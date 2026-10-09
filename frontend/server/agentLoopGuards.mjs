// WP12 of convergenza.loop.md — guard parity: fabricated results, defensive
// loop, date/time context.
//
// Ported 1:1 from the C loop (shadow ds4_agent.c):
//   - agent_is_fabricated_result  :20212-20235 (six bare markers, strstr)
//   - agent_is_defensive_text     :20242-20257 (ten phrases, strstr, case-sensitive)
//   - fabrication tool error      :24096-24104 (inject, continue, count defensive)
//   - defensive stop              :24181-24202 (check >= 3 BEFORE incrementing,
//                                   publish no candidate bytes)
//   - defensive counter           :24204-24208 (++ / reset on plain text)
//   - loop-guard status           :24194
//   - datetime context            :3352-3370 (once per session, strftime
//                                   "%Y-%m-%d %H:%M:%S %Z")
// Deviations (declared in docs/convergenza/WP12.md): the datetime message
// rides as role "user" with the "[DS4 Studio]" prefix instead of role
// "system" (WP7 policy: templates reject non-head system messages), and the
// C tree has no dedicated unit tests for the two detectors, so the phrase
// tables below are the copied reference.

export const FABRICATION_MARKERS = Object.freeze([
  "<search_results>",
  "</search_results>",
  "<crawl_results>",
  "</crawl_results>",
  "<tool_results>",
  "</tool_results>"
]);

export const DEFENSE_PHRASES = Object.freeze([
  "I did search", "i did search",
  "the block shows", "the search results show",
  "as proof", "prova che ho cercato",
  "ho cercato", "la ricerca ha prodotto",
  "sostengo di aver", "continuo a sostenere"
]);

// C :24096-24101 — appended as the tool error when a fabricated result is
// detected (the trailing newline is part of the C string).
export const FABRICATION_TOOL_ERROR_TEXT =
  "Tool error: simulated result detected — you wrote " +
  "<search_results>, <crawl_results> or <tool_results> " +
  "without executing a real tool call. Do not simulate " +
  "tool output. Use the proper DSML syntax to invoke the " +
  "tool, then report its real result.\n";

// C :24184-24191 — appended when the defensive loop is stopped.
export const DEFENSIVE_LOOP_ERROR_TEXT =
  "Tool error: loop detected — repeated defensive responses " +
  "without admitting the error. Stop defending and answer " +
  "directly with what was learned so far:\n" +
  "[OBSERVATION] what was learned\n" +
  "[COMPRESSED] <= 10 lines\n" +
  "[TARGET_SELECTED] the single next thing to try\n" +
  "[VERDICT] GO / STOP / RETEST\n";

// C :24194 — the published system status on a defensive stop.
export const LOOP_GUARD_STATUS_TEXT =
  "Loop guard: difesa ripetuta senza ammissione — arresto.";

// C :24181 — the stop fires when the counter is already >= 3 (so the fourth
// consecutive defensive/fabricated plain-text turn stops the loop).
export const DEFENSIVE_STOP_THRESHOLD = 3;

/** C agent_is_fabricated_result: any bare result marker is fabrication. */
export function isFabricatedResult(text) {
  if (!text) return false;
  for (const marker of FABRICATION_MARKERS) {
    if (text.includes(marker)) return true;
  }
  return false;
}

/** C agent_is_defensive_text: case-sensitive substring table. */
export function isDefensiveText(text) {
  if (!text) return false;
  for (const phrase of DEFENSE_PHRASES) {
    if (text.includes(phrase)) return true;
  }
  return false;
}

export function createLoopGuardState() {
  // C globals are zero-initialized; the worker starts with no defensive run
  // and no datetime context (ds4_agent.c:446 and the injected flag).
  return { consecutiveDefensive: 0, datetimeInjected: false };
}

/** C :24094 — a fabricated answer shares the defensive counter. */
export function noteFabricatedResult(loopGuard) {
  if (loopGuard) loopGuard.consecutiveDefensive += 1;
}

/**
 * C :24181-24208 for one plain-text final response.  The counter is checked
 * BEFORE it is incremented, exactly like C: three defensive turns pass, the
 * fourth stops the loop.  Mutates and returns { stop, count }.
 */
export function evaluateDefensiveLoop(loopGuard, text) {
  if (!isDefensiveText(text)) {
    loopGuard.consecutiveDefensive = 0;
    return { stop: false, count: 0 };
  }
  if (loopGuard.consecutiveDefensive >= DEFENSIVE_STOP_THRESHOLD) {
    return { stop: true, count: loopGuard.consecutiveDefensive };
  }
  loopGuard.consecutiveDefensive += 1;
  return { stop: false, count: loopGuard.consecutiveDefensive };
}

/** C strftime "%Y-%m-%d %H:%M:%S %Z" over local time. */
export function formatLocalDateTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  let zone = "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(date);
    zone = (parts.find((part) => part.type === "timeZoneName") || {}).value || "";
  } catch {
    zone = "";
  }
  return zone ? `${stamp} ${zone}` : stamp;
}

/** C :3364-3366 — the once-per-session datetime message body. */
export function datetimeContextMessage(date = new Date()) {
  return `Current local date and time at session start: ${formatLocalDateTime(date)}. ` +
    "Use this only when date or time matters.";
}
