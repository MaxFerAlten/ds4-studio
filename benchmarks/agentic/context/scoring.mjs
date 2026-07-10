// PATCH 14 — Pure scoring primitives for context-retention tasks (§19.2).
// These are deterministic and unit-tested (run.mjs --selftest). The live driver
// feeds them the agent's final text + observed tool calls.

// True if the agent echoed a long verbatim run of the raw tool output instead of
// synthesizing it. Samples windows of `minRun` chars from the raw text.
export function rawEchoDetected(finalText, rawText, { minRun = 200, samples = 12 } = {}) {
  const hay = String(finalText || "");
  const raw = String(rawText || "");
  if (raw.length < minRun || !hay) return false;
  const step = Math.max(1, Math.floor((raw.length - minRun) / samples));
  for (let off = 0; off + minRun <= raw.length; off += step) {
    if (hay.includes(raw.slice(off, off + minRun))) return true;
  }
  return false;
}

export function blobIdPresent(text) {
  return /\bblob_[a-z0-9]+/i.test(String(text || ""));
}

export function synthesisPresent(text) {
  return String(text || "").trim().length > 40;
}

// Count read tool calls that repeat a target already read (unnecessary re-reads).
export function countDuplicateReads(toolCalls = []) {
  const seen = new Set();
  let dup = 0;
  for (const c of toolCalls) {
    if (c?.name !== "read") continue;
    const key = c.target || "";
    if (seen.has(key)) dup++;
    else seen.add(key);
  }
  return dup;
}

// How many of `expected` link targets the agent opened (crawl/read) that were not
// in `alreadyOpened`, and how many already-opened links it avoided re-opening.
export function scoreLinkRecovery(toolCalls = [], expected = [], alreadyOpened = []) {
  const opened = new Set(toolCalls.map((c) => c.target).filter(Boolean));
  const already = new Set(alreadyOpened);
  const remaining = expected.filter((u) => !already.has(u));
  return {
    remaining_links_found: remaining.filter((u) => opened.has(u)).length,
    already_opened_avoided: [...already].filter((u) => !toolCalls.some((c) => c.target === u)).length,
    asked_user_to_repeat: 0 // set by the live driver from the final text if it punts
  };
}
