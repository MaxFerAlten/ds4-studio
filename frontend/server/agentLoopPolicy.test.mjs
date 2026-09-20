import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { loadAgentLoopPolicy, AGENT_LOOP_POLICY_DESCRIPTOR } from "./agentLoopPolicy.mjs";
import {
  renderAgentLoopPolicyHeader,
  validateAgentLoopPolicy,
} from "../../scripts/generate-agent-loop-policy.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = resolve(ROOT, "config/agent-loop-policy.json");
const HEADER = resolve(ROOT, "generated/agent_loop_policy.h");

const valid = () => JSON.parse(readFileSync(SOURCE, "utf8"));

function macrosOf(headerText) {
  const macros = {};
  for (const line of headerText.split("\n")) {
    const m = line.match(/^#define\s+(DS4_AGENT_\w+)\s+(-?\d+)\s*$/);
    if (m) macros[m[1]] = Number(m[2]);
  }
  return macros;
}

test("LOOP-POLICY-01 the C header and the JSON descriptor carry the same numbers", () => {
  const policy = loadAgentLoopPolicy({ reload: true });
  const macros = macrosOf(readFileSync(HEADER, "utf8"));

  // Every policy key must reach C, and every C macro must come from a key:
  // a value that exists on one side only is exactly the drift this guards.
  assert.equal(
    Object.keys(macros).length,
    Object.keys(policy).length,
    "header and descriptor must define the same number of values",
  );
  const expected = macrosOf(renderAgentLoopPolicyHeader(policy));
  assert.deepEqual(macros, expected);
});

test("the generated files on disk match a fresh generation from config/", () => {
  // Catches a hand-edited or stale header, which would put C and Node on two
  // policies while both claim to read one.
  const policy = valid();
  assert.equal(readFileSync(HEADER, "utf8"), renderAgentLoopPolicyHeader(policy));
  assert.deepEqual(
    JSON.parse(readFileSync(AGENT_LOOP_POLICY_DESCRIPTOR, "utf8")),
    policy,
  );
});

test("LOOP-POLICY-02 a missing key fails generation", () => {
  const policy = valid();
  delete policy.protocolSameFailureTerminal;
  assert.throws(() => validateAgentLoopPolicy(policy), /protocolSameFailureTerminal/);
});

test("an unknown key fails generation", () => {
  assert.throws(
    () => validateAgentLoopPolicy({ ...valid(), tolerateLoops: 3 }),
    /unknown key/,
  );
});

test("LOOP-POLICY-03 a non-positive or non-integer value fails generation", () => {
  assert.throws(
    () => validateAgentLoopPolicy({ ...valid(), noProgressTerminal: 0 }),
    /must be > 0/,
  );
  assert.throws(
    () => validateAgentLoopPolicy({ ...valid(), noProgressTerminal: 2.5 }),
    /must be an integer/,
  );
});

test("LOOP-POLICY-04 a strategy change at or after the terminal threshold never fires", () => {
  assert.throws(
    () =>
      validateAgentLoopPolicy({
        ...valid(),
        protocolSameFailureStrategyChange: 3,
        protocolSameFailureTerminal: 3,
      }),
    /protocolSameFailureStrategyChange must be </,
  );
  assert.throws(
    () =>
      validateAgentLoopPolicy({
        ...valid(),
        repeatedActionStrategyChange: 5,
        repeatedActionTerminal: 4,
      }),
    /repeatedActionStrategyChange must be </,
  );
});

test("LOOP-POLICY-05 the hard ceiling cannot sit below a protocol threshold", () => {
  assert.throws(
    () => validateAgentLoopPolicy({ ...valid(), maxToolRoundsHard: 4 }),
    /maxToolRoundsHard must be >=/,
  );
  assert.throws(
    () =>
      validateAgentLoopPolicy({
        ...valid(),
        protocolSameFailureTerminal: 8,
        protocolTotalFailureTerminal: 6,
      }),
    /protocolSameFailureTerminal must be <=/,
  );
});

test("the shipped policy is itself valid", () => {
  assert.doesNotThrow(() => validateAgentLoopPolicy(valid()));
});
