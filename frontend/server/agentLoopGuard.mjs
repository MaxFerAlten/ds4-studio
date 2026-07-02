import { createHash } from "node:crypto";

const FILE_TOKEN_RE =
  /(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:c|h|cu|cuh|m|mm|metal|js|mjs|jsx|ts|tsx|py|md|txt|json|inc|sh)\b/g;

function normalizeGuardMode(mode) {
  const value = String(mode || "block").trim().toLowerCase();
  return value === "off" || value === "warn" ? value : "block";
}

export function findRepeatedNgrams(text, n = 5) {
  const words = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const counts = new Map();
  for (let i = 0; i + n <= words.length; i++) {
    const gram = words.slice(i, i + n).join(" ");
    counts.set(gram, (counts.get(gram) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1);
}

export function checkAssistantFileListEcho(text, {
  maxFileTokens = 40,
  maxSameFile = 3,
  maxRepeatedFiveGram = 2,
  maxCharsWithoutState = 6000,
  maxToolOutputMarkers = 2
} = {}) {
  const content = String(text || "");
  const files = content.match(FILE_TOKEN_RE) || [];

  if (files.length > maxFileTokens) {
    return {
      block: true,
      type: "STOP_FILE_LIST_ECHO",
      reason: `Assistant attempted to emit ${files.length} file tokens.`,
      guidance: "Compress repository listings into categories and select one target."
    };
  }

  const counts = new Map();
  for (const file of files) counts.set(file, (counts.get(file) || 0) + 1);
  const repeatedFiles = [...counts.entries()].filter(([, count]) => count > maxSameFile);
  if (repeatedFiles.length) {
    return {
      block: true,
      type: "STOP_REPEATED_FILE_ECHO",
      reason: `Repeated file names: ${repeatedFiles.slice(0, 8).map(([file, count]) => `${file} x${count}`).join(", ")}`,
      guidance: "Do not repeat the same repository listing. Summarize and move to a verdict."
    };
  }

  const repeatedGrams = findRepeatedNgrams(content, 5)
    .filter(([, count]) => count > maxRepeatedFiveGram);
  if (repeatedGrams.length) {
    return {
      block: true,
      type: "STOP_REPEATED_TEXT_ECHO",
      reason: `Repeated phrase: "${repeatedGrams[0][0]}" x${repeatedGrams[0][1]}`,
      guidance: "Stop repeated narration and produce [OBSERVATION] or [VERDICT]."
    };
  }

  const markerCount = (content.match(/TOOL_OUTPUT_COMPRESSED|ds4 compressed tool output|tool output compressed/gi) || []).length;
  if (markerCount > maxToolOutputMarkers) {
    return {
      block: true,
      type: "STOP_TOOL_OUTPUT_ECHO",
      reason: `Assistant repeated tool-output markers ${markerCount} times.`,
      guidance: "Summarize the observation once and select one target."
    };
  }

  if (
    content.length > maxCharsWithoutState &&
    !/\[(ACTION|OBSERVATION|COMPRESSED|TARGET_SELECTED|VERDICT|STOP)\]/.test(content)
  ) {
    return {
      block: true,
      type: "STOP_UNSTRUCTURED_LONG_OUTPUT",
      reason: `Assistant output exceeded ${maxCharsWithoutState} chars without a state marker.`,
      guidance: "Use structured output and summarize."
    };
  }

  return undefined;
}

export function guardAssistantDelta(currentContent, deltaText, guard) {
  const current = String(currentContent || "");
  const next = current + String(deltaText || "");
  const decision = guard?.checkAssistantOutput
    ? guard.checkAssistantOutput(next)
    : checkAssistantFileListEcho(next);
  return {
    content: decision?.block ? current : next,
    accepted: !decision?.block,
    decision
  };
}

export function hasStructuredSynthesis(text) {
  const content = String(text || "");
  const positions = [
    content.indexOf("[OBSERVATION]"),
    content.indexOf("[COMPRESSED]"),
    content.indexOf("[TARGET_SELECTED]"),
    content.indexOf("[VERDICT]")
  ];
  return positions.every((position) => position >= 0) &&
    positions.every((position, index) => index === 0 || position > positions[index - 1]);
}

function stableJson(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
}

export function normalizeAgentIntentText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9_./-]+/g, " ")
    .replace(/\b(let me|i need to|i should|i will|i ll|now|next|continuo|procedo|passo a)\b/g, " ")
    .replace(/\b(look at|check|inspect|read|open|view|analizza|controlla|leggi|guarda)\b/g, "inspect")
    .replace(/\b(the|a|an|il|lo|la|i|gli|le|un|una|del|della|dei|degli)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAmbiguityText(text) {
  const content = String(text || "").toLowerCase();
  if (!/(maybe|perhaps|given the ambiguity|could mean|forse|potrebbe voler dire|ambiguit)/i.test(content)) {
    return "";
  }

  // The runtime permits one ambiguity assessment per turn. A second one must
  // select an operating assumption instead of reopening the same decision.
  return "ambiguity";
}

export function actionSignature({ phase = "", tool = "", target = "", args = {} } = {}) {
  const normalized = {
    phase: String(phase || "").toLowerCase(),
    tool: String(tool || "").toLowerCase(),
    target: String(target || "").toLowerCase(),
    args
  };
  return createHash("sha256").update(stableJson(normalized)).digest("hex").slice(0, 24);
}

export class AgentLoopGuard {
  constructor({
    maxSameIntent = 2,
    maxSameAction = 1,
    maxNoProgress = 3,
    loopMode = "block",
    outputEchoMode = "block"
  } = {}) {
    this.maxSameIntent = maxSameIntent;
    this.maxSameAction = maxSameAction;
    this.maxNoProgress = maxNoProgress;
    this.loopMode = normalizeGuardMode(loopMode);
    this.outputEchoMode = normalizeGuardMode(outputEchoMode);
    this.intentCounts = new Map();
    this.ambiguityCounts = new Map();
    this.actionCounts = new Map();
    this.progressHashes = new Set();
    this.noProgressCount = 0;
    this.observationFlowRequired = false;
  }

  beginTurn() {
    this.intentCounts.clear();
    this.ambiguityCounts.clear();
    this.actionCounts.clear();
    this.progressHashes.clear();
    this.noProgressCount = 0;
    this.observationFlowRequired = false;
  }

  _applyMode(decision, mode) {
    const normalized = normalizeGuardMode(mode);
    if (normalized === "off") return undefined;
    return {
      ...decision,
      block: normalized === "block",
      warn: normalized === "warn",
      mode: normalized
    };
  }

  checkAssistantOutput(text) {
    const decision = checkAssistantFileListEcho(text);
    return decision ? this._applyMode(decision, this.outputEchoMode) : undefined;
  }

  recordCompressedObservation() {
    this.observationFlowRequired = true;
  }

  requiresStructuredObservation() {
    return this.observationFlowRequired;
  }

  _checkObservationFlow(text) {
    if (!this.observationFlowRequired) return undefined;
    if (hasStructuredSynthesis(text)) {
      this.observationFlowRequired = false;
      return undefined;
    }

    const decision = this._applyMode({
      block: true,
      type: "STOP_MISSING_OBSERVATION_FLOW",
      reason: "A compressed tool observation was not converted into an ordered observation, target, and verdict.",
      guidance: "Required order: [OBSERVATION] [COMPRESSED] [TARGET_SELECTED] [VERDICT]."
    }, this.loopMode);
    if (!decision || decision.block) this.observationFlowRequired = false;
    return decision;
  }

  checkAmbiguity(text) {
    const key = normalizeAmbiguityText(text);
    if (!key) return undefined;

    const count = (this.ambiguityCounts.get(key) || 0) + 1;
    this.ambiguityCounts.set(key, count);
    if (count < 2) return undefined;

    return this._applyMode({
      block: true,
      type: "STOP_AMBIGUITY_LOOP",
      reason: "Repeated ambiguity reasoning detected.",
      guidance: "Choose an operating assumption, produce [TARGET_SELECTED], or stop with [VERDICT]."
    }, this.loopMode);
  }

  checkAssistantText(text) {
    const observationDecision = this._checkObservationFlow(text);
    if (observationDecision) return observationDecision;

    const ambiguityDecision = this.checkAmbiguity(text);
    if (ambiguityDecision) return ambiguityDecision;

    const intent = normalizeAgentIntentText(text);
    if (!intent) return undefined;

    // Only guard inspection-style intent. Do not block normal useful prose.
    if (!/\binspect\b/.test(intent)) return undefined;

    const count = (this.intentCounts.get(intent) || 0) + 1;
    this.intentCounts.set(intent, count);

    if (count >= this.maxSameIntent) {
      return this._applyMode({
        block: true,
        type: "STOP_LOOP",
        reason: `Repeated agent inspection intent blocked: ${intent}`,
        guidance: [
          "Do not repeat the same inspection sentence.",
          "Use the previous observation, change strategy, or stop with a verdict."
        ].join(" ")
      }, this.loopMode);
    }

    return undefined;
  }

  checkAction(action) {
    const sig = actionSignature(action);
    const count = (this.actionCounts.get(sig) || 0) + 1;
    this.actionCounts.set(sig, count);

    if (count > this.maxSameAction) {
      return this._applyMode({
        block: true,
        type: "STOP_ACTION_LOOP",
        signature: sig,
        reason: `Repeated tool/action signature blocked: ${sig}`,
        guidance: "Do not retry the same action. Reuse prior output, change arguments, or stop."
      }, this.loopMode);
    }

    return undefined;
  }

  recordProgress(label, payload) {
    const h = createHash("sha256").update(`${label}:${stableJson(payload)}`).digest("hex");
    if (this.progressHashes.has(h)) {
      this.noProgressCount += 1;
    } else {
      this.progressHashes.add(h);
      this.noProgressCount = 0;
    }

    if (this.noProgressCount >= this.maxNoProgress) {
      return this._applyMode({
        block: true,
        type: "STOP_NO_PROGRESS",
        reason: "No new observation/progress across repeated steps.",
        guidance: "Stop the turn and report the last useful observation."
      }, this.loopMode);
    }

    return undefined;
  }
}
