// LF000-033 — the native client's transport deadline must outlive the server's
// worst-case response time, proved arithmetically rather than empirically.
//
// The failure this guards against (doc6, lean.fix.000): the C client used
// `timeout_sec * 1000 + 5000` while the server can legitimately spend
// `timeout_sec * 1000 + killGrace + settle` before it answers. At timeout_sec=60
// that left 2.5s of slack, so a run that used its full budget raced the
// transport and the client gave up on a result the server was about to send.
//
// Both sides are read from their real definitions — the C macro out of
// ds4_agent.c, the shutdown windows out of leanProcess.mjs — so this fails if
// either drifts, which is the whole point of not hardcoding the numbers twice.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { LEAN_MAX_TIMEOUT_SEC } from "./leanConstants.mjs";
import { LEAN_PROCESS_KILL_GRACE_MS, LEAN_PROCESS_SETTLE_TIMEOUT_MS } from "./leanProcess.mjs";

const AGENT_SOURCE_URL = new URL("../../../ds4_agent.c", import.meta.url);

/** Read a `#define NAME <integer>` out of the C source. */
function readCDefine(source, name) {
  const match = source.match(new RegExp(`^#define\\s+${name}\\s+(\\d+)\\s*$`, "m"));
  assert.ok(match, `${name} must be defined in ds4_agent.c`);
  return Number(match[1]);
}

/**
 * Worst case the server can take to answer /api/lean/exec for a given timeout:
 * the process runs to its full bound, then SIGTERM waits out the grace window,
 * then SIGKILL waits out the settle window before the result is forced.
 * Artifact writes and diagnostics parsing sit on top of this and are what the
 * remaining slack is for.
 */
function serverMaxResponseMs(timeoutSec) {
  return timeoutSec * 1000 + LEAN_PROCESS_KILL_GRACE_MS + LEAN_PROCESS_SETTLE_TIMEOUT_MS;
}

test("LF000-033: native transport deadline exceeds the server worst case at every legal timeout", async () => {
  const source = await readFile(AGENT_SOURCE_URL, "utf8");
  const marginMs = readCDefine(source, "AGENT_LEAN_HTTP_TIMEOUT_MARGIN_MS");
  const cMaxTimeoutSec = readCDefine(source, "AGENT_LEAN_MAX_TIMEOUT_SEC");

  // The C client refuses to send a timeout the Node contract would reject, so
  // the two caps must agree before the arithmetic below means anything.
  assert.equal(
    cMaxTimeoutSec,
    LEAN_MAX_TIMEOUT_SEC,
    "the C and Node timeout caps must not drift apart"
  );

  // The margin is a constant while the timeout is not, so if it holds anywhere
  // it holds everywhere; the boundary values are checked explicitly anyway.
  for (const timeoutSec of [1, 30, 60, cMaxTimeoutSec]) {
    const clientDeadlineMs = timeoutSec * 1000 + marginMs;
    const serverMaxMs = serverMaxResponseMs(timeoutSec);
    assert.ok(
      clientDeadlineMs > serverMaxMs,
      `timeout_sec=${timeoutSec}: client deadline ${clientDeadlineMs}ms must exceed ` +
        `server worst case ${serverMaxMs}ms`
    );
  }
});

test("LF000-033: the surviving slack covers post-process work, not just the kill windows", async () => {
  const source = await readFile(AGENT_SOURCE_URL, "utf8");
  const marginMs = readCDefine(source, "AGENT_LEAN_HTTP_TIMEOUT_MARGIN_MS");

  // Slack is timeout-independent: both sides scale with timeout_sec identically,
  // so the margin minus the kill windows is what is left for preflight, artifact
  // writes, diagnostics parsing and result validation.
  const slackMs = marginMs - (LEAN_PROCESS_KILL_GRACE_MS + LEAN_PROCESS_SETTLE_TIMEOUT_MS);

  // 10s is the floor this fix was chosen to land above. The pre-fix 5000ms
  // margin scored 2500ms here, which is what the race was.
  assert.ok(
    slackMs >= 10_000,
    `only ${slackMs}ms of slack after the kill windows; the transport race is back`
  );
});
