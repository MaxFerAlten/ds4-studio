/**
 * JS mirror of the native P0 lexical/structural scan (§46/§62).
 *
 * A match means only "unsupported by evidence observed in this turn". It is
 * never a semantic verdict that the sentence is false.
 */

const RULES = Object.freeze([
  Object.freeze({
    code: "F03",
    requires: "observation",
    pattern:
      /\b(we measured|i measured|we benchmarked|experiment confirmed|the experiment confirmed|experiment shows|abbiamo misurato|ho misurato|l'esperimento conferma|l'esperimento ha confermato|l'esperimento mostra)\b/i
  }),
  Object.freeze({
    code: "F18",
    requires: "observation",
    pattern:
      /\b(confirmed by internal analysis|confirmed by our analysis|internal analysis confirms|our analysis confirms|confermato dall'analisi interna|confermato dalla nostra analisi|l'analisi interna conferma|la nostra analisi conferma)\b/i
  }),
  Object.freeze({
    code: "F04",
    requires: "execution",
    pattern:
      /\b(working code|passes tests|passed tests|ran successfully|tested|benchmark shows|codice funzionante|i test passano|eseguito con successo|testato|testata|il benchmark mostra)\b/i
  }),
  Object.freeze({
    code: "F12",
    requires: "sourceOrComputation",
    pattern:
      /\b(official|officially|exact architecture|verified value|ufficiale|ufficialmente|architettura esatta|valore verificato)\b/i
  })
]);

const IDENTIFIER = /\b(?:arxiv\s*:\s*\d{4}\.\d{4,5}|doi\s*:\s*10\.)/i;
const CONCESSION =
  /\b(you are right|you're right|you were right|hai ragione|ha ragione|avevi ragione|hai perfettamente ragione)\b/i;
const SOURCE_TOOLS = new Set(["web_search", "google_search", "search", "visit_page", "crawl", "research"]);

function evidenceFacts(evidence) {
  const items = Array.isArray(evidence) ? evidence : [];
  const executed = items.filter(
    (item) => item?.evidenceType === "tool_execution" && item?.status === "EXECUTED"
  );
  const execution = executed.some((item) => item.toolName === "bash");
  const computation = executed.some((item) => item.toolName === "sage");
  const source = items.some(
    (item) =>
      item?.evidenceType === "source_document" ||
      (item?.status === "EXECUTED" && SOURCE_TOOLS.has(item?.toolName))
  );
  return { execution, computation, observation: execution || computation, source };
}

function requirementMet(requires, facts) {
  if (requires === "execution") return facts.execution;
  if (requires === "observation") return facts.observation;
  if (requires === "sourceOrComputation") return facts.source || facts.computation;
  return false;
}

export function scanDeterministicEpistemicFailures({
  text = "",
  evidence = [],
  challengeTurn = false
} = {}) {
  const content = String(text ?? "");
  const facts = evidenceFacts(evidence);
  const failures = [];

  for (const rule of RULES) {
    const match = content.match(rule.pattern)?.[0] ?? null;
    if (match && !requirementMet(rule.requires, facts)) {
      failures.push(Object.freeze({ code: rule.code, match, requirement: rule.requires }));
    }
  }

  const identifier = content.match(IDENTIFIER)?.[0] ?? null;
  if (identifier && !facts.source) {
    failures.push(Object.freeze({ code: "F17", match: identifier, requirement: "source" }));
  }

  if (challengeTurn && failures.length > 0) {
    const concession = content.match(CONCESSION)?.[0] ?? null;
    if (concession) {
      failures.push(
        Object.freeze({ code: "F25", match: concession, requirement: "replacement_verification" })
      );
    }
  }

  return Object.freeze({
    verdict: failures.length > 0 ? "BLOCK_UNSUPPORTED" : "ALLOW",
    blocked: failures.length > 0,
    failureCodes: Object.freeze([...new Set(failures.map((failure) => failure.code))]),
    findings: Object.freeze(failures)
  });
}
