// Tests for leanMetadata.mjs — schema validation, read, verify and atomic
// write against a real temp profile directory.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  RUNTIME_METADATA_SCHEMA_VERSION,
  runtimeMetadataPath,
  sha256Hex,
  validateLeanRuntimeMetadata,
  readLeanRuntimeMetadata,
  verifyLeanRuntimeMetadata,
  writeLeanRuntimeMetadata,
  smokeSourceForProfile,
} from "./leanMetadata.mjs";

let root;
const CONFIG = { runtimeRoot: "" };

test.before(async () => {
  root = await mkdtemp(resolve(tmpdir(), "ds4-lean-meta-"));
  CONFIG.runtimeRoot = root;
  const coreDir = join(root, "core");
  await mkdir(coreDir, { recursive: true });
  const files = {
    "lean-toolchain": "leanprover/lean4:v4.32.2\n",
    "lakefile.toml": "name = \"ds4LeanCore\"\n",
    "lake-manifest.json": '{"version":"1.2.0","packages":[]}\n',
    "Ds4LeanCore.lean": "theorem ds4_core_smoke : 1 + 1 = 2 := by decide\n",
  };
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(coreDir, name), content);
  }
});

test.after(async () => {
  await rm(root, { recursive: true, force: true });
});

function facts(overrides = {}) {
  return {
    mode: "locked",
    descriptor: "leanprover/lean4:v4.32.2",
    leanVersion: "Lean (version 4.32.2, x86_64-unknown-linux-gnu, commit f3b06c705e6c85f5314019d5d3baab0fec5b580c, Release)",
    lakeVersion: "Lake version 5.0.0-src+f3b06c7 (Lean version 4.32.2)",
    ...overrides,
  };
}

test("smokeSourceForProfile maps the two known profiles", () => {
  assert.equal(smokeSourceForProfile("core"), "Ds4LeanCore.lean");
  assert.equal(smokeSourceForProfile("mathlib"), "Ds4LeanMathlib.lean");
  assert.equal(smokeSourceForProfile("other"), undefined);
});

test("writeLeanRuntimeMetadata writes a valid, atomic metadata file", async () => {
  const res = await writeLeanRuntimeMetadata(CONFIG, "core", facts());
  assert.equal(res.ok, true);
  const file = runtimeMetadataPath(CONFIG, "core");
  assert.ok(existsSync(file));
  assert.ok(!existsSync(`${file}.tmp`), "the tmp file must be renamed away");
  const metadata = JSON.parse(await readFile(file, "utf8"));
  assert.equal(metadata.schemaVersion, RUNTIME_METADATA_SCHEMA_VERSION);
  assert.equal(metadata.profile, "core");
  assert.equal(metadata.mode, "locked");
  assert.equal(metadata.toolchain.descriptor, "leanprover/lean4:v4.32.2");
  assert.equal(metadata.toolchain.resolvedCommit, "f3b06c705e6c85f5314019d5d3baab0fec5b580c");
  assert.equal(metadata.smokeSource, "Ds4LeanCore.lean");
  assert.equal(metadata.files["lean-toolchain"], sha256Hex(Buffer.from("leanprover/lean4:v4.32.2\n")));
  assert.equal(metadata.files["lake-manifest.json"].length, 64);
});

test("readLeanRuntimeMetadata returns the validated metadata", async () => {
  const read = await readLeanRuntimeMetadata(CONFIG, "core");
  assert.equal(read.ok, true);
  assert.equal(read.metadata.profile, "core");
});

test("readLeanRuntimeMetadata fails when metadata is missing", async () => {
  const read = await readLeanRuntimeMetadata(CONFIG, "mathlib");
  assert.equal(read.ok, false);
  assert.match(read.error, /missing runtime metadata/);
});

test("readLeanRuntimeMetadata rejects a metadata for the wrong profile", async () => {
  const mathlibDir = join(root, "mathlib");
  await mkdir(mathlibDir, { recursive: true });
  await writeFile(
    join(mathlibDir, "runtime.metadata.json"),
    JSON.stringify({
      schemaVersion: RUNTIME_METADATA_SCHEMA_VERSION,
      profile: "core",
      preparedAt: new Date().toISOString(),
      mode: "locked",
      smokeSource: "Ds4LeanCore.lean",
      toolchain: {
        descriptor: "leanprover/lean4:v4.32.2",
        leanVersion: "lean",
        lakeVersion: "lake",
        resolvedCommit: "a".repeat(40),
      },
      files: {
        "lean-toolchain": "b".repeat(64),
        "lakefile.toml": "b".repeat(64),
        "lake-manifest.json": "b".repeat(64),
        "Ds4LeanCore.lean": "b".repeat(64),
      },
    })
  );
  const read = await readLeanRuntimeMetadata(CONFIG, "mathlib");
  assert.equal(read.ok, false);
  assert.match(read.error, /runtime metadata invalid/);
  assert.ok(read.errors.some((e) => e.includes("profile mismatch")), "must report the profile mismatch");
  await rm(mathlibDir, { recursive: true, force: true });
});

test("verifyLeanRuntimeMetadata passes when files match the lock", async () => {
  await writeLeanRuntimeMetadata(CONFIG, "core", facts());
  const verify = await verifyLeanRuntimeMetadata(CONFIG, "core");
  assert.equal(verify.ok, true);
  assert.deepEqual(verify.mismatches, []);
});

test("verifyLeanRuntimeMetadata reports a drifted pinned file", async () => {
  await writeLeanRuntimeMetadata(CONFIG, "core", facts());
  await writeFile(join(root, "core", "lean-toolchain"), "leanprover/lean4:v4.32.3\n");
  const verify = await verifyLeanRuntimeMetadata(CONFIG, "core");
  assert.equal(verify.ok, false);
  assert.equal(verify.mismatches.length, 1);
  assert.equal(verify.mismatches[0].file, "lean-toolchain");
  await writeFile(join(root, "core", "lean-toolchain"), "leanprover/lean4:v4.32.2\n");
});

test("writeLeanRuntimeMetadata refuses a floating descriptor", async () => {
  const res = await writeLeanRuntimeMetadata(CONFIG, "core", facts({ descriptor: "leanprover/lean4:master" }));
  assert.equal(res.ok, false);
  assert.match(res.error, /not a pinned version/);
});

test("writeLeanRuntimeMetadata refuses a missing pinned file", async () => {
  const res = await writeLeanRuntimeMetadata(CONFIG, "mathlib", facts());
  assert.equal(res.ok, false, "mathlib smoke source is absent in the temp dir");
  assert.match(res.error, /missing pinned file/);
});

test("validateLeanRuntimeMetadata rejects floating mathlib inputRev", () => {
  const metadata = {
    schemaVersion: 1,
    profile: "mathlib",
    preparedAt: new Date().toISOString(),
    mode: "locked",
    smokeSource: "Ds4LeanMathlib.lean",
    toolchain: {
      descriptor: "leanprover/lean4:v4.32.2",
      leanVersion: "lean",
      lakeVersion: "lake",
      resolvedCommit: "a".repeat(40),
    },
    mathlib: { inputRev: "master", resolvedCommit: "b".repeat(40) },
    files: {
      "lean-toolchain": "c".repeat(64),
      "lakefile.toml": "c".repeat(64),
      "lake-manifest.json": "c".repeat(64),
      "Ds4LeanMathlib.lean": "c".repeat(64),
    },
  };
  const check = validateLeanRuntimeMetadata(metadata, "mathlib");
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes("mathlib.inputRev") && e.includes("pinned")));
});
