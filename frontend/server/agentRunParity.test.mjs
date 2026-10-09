// WP1 (piano.esecutivo.integrazione.opendots.v2.md §12-§13) — differential
// parity of POST /api/agent/chat after the AgentRunService extraction.
//
// tests/fixtures/agent-run-parity/legacy-golden.json was recorded on the
// route before the extraction (frontend/server/agent/agentRunParityHarness.mjs
// --record, three identical runs); every scenario here re-runs the real server
// against the same scripted backend and must produce the same wire bytes, the
// same model calls (count and messages) and the same tool calls.  Only clock
// values and random IDs are normalized (normalizeVolatile).

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { GOLDEN_PATH, REPO, SCENARIOS, diffRecordings, normalizeVolatile, runScenario } from "./agent/agentRunParityHarness.mjs";

const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")).scenarios;
// The real-runtime Lean scenario needs the checkout's prepared Lean runtime.
const leanRuntimeReady = existsSync(join(REPO, "lean-runtime", "core"));

test("the golden covers every scenario of the harness", () => {
  assert.deepEqual(Object.keys(golden).sort(), SCENARIOS.map((s) => s.name).sort());
});
test("volatile normalization keeps arbitrary message data exact", () => {
  const ordinary = "Assistant text: 1700000000000 550e8400-e29b-41d4-a716-446655440000";
  assert.equal(normalizeVolatile(ordinary), ordinary);
  assert.equal(normalizeVolatile('{"messageId":"550e8400-e29b-41d4-a716-446655440000","content":"550e8400-e29b-41d4-a716-446655440000"}'), '{"messageId":"<UUID>","content":"550e8400-e29b-41d4-a716-446655440000"}');
  assert.equal(normalizeVolatile('{"sessionKey":"agent_1700000000000_7"}'), '{"sessionKey":"agent_<EPOCH_MS>_7"}');
  assert.equal(normalizeVolatile('{"sessionId":"ds4studio_agent_1700000000000_7"}'), '{"sessionId":"ds4studio_agent_<EPOCH_MS>_7"}');
  assert.equal(normalizeVolatile('{"proofId":"proof-abcd-1700000000000-2"}'), '{"proofId":"proof-<RANDOM_ID>"}');
  assert.equal(normalizeVolatile('proof-abcd-1700000000000-2'), 'proof-abcd-1700000000000-2');
  assert.equal(normalizeVolatile('{"createdAt":"2026-10-07T00:00:00Z"}'), '{"createdAt":"<ISO>"}');
  assert.equal(normalizeVolatile('{"createdAt":1700000000000,"savedAt":1700000000001}'), '{"createdAt":<EPOCH_MS>,"savedAt":<EPOCH_MS>}');
  assert.equal(normalizeVolatile('ordinary timestamp 2026-10-07T00:00:00Z'), 'ordinary timestamp 2026-10-07T00:00:00Z');
  assert.equal(normalizeVolatile('7817 tok  2026-10-07T00:00:00Z'), '7817 tok  <ISO>');
});

for (const scenario of SCENARIOS) {
  const skip = scenario.name === "lean-proof-real-runtime" && !leanRuntimeReady
    ? "lean-runtime/core is not prepared in this checkout"
    : false;
  test(`legacy parity: ${scenario.name}`, { skip, timeout: 180000 }, async () => {
    const actual = await runScenario(scenario);
    const expected = golden[scenario.name];
    assert.equal(actual.modelCalls, expected.modelCalls, "model calls");
    assert.equal(actual.toolCallEvents, expected.toolCallEvents, "tool calls");
    const diffs = diffRecordings(expected, actual);
    assert.deepEqual(diffs, [], diffs.slice(0, 5).join("\n"));
  });
}

// Behaviour the golden must keep showing (it is the legacy contract, not a
// snapshot to regenerate): withheld candidates never reach the wire, Lean
// verdicts ride on agent_done, cancel commits nothing.
test("golden invariants: gates, Lean verdict and cancel", () => {
  const body = (name, i) => golden[name].steps.filter((s) => !s.start)[i].body;
  assert.doesNotMatch(body("conformance/08-evidence-hold-and-finalize", 1), /Preliminary verdict/);
  assert.doesNotMatch(body("lean-proof-not-verified", 1), /Teorema dimostrato/);
  assert.match(body("lean-proof-not-verified", 1), /"finish_reason":"lean_not_verified","leanVerified":false,"leanVerification":\{/);
  assert.match(body("lean-proof-real-runtime", 1), /"finish_reason":"lean_verified","leanVerified":true,"leanVerification":\{"leanStatus":"checked"/);
  const cancel = golden["cancel-mid-stream"];
  assert.equal(cancel.steps.filter((s) => !s.start)[0].aborted, true);
  const afterCancel = cancel.backendLog.filter((e) => e.path === "POST /v1/chat/completions")[1];
  assert.ok(!JSON.stringify(afterCancel.body.messages).includes("Parte annullata"), "aborted round not committed");
});
