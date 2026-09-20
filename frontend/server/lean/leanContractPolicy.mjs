// The lean_check protocol descriptor, as the Node server sees it.
//
// ds4_agent bakes DS4_LEAN_CONTRACT_REVISION in at compile time from
// generated/lean_contract_policy.h. This module reads the JSON sibling written
// by the same generator run, so "the revision the native client will send" and
// "the revision this server will accept" come from one artifact instead of two
// readings of one source.
//
// The canonicalization and the hash are imported, never reimplemented: a second
// implementation would be free to disagree, and the whole point of the revision
// is that disagreement is detectable.

import { readFile } from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import {
  ORDERED_KEYS,
  canonicalizeLeanContractPolicy,
  leanContractRevision,
  validateLeanContractPolicy,
} from "../../../scripts/generate-lean-contract-policy.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const LEAN_CONTRACT_DESCRIPTOR_PATH = resolve(
  PROJECT_ROOT,
  "generated/lean-contract-policy.json"
);
export const LEAN_CONTRACT_SOURCE_PATH = resolve(
  PROJECT_ROOT,
  "config/lean-contract-policy.json"
);

export { ORDERED_KEYS, validateLeanContractPolicy };

/**
 * The revision of a policy object. Re-exported under the name the rest of the
 * server uses, so no caller has to reach into the generator script.
 */
export function computeLeanContractRevision(policy) {
  return leanContractRevision(policy);
}

/** A load failure that must stop the server rather than degrade it. */
export class LeanContractDescriptorError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

let cached = null;

/**
 * Load and verify the generated contract descriptor.
 *
 * Three things must agree or the load fails closed:
 *  - the descriptor parses and its policy validates;
 *  - the revision recorded in the descriptor is the revision of its own policy
 *    (a hand-edited generated file);
 *  - that revision matches the one recomputed from config/lean-contract-policy.json
 *    (a descriptor — and therefore a compiled ds4_agent — older than the source).
 *
 * The third check is the one that matters in practice: C carries the revision it
 * was compiled with, so a stale descriptor means the native client is about to
 * be rejected by this server for a change nobody rebuilt.
 *
 * @param {object} [options]
 * @param {string} [options.descriptorPath]
 * @param {string} [options.sourcePath]
 * @param {boolean} [options.force] - Ignore the process cache.
 * @returns {Promise<{ policy: object, revision: string, descriptorPath: string }>}
 */
export async function loadLeanContractPolicy(options = {}) {
  const {
    descriptorPath = LEAN_CONTRACT_DESCRIPTOR_PATH,
    sourcePath = LEAN_CONTRACT_SOURCE_PATH,
    force = false,
  } = options;

  if (!force && cached && cached.descriptorPath === descriptorPath) return cached;

  let raw;
  try {
    raw = await readFile(descriptorPath, "utf8");
  } catch (err) {
    throw new LeanContractDescriptorError(
      "LEAN_CONTRACT_DESCRIPTOR_MISSING",
      `${descriptorPath} is not readable (${err.code || err.message}); ` +
        "run node scripts/generate-lean-contract-policy.mjs"
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new LeanContractDescriptorError(
      "LEAN_CONTRACT_DESCRIPTOR_STALE",
      `${descriptorPath} is not valid JSON (${err.message})`
    );
  }

  const validation = validateLeanContractPolicy(parsed?.policy);
  if (!validation.ok) {
    throw new LeanContractDescriptorError(
      "LEAN_CONTRACT_DESCRIPTOR_STALE",
      `${descriptorPath} policy is invalid: ${validation.errors.join("; ")}`
    );
  }

  const policy = canonicalizeLeanContractPolicy(parsed.policy);
  const recomputed = leanContractRevision(policy);
  if (parsed.revision !== recomputed) {
    throw new LeanContractDescriptorError(
      "LEAN_CONTRACT_DESCRIPTOR_STALE",
      `${descriptorPath} records revision ${parsed.revision} but its own policy ` +
        `hashes to ${recomputed}`
    );
  }

  // The source may be absent in a packaged deployment; only compare when it is
  // there, and treat a difference as fatal when it is.
  let sourceRevision = null;
  try {
    sourceRevision = leanContractRevision(
      JSON.parse(await readFile(sourcePath, "utf8"))
    );
  } catch (err) {
    if (err instanceof SyntaxError || /^LEAN_CONTRACT_POLICY_INVALID/.test(err.message)) {
      throw new LeanContractDescriptorError(
        "LEAN_CONTRACT_DESCRIPTOR_STALE",
        `${sourcePath} is unusable: ${err.message}`
      );
    }
    sourceRevision = null;
  }
  if (sourceRevision && sourceRevision !== recomputed) {
    throw new LeanContractDescriptorError(
      "LEAN_CONTRACT_DESCRIPTOR_STALE",
      `${descriptorPath} is at ${recomputed} while ${sourcePath} is at ` +
        `${sourceRevision}; regenerate and rebuild ds4_agent`
    );
  }

  cached = Object.freeze({
    policy: Object.freeze(policy),
    revision: recomputed,
    descriptorPath,
  });
  return cached;
}

/**
 * Synchronous accessor for a descriptor already loaded in this process.
 * Returns null before the first successful load — routes take the async path.
 */
export function peekLeanContractPolicy() {
  return cached;
}

/** The revision alone, for the common case. */
export async function getLeanContractRevision(options = {}) {
  const { revision } = await loadLeanContractPolicy(options);
  return revision;
}

export function invalidateLeanContractPolicyCache() {
  cached = null;
}
