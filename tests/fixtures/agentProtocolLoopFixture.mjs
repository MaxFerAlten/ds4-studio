// Transcripts the agent loop guards were written against, kept apart from the
// tests so the native and Node suites can assert against the same bytes.
//
// The detail below is not illustrative: protocolFailureFingerprint hashes it,
// and frontend/server/agentLoopGuard.test.mjs pins the result to the value the
// native test prints as PROTOCOL_FINGERPRINT DSML_TOOL_INSIDE_THINK=...  It is
// reproduced from temp/ds4_agent.c (the printf feeding that line), so editing
// it here without editing it there is exactly the divergence the test exists to
// catch. The ｜ is a fullwidth vertical line, as the native source spells it.
export const DSML_IN_THINK_ERROR =
  "tool calling is not allowed inside <think></think>. " +
  "You MUST explicitly write </think> BEFORE writing " +
  "<｜DSML｜tool_calls>";

// The same failure three times over. The policy escalates on repeats
// (protocolSameFailureStrategyChange 2, protocolSameFailureTerminal 3), so the
// rounds must be identical: repair, then strategy change, then terminal.
export const dsmlInThinkLoopRounds = [
  { code: "DSML_TOOL_INSIDE_THINK", detail: DSML_IN_THINK_ERROR },
  { code: "DSML_TOOL_INSIDE_THINK", detail: DSML_IN_THINK_ERROR },
  { code: "DSML_TOOL_INSIDE_THINK", detail: DSML_IN_THINK_ERROR },
];

// Six failures, no two alike, so the same-failure ladder never fires and only
// the per-turn total (protocolTotalFailureTerminal 6) can end the turn. A model
// that varies its mistakes is still a model that is not making progress.
export const alternatingProtocolFailureRounds = [
  { code: "DSML_TOOL_INSIDE_THINK", detail: DSML_IN_THINK_ERROR },
  { code: "DSML_PARSE_ERROR", detail: "parse error at byte 1024" },
  { code: "DSML_INCOMPLETE_CALL", detail: "stanza ended mid-call" },
  { code: "TOOL_PREFLIGHT_FAILED", detail: "unknown tool: retrieve_blob" },
  { code: "DSML_PARSE_ERROR", detail: "unterminated string" },
  { code: "DSML_TOOL_INSIDE_THINK", detail: "tool call emitted before </think>" },
];

// From the transcript that motivated the gate: with lean_check refused the
// model worked down its tool list rather than publishing. Every one of these
// has to be blocked, not just the prover.
export const toolsAttemptedAfterLeanTerminal = [
  "lean_check",
  "bash",
  "read",
  "search",
  "crawl",
  "web_search",
  "sage",
];

// The Lean task ran out of budget without a verified proof: terminal, so the
// turn may only publish, and not verified, so it may not claim the theorem.
export const leanBudgetExhaustedSnapshot = {
  terminal: true,
  verified: false,
};
