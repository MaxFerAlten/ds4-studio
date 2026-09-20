#!/usr/bin/env node
// Generate the Lean contract descriptor from config/lean-contract-policy.json.
//
// Two revisions used to be one. `policyRevision` was the SHA-1 of the Lean
// policy prompt, and the server rejected any check whose hash differed — so
// fixing a typo in skills/lean/SKILL.md made every primed session unable to
// call lean_check, for a difference the lean_check protocol never noticed.
//
// This file is the other half of the split: it describes the machine-readable
// semantics of lean_check, and its SHA-256 changes only when a client and a
// server would genuinely disagree about what a result means. Prose belongs in
// the prompt; nothing here is written for a model to read.
//
// Outputs (both regenerated, never hand-edited):
//   generated/lean_contract_policy.h    — C macros
//   generated/lean-contract-policy.json — { policy, revision } for Node

import { createHash } from "crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const LEAN_CONTRACT_POLICY_SOURCE = resolve(
  ROOT,
  "config/lean-contract-policy.json"
);
export const LEAN_CONTRACT_HEADER_TARGET = resolve(
  ROOT,
  "generated/lean_contract_policy.h"
);
export const LEAN_CONTRACT_DESCRIPTOR_TARGET = resolve(
  ROOT,
  "generated/lean-contract-policy.json"
);

/**
 * The canonical key order. The revision is a hash of text, so the order is part
 * of the contract: reordering the source file must not look like a semantic
 * change, and adding a key must.
 */
export const ORDERED_KEYS = [
  "schemaVersion",
  "requestContract",
  "resultContract",
  "executionMode",
  "proofPolicy",
  "sandboxRequired",
  "verifiedStatus",
  "requiresExitCodeZero",
  "requiresNoTimeout",
  "requiresNoCancellation",
  "requiresSourceIdentity",
  // Task identity (WP-15). Source identity proves *which bytes* were checked;
  // these prove *which theorem* they were checked for, and that a check is not
  // gated on a ritual discovery call.
  "requiresTargetStatementIdentity",
  "targetIdentityAlgorithm",
  "inspectRequiredBeforeCheck",
  "proofTaskMode",
  "utilityTaskMode",
  "orchestrationContractVersion",
];

const INTEGER_KEYS = new Set(["schemaVersion", "orchestrationContractVersion"]);
const BOOLEAN_KEYS = new Set([
  "sandboxRequired",
  "requiresExitCodeZero",
  "requiresNoTimeout",
  "requiresNoCancellation",
  "requiresSourceIdentity",
  "requiresTargetStatementIdentity",
  "inspectRequiredBeforeCheck",
]);

/**
 * Validate a contract policy object.
 *
 * @param {object} policy
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateLeanContractPolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return { ok: false, errors: ["contract policy must be a JSON object"] };
  }

  for (const key of ORDERED_KEYS) {
    if (!(key in policy)) {
      errors.push(`missing key '${key}'`);
      continue;
    }
    const value = policy[key];
    if (INTEGER_KEYS.has(key)) {
      if (!Number.isInteger(value) || value < 1) {
        errors.push(`'${key}' must be an integer >= 1, got ${value}`);
      }
    } else if (BOOLEAN_KEYS.has(key)) {
      if (typeof value !== "boolean") {
        errors.push(`'${key}' must be a boolean, got ${value}`);
      }
    } else if (typeof value !== "string" || value.length === 0) {
      errors.push(`'${key}' must be a non-empty string, got ${value}`);
    }
  }

  // An unknown key is a semantic change nobody declared. Failing here is what
  // stops a descriptor from carrying a field only one side of the wire knows.
  for (const key of Object.keys(policy)) {
    if (!ORDERED_KEYS.includes(key)) errors.push(`unknown key '${key}'`);
  }

  // A sandbox-optional or exit-code-optional contract would let "checked" mean
  // two different things on two hosts, which is exactly what the revision is
  // supposed to make impossible.
  if (policy.sandboxRequired === false) {
    errors.push("'sandboxRequired' must be true: an unsandboxed check is not a check");
  }
  if (policy.requiresExitCodeZero === false) {
    errors.push("'requiresExitCodeZero' must be true for verifiedStatus to mean anything");
  }

  // A checked source that cannot be tied to the declaration it was supposed to
  // prove is what let a probe be published as the user's theorem.
  if (policy.requiresTargetStatementIdentity !== true) {
    errors.push("'requiresTargetStatementIdentity' must be true: a checked source without a target statement is not a proof");
  }
  // The gate is gone by contract, not only by code: a client that still
  // demands lean_inspect before lean_check implements different semantics.
  if (policy.inspectRequiredBeforeCheck !== false) {
    errors.push("'inspectRequiredBeforeCheck' must be false: lean_inspect is optional discovery");
  }
  if (policy.targetIdentityAlgorithm !== "lean-target-statement-v1") {
    errors.push("'targetIdentityAlgorithm' must be 'lean-target-statement-v1'");
  }
  if (policy.proofTaskMode !== "proof") {
    errors.push("'proofTaskMode' must be 'proof'");
  }
  if (policy.utilityTaskMode !== "utility") {
    errors.push("'utilityTaskMode' must be 'utility'");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Reduce a policy to its canonical object: declared keys, declared order,
 * nothing else.
 *
 * @param {object} policy
 * @returns {object}
 */
export function canonicalizeLeanContractPolicy(policy) {
  const validation = validateLeanContractPolicy(policy);
  if (!validation.ok) {
    throw new Error(
      `LEAN_CONTRACT_POLICY_INVALID: ${validation.errors.join("; ")}`
    );
  }
  const canonical = {};
  for (const key of ORDERED_KEYS) canonical[key] = policy[key];
  return canonical;
}

/**
 * The contract revision: SHA-256 over the canonical JSON text.
 *
 * SHA-256 and not SHA-1 so no reader can mistake it for a prompt revision —
 * 64 hex characters versus 40 is a difference a grep can see.
 *
 * @param {object} policy
 * @returns {string} 64 lowercase hex characters
 */
export function leanContractRevision(policy) {
  const canonicalText = JSON.stringify(canonicalizeLeanContractPolicy(policy));
  return createHash("sha256").update(canonicalText, "utf8").digest("hex");
}

/** Read + validate the checked-in source policy. */
export function readLeanContractPolicySource(source = LEAN_CONTRACT_POLICY_SOURCE) {
  return canonicalizeLeanContractPolicy(
    JSON.parse(readFileSync(source, "utf8"))
  );
}

function writeAtomic(target, text) {
  const tmp = `${target}.tmp.${process.pid}`;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(tmp, text);
  renameSync(tmp, target);
}

function renderHeader(policy, revision) {
  return `/* Generated by scripts/generate-lean-contract-policy.mjs — do not edit.
 * Source: config/lean-contract-policy.json
 *
 * The revision below identifies the lean_check protocol, not the Lean policy
 * text. A prompt edit must not change it; a schema or semantics change must. */
#ifndef DS4_LEAN_CONTRACT_POLICY_H
#define DS4_LEAN_CONTRACT_POLICY_H

#define DS4_LEAN_CONTRACT_SCHEMA_VERSION ${policy.schemaVersion}

#define DS4_LEAN_REQUEST_CONTRACT "${policy.requestContract}"

#define DS4_LEAN_RESULT_CONTRACT "${policy.resultContract}"

#define DS4_LEAN_VERIFIED_STATUS "${policy.verifiedStatus}"

#define DS4_LEAN_CONTRACT_REVISION \\
    "${revision}"

#define DS4_LEAN_CONTRACT_REVISION_HEX 64

#endif /* DS4_LEAN_CONTRACT_POLICY_H */
`;
}

export function generateLeanContractArtifacts({
  source = LEAN_CONTRACT_POLICY_SOURCE,
  headerTarget = LEAN_CONTRACT_HEADER_TARGET,
  descriptorTarget = LEAN_CONTRACT_DESCRIPTOR_TARGET,
} = {}) {
  const policy = readLeanContractPolicySource(source);
  const revision = leanContractRevision(policy);
  writeAtomic(headerTarget, renderHeader(policy, revision));
  writeAtomic(
    descriptorTarget,
    `${JSON.stringify({ policy, revision }, null, 2)}\n`
  );
  return { policy, revision, headerTarget, descriptorTarget };
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const out = generateLeanContractArtifacts();
  process.stdout.write(`generated ${out.headerTarget}\n`);
  process.stdout.write(`generated ${out.descriptorTarget}\n`);
  process.stdout.write(`lean contract revision ${out.revision}\n`);
}
