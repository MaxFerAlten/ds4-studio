import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_INTENT_SYSTEM_PROMPT,
  agentIntentContext,
  parseAgentIntentContent,
  parseAgentRequestIntent,
  TOOL_EVALUATION_INSTRUCTION
} from "./agentRequestIntent.mjs";

test("intent routing delegates meaning and tool choice to the model", () => {
  assert.match(AGENT_INTENT_SYSTEM_PROMPT, /Interpret the user's meaning/);
  assert.match(AGENT_INTENT_SYSTEM_PROMPT, /do not use exact keyword matching/);
  assert.deepEqual(parseAgentIntentContent(JSON.stringify({
    verification_requested: true,
    required_tools: ["lean_check"],
    tool_selection: ["lean_check"],
    skill_actions: [{ skill: "lean", action: "start" }]
  })), {
    verificationRequested: true,
    toolEvaluationRequested: false,
    requiredTools: ["lean_check"],
    toolSelection: ["lean_check"],
    skillActions: [{ skill: "lean", action: "start" }]
  });
});

test("intent parser rejects malformed or ungrounded verifier decisions", () => {
  assert.throws(() => parseAgentIntentContent("not json"), /AGENT_INTENT_INVALID_JSON/);
  assert.throws(() => parseAgentRequestIntent({ verification_requested: true }), /AGENT_INTENT_VERIFIERS_REQUIRED/);
  assert.throws(() => parseAgentRequestIntent({ verification_requested: false, skill_actions: [{ skill: "bash", action: "start" }] }), /AGENT_INTENT_INVALID_SKILL_ACTION/);
});

test("intent context includes recent turns and the current request", () => {
  const context = agentIntentContext([{ role: "user", content: "Check my claim" }], "Use Lean");
  assert.match(context, /Check my claim/);
  assert.match(context, /current user request: Use Lean/);
});

test("a request to evaluate the tools is its own intent, optional and strictly boolean", () => {
  assert.match(AGENT_INTENT_SYSTEM_PROMPT, /tool_evaluation_requested/);
  assert.match(AGENT_INTENT_SYSTEM_PROMPT, /choose among tools and then verify, the choice is yours/);
  assert.equal(parseAgentRequestIntent({ verification_requested: false }).toolEvaluationRequested, false);
  assert.equal(parseAgentRequestIntent({ verification_requested: false, tool_evaluation_requested: true })
    .toolEvaluationRequested, true);
  assert.throws(() => parseAgentRequestIntent({ verification_requested: false, tool_evaluation_requested: "yes" }),
    /AGENT_INTENT_INVALID_SCHEMA/);
});

test("router reads consent to an offered verification as a request to run it", () => {
  assert.match(AGENT_INTENT_SYSTEM_PROMPT, /short consent to continue[^"]*evaluated tools or offered a verification[^"]*verification_requested=true/);
});

test("tool evaluation asks for the answer itself, not a restatement of the instruction", () => {
  assert.match(TOOL_EVALUATION_INSTRUCTION, /starting with the answer: do not narrate your plan or restate these instructions/);
});

test("router context keeps the end of a long answer, where the next step is offered", () => {
  const answer = `Risposta: D. ${"x".repeat(5000)} Se vuoi, eseguo SageMath.`;
  const context = agentIntentContext([{ role: "assistant", content: answer }], "procedi");
  assert.match(context, /^assistant: Risposta: D\./);
  assert.match(context, /Se vuoi, eseguo SageMath\.\n\ncurrent user request: procedi$/);
  assert.ok(context.length < 2000);
});

test("router treats the purpose of an evaluated tool as part of the evaluation", () => {
  assert.match(AGENT_INTENT_SYSTEM_PROMPT, /the goal a tool would serve[^"]*is part of what to evaluate, not a request to run it/);
});
