import assert from "node:assert/strict";
import test from "node:test";

import { classifySageBridgeException } from "./sageErrorClassifier.mjs";

const cases = [
  [{ code: "ENOENT" }, "SAGE_BRIDGE_SPAWN_FAILED"],
  [{ code: "ETIMEDOUT" }, "SAGE_BRIDGE_TIMEOUT"],
  [new SyntaxError("private JSON payload"), "SAGE_BRIDGE_INVALID_JSON"],
  [new Error("bridge contract invalid"), "SAGE_BRIDGE_CONTRACT_INVALID"],
  [new Error("validator unavailable at /private/path"), "SAGE_VALIDATOR_UNAVAILABLE"],
  [new Error("runtime unavailable at /private/path"), "SAGE_RUNTIME_UNAVAILABLE"],
  [new Error("secret execution traceback"), "SAGE_EXECUTION_FAILED"],
];

for (const [error, expected] of cases) {
  test(`classifies ${expected}`, () => {
    const result = classifySageBridgeException(error);
    assert.equal(result.code, expected);
    assert.equal(typeof result.retryable, "boolean");
    assert.equal(typeof result.terminal, "boolean");
    assert.doesNotMatch(result.safeMessage, /private|secret|traceback/);
  });
}
