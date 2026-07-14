import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadSagePolicy,
  sagePolicyRevision,
  SAGE_POLICY_PATH
} from "./sagePolicyLoader.mjs";

test("canonical Sage policy is loaded from the single skill source", () => {
  const policy = loadSagePolicy();
  assert.equal(policy.ready, true);
  assert.equal(policy.path, SAGE_POLICY_PATH);
  assert.match(policy.path, /skills\/sage\/SKILL\.md$/);
  assert.equal(policy.revision.length, 40);
  assert.equal(policy.revision, sagePolicyRevision(policy.prompt));
});

test("revision hashes exact bytes and changes with policy content", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ds4-sage-policy-"));
  const policyPath = path.join(dir, "SKILL.md");
  await writeFile(policyPath, "policy v1\n");
  const first = loadSagePolicy({ policyPath });
  await writeFile(policyPath, "policy v1");
  const second = loadSagePolicy({ policyPath });
  assert.notEqual(first.revision, second.revision);
});

test("missing and empty policy files fail closed", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ds4-sage-policy-"));
  const policyPath = path.join(dir, "SKILL.md");
  assert.equal(loadSagePolicy({ policyPath }).ready, false);
  await writeFile(policyPath, "  \n");
  assert.equal(loadSagePolicy({ policyPath }).ready, false);
});
