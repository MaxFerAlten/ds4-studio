import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateAuthoritativeToolCalls,
  authoritativeToolBlockGuidance,
} from "./authoritativeToolGate.mjs";
import {
  leanBudgetExhaustedSnapshot,
  toolsAttemptedAfterLeanTerminal,
} from "../../tests/fixtures/agentProtocolLoopFixture.mjs";

const leanActive = { proofId: "p1", terminal: false, verified: false };
const leanTerminal = { proofId: "p1", terminal: true, verified: false };
const leanVerified = { proofId: "p1", terminal: true, verified: true };
const call = (name) => ({ id: `${name}-1`, name, arguments: "{}" });

test("AUTH-JS-01/02/03 a terminal Lean task blocks every tool, not a list of them", () => {
  // The transcript this gate exists for shows the model walking down the tool
  // list after lean_check was refused, so the assertion walks it too.
  for (const name of toolsAttemptedAfterLeanTerminal) {
    const decision = evaluateAuthoritativeToolCalls({
      leanSnapshot: leanTerminal,
      toolCalls: [call(name)],
    });
    assert.equal(decision.allowed, false, `${name} should be blocked`);
    assert.equal(decision.code, "LEAN_FINALIZATION_ONLY");
    assert.equal(decision.terminal, true);
    assert.equal(decision.action, "publish_terminal");
    assert.deepEqual(decision.blockedTools, [name]);
  }
});

test("AUTH-JS-04 a repairable Lean task still allows its own next attempt", () => {
  const decision = evaluateAuthoritativeToolCalls({
    leanSnapshot: leanActive,
    toolCalls: [call("lean_check")],
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.terminal, false);
});

test("AUTH-JS-05 no tool calls is never blocked", () => {
  assert.equal(
    evaluateAuthoritativeToolCalls({ leanSnapshot: leanVerified, toolCalls: [] })
      .allowed,
    true,
  );
});

test("AUTH-JS-06 a verified Lean task blocks tools and names the right outcome", () => {
  const decision = evaluateAuthoritativeToolCalls({
    leanSnapshot: leanVerified,
    toolCalls: [call("crawl")],
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.finishReason, "lean_verified");
});

test("AUTH-JS-07 ordinary chat is unaffected", () => {
  const decision = evaluateAuthoritativeToolCalls({
    toolCalls: [call("read"), call("bash")],
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.code, "AUTHORITATIVE_NOT_ACTIVE");
});

test("a terminal Sage run goes through the same generic gate", () => {
  const decision = evaluateAuthoritativeToolCalls({
    sageSnapshot: { runId: "r1", terminal: true, publishable: false },
    toolCalls: [call("read")],
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "SAGE_FINALIZATION_ONLY");
  assert.equal(decision.finishReason, "sage_not_publishable");

  assert.equal(
    evaluateAuthoritativeToolCalls({
      sageSnapshot: { runId: "r1", terminal: false },
      toolCalls: [call("read")],
    }).allowed,
    true,
  );
});

test("two authoritative domains in one turn stop the turn rather than picking one", () => {
  const decision = evaluateAuthoritativeToolCalls({
    leanSnapshot: leanActive,
    sageSnapshot: { runId: "r1", terminal: false },
    toolCalls: [call("lean_check")],
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "AUTHORITATIVE_MODE_CONFLICT");
});

test("the reproduction snapshot blocks the tool the model actually reached for", () => {
  const decision = evaluateAuthoritativeToolCalls({
    leanSnapshot: { proofId: "p1", ...leanBudgetExhaustedSnapshot },
    toolCalls: [call("crawl")],
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.finishReason, "lean_not_verified");
  assert.match(authoritativeToolBlockGuidance(decision), /no crawl/i);
});

test("guidance is empty when nothing was blocked", () => {
  assert.equal(authoritativeToolBlockGuidance({ code: "AUTHORITATIVE_NOT_ACTIVE" }), "");
});
