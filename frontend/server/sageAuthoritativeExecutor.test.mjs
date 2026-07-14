import assert from "node:assert/strict";
import { test } from "node:test";

import {
  executeAuthoritativeSage,
  normalizeAuthoritativeSageResponse
} from "./sageAuthoritativeExecutor.mjs";

const legacyRaw = () => ({
  content: "raw",
  isError: false,
  sageResult: {
    contractVersion: "sage_result_v1",
    tool: "sage",
    taskType: "evaluate",
    phase: "compute",
    state: "computed",
    status: "ok",
    artifacts: [],
    execution: { ok: true, exitCode: 0, timedOut: false },
    validation: { authoritative: false, passed: false, checks: [], errors: [] },
    publication: { publishable: false, markdown: "", reasonCodes: [] }
  }
});

function authorized(markdown = "# Validato") {
  return {
    content: markdown,
    isError: false,
    contractVersion: "sage_result_v2",
    publishable: true,
    authoritative: true,
    validationPassed: true,
    runId: "run-1",
    state: "ready",
    sageResult: {
      contractVersion: "sage_result_v2",
      artifacts: [],
      publication: { publishable: true, markdown }
    },
    artifacts: [],
    finalMarkdown: markdown
  };
}

test("authoritative executor uses rawExecutor when orchestration V2 is disabled", async () => {
  let rawCalls = 0;
  const result = await executeAuthoritativeSage({ code: "1+1" }, {
    rawExecutor: async () => {
      rawCalls += 1;
      return legacyRaw();
    },
    sageV2EnabledFn: () => false,
    authorizer: async () => authorized()
  });
  assert.equal(rawCalls, 1);
  assert.equal(result.finalMarkdown, "# Validato");
});

test("authoritative executor uses the bridge when orchestration V2 is enabled", async () => {
  let rawCalls = 0;
  let bridgeCalls = 0;
  await executeAuthoritativeSage({ code: "1+1" }, {
    rawExecutor: async () => {
      rawCalls += 1;
      return legacyRaw();
    },
    sageV2EnabledFn: () => true,
    bridgeExecutor: async () => {
      bridgeCalls += 1;
      return legacyRaw();
    },
    authorizer: async () => authorized()
  });
  assert.equal(rawCalls, 0);
  assert.equal(bridgeCalls, 1);
});

test("authoritative executor always calls the publication authorizer", async () => {
  let calls = 0;
  await executeAuthoritativeSage({ code: "1+1" }, {
    rawExecutor: async () => legacyRaw(),
    sageV2EnabledFn: () => false,
    authorizer: async ({ raw }) => {
      calls += 1;
      assert.equal(raw.content, "raw");
      return authorized();
    }
  });
  assert.equal(calls, 1);
});

test("authoritative response keeps content and isError types", () => {
  const result = normalizeAuthoritativeSageResponse({ content: 42, isError: 0 });
  assert.equal(typeof result.content, "string");
  assert.equal(typeof result.isError, "boolean");
});

test("authoritative executor rejects a missing raw executor", async () => {
  await assert.rejects(
    executeAuthoritativeSage({ code: "1+1" }, { sageV2EnabledFn: () => false }),
    /rawExecutor is required/
  );
});

test("authoritative executor normalizes bridge exceptions", async () => {
  const result = await executeAuthoritativeSage({ code: "1+1" }, {
    rawExecutor: async () => legacyRaw(),
    sageV2EnabledFn: () => true,
    bridgeExecutor: async () => {
      throw new Error("private traceback");
    }
  });
  assert.equal(result.isError, true);
  assert.equal(result.publishable, false);
  assert.doesNotMatch(result.content, /private traceback/);
});

test("authoritative executor does not mutate args", async () => {
  const args = { code: "1+1", nested: { value: 1 } };
  const before = structuredClone(args);
  await executeAuthoritativeSage(args, {
    rawExecutor: async () => legacyRaw(),
    sageV2EnabledFn: () => false,
    authorizer: async () => authorized()
  });
  assert.deepEqual(args, before);
});

test("legacy authorization result remains non-publishable", async () => {
  const result = await executeAuthoritativeSage({ code: "1+1" }, {
    rawExecutor: async () => legacyRaw(),
    sageV2EnabledFn: () => false,
    authorizer: async ({ raw }) => raw
  });
  assert.equal(result.publishable, false);
  assert.equal(result.authoritative, false);
  assert.equal(result.finalMarkdown, "");
});

test("rollout flag zero uses the legacy raw path through the same gateway", async () => {
  let authorizerCalls = 0;
  const result = await executeAuthoritativeSage({ code: "1+1" }, {
    rawExecutor: async () => legacyRaw(),
    authoritativeLoopEnabledFn: () => false,
    sageV2EnabledFn: () => true,
    bridgeExecutor: async () => {
      throw new Error("bridge must not run in rollback mode");
    },
    authorizer: async () => {
      authorizerCalls += 1;
      return authorized();
    }
  });
  assert.equal(authorizerCalls, 0);
  assert.equal(result.contractVersion, "sage_result_v1");
  assert.equal(result.publishable, false);
  assert.equal(result.content, "raw");
});
