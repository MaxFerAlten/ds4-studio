// Lean 4 runtime metadata — schema, atomic writes and verification.
//
// One `runtime.metadata.json` per runtime profile records the *lock*: which
// toolchain descriptor was prepared, the resolved lean/lake versions (the lean
// --version line embeds the resolved commit, the real pin), the mathlib input
// rev + resolved commit, and a SHA-256 for every pinned file (lean-toolchain,
// lakefile.toml, lake-manifest.json, the smoke source). The provisioning
// scripts write it atomically; the preflight (R8) and any certification step
// cross-check the current files against it so a runtime that drifted from the
// recorded lock is never reported as ready.

import { createHash } from "crypto";
import { readFile, rename, writeFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

export const RUNTIME_METADATA_SCHEMA_VERSION = 1;
export const RUNTIME_METADATA_FILE = "runtime.metadata.json";

/** Reject a pin that is not a real version: placeholders and floating tags. */
export const FORBIDDEN_PIN = /\b(latest|stable|master|main)\b|X\.Y\.Z/i;

const SMOKE_SOURCE_BY_PROFILE = {
  core: "Ds4LeanCore.lean",
  mathlib: "Ds4LeanMathlib.lean",
};

export function smokeSourceForProfile(profile) {
  return SMOKE_SOURCE_BY_PROFILE[profile];
}

/** Absolute path of a profile's metadata file. */
export function runtimeMetadataPath(config, profile) {
  return resolve(config.runtimeRoot, profile, RUNTIME_METADATA_FILE);
}

/** SHA-256 of a file's bytes, hex. */
export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Validate a parsed metadata object against the schema.
 *
 * @param {object} metadata
 * @param {string} [profile] - Expected profile; when given, mismatch is an error.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateLeanRuntimeMetadata(metadata, profile) {
  const errors = [];
  if (!metadata || typeof metadata !== "object") {
    return { ok: false, errors: ["metadata is not an object"] };
  }
  if (metadata.schemaVersion !== RUNTIME_METADATA_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${RUNTIME_METADATA_SCHEMA_VERSION}, got ${metadata.schemaVersion}`);
  }
  if (typeof metadata.profile !== "string" || !metadata.profile) {
    errors.push("profile is missing");
  } else if (profile && metadata.profile !== profile) {
    errors.push(`profile mismatch: metadata=${metadata.profile}, expected=${profile}`);
  }
  if (typeof metadata.preparedAt !== "string" || !Number.isFinite(Date.parse(metadata.preparedAt))) {
    errors.push("preparedAt must be an ISO timestamp");
  }
  if (metadata.mode !== "locked" && metadata.mode !== "update-lock") {
    errors.push(`mode must be 'locked' or 'update-lock', got ${metadata.mode}`);
  }

  const tc = metadata.toolchain;
  if (!tc || typeof tc !== "object") {
    errors.push("toolchain block is missing");
  } else {
    if (typeof tc.descriptor !== "string" || !tc.descriptor) {
      errors.push("toolchain.descriptor is missing");
    } else if (FORBIDDEN_PIN.test(tc.descriptor)) {
      errors.push(`toolchain.descriptor '${tc.descriptor}' is not a pinned version`);
    }
    if (typeof tc.leanVersion !== "string" || !tc.leanVersion) errors.push("toolchain.leanVersion is missing");
    if (typeof tc.lakeVersion !== "string" || !tc.lakeVersion) errors.push("toolchain.lakeVersion is missing");
    if (typeof tc.resolvedCommit !== "string" || !/^[0-9a-f]{40}$/.test(tc.resolvedCommit)) {
      errors.push("toolchain.resolvedCommit must be a 40-hex commit");
    }
  }

  const isMathlib = metadata.profile === "mathlib" || (profile && profile === "mathlib");
  if (isMathlib) {
    const ml = metadata.mathlib;
    if (!ml || typeof ml !== "object") {
      errors.push("mathlib block is required for the mathlib profile");
    } else {
      if (typeof ml.inputRev !== "string" || !ml.inputRev || FORBIDDEN_PIN.test(ml.inputRev)) {
        errors.push(`mathlib.inputRev must be a pinned rev, got ${ml.inputRev}`);
      }
      if (typeof ml.resolvedCommit !== "string" || !/^[0-9a-f]{40}$/.test(ml.resolvedCommit)) {
        errors.push("mathlib.resolvedCommit must be a 40-hex commit");
      }
    }
  }

  if (!metadata.files || typeof metadata.files !== "object") {
    errors.push("files block is missing");
  } else {
    const entries = Object.entries(metadata.files);
    if (entries.length === 0) errors.push("files block is empty");
    for (const [file, hash] of entries) {
      if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
        errors.push(`files['${file}'] must be a 64-hex sha256, got ${hash}`);
      }
    }
    for (const required of ["lean-toolchain", "lakefile.toml", "lake-manifest.json"]) {
      if (!metadata.files[required]) errors.push(`files['${required}'] is missing`);
    }
    const smoke = metadata.smokeSource || smokeSourceForProfile(metadata.profile);
    if (!smoke || !metadata.files[smoke]) {
      errors.push(`files['${smoke}'] (smoke source) is missing`);
    }
  }

  if (typeof metadata.smokeSource !== "string" || !metadata.smokeSource) {
    errors.push("smokeSource is missing");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Read and validate a profile's runtime metadata.
 *
 * @returns {{ ok: boolean, metadata?: object, error?: string, errors?: string[] }}
 */
export async function readLeanRuntimeMetadata(config, profile) {
  const file = runtimeMetadataPath(config, profile);
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return { ok: false, error: `missing runtime metadata: ${file}. Run scripts/lean-prepare-runtime.sh.` };
  }
  let metadata;
  try {
    metadata = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `invalid JSON in ${file}: ${err.message}` };
  }
  const check = validateLeanRuntimeMetadata(metadata, profile);
  if (!check.ok) {
    return { ok: false, error: `runtime metadata invalid (${file})`, errors: check.errors };
  }
  return { ok: true, metadata };
}

/**
 * Cross-check every hashed file in the metadata against the current bytes on
 * disk. Any recorded lock that no longer matches the files is reported.
 *
 * @returns {{ ok: boolean, metadata?: object, mismatches?: { file: string, recorded: string, actual: string }[] }}
 */
export async function verifyLeanRuntimeMetadata(config, profile) {
  const read = await readLeanRuntimeMetadata(config, profile);
  if (!read.ok) return { ok: false, ...read };
  const metadata = read.metadata;
  const profileDir = resolve(config.runtimeRoot, profile);
  const mismatches = [];
  for (const [file, recorded] of Object.entries(metadata.files)) {
    const actual = sha256Hex(readFileSync(resolve(profileDir, file)));
    if (actual !== recorded) mismatches.push({ file, recorded, actual });
  }
  return { ok: mismatches.length === 0, metadata, mismatches };
}

/**
 * Assemble and atomically write a profile's runtime metadata.
 *
 * The script-side facts are passed in `input`; the module hashes the pinned
 * files itself, so the schema writer and the schema validator can never drift.
 *
 * @param {object} config - Lean configuration (runtimeRoot is what matters)
 * @param {string} profile - "core" | "mathlib"
 * @param {object} input
 * @param {"locked"|"update-lock"} input.mode
 * @param {string} input.descriptor - lean-toolchain contents
 * @param {string} input.leanVersion - full `lean --version` output
 * @param {string} input.lakeVersion - full `lake --version` output
 * @returns {{ ok: boolean, metadata?: object, error?: string }}
 */
export async function writeLeanRuntimeMetadata(config, profile, input) {
  const profileDir = resolve(config.runtimeRoot, profile);
  const smokeSource = smokeSourceForProfile(profile);
  if (!smokeSource) return { ok: false, error: `unknown profile ${profile}` };

  const pinned = ["lean-toolchain", "lakefile.toml", "lake-manifest.json", smokeSource];
  const files = {};
  for (const file of pinned) {
    const path = resolve(profileDir, file);
    if (!existsSync(path)) return { ok: false, error: `missing pinned file ${path} for metadata` };
    files[file] = sha256Hex(readFileSync(path));
  }

  const commitMatch = String(input.leanVersion || "").match(/commit ([0-9a-f]{40})/);
  const metadata = {
    schemaVersion: RUNTIME_METADATA_SCHEMA_VERSION,
    profile,
    preparedAt: new Date().toISOString(),
    mode: input.mode,
    smokeSource,
    toolchain: {
      descriptor: input.descriptor,
      leanVersion: input.leanVersion,
      lakeVersion: input.lakeVersion,
      resolvedCommit: commitMatch ? commitMatch[1] : "",
    },
    files,
  };

  if (profile === "mathlib") {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(resolve(profileDir, "lake-manifest.json"), "utf8"));
    } catch {
      return { ok: false, error: "cannot read lake-manifest.json for mathlib metadata" };
    }
    const mathlib = (manifest.packages || []).find((p) => p.name === "mathlib");
    metadata.mathlib = {
      inputRev: mathlib?.inputRev || "",
      resolvedCommit: mathlib?.rev || "",
    };
  }

  const check = validateLeanRuntimeMetadata(metadata, profile);
  if (!check.ok) {
    return { ok: false, error: `refusing to write invalid metadata: ${check.errors.join("; ")}` };
  }

  const file = runtimeMetadataPath(config, profile);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o644 });
  await rename(tmp, file);
  return { ok: true, metadata };
}
