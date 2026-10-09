import { createHash } from "node:crypto";

import { loadAgentLoopPolicy } from "./agentLoopPolicy.mjs";

// A trailing ":line" (or ":start-end") is kept in the token: an audit report
// citing ds4.c:120 and ds4.c:340 references two places, it is not an echo.
const FILE_TOKEN_RE =
  /(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:c|h|cu|cuh|m|mm|metal|js|mjs|jsx|ts|tsx|py|md|txt|json|inc|sh)\b(?::\d+(?:-\d+)?)?/g;

// File tokens that name a file: the tail of a glob ("server/*.test.mjs" ->
// ".test.mjs") names a pattern, and a command repeated in a report must not
// count as the same file echoed four times.
function fileTokenMatches(content) {
  return [...content.matchAll(FILE_TOKEN_RE)]
    .filter((match) => !/[*?\]}]/.test(content[match.index - 1] ?? ""));
}

// Words that carry no claim, so two mentions differing only in them still say
// the same thing. Italian and English: the model answers in the user's language.
const ECHO_STOPWORDS = new Set((
  "il lo la i gli le un uno una di a da in con su per tra fra del dello della dei degli delle " +
  "al allo alla ai agli alle dal dallo dalla dai dagli dalle nel nello nella nei negli nelle " +
  "sul sullo sulla sui sugli sulle e ed o che non si ci ne come anche ma se poi qui piu " +
  "e' e questo questa quello quella sono essere viene vengono stato stata ha hanno " +
  "the a an of to in on at for from with by and or but is are was were be been being " +
  "this that these those it its as not no also then there here which"
).split(/\s+/));

// Equivalence threshold on the stemmed word sets of two mentions' context.
const ECHO_CONTEXT_SIMILARITY = 0.6;
const ECHO_CONTEXT_CHARS = 160;

/**
 * What a file mention says: the text after it, up to the end of its line,
 * reduced to a set of word stems. Lowercased, accents folded, stopwords
 * dropped, words cut to 6 chars so "controllo/controlla", "buffer/buffers"
 * meet. Cheap enough to run on every streamed delta.
 */
export function echoContextKey(text) {
  const words = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !ECHO_STOPWORDS.has(word));
  return new Set(words.map((word) => word.slice(0, 6)));
}

export function echoContextSimilarity(a, b) {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Largest group of mentions of each file token that say the same thing.
 * A file cited many times for different findings is a report; the same
 * citation with the same (or reworded) text is an echo.
 */
export function equivalentFileMentions(content) {
  const groups = new Map();
  for (const match of fileTokenMatches(content)) {
    const start = match.index + match[0].length;
    const lineEnd = content.indexOf("\n", start);
    const end = Math.min(lineEnd < 0 ? content.length : lineEnd, start + ECHO_CONTEXT_CHARS);
    const key = echoContextKey(content.slice(start, end));
    let clusters = groups.get(match[0]);
    if (!clusters) groups.set(match[0], clusters = []);
    const same = clusters.find((cluster) =>
      echoContextSimilarity(cluster.key, key) >= ECHO_CONTEXT_SIMILARITY);
    if (same) same.count++;
    else clusters.push({ key, count: 1 });
  }
  return [...groups.entries()].map(([file, clusters]) =>
    [file, Math.max(...clusters.map((cluster) => cluster.count))]);
}

/**
 * Whether long prose is organized: state markers, or a markdown report
 * (headings, lists, tables). The state markers are only requested after a
 * compressed observation or a progress block, so a long final report the model
 * was never told to mark up must not be read as runaway narration. Repetition
 * inside a structured report is the echo checks' job, not this one's.
 */
const STATE_MARKER_RE = /\[(ACTION|OBSERVATION|COMPRESSED|TARGET_SELECTED|VERDICT|STOP)\]/;

export function hasStructuredOutput(text) {
  const content = String(text || "");
  return STATE_MARKER_RE.test(content) || hasMarkdownStructure(content);
}

function hasMarkdownStructure(content) {
  let headings = 0;
  let items = 0;
  for (const line of content.split("\n")) {
    if (/^\s{0,3}#{1,6}\s+\S/.test(line)) headings++;
    else if (/^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line) || /^\s*\|.*\|\s*$/.test(line)) items++;
  }
  return headings >= 2 || headings + items >= 6;
}

const MIN_REPORT_CHARS = 400;

/** A final answer that reports findings rather than announcing more work. */
export function isSubstantialReport(text) {
  const content = String(text || "").trim();
  // Markers mean the model attempted the checkpoint format: an incomplete one
  // is a failed checkpoint, judged by the marker rule, not a prose report.
  if (STATE_MARKER_RE.test(content)) return false;
  if (hasMarkdownStructure(content)) return true;
  return content.replace(/\s+/g, " ").length >= MIN_REPORT_CHARS;
}

function normalizeGuardMode(mode) {
  const value = String(mode || "block").trim().toLowerCase();
  return value === "off" || value === "warn" ? value : "block";
}

// Code quoted in an analysis repeats by nature (the same bound, the same
// condition): it is not narration, so the n-gram echo check skips it.  Fenced
// and inline code go, and so does any word carrying a code operator.  Not in
// the C loop, which has no n-gram echo check at all (WP16, option a).
const CODE_WORD = /->|::|==|!=|<=|>=|&&|\|\||[{}()[\];<>=*&!]/;
const LONE_OPERATOR = /^[-+*/%^|]+$/;
export function withoutCode(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .split(/\s+/)
    .filter((word) => word && !CODE_WORD.test(word) && !LONE_OPERATOR.test(word))
    .join(" ");
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

// A markdown table row that names a file and carries another non-empty cell
// (a count, a verdict, a line) is a result, not a listing: a table of 41
// measured files is a report (WP16).  Bare lists and one-column tables of
// file names still count toward the listing limit.
function withoutResultRows(content) {
  return content.split("\n").filter((line) => {
    if (!/^\s*\|.*\|\s*$/.test(line)) return true;
    const cells = line.trim().slice(1, -1).split("|").map((cell) => cell.trim());
    const withoutFile = cells.filter((cell) => cell && !fileTokenMatches(cell).length);
    return withoutFile.length === 0;
  }).join("\n");
}

export function checkAssistantFileListEcho(text, {
  maxFileTokens = 40,
  maxSameFile = 3,
  maxRepeatedFiveGram = 2,
  maxCharsWithoutState = 6000,
  maxToolOutputMarkers = 2
} = {}) {
  const content = String(text || "");
  const files = fileTokenMatches(content);
  const listed = fileTokenMatches(withoutResultRows(content));

  if (listed.length > maxFileTokens) {
    return {
      block: true,
      type: "STOP_FILE_LIST_ECHO",
      reason: `Assistant attempted to emit ${listed.length} file tokens.`,
      guidance: "Compress repository listings into categories and select one target."
    };
  }

  // Counted per meaning, not per name: only mentions whose following text is
  // equivalent add up (a bare repeated listing is equivalent to itself).
  const repeatedFiles = equivalentFileMentions(content)
    .filter(([, count]) => count > maxSameFile);
  if (repeatedFiles.length) {
    return {
      block: true,
      type: "STOP_REPEATED_FILE_ECHO",
      reason: `Repeated file names with the same content: ${repeatedFiles.slice(0, 8).map(([file, count]) => `${file} x${count}`).join(", ")}`,
      guidance: "Do not repeat the same repository listing. Summarize and move to a verdict."
    };
  }

  const repeatedGrams = findRepeatedNgrams(withoutCode(content), 5)
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

  if (content.length > maxCharsWithoutState && !hasStructuredOutput(content)) {
    return {
      block: true,
      type: "STOP_UNSTRUCTURED_LONG_OUTPUT",
      reason: `Assistant output exceeded ${maxCharsWithoutState} chars without a state marker or markdown structure.`,
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

/**
 * A structured synthesis sent as a whole reply, read as what it asks for:
 * "continue" (GO/RETEST with a target to look at next) or "finish" (STOP, or
 * nothing left to look at). Undefined when the text is not such a block.
 */
export function readStructuredCheckpoint(text) {
  const content = String(text || "");
  if (!hasStructuredSynthesis(content)) return undefined;
  const verdict = (content.match(/\[VERDICT\]\s*\**\s*(GO|STOP|RETEST)\b/i)?.[1] || "").toUpperCase();
  const targetMatch = content.match(/\[TARGET_SELECTED\]([\s\S]*?)\[VERDICT\]/);
  const target = (targetMatch?.[1] || "").trim();
  const noTarget = !target ||
    /^[-*_\s]*(?:none|nessun[oa]?|niente|n\/a|nulla)\b/i.test(target);
  const next = (verdict === "GO" || verdict === "RETEST") && !noTarget ? "continue" : "finish";
  return { verdict: verdict || null, target: noTarget ? null : target, next };
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

function emptyProtocolState() {
  return {
    lastCode: "",
    lastFingerprint: "",
    sameFailureCount: 0,
    totalFailureCount: 0,
    strategyChangeRequired: false,
    terminal: false,
    terminalReason: ""
  };
}

/**
 * Canonical identity of a protocol failure, byte-for-byte compatible with
 * ds4_agent_protocol_failure_fingerprint in C.
 *
 * Digit runs collapse to '#' and whitespace collapses to one space: an offset
 * or a token count in the message must not make the same error look new every
 * round, which is exactly how the observed loop survived. Timestamps and round
 * numbers are never part of the material.
 *
 * The two implementations exist because the failure is detected on two sides;
 * they agree because a divergence here would mean one side never counts a
 * repeat the other side does.
 */
export function protocolFailureFingerprint(code, detail = "") {
  let norm = "";
  let prevSpace = false;
  let prevDigit = false;
  for (const ch of String(detail || "")) {
    if (norm.length >= 256) break;
    if (/\s/.test(ch)) {
      prevDigit = false;
      if (!prevSpace && norm.length > 0) {
        norm += " ";
        prevSpace = true;
      }
      continue;
    }
    prevSpace = false;
    if (ch >= "0" && ch <= "9") {
      if (prevDigit) continue;
      prevDigit = true;
      norm += "#";
      continue;
    }
    prevDigit = false;
    norm += ch.toLowerCase();
  }
  norm = norm.replace(/ +$/, "");

  // C builds the material into a 320-byte buffer; the cut is on bytes, not on
  // code points, so it is done on bytes here too.
  const material = Buffer.from(`${code}|${norm}`, "utf8").subarray(0, 319);
  return createHash("sha256").update(material).digest("hex");
}

const PROTOCOL_REPAIR_HINTS = {
  DSML_TOOL_INSIDE_THINK:
    "Close </think> before any DSML.\nEmit exactly one valid tool call outside reasoning.\nDo not explain the formatting error.",
  DSML_INCOMPLETE_CALL:
    "The DSML stanza ended mid-call.\nEmit one short, complete tool call, or answer with what you have.",
  DSML_PARSE_ERROR:
    "The DSML stanza did not parse.\nEmit exactly one syntactically valid tool call.",
  TOOL_PREFLIGHT_ERROR:
    "The call was rejected before execution.\nFix the arguments named in the error, or choose a different tool.",
  DEGENERATE_GENERATION:
    "The text degenerated into repeating the same lines.\nDo not restate previous sentences; answer directly with what was learned so far, or make ONE different tool call."
};

export class AgentLoopGuard {
  /**
   * The thresholds come from config/agent-loop-policy.json, the same file the
   * native worker compiles in. C and Node enforce separately — the DSML parser
   * is not portable and porting it would be worse than two enforcement points —
   * but they may not disagree about the numbers. Explicit values are for tests.
   */
  constructor({
    policy = loadAgentLoopPolicy(),
    // A repeated intent and a repeated action are the same rung of the same
    // ladder: the intent is the action that has not happened yet.
    maxSameIntent = policy.repeatedActionStrategyChange,
    repeatedActionStrategyChange = policy.repeatedActionStrategyChange,
    maxNoProgress = policy.noProgressTerminal,
    loopMode = "block",
    outputEchoMode = "block"
  } = {}) {
    this.policy = policy;
    this.maxSameIntent = maxSameIntent;
    this.repeatedActionStrategyChange = repeatedActionStrategyChange;
    this.maxNoProgress = maxNoProgress;
    this.loopMode = normalizeGuardMode(loopMode);
    this.outputEchoMode = normalizeGuardMode(outputEchoMode);
    this.intentCounts = new Map();
    this.ambiguityCounts = new Map();
    this.actionCounts = new Map();
    this.progressHashes = new Set();
    this.noProgressCount = 0;
    this.observationFlowRequired = false;
    this.protocol = emptyProtocolState();
  }

  beginTurn() {
    this.intentCounts.clear();
    this.ambiguityCounts.clear();
    this.actionCounts.clear();
    this.progressHashes.clear();
    this.noProgressCount = 0;
    this.observationFlowRequired = false;
    this.protocol = emptyProtocolState();
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

  _checkObservationFlow(text, { isFinalResponse = true } = {}) {
    if (!this.observationFlowRequired) return undefined;
    if (hasStructuredSynthesis(text)) {
      this.observationFlowRequired = false;
      return undefined;
    }
    // The markers are the intermediate checkpoint format; the final answer is
    // asked for as a prose report without them (toolOutputCompressor marker,
    // AGENT_CHECKPOINT_FINAL_PROMPT).  A report that actually synthesizes the
    // observations -- markdown structure, or substantial prose -- satisfies
    // the requirement.  What stays blocked is a final turn that only announces
    // more reading ("I will keep reading the repository.").
    if (isFinalResponse && isSubstantialReport(text)) {
      this.observationFlowRequired = false;
      return undefined;
    }
    // A tool call is deferral, not a failure to synthesize: the compressed
    // payload itself offers retrieve_context_blob as the next step, and a model
    // that takes it answers with tool_calls and no content at all. Stay armed
    // and judge the prose turn that follows. Unbounded deferral is already the
    // tool-round ceiling's job, not this guard's.
    if (!isFinalResponse) return undefined;

    const decision = this._applyMode({
      block: true,
      type: "STOP_MISSING_OBSERVATION_FLOW",
      reason: "A compressed tool observation was not converted into an ordered observation, target, and verdict.",
      guidance: "Required order: [OBSERVATION] [COMPRESSED] [TARGET_SELECTED] [VERDICT]."
    }, this.loopMode);
    // A non-empty final answer is the turn's deliverable: blocking it discards
    // what the user asked for (a short "WP2 done, report in docs/..." was being
    // thrown away after a long run).  Report the missing synthesis instead.
    // Only an empty final answer -- nothing to publish -- is still blocked.
    // A partial checkpoint keeps the requirement armed, as before.
    if (decision?.block && String(text || "").trim() &&
        !STATE_MARKER_RE.test(String(text))) {
      this.observationFlowRequired = false;
      return { ...decision, block: false, warn: true };
    }
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

  checkAssistantText(text, options = {}) {
    const observationDecision = this._checkObservationFlow(text, options);
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

    if (count >= this.repeatedActionStrategyChange) {
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

  /**
   * Same escalation ladder as the native worker: one repair round, then a
   * forced strategy change, then terminal. Terminal is latched for the turn —
   * the model may explain an error but may not decide whether it is terminal.
   */
  recordProtocolFailure({ code = "", detail = "", tool = "", phase = "" } = {}) {
    const p = this.protocol;
    const fingerprint = protocolFailureFingerprint(code, detail);

    if (p.terminal) {
      return {
        terminal: true,
        strategyChangeRequired: false,
        sameFailureCount: p.sameFailureCount,
        totalFailureCount: p.totalFailureCount,
        fingerprint: p.lastFingerprint,
        guidance: this._protocolGuidance("terminal", code, detail)
      };
    }

    p.sameFailureCount =
      p.lastFingerprint && p.lastFingerprint === fingerprint
        ? p.sameFailureCount + 1
        : 1;
    p.lastFingerprint = fingerprint;
    p.lastCode = code;
    p.totalFailureCount += 1;

    let stage = "repair";
    if (p.sameFailureCount >= this.policy.protocolSameFailureTerminal) {
      p.terminal = true;
      p.terminalReason = `identical protocol failure repeated ${p.sameFailureCount} times`;
      stage = "terminal";
    } else if (p.totalFailureCount >= this.policy.protocolTotalFailureTerminal) {
      p.terminal = true;
      p.terminalReason = `${p.totalFailureCount} protocol failures in a single turn`;
      stage = "terminal";
    } else if (p.sameFailureCount >= this.policy.protocolSameFailureStrategyChange) {
      p.strategyChangeRequired = true;
      stage = "strategy_change";
    } else {
      p.strategyChangeRequired = false;
    }

    return {
      terminal: p.terminal,
      strategyChangeRequired: p.strategyChangeRequired,
      sameFailureCount: p.sameFailureCount,
      totalFailureCount: p.totalFailureCount,
      fingerprint,
      tool,
      phase,
      guidance: this._protocolGuidance(stage, code, detail)
    };
  }

  /** A round with a well-formed call clears the streak, never the turn total. */
  noteProtocolSuccess() {
    if (this.protocol.terminal) return;
    this.protocol.sameFailureCount = 0;
    this.protocol.lastCode = "";
    this.protocol.lastFingerprint = "";
    this.protocol.strategyChangeRequired = false;
  }

  _protocolGuidance(stage, code, detail) {
    const p = this.protocol;
    const head = [
      `code=${code || "NONE"}`,
      `sameFailureCount=${p.sameFailureCount}`,
      `totalFailureCount=${p.totalFailureCount}`
    ].join("\n");
    const body = detail ? `\ndetail: ${detail}\n` : "";

    if (stage === "terminal") {
      return [
        "TOOL_PROTOCOL_TERMINAL",
        "code=TOOL_CONTRACT_FAILURE",
        `failureClass=${code || "NONE"}`,
        `sameFailureCount=${p.sameFailureCount}`,
        `totalFailureCount=${p.totalFailureCount}`,
        "terminal=true",
        p.terminalReason ? `reason=${p.terminalReason}` : "",
        body,
        "No further tool call may be made in this turn."
      ]
        .filter(Boolean)
        .join("\n");
    }
    if (stage === "strategy_change") {
      return [
        "TOOL_PROTOCOL_STRATEGY_CHANGE_REQUIRED",
        head,
        "terminal=false",
        body,
        "The same protocol failure has now happened twice.",
        "Do not attempt another tool call in this round.",
        "Produce a concise final answer from existing evidence,",
        "unless an authoritative domain task is still nonterminal."
      ]
        .filter(Boolean)
        .join("\n");
    }
    return [
      "TOOL_PROTOCOL_REPAIR_REQUIRED",
      head,
      "terminal=false",
      body,
      PROTOCOL_REPAIR_HINTS[code] || ""
    ]
      .filter(Boolean)
      .join("\n");
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
