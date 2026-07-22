/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/acceptance-contract.md sections 3 and 24-29.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: deterministic benchmark gate and content-addressed evidence patterns.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { atomicWriteJson, hashJson, sha256 } from "./evolutionIntegrity.mjs";
import { redactExecutionText } from "./evolutionExecutor.mjs";
import { validateLiveEvidence, verifyLiveEvidenceHashes } from "./evolutionLiveEvidence.mjs";
import { scanEvolutionProvenance } from "./evolutionProvenance.mjs";

const execFileAsync = promisify(execFile);
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(MODULE_DIR, "../../..");
const UNIT_COMMAND = "node <each unit test file sequentially>";
const SECURITY_COMMAND = "node <each security test file sequentially>";
const PROVENANCE_COMMAND = "node benchmarks/agentic/evolution/run.mjs --selftest --gate";

function ids(prefix, first, last = first) {
  return Array.from({ length: last - first + 1 }, (_, index) => `${prefix}-${String(first + index).padStart(3, "0")}`);
}

const UNIT_REQUIREMENTS = Object.freeze([
  ...ids("BEH-CONTRACT", 1, 5), ...ids("SEC-SCHEMA", 1, 2),
  ...ids("BEH-STATE", 1, 6), ...ids("BEH-BASE", 1, 2), ...ids("SEC-BASE", 1, 2),
  ...ids("SEC-PATH", 1, 5), ...ids("SEC-ISOLATION", 1, 3),
  ...ids("BEH-EVAL", 1, 4), ...ids("SEC-EVAL", 1, 4),
  ...ids("BEH-GATE", 1, 7), ...ids("SEC-AUTH", 1, 2), ...ids("SEC-SIMPLIFY", 1, 2),
  ...ids("SEC-APPROVAL", 1, 2), ...ids("SEC-TOCTOU", 1, 2),
  ...ids("BEH-PROMOTE", 1, 2), ...ids("SEC-ROLLBACK", 1, 3),
  ...ids("SEC-LEDGER", 1, 5), ...ids("BEH-LEDGER", 1),
  ...ids("SEC-SECRET", 3, 4), ...ids("SEC-NET", 2), ...ids("SEC-SUPPLY", 1, 4),
  ...ids("SEC-GAME", 2, 4), ...ids("SEC-RISK", 1, 3), ...ids("SEC-SHELL", 1)
]);

const SECURITY_REQUIREMENTS = Object.freeze([
  ...ids("BEH-EXEC", 1, 4), ...ids("SEC-DOS", 1, 6), ...ids("SEC-SHELL", 2),
  ...ids("SEC-SECRET", 1, 2), ...ids("SEC-NET", 1), ...ids("SEC-HID", 1, 2),
  ...ids("SEC-GAME", 1)
]);

const PROVENANCE_REQUIREMENTS = Object.freeze(ids("CR", 1, 6));

function catalogEntries(requirements, suite, type, command, artifact) {
  return requirements.map((testId) => Object.freeze({
    testId,
    requirement: `DS4-EVO-ACC-001 requirement ${testId}`,
    suite,
    type,
    command,
    expected: `${testId} passes without waiver`,
    artifact
  }));
}

export const LEVEL_B_TEST_CATALOG = Object.freeze([
  ...catalogEntries(UNIT_REQUIREMENTS, "unit", "unit", UNIT_COMMAND, "test-results.json"),
  ...catalogEntries(SECURITY_REQUIREMENTS, "security", "security", SECURITY_COMMAND, "security-results.json"),
  ...catalogEntries(PROVENANCE_REQUIREMENTS, "provenance", "security", PROVENANCE_COMMAND, "provenance-report.json")
]);

const LEVEL_C_REQUIREMENTS = Object.freeze([
  ...ids("BEH-CRITIC", 1, 3), ...ids("SEC-CRITIC", 1, 3),
  ...ids("BEH-MODEL", 1, 3), ...ids("SEC-MODEL", 1, 4),
  ...ids("BEH-API", 1, 3), ...ids("SEC-API", 1, 2), ...ids("SEC-UI", 1, 2)
]);

const LEVEL_D_REQUIREMENTS = Object.freeze([
  ...ids("BEH-PROPOSER", 1, 3), ...ids("SEC-PROPOSER", 1, 3),
  ...ids("BEH-LOOP", 1, 3), ...ids("SEC-LOOP", 1, 3)
]);

export const LEVEL_C_TEST_CATALOG = Object.freeze([
  ...LEVEL_B_TEST_CATALOG,
  ...catalogEntries(LEVEL_C_REQUIREMENTS, "unit", "integration", UNIT_COMMAND, "test-results.json")
]);

export const LEVEL_D_TEST_CATALOG = Object.freeze([
  ...LEVEL_C_TEST_CATALOG,
  ...catalogEntries(LEVEL_D_REQUIREMENTS, "unit", "integration", UNIT_COMMAND, "test-results.json")
]);

export function certificationCatalog(level = "B") {
  if (level === "B") return LEVEL_B_TEST_CATALOG;
  if (level === "C") return LEVEL_C_TEST_CATALOG;
  if (level === "D") return LEVEL_D_TEST_CATALOG;
  throw new EvolutionCertificationError("UNSUPPORTED_CERTIFICATION_LEVEL", String(level));
}

export class EvolutionCertificationError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "EvolutionCertificationError";
    this.code = code;
    this.details = details;
  }
}

async function listFiles(root, predicate = () => true) {
  const result = [];
  const visit = async (directory) => {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile() && predicate(candidate)) result.push(candidate);
    }
  };
  await visit(root);
  return result;
}

async function defaultTestFiles(repositoryRoot) {
  const evolutionDir = path.join(repositoryRoot, "frontend/server/evolution");
  const benchmarkDir = path.join(repositoryRoot, "benchmarks/agentic/evolution");
  const allEvolutionTests = await listFiles(evolutionDir, (file) => file.endsWith(".test.mjs"));
  const unit = allEvolutionTests.filter((file) => !file.includes(`${path.sep}security${path.sep}`));
  unit.push(...await listFiles(benchmarkDir, (file) => file.endsWith(".test.mjs")));
  const structuredClientTest = path.join(repositoryRoot, "frontend/server/structuredModelClient.test.mjs");
  if (await fs.access(structuredClientTest).then(() => true, () => false)) unit.push(structuredClientTest);
  unit.push(...await listFiles(path.join(repositoryRoot, "frontend/src/evolution"), (file) => file.endsWith(".test.mjs")));
  const security = allEvolutionTests.filter((file) => file.includes(`${path.sep}security${path.sep}`));
  return {
    unit: unit.map((file) => path.relative(repositoryRoot, file)).sort(),
    security: security.map((file) => path.relative(repositoryRoot, file)).sort()
  };
}

function boundedOutput(value) {
  const redacted = redactExecutionText(String(value ?? ""));
  return redacted.length <= 8_000 ? redacted : `[truncated ${redacted.length - 8_000} chars]\n${redacted.slice(-8_000)}`;
}

const TAP_RESULT_LINE = /^\s*(ok|not ok) \d+ - (.+?)\s*$/gm;
const REQUIREMENT_ID_PATTERN = /([A-Z]+(?:-[A-Z]+)*)-(\d{3})/g;
const REQUIREMENT_ID_COMBO = /^((?:[./]{1,2}\d{3})+)/;

/** Parses `--test-reporter=tap` output into top-level {title, ok} subtest records. */
function parseTapSubtests(tapOutput) {
  const subtests = [];
  for (const match of tapOutput.matchAll(TAP_RESULT_LINE)) {
    const [, verdict, rawTitle] = match;
    subtests.push({ title: rawTitle.replace(/\s*#\s*(SKIP|TODO).*$/i, "").trim(), ok: verdict === "ok" });
  }
  return subtests;
}

/**
 * Extracts fully-qualified requirement IDs from a subtest title, expanding the
 * `PREFIX-NNN/MMM` and `PREFIX-NNN..MMM` combo notations used by this suite's test
 * titles. A bare prefix with no attached number (e.g. a title mentioning "SEC-FOO"
 * without a number) is deliberately NOT credited to any numbered requirement ID -
 * only an explicit number is real evidence.
 */
function extractRequirementIds(title) {
  const found = new Set();
  REQUIREMENT_ID_PATTERN.lastIndex = 0;
  let match;
  while ((match = REQUIREMENT_ID_PATTERN.exec(title))) {
    const [, prefix, firstNum] = match;
    found.add(`${prefix}-${firstNum}`);
    const comboMatch = REQUIREMENT_ID_COMBO.exec(title.slice(REQUIREMENT_ID_PATTERN.lastIndex));
    if (!comboMatch) continue;
    const nums = comboMatch[1].match(/\d{3}/g) ?? [];
    if (comboMatch[1].includes("..")) {
      for (let n = Number(firstNum) + 1; n <= Number(nums[nums.length - 1]); n++) found.add(`${prefix}-${String(n).padStart(3, "0")}`);
    } else {
      for (const num of nums) found.add(`${prefix}-${num}`);
    }
    REQUIREMENT_ID_PATTERN.lastIndex += comboMatch[1].length;
  }
  return found;
}

/** Maps each requirement ID to whether every subtest that names it passed, and whether any subtest named it at all. */
function requirementEvidence(subtests) {
  const evidence = new Map();
  for (const subtest of subtests) {
    for (const testId of extractRequirementIds(subtest.title)) {
      const current = evidence.get(testId) ?? { ok: true, found: false };
      evidence.set(testId, { ok: current.ok && subtest.ok, found: true });
    }
  }
  return evidence;
}

export async function runCertificationSuite({ name, files, repositoryRoot }) {
  if (!files.length) return Object.freeze({ name, passed: false, exitCode: null, durationMs: 0, outputHash: null, outputPreview: "NO_TEST_FILES", subtests: Object.freeze([]) });
  const started = Date.now();
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  const deadline = started + 180_000;
  const environment = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LANG: "C.UTF-8",
    NODE_ENV: "test",
    TMPDIR: process.env.TMPDIR ?? "/tmp"
  };
  const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evolution-tap-"));
  try {
    for (const [index, file] of files.entries()) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        exitCode = 1;
        stderr += `\n${file}: certification suite timeout`;
        break;
      }
      const reportFile = path.join(reportDir, `${String(index).padStart(4, "0")}.tap`);
      try {
        const result = await execFileAsync(process.execPath, [
          "--test-reporter=tap",
          `--test-reporter-destination=${reportFile}`,
          file
        ], {
          cwd: repositoryRoot,
          encoding: "utf8",
          timeout: remainingMs,
          maxBuffer: 4_000_000,
          env: environment
        });
        const report = await fs.readFile(reportFile, "utf8").catch(() => result.stdout);
        stdout += `\n# file ${file}\n${report}`;
        stderr += result.stderr;
      } catch (error) {
        const report = await fs.readFile(reportFile, "utf8").catch(() => String(error.stdout ?? ""));
        stdout += `\n# file ${file}\n${report}`;
        stderr += `\n${file}\n${String(error.stderr ?? error.message ?? "")}`;
        exitCode = Number.isInteger(error.code) ? error.code : 1;
        if (error.killed || error.code === "ETIMEDOUT") break;
      }
    }
  } finally {
    await fs.rm(reportDir, { recursive: true, force: true });
  }
  const combined = `${stdout}${stderr}`;
  return Object.freeze({
    name,
    passed: exitCode === 0,
    exitCode,
    durationMs: Date.now() - started,
    outputHash: sha256(combined),
    outputPreview: boundedOutput(combined),
    subtests: Object.freeze(parseTapSubtests(stdout))
  });
}

async function commandVersion(executable, args, repositoryRoot) {
  try {
    const { stdout, stderr } = await execFileAsync(executable, args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 100_000,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8" }
    });
    return `${stdout}${stderr}`.trim().slice(0, 500);
  } catch {
    return null;
  }
}

async function environmentEvidence(repositoryRoot) {
  return Object.freeze({
    schema: "ds4_evolution_environment_v1",
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    git: await commandVersion("git", ["--version"], repositoryRoot),
    bubblewrap: await commandVersion("/usr/bin/bwrap", ["--version"], repositoryRoot),
    networkPolicy: "candidate-disabled-by-default",
    sandboxPolicy: "bubblewrap-prlimit"
  });
}

async function sourceRevisionEvidence(repositoryRoot) {
  const roots = [
    path.join(repositoryRoot, "frontend/server/evolution"),
    path.join(repositoryRoot, "benchmarks/agentic/evolution"),
    path.join(repositoryRoot, "frontend/src/evolution")
  ];
  const files = [];
  for (const root of roots) files.push(...await listFiles(root));
  for (const name of ["acceptance-contract.md", "behavioral-specification.md", "clean-room-provenance.md", "threat-model.md"]) {
    const file = path.join(repositoryRoot, "docs/evolution", name);
    if (await fs.access(file).then(() => true, () => false)) files.push(file);
  }
  for (const name of [
    "frontend/package.json", "frontend/server/config.mjs", "frontend/server/defaultConfig.mjs",
    "frontend/server/index.mjs", "frontend/server/structuredModelClient.mjs",
    "frontend/src/App.jsx", "frontend/src/chat/ChatPanel.jsx", "frontend/src/styles.css"
  ]) {
    const file = path.join(repositoryRoot, name);
    if (await fs.access(file).then(() => true, () => false)) files.push(file);
  }
  const sourceFiles = [];
  for (const file of [...new Set(files)].sort()) {
    sourceFiles.push({ path: path.relative(repositoryRoot, file).split(path.sep).join("/"), hash: sha256(await fs.readFile(file)) });
  }
  const head = await commandVersion("git", ["rev-parse", "HEAD"], repositoryRoot);
  const treeHash = hashJson(sourceFiles);
  return Object.freeze({
    schema: "ds4_evolution_source_revision_v1",
    gitHead: head,
    treeHash,
    revision: `${head ?? "unversioned"}+sha256:${treeHash}`,
    files: Object.freeze(sourceFiles)
  });
}

function mappedResult(entry, status) {
  return Object.freeze({
    testId: entry.testId,
    requirement: entry.requirement,
    type: entry.type,
    command: entry.command,
    expected: entry.expected,
    artifact: entry.artifact,
    status,
    skipReason: null
  });
}

export async function createCertificationBundle(options = {}) {
  const level = options.level ?? "B";
  const mode = options.live ? "live" : "offline-selftest";
  const catalog = certificationCatalog(level);
  const repositoryRoot = path.resolve(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT);
  const decidedAt = (options.now ?? (() => new Date()))().toISOString();
  const timestamp = decidedAt.replaceAll(":", "-");
  const outputDir = path.resolve(options.outputDir ?? path.join(repositoryRoot, "artifacts/evolution-certification", timestamp));
  const testFiles = options.testFiles ?? await defaultTestFiles(repositoryRoot);
  const suiteRunner = options.suiteRunner ?? runCertificationSuite;
  const [unit, security, provenanceReport, environment, sourceRevision] = await Promise.all([
    suiteRunner({ name: "unit", files: testFiles.unit, repositoryRoot }),
    suiteRunner({ name: "security", files: testFiles.security, repositoryRoot }),
    options.provenanceReport ? Promise.resolve(options.provenanceReport) : scanEvolutionProvenance({ repositoryRoot }),
    options.environment ? Promise.resolve(options.environment) : environmentEvidence(repositoryRoot),
    options.sourceRevision ? Promise.resolve(options.sourceRevision) : sourceRevisionEvidence(repositoryRoot)
  ]);
  const liveEvidence = options.liveEvidence ?? null;
  const liveArmsExecuted = liveEvidence !== null && liveEvidence.executed === true;
  const provenanceStatuses = new Map((provenanceReport.checks ?? []).map((entry) => [entry.testId, entry.status]));
  const unitEvidence = requirementEvidence(unit.subtests ?? []);
  const securityEvidence = requirementEvidence(security.subtests ?? []);
  const records = catalog.map((entry) => {
    if (entry.suite === "unit" || entry.suite === "security") {
      const evidence = (entry.suite === "unit" ? unitEvidence : securityEvidence).get(entry.testId);
      return mappedResult(entry, evidence?.found && evidence.ok ? "PASS" : "FAIL");
    }
    return mappedResult(entry, provenanceStatuses.get(entry.testId) === "PASS" ? "PASS" : "FAIL");
  });
  const passed = records.filter((entry) => entry.status === "PASS").length;
  const failed = records.filter((entry) => entry.status === "FAIL").length;
  const skipped = records.filter((entry) => entry.status === "SKIP").length;
  const hardFailures = [];
  if (unit.passed !== true) hardFailures.push("UNIT_OR_INTEGRATION_SUITE_FAILED");
  if (security.passed !== true) hardFailures.push("SECURITY_SUITE_FAILED");
  for (const violation of provenanceReport.violations ?? []) hardFailures.push(`PROVENANCE:${violation}`);
  if (failed || skipped) hardFailures.push(...records.filter((entry) => entry.status !== "PASS").map((entry) => `REQUIRED_TEST_${entry.status}:${entry.testId}`));
  if (mode === "live") {
    if (!liveEvidence) {
      hardFailures.push("LIVE_EVIDENCE_MISSING");
    } else {
      try {
        validateLiveEvidence(liveEvidence);
      } catch (error) {
        hardFailures.push(`LIVE_EVIDENCE_INVALID:${error.code}`);
      }
      if (options.liveArtifactsDir) {
        try {
          await verifyLiveEvidenceHashes(liveEvidence, options.liveArtifactsDir);
        } catch (error) {
          hardFailures.push(`LIVE_EVIDENCE_INVALID:${error.code}`);
        }
      }
      if (!liveEvidence.model) hardFailures.push("LIVE_MODEL_CALL_MISSING");
      if (!liveEvidence.sourceRevision) hardFailures.push("LIVE_FEEDBACK_BINDING_MISSING");
      if (liveEvidence.runsRequested > 0 && liveEvidence.runsCompleted < liveEvidence.runsRequested) {
        hardFailures.push("LIVE_RUN_TIMEOUT");
      }
      if (liveEvidence.sourceRevision && liveEvidence.sourceRevision !== sourceRevision.revision) {
        hardFailures.push("LIVE_CANONICAL_REPOSITORY_MUTATED");
      }
      if (!liveEvidence.rollbackDrillPassed) hardFailures.push("LIVE_ROLLBACK_DRILL_FAILED");
      if (liveEvidence.runsRequested > 0 && liveEvidence.runsPassed < liveEvidence.runsRequested) {
        hardFailures.push("LIVE_SUCCESS_RATE_BELOW_THRESHOLD");
      }
    }
    if (level === "C") {
      if (!liveEvidence || liveEvidence.runsPassed < 1) {
        if (!hardFailures.includes("LIVE_EVIDENCE_MISSING")) {
          hardFailures.push("LIVE_EVIDENCE_MISSING");
        }
      }
    }
    if (level === "D") {
      if (!liveEvidence || liveEvidence.runsRequested < 2) {
        if (!hardFailures.includes("LIVE_EVIDENCE_MISSING")) {
          hardFailures.push("LIVE_EVIDENCE_MISSING");
        }
      } else {
        const threshold = Math.ceil(liveEvidence.runsRequested * 2 / 3);
        if (liveEvidence.runsPassed < threshold) {
          hardFailures.push("LIVE_SUCCESS_RATE_BELOW_THRESHOLD");
        }
        if (!liveEvidence.rollbackDrillPassed) {
          if (!hardFailures.includes("LIVE_ROLLBACK_DRILL_FAILED")) {
            hardFailures.push("LIVE_ROLLBACK_DRILL_FAILED");
          }
        }
      }
    }
  }
  const environmentHash = hashJson(environment);
  const decision = Object.freeze({
    schema: "ds4_evolution_acceptance_v2",
    level,
    mode,
    decision: hardFailures.length ? "FAIL" : "PASS",
    requiredTests: records.length,
    passed,
    failed,
    skipped,
    hardFailures: Object.freeze([...new Set(hardFailures)].sort()),
    sourceRevision: sourceRevision.revision,
    environmentHash,
    liveEvidence: liveEvidence ? Object.freeze({ ...liveEvidence }) : null,
    decidedAt
  });
  const testResults = {
    schema: "ds4_evolution_test_results_v1",
    suite: unit,
    tests: records.filter((entry) => catalog.find((item) => item.testId === entry.testId)?.suite === "unit")
  };
  const securityResults = {
    schema: "ds4_evolution_security_results_v1",
    suite: security,
    tests: records.filter((entry) => catalog.find((item) => item.testId === entry.testId)?.suite === "security")
  };
  const benchmarkSummary = {
    schema: "ds4_evolution_benchmark_summary_v1",
    mode,
    level,
    passed: decision.decision === "PASS",
    unitSuitePassed: unit.passed === true,
    securitySuitePassed: security.passed === true,
    provenancePassed: provenanceReport.passed === true,
    liveArmsExecuted
  };
  const failures = { schema: "ds4_evolution_failures_v1", failures: decision.hardFailures };
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const artifacts = {
    "environment.json": environment,
    "source-revision.json": sourceRevision,
    "provenance-report.json": provenanceReport,
    "test-results.json": testResults,
    "security-results.json": securityResults,
    "benchmark-summary.json": benchmarkSummary,
    "failures.json": failures,
    "acceptance-decision.json": decision
  };
  for (const [name, value] of Object.entries(artifacts)) await atomicWriteJson(path.join(outputDir, name), value);
  return Object.freeze({ outputDir, decision, artifacts: Object.freeze(Object.keys(artifacts).sort()) });
}
