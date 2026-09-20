import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import {
  ORDERED_KEYS,
  canonicalizeLeanContractPolicy,
  leanContractRevision,
  validateLeanContractPolicy,
  LEAN_CONTRACT_POLICY_SOURCE,
} from "../../../scripts/generate-lean-contract-policy.mjs";
import {
  LEAN_CONTRACT_DESCRIPTOR_PATH,
  LEAN_CONTRACT_SOURCE_PATH,
  LeanContractDescriptorError,
  computeLeanContractRevision,
  invalidateLeanContractPolicyCache,
  loadLeanContractPolicy,
} from "./leanContractPolicy.mjs";

async function validPolicy() {
  return JSON.parse(await readFile(LEAN_CONTRACT_POLICY_SOURCE, "utf8"));
}

test("the checked-in contract policy validates", async () => {
  const policy = await validPolicy();
  assert.deepEqual(validateLeanContractPolicy(policy), { ok: true, errors: [] });
});

test("the revision is 64 lowercase hex and stable across runs", async () => {
  const policy = await validPolicy();
  const a = leanContractRevision(policy);
  const b = leanContractRevision(policy);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(a, b);
});

test("key order in the source file does not change the revision", async () => {
  const policy = await validPolicy();
  const reversed = {};
  for (const key of [...ORDERED_KEYS].reverse()) reversed[key] = policy[key];
  assert.equal(leanContractRevision(reversed), leanContractRevision(policy));
  assert.deepEqual(
    Object.keys(canonicalizeLeanContractPolicy(reversed)),
    ORDERED_KEYS
  );
});

test("a semantic change changes the revision", async () => {
  const policy = await validPolicy();
  const before = leanContractRevision(policy);
  assert.notEqual(
    leanContractRevision({ ...policy, verifiedStatus: "elaborated" }),
    before
  );
  assert.notEqual(
    leanContractRevision({
      ...policy,
      orchestrationContractVersion: policy.orchestrationContractVersion + 1,
    }),
    before
  );
  assert.notEqual(leanContractRevision({ ...policy, schemaVersion: 2 }), before);
});

test("an unknown key is refused instead of silently hashed", async () => {
  const policy = { ...(await validPolicy()), hint: "try ring" };
  const validation = validateLeanContractPolicy(policy);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(" "), /unknown key 'hint'/);
  assert.throws(() => canonicalizeLeanContractPolicy(policy), /LEAN_CONTRACT_POLICY_INVALID/);
});

test("a missing key and a wrong type are refused", async () => {
  const policy = await validPolicy();
  const { sandboxRequired, ...missing } = policy;
  void sandboxRequired;
  assert.match(
    validateLeanContractPolicy(missing).errors.join(" "),
    /missing key 'sandboxRequired'/
  );
  assert.match(
    validateLeanContractPolicy({ ...policy, schemaVersion: "1" }).errors.join(" "),
    /'schemaVersion' must be an integer/
  );
  assert.match(
    validateLeanContractPolicy({ ...policy, requiresNoTimeout: "yes" }).errors.join(" "),
    /'requiresNoTimeout' must be a boolean/
  );
});

test("a contract that makes 'checked' meaningless is refused", async () => {
  const policy = await validPolicy();
  assert.match(
    validateLeanContractPolicy({ ...policy, sandboxRequired: false }).errors.join(" "),
    /'sandboxRequired' must be true/
  );
  assert.match(
    validateLeanContractPolicy({ ...policy, requiresExitCodeZero: false }).errors.join(" "),
    /'requiresExitCodeZero' must be true/
  );
});

test("the generated descriptor loads and matches the source", async () => {
  invalidateLeanContractPolicyCache();
  const state = await loadLeanContractPolicy({ force: true });
  assert.match(state.revision, /^[a-f0-9]{64}$/);
  assert.equal(state.revision, computeLeanContractRevision(await validPolicy()));
  assert.equal(state.descriptorPath, LEAN_CONTRACT_DESCRIPTOR_PATH);
  assert.equal(LEAN_CONTRACT_SOURCE_PATH, LEAN_CONTRACT_POLICY_SOURCE);
});

test("a descriptor whose recorded revision is not its own hash fails closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lean-contract-"));
  const descriptorPath = join(dir, "lean-contract-policy.json");
  await writeFile(
    descriptorPath,
    JSON.stringify({ policy: await validPolicy(), revision: "0".repeat(64) })
  );
  await assert.rejects(
    () => loadLeanContractPolicy({ descriptorPath, force: true }),
    (err) => {
      assert.ok(err instanceof LeanContractDescriptorError);
      assert.equal(err.code, "LEAN_CONTRACT_DESCRIPTOR_STALE");
      return true;
    }
  );
});

test("a descriptor older than the source fails closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lean-contract-"));
  const stale = { ...(await validPolicy()), orchestrationContractVersion: 99 };
  const descriptorPath = join(dir, "lean-contract-policy.json");
  await writeFile(
    descriptorPath,
    JSON.stringify({ policy: stale, revision: leanContractRevision(stale) })
  );
  await assert.rejects(
    () => loadLeanContractPolicy({ descriptorPath, force: true }),
    (err) => {
      assert.equal(err.code, "LEAN_CONTRACT_DESCRIPTOR_STALE");
      assert.match(err.message, /regenerate and rebuild ds4_agent/);
      return true;
    }
  );
});

test("a missing descriptor names the command that fixes it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lean-contract-"));
  await assert.rejects(
    () => loadLeanContractPolicy({ descriptorPath: join(dir, "absent.json"), force: true }),
    (err) => {
      assert.equal(err.code, "LEAN_CONTRACT_DESCRIPTOR_MISSING");
      assert.match(err.message, /generate-lean-contract-policy\.mjs/);
      return true;
    }
  );
  invalidateLeanContractPolicyCache();
});

// WP-15 — task identity is part of the machine-readable contract, so a client
// that disagrees about it cannot look compatible.

test("the task identity keys are mandatory", async () => {
  const policy = await validPolicy();
  for (const key of [
    "requiresTargetStatementIdentity",
    "targetIdentityAlgorithm",
    "inspectRequiredBeforeCheck",
    "proofTaskMode",
    "utilityTaskMode",
  ]) {
    const { [key]: dropped, ...missing } = policy;
    void dropped;
    const validation = validateLeanContractPolicy(missing);
    assert.equal(validation.ok, false, `${key} must be required`);
    assert.match(validation.errors.join(" "), new RegExp(`missing key '${key}'`));
  }
});

test("a contract that still gates lean_check on lean_inspect is invalid", async () => {
  const policy = { ...(await validPolicy()), inspectRequiredBeforeCheck: true };
  const validation = validateLeanContractPolicy(policy);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(" "), /inspectRequiredBeforeCheck/);
});

test("a contract without target statement identity is invalid", async () => {
  const policy = { ...(await validPolicy()), requiresTargetStatementIdentity: false };
  const validation = validateLeanContractPolicy(policy);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(" "), /requiresTargetStatementIdentity/);
});

test("the task mode names and the identity algorithm are fixed", async () => {
  const policy = await validPolicy();
  for (const [key, bad] of [
    ["targetIdentityAlgorithm", "sha256-of-body"],
    ["proofTaskMode", "authoritative"],
    ["utilityTaskMode", "probe"],
  ]) {
    const validation = validateLeanContractPolicy({ ...policy, [key]: bad });
    assert.equal(validation.ok, false, `${key} must be pinned`);
    assert.match(validation.errors.join(" "), new RegExp(key));
  }
});

test("the shipped policy declares the post-patch semantics", async () => {
  const policy = await validPolicy();
  assert.equal(policy.requiresTargetStatementIdentity, true);
  assert.equal(policy.inspectRequiredBeforeCheck, false);
  assert.equal(policy.targetIdentityAlgorithm, "lean-target-statement-v1");
  assert.equal(policy.proofTaskMode, "proof");
  assert.equal(policy.utilityTaskMode, "utility");
  assert.ok(policy.orchestrationContractVersion >= 2);
});
