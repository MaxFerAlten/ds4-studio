import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { loadAgentLoopPolicy } from "./agentLoopPolicy.mjs";
import {
  renderAgentLoopPolicyHeader,
  validateAgentLoopPolicy
} from "../../scripts/generate-agent-loop-policy.mjs";

// WP2 of convergenza.loop.md (decision D3): every number the two agent loops
// share has exactly one source, config/agent-loop-policy.json.  These values
// mirror #define lines in studio/ds4_agent.c; the C parity test
// (docs/convergenza + agentTextParity.test.mjs) is what keeps them honest.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = resolve(ROOT, "config/agent-loop-policy.json");
const valid = () => JSON.parse(readFileSync(SOURCE, "utf8"));

const SHARED_LIMITS = {
  maxAgentIterations: 40,
  maxCheckpointNudges: 3,
  systemPromptReminderTokens: 50000,
  reminderToolBurstTokens: 20000,
  compactSoftPercent: 85,
  compactMinFreeTokens: 8192,
  compactTailDivisor: 10,
  compactTailCapTokens: 50000,
  compactSummaryMaxTokens: 4096,
  evidenceMaxRepairRounds: 2
};

test("the shared loop limits are readable from the policy", () => {
  const policy = loadAgentLoopPolicy();
  for (const [key, value] of Object.entries(SHARED_LIMITS)) {
    assert.equal(policy[key], value, `${key} must come from the policy`);
  }
});

test("every shared limit is emitted as a C macro", () => {
  const header = renderAgentLoopPolicyHeader(valid());
  for (const [key, value] of Object.entries(SHARED_LIMITS)) {
    const macro = `DS4_AGENT_${key.replace(/[A-Z]/g, (c) => `_${c.toUpperCase()}`).toUpperCase()}`;
    assert.match(header, new RegExp(`#define ${macro} ${value}\\b`), `missing ${macro}`);
  }
});

test("a non-integer shared limit fails generation", () => {
  assert.throws(
    () => validateAgentLoopPolicy({ ...valid(), maxAgentIterations: "40" }),
    /maxAgentIterations.*must be an integer/,
  );
  assert.throws(
    () => validateAgentLoopPolicy({ ...valid(), compactTailDivisor: 1.5 }),
    /must be an integer/,
  );
});

test("compactSoftPercent must stay a soft ceiling", () => {
  assert.throws(
    () => validateAgentLoopPolicy({ ...valid(), compactSoftPercent: 100 }),
    /compactSoftPercent must be between 50 and 99/,
  );
  assert.throws(
    () => validateAgentLoopPolicy({ ...valid(), compactSoftPercent: 49 }),
    /compactSoftPercent must be between 50 and 99/,
  );
  assert.doesNotThrow(() => validateAgentLoopPolicy({ ...valid(), compactSoftPercent: 50 }));
  assert.doesNotThrow(() => validateAgentLoopPolicy({ ...valid(), compactSoftPercent: 99 }));
});
