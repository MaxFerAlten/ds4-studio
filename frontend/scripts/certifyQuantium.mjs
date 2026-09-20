// certifyQuantium.mjs — Quantium epistemic certification gate (Q50 / R08) + REM-010
// + formal hardening (FI-001..FI-015).
//
// One command that certifies the Quantium ongoing-verification subsystem. It
// refuses a CERTIFIED verdict unless every scope actually ran and passed with
// zero failures and zero skips on this machine, at this commit — a skipped test
// is a failure in certification mode (REM-010.7).
//
// Scopes (R08-PATCH-07, REM-010.9):
//   1. epistemic unit tests        epistemic/*.test.mjs (excluding e2e/wiring/registry/qho)
//   2. orchestration E2E           epistemicOrchestration.e2e.test.mjs
//   3. production wiring           epistemicProductionWiring.test.mjs
//   4. Quantium hallucination E2E  quantiumHallucination.e2e.test.mjs
//   5. registry completeness       epistemicRegressionSuite.test.mjs
//   6. QHO real replay (REM-012)   qhoFinalizationRegression.test.mjs
//   6b. QHO→LLM adversarial (Q2-019) qhoLlmAdversarialRegression.test.mjs
//   7. (optional) native C bridge  ds4_agent_test, ds4_agent_runtime_skill_test,
//                                  ds4_agent_epistemic_test
//
// Real metrics (REM-010): high-severity escape rate, the JS no-byte-leak and the
// EPI manifest hash are derived from the actual corpus evidence via
// quantiumMetrics.mjs — not from a pass/fail shortcut.
//
// Formal hardening additions (docs/quantum/001/formalmente.inattaccabile.quantium.001.md):
//   FI-002  native targets are built-then-run (provenance records build status,
//           source sha256 and binary sha256 — never a stale binary).
//   FI-003  the native epistemic target emits machine-readable --metrics JSON;
//           the certifier parses it instead of trusting exit code alone.
//   FI-008  non-vacuity: every scope must be non-empty, metrics must be present,
//           and the native epistemic probe must report every adversarial candidate
//           blocked AND a clean candidate published (a bare zero is never enough).
//   FI-009  provenance mode: --mode=release requires a clean tree, --mode=dev
//           (or --allow-dirty) records dev provenance and permits a dirty tree.
//   FI-010  a machine-readable certificate (quantium-certificate.json) is written
//           with full evidence and a certificateSha256 self-hash.
//   FI-011  the markdown certificate (quantium-certificate.md) is rendered from the
//           JSON, and both artifacts carry sha256 hashes.
//   FI-001  the epistemic native target is part of NATIVE_TARGETS.
//
// Output (REM-010.10 + FI-010): a one-line JSON certificate on stdout plus the
// human lines. Exit 0 iff CERTIFIED.

import {
  readdirSync,
  existsSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  mkdirSync
} from "node:fs";
import { createHash } from "node:crypto";
import {
  guardHSCorpusNonEmpty,
  guardFailClosedOnError,
  guardNativeFresh,
  guardNoPreGateLeak
} from "./certificationGuards.mjs";
import { auditCertificate } from "./auditQuantiumCertificate.mjs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = realpathSync(join(HERE, "..", ".."));
const EPI_DIR = join(ROOT, "frontend", "server", "epistemic");
const METRIC_RUNNER = join(EPI_DIR, "quantiumMetrics.mjs");

// Unit files exclude the separately-scoped E2E / wiring / registry / QHO replay
// tests so their tests are not run twice (REM-010.9).
const EXCLUDED_UNIT = new Set([
  "epistemicOrchestration.e2e.test.mjs",
  "epistemicProductionWiring.test.mjs",
  "epistemicRegressionSuite.test.mjs",
  "qhoFinalizationRegression.test.mjs",
  "qhoLlmAdversarialRegression.test.mjs",
  "quantiumHallucination.e2e.test.mjs"
]);

// REM-011.1 / FI-001 — real native epistemic test targets. Each carries:
//   makeTarget : Makefile target that builds the binary (build-then-run, FI-002)
//   bin        : relative path to the built binary
//   metrics    : true when the binary supports the machine-readable --metrics
//                protocol (FI-003). The epistemic target does; the two older
//                agent targets do not (they certify on exit 0 + built provenance).
const NATIVE_TARGETS = [
  {
    name: "ds4_agent_test",
    makeTarget: "ds4_agent_test",
    bin: "ds4_agent_test",
    metrics: false,
    sources: [
      "tests/ds4_agent_test.c",
      "ds4_agent.c",
      "ds4_agent_epistemic.c",
      "ds4_agent_epistemic.h"
    ]
  },
  {
    name: "agent_runtime_skill_test",
    makeTarget: "ds4_agent_runtime_skill_test",
    bin: "tests/ds4_agent_runtime_skill_test",
    metrics: false,
    sources: [
      "tests/ds4_agent_runtime_skill_test.c",
      "ds4_agent_runtime.c",
      "ds4_agent.c",
      "ds4_agent_epistemic.c"
    ]
  },
  {
    name: "agent_epistemic_test",
    makeTarget: "ds4-agent-epistemic-test",
    bin: "tests/ds4_agent_epistemic_test",
    metrics: true,
    sources: [
      "tests/ds4_agent_epistemic_test.c",
      "ds4_agent_epistemic.c",
      "ds4_agent_epistemic.h"
    ]
  }
];

function sha256Of(text) {
  return createHash("sha256").update(text).digest("hex");
}

function sha256File(path) {
  try {
    return sha256Of(readFileSync(path));
  } catch {
    return null;
  }
}

// Strip inherited Node test-runner context from child envs so a certifier that
// is itself run under `node --test` still spawns independent, non-nested test
// runs (a nested run in NODE_TEST_CONTEXT=child collapses to zero passing tests).
function cleanEnv(extra) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith("NODE_TEST_") || k === "TAP") delete env[k];
  }
  return { ...env, NO_COLOR: "1", ...extra };
}

// Run a scope. A scope is either a node --test run (has `files`) or an arbitrary
// command (has `command`) — the runner is generalized so the native C targets can
// be exercised identically to the Node suites (REM-011.3). Returns the process
// result plus a parsed summary (null for non-TAP command scopes).
function runScope(scope) {
  if (scope.files) {
    const res = spawnSync(process.execPath, ["--test", ...scope.files], {
      cwd: ROOT,
      encoding: "utf8",
      env: cleanEnv(),
      timeout: 300_000
    });
    const combined = (res.stdout ?? "") + "\n" + (res.stderr ?? "");
    return {
      code: res.status,
      signal: res.signal ?? null,
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
      combined,
      summary: parseSummary(combined)
    };
  }
  const res = spawnSync(scope.command, scope.args ?? [], {
    cwd: scope.dir ?? ROOT,
    encoding: "utf8",
    env: cleanEnv(),
    timeout: 600_000
  });
  const combined = (res.stdout ?? "") + "\n" + (res.stderr ?? "");
  return {
    code: res.status,
    signal: res.signal ?? null,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    combined,
    summary: null
  };
}

function parseSummary(text) {
  const m = /^# tests\s+(\d+)\s*$/m.exec(text);
  if (!m) return null;
  const num = (label) => {
    const x = new RegExp(`^# ${label}\\s+(\\d+)\\s*$`, "m").exec(text);
    return x ? Number(x[1]) : 0;
  };
  return {
    total: Number(m[1]),
    pass: num("pass"),
    fail: num("fail"),
    skipped: num("skipped")
  };
}

/** Run the metric runner and return parsed metrics, or null on failure. */
function readMetrics() {
  const res = spawnSync(process.execPath, [METRIC_RUNNER], {
    cwd: ROOT,
    encoding: "utf8",
    env: cleanEnv(),
    timeout: 300_000
  });
  if (res.status !== 0) return null;
  const line = String(res.stdout ?? "").trim();
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function listTestFiles() {
  let files = [];
  try {
    files = readdirSync(EPI_DIR);
  } catch (err) {
    files = [];
  }
  return files
    .filter(
      (f) =>
        f.endsWith(".test.mjs") &&
        !EXCLUDED_UNIT.has(f) &&
        !f.endsWith(".e2e.test.mjs")
    )
    .sort()
    .map((f) => join(EPI_DIR, f));
}

function gitHead() {
  const res = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  return res.status === 0 ? String(res.stdout).trim() : null;
}

function gitDirty() {
  const res = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  if (res.status !== 0) return true;
  return String(res.stdout).trim().length > 0;
}

// FI-009 / §26 — in dev mode the certified source is GitTree(HEAD) + Diff(hash),
// so the diff must be hashed: HEAD alone does not identify a dirty tree. The hash
// covers both the tracked diff and every untracked, non-ignored file, since an
// untracked file (a new module) changes the source under test just as much.
function gitDiffSha256() {
  const diff = spawnSync("git", ["diff", "HEAD", "--binary"], {
    cwd: ROOT,
    encoding: "buffer",
    maxBuffer: 512 * 1024 * 1024
  });
  if (diff.status !== 0) return null;
  const hash = createHash("sha256").update(diff.stdout ?? Buffer.alloc(0));

  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8"
  });
  if (untracked.status !== 0) return null;
  for (const rel of String(untracked.stdout).split("\n").map((l) => l.trim()).filter(Boolean).sort()) {
    hash.update(` ${rel} `);
    try {
      hash.update(readFileSync(join(ROOT, rel)));
    } catch {
      // a file that vanished between listing and reading is itself source drift
      hash.update("<unreadable>");
    }
  }
  return hash.digest("hex");
}

function gitBranch() {
  const res = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8"
  });
  return res.status === 0 ? String(res.stdout).trim() : null;
}

// FI-002 — build a native target from source (never trust a stale binary), then
// hash the source and the produced binary for provenance.
function buildNative(t) {
  const res = spawnSync("make", [t.makeTarget, "-B"], {
    cwd: ROOT,
    encoding: "utf8",
    env: cleanEnv(),
    timeout: 600_000
  });
  const binPath = join(ROOT, t.bin);
  // FI-002 — hash the source files that produce this binary (source provenance);
  // null when a declared source is missing on disk.
  let sourceHash = null;
  if (Array.isArray(t.sources)) {
    let buf = "";
    let missing = false;
    for (const src of t.sources) {
      const p = join(ROOT, src);
      if (!existsSync(p)) {
        missing = true;
        break;
      }
      buf += `${src}\0`;
      try {
        buf += readFileSync(p, "utf8");
      } catch {
        missing = true;
        break;
      }
    }
    if (!missing) sourceHash = sha256Of(buf);
  }
  return {
    makeTarget: t.makeTarget,
    built: res.status === 0,
    buildExit: res.status,
    buildSignal: res.signal ?? null,
    buildLog: (res.stdout ?? "") + (res.stderr ?? ""),
    sources: t.sources ?? [],
    sourceSha256: sourceHash,
    binarySha256: sha256File(binPath),
    binaryExists: existsSync(binPath)
  };
}

// FI-003 — parse the native epistemic --metrics JSON from the binary stdout.
function parseNativeMetrics(stdout) {
  for (const line of String(stdout ?? "").split("\n")) {
    const l = line.trim();
    if (l.startsWith("{")) {
      try {
        const obj = JSON.parse(l);
        if (obj.schema === "ds4_native_epistemic_metrics_v1") return obj;
      } catch {
        // not the metrics line; keep scanning
      }
    }
  }
  return null;
}

// FI-010 §36 — QHO replay evidence is READ from the replay scope's TAP stream by
// exact test name. The aggregate exit code of the scope is a boolean proxy; the
// certificate must record which of the two named replay cases was observed.
const QHO_BROAD_TEST = "R08 replay qho_broad_final: expected blocked";
const QHO_NARROW_TEST = "R08 replay qho_narrowed_final: expected allowed";

// Q2-019 (§34) — the three §30/§31/§32 outcomes, observed by exact test name in
// the TAP stream rather than inferred from an exit code.
const QHO_LLM_BLOCKED_TEST = "Q2-017 (§30): the transcript's own final answer is blocked";
const QHO_LLM_REPAIR_TEST = "Q2-017 (§31): the honest repair over the same evidence publishes";
const QHO_LLM_COVERAGE_TEST = "Q2-017 (§32): one unbacked factual sentence blocks the same repair";

function passedNamedIn(tap, name) {
  return String(tap ?? "")
    .split("\n")
    .some((line) => {
      const t = line.trim();
      return t.startsWith("ok ") && t.endsWith(`- ${name}`);
    });
}

function parseQhoLlmReplay(tap) {
  return {
    adversarialIncluded: true,
    adversarialBlocked: passedNamedIn(tap, QHO_LLM_BLOCKED_TEST),
    safeRepairAllowed: passedNamedIn(tap, QHO_LLM_REPAIR_TEST),
    universalCoverageBlocked: passedNamedIn(tap, QHO_LLM_COVERAGE_TEST)
  };
}

function parseQhoReplay(tap) {
  const passedNamed = (name) =>
    String(tap ?? "")
      .split("\n")
      .some((line) => {
        const t = line.trim();
        return t.startsWith("ok ") && t.endsWith(`- ${name}`);
      });
  return {
    broadBlocked: passedNamed(QHO_BROAD_TEST),
    narrowAllowed: passedNamed(QHO_NARROW_TEST)
  };
}

function renderMarkdown(cert) {
  const rows = [
    "# Quantium Certification",
    "",
    `- Verdict: **${cert.verdict}**`,
    `- Schema: ${cert.schema}`,
    `- OID: ${cert.oid ?? "n/a"}`,
    `- Provenance: ${cert.provenance.mode}`,
    `- Commit: ${cert.provenance.gitHead ?? "n/a"}`,
    `- Branch: ${cert.provenance.gitBranch ?? "n/a"}`,
    `- Dirty at certify: ${cert.provenance.dirty}`,
    `- Certificate SHA-256: \`${cert.certificateSha256}\``,
    "",
    "## Test totals",
    "",
    `- TOTAL_TESTS=${cert.totals.total}`,
    `- PASSED_TESTS=${cert.totals.passed}`,
    `- FAILED_TESTS=${cert.totals.failed}`,
    `- SKIPPED_TESTS=${cert.totals.skipped}`,
    "",
    "## Scopes",
    ""
  ];
  for (const s of cert.scopes) {
    rows.push(`- **${s.name}**: ${s.ok ? "PASS" : "FAIL"}`);
  }
  rows.push("", "## Native targets (FI-002/003)", "");
  for (const n of cert.native) {
    rows.push(`- **${n.name}**: ${n.ok ? "PASS" : "FAIL"} (build exit ${n.build.buildExit})`);
    if (n.metrics) {
      rows.push(
        `  - candidateBytesBeforeVerdict=${n.metrics.candidateBytesBeforeVerdict}, ` +
          `withheldCandidateBytes=${n.metrics.withheldCandidateBytes}, ` +
          `publishedCleanBytesAfterVerdict=${n.metrics.publishedCleanBytesAfterVerdict}, ` +
          `blockedCases=${n.metrics.blockedCases}/${n.metrics.adversarialCases}`
      );
    }
  }
  for (const n of cert.native) {
    rows.push(
      `  - sourceSha256=\`${n.build.sourceSha256 ?? "n/a"}\`, binarySha256=\`${n.build.binarySha256 ?? "n/a"}\``
    );
  }
  rows.push(
    "",
    "## Metrics",
    "",
    `- epiManifestSha256=\`${cert.metrics.epiManifestSha256 ?? "n/a"}\` (count=${cert.metrics.epiManifestCount ?? "n/a"})`,
    `- HS_GENERATED=${cert.metrics.generatedHighSeverity}, HS_PUBLISHED=${cert.metrics.publishedHighSeverity}`,
    `- HIGH_SEVERITY_ESCAPE_RATE=${cert.metrics.escapeRate ?? "n/a"}`,
    `- JS_BLOCKED_CASES=${cert.jsLeak.blockedCases}`,
    `- JS_TEXT_BYTES_BEFORE_GATE=${cert.jsLeak.textBytesBeforeGate}`,
    `- JS_REASONING_BYTES_BEFORE_GATE=${cert.jsLeak.reasoningBytesBeforeGate}`,
    `- JS_CANDIDATE_BYTES_BEFORE_GATE=${cert.jsLeak.totalBytesBeforeGate}`,
    "",
    "## QHO replay (§31)",
    "",
    `- QHO_BROAD_BLOCKED=${cert.qhoReplay.broadBlocked}`,
    `- QHO_NARROW_ALLOWED=${cert.qhoReplay.narrowAllowed}`,
    "",
    "## QHO→LLM adversarial closure (remediation.Quantiom.002 §34)",
    "",
    `- QHO_LLM_ADVERSARIAL_INCLUDED=${cert.qhoLlmReplay?.adversarialIncluded ?? false}`,
    `- QHO_LLM_ADVERSARIAL_BLOCKED=${cert.qhoLlmReplay?.adversarialBlocked ?? false}`,
    `- QHO_LLM_SAFE_REPAIR_ALLOWED=${cert.qhoLlmReplay?.safeRepairAllowed ?? false}`,
    `- QHO_LLM_UNIVERSAL_COVERAGE_BLOCKED=${cert.qhoLlmReplay?.universalCoverageBlocked ?? false}`,
    `- STRICT_CONTRACT_VCCR=${cert.strictMetrics?.strictVerificationContract?.vccr ?? "n/a"}`,
    `- UFAR=${cert.strictMetrics?.formalArtifacts?.ufar ?? "n/a"}`,
    `- CBER=${cert.strictMetrics?.crossDomain?.cber ?? "n/a"}`,
    `- BIER=${cert.strictMetrics?.bibliography?.bier ?? "n/a"}`,
    `- APER=${cert.strictMetrics?.analogies?.aper ?? "n/a"}`,
    `- SOR=${cert.strictMetrics?.synthesis?.sor ?? "n/a"}`,
    `- STRICT_METRICS_NON_VACUOUS=${cert.strictMetrics?.nonVacuous ?? false}`,
    "",
    "## Independent audit (FI-015)",
    "",
    `- INDEPENDENT_AUDIT=${cert.audit?.verdict ?? "n/a"} (${cert.audit?.checks ?? 0} checks recomputed)`
  );
  for (const f of cert.audit?.failures ?? []) rows.push(`  - FAIL ${f.check}: ${f.reason}`);
  return rows.join("\n") + "\n";
}

function main() {
  const args = process.argv.slice(2);
  const withNative = args.includes("--with-native");
  const certDirArg = args.find((a) => a.startsWith("--cert-dir="));
  const outDir = certDirArg ? certDirArg.split("=")[1] : ROOT;

  // FI-009 — provenance mode. --allow-dirty is a deprecated alias for --mode=dev.
  const modeArg = args.find((a) => a.startsWith("--mode="));
  let mode = "release";
  if (modeArg) {
    mode = modeArg.split("=")[1] === "release" ? "release" : "dev";
  } else if (args.includes("--allow-dirty")) {
    mode = "dev";
  }
  const allowDirty = mode === "dev";

  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(
      "certifyQuantium.mjs — epistemic certification gate\n" +
        "  --with-native      also exercise the native C bridge (REM-011/FI-001)\n" +
        "  --mode=dev|release provenance mode (release requires a clean tree; FI-009)\n" +
        "  --allow-dirty      deprecated alias for --mode=dev\n" +
        "  --cert-dir=<path>  directory for quantium-certificate.json/.md (FI-010/011)\n" +
        "\n" +
        "Verdicts (FI-013): NOT_CERTIFIED | CERTIFIED_DEV | CERTIFIED_NATIVE_DEV |\n" +
        "CERTIFIED_RELEASE (clean tree + --with-native only). Every run embeds an\n" +
        "independent audit (FI-015); replay it with auditQuantiumCertificate.mjs.\n"
    );
    return 0;
  }

  // Early exits still report the provenance mode: a refusal is part of the audit
  // trail, so it must say under which mode it refused.
  const head = `QUANTIUM_CERTIFICATION\nMODE=${mode}\n`;

  if (!existsSync(EPI_DIR)) {
    process.stdout.write(`${head}VERDICT=NOT_CERTIFIED scope=epistemic_dir_missing\n`);
    return 1;
  }

  if (!allowDirty && gitDirty()) {
    process.stdout.write(
      `${head}SOURCE_DIRTY=true\nVERDICT=NOT_CERTIFIED phase=dirty_tree (use --mode=dev/--allow-dirty)\n`
    );
    return 1;
  }

  const unitFiles = listTestFiles();

  // FI-008 — non-vacuity: the unit scope must not be empty.
  if (unitFiles.length === 0) {
    process.stdout.write(`${head}VERDICT=NOT_CERTIFIED scope=unit_files_empty\n`);
    return 1;
  }

  const scopeArgs = [
    { name: "epistemic_unit", files: unitFiles },
    { name: "orchestration_e2e", files: [join(EPI_DIR, "epistemicOrchestration.e2e.test.mjs")] },
    { name: "production_wiring", files: [join(EPI_DIR, "epistemicProductionWiring.test.mjs")] },
    { name: "hallucination_e2e", files: [join(EPI_DIR, "quantiumHallucination.e2e.test.mjs")] },
    { name: "registry_completeness", files: [join(EPI_DIR, "epistemicRegressionSuite.test.mjs")] },
    { name: "qho_replay", files: [join(EPI_DIR, "qhoFinalizationRegression.test.mjs")] },
    // Q2-019 (§34) — the QHO→LLM adversarial closure is its own scope: the
    // certification has to run the real replay, not only the unit tests
    // whose helpers it exercises.
    { name: "qho_llm_adversarial", files: [join(EPI_DIR, "qhoLlmAdversarialRegression.test.mjs")] },
    // FI-012/015 — the anti-false-green negative controls (M1..M8) and the
    // independent auditor run INSIDE the certification: a certificate that does
    // not prove its own detectors are sensitive proves nothing (FB-015).
    {
      name: "negative_controls",
      files: [join(HERE, "certificationGuards.test.mjs"), join(HERE, "auditQuantiumCertificate.test.mjs")]
    }
  ];

  const scopes = [];
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let qhoReplay = { broadBlocked: false, narrowAllowed: false };
  let qhoLlmReplay = {
    adversarialIncluded: false,
    adversarialBlocked: false,
    safeRepairAllowed: false,
    universalCoverageBlocked: false
  };

  for (const scope of scopeArgs) {
    const res = runScope(scope);
    if (scope.name === "qho_replay") qhoReplay = parseQhoReplay(res.combined);
    if (scope.name === "qho_llm_adversarial") qhoLlmReplay = parseQhoLlmReplay(res.combined);
    const summary = res.summary;
    const ok = summary !== null && summary.fail === 0 && summary.skipped === 0;
    scopes.push({ name: scope.name, ok, ...(summary ?? {}) });

    if (summary) {
      total += summary.total;
      passed += summary.pass;
      failed += summary.fail;
      skipped += summary.skipped;
    } else {
      failed += 1;
    }
    if (!ok) {
      process.stdout.write(`[fail] ${scope.name}${res.signal ? ` signal=${res.signal}` : ""}\n`);
      const diag = /^not ok.*$/m.exec(res.stdout ?? "");
      if (diag) process.stdout.write(`${diag[0]}\n`);
    }
  }

  const metrics = readMetrics();

  // Native scopes (FI-001/002/003). Build-then-run each target; parse the
  // epistemic metrics JSON; certify on real conditions, never exit code alone.
  const native = [];
  if (withNative) {
    for (const t of NATIVE_TARGETS) {
      const build = buildNative(t);
      const res = runScope({ command: `./${t.bin}`, args: t.metrics ? ["--metrics"] : [], dir: ROOT });
      const nativeMetrics = t.metrics ? parseNativeMetrics(res.stdout) : null;

      let probeOk = true;
      if (t.metrics) {
        // FI-008 — non-vacuity for the epistemic probe: metrics JSON present,
        // zero bytes before verdict, every adversarial candidate blocked, and a
        // clean candidate published (so the zero is real, not vacuous).
        probeOk =
          nativeMetrics !== null &&
          nativeMetrics.candidateBytesBeforeVerdict === 0 &&
          nativeMetrics.candidateTextBytesBeforeVerdict === 0 &&
          nativeMetrics.candidateReasoningBytesBeforeVerdict === 0 &&
          Number(nativeMetrics.blockedCases) > 0 &&
          (nativeMetrics.blockedCases === nativeMetrics.adversarialCases) &&
          nativeMetrics.adversarialBlocked === true &&
          nativeMetrics.publishedCleanAfterVerdict === true &&
          Number(nativeMetrics.publishedCleanBytesAfterVerdict) > 0 &&
          nativeMetrics.testsFailed === 0;
      }

      const entry = {
        name: `native_${t.name}`,
        makeTarget: t.makeTarget,
        bin: t.bin,
        build,
        metrics: nativeMetrics,
        probeOk,
        ok: build.built && build.sourceSha256 !== null && res.code === 0 && probeOk
      };
      native.push(entry);

      if (build.buildExit !== 0) {
        process.stdout.write(`[fail] native_build_${t.name} exit=${build.buildExit}\n`);
      } else if (!entry.ok) {
        process.stdout.write(`[fail] native_${t.name} exit=${res.code} probeOk=${probeOk}\n`);
      }
    }
  }

  const nativeIncluded = withNative;
  const allNativeOk = native.every((n) => n.ok);
  const nativeLeakOk = !nativeIncluded || (native.length > 0 && allNativeOk);
  // FI-012 M7 — every native target must be freshly built from hashed sources;
  // an existing binary is never evidence about the current source (§2).
  const nativeFreshOk = !nativeIncluded || native.every((n) => guardNativeFresh(n.build).ok);

  // Fail-closed: when --with-native, absent native entries are NOT a pass.
  const nativeRanAll = !nativeIncluded || native.length === NATIVE_TARGETS.length;

  const registryComplete = !!metrics && metrics.registryRange !== "001..000";
  const manifestPresent = !!metrics && typeof metrics.epiManifestSha256 === "string" &&
    /^[0-9a-f]{64}$/.test(metrics.epiManifestSha256);
  const scopesOk = scopes.length > 0 && scopes.every((s) => s.ok);
  const hserOk = metrics ? metrics.escapeRate === 0 : false;

  // FI-005 — text and reasoning are buffered separately in production, so they are
  // certified separately; the total is their sum, never a hardcoded zero.
  const jsText = metrics?.jsCandidateTextBytesBeforeGate ?? -1;
  const jsReasoning = metrics?.jsCandidateReasoningBytesBeforeGate ?? -1;
  const jsBlockedCases = Number(metrics?.jsBlockedCases ?? 0);
  const jsLeakOk = metrics
    ? metrics.jsNoByteLeak === true && guardNoPreGateLeak(jsText, jsReasoning).ok
    : false;
  // FI-008 — zero pre-gate bytes over an empty blocked corpus is vacuous.
  const jsNonVacuous = jsBlockedCases > 0;
  // FI-012 — the QHO replay verdicts are observed by test name, not inferred.
  const qhoOk = qhoReplay.broadBlocked === true && qhoReplay.narrowAllowed === true;
  // Q2-019 (§34) — the QHO→LLM adversarial closure: the transcript's own answer
  // blocked, the honest repair published, and one unbacked sentence enough to
  // block it again. All three are observed, never assumed.
  const qhoLlmOk =
    qhoLlmReplay.adversarialIncluded === true &&
    qhoLlmReplay.adversarialBlocked === true &&
    qhoLlmReplay.safeRepairAllowed === true &&
    qhoLlmReplay.universalCoverageBlocked === true;
  // §58 — the six strict rates are only evidence when every denominator is
  // non-empty; a zero over nothing certifies nothing.
  const strictMetricsOk =
    metrics?.strictMetricsNonVacuous === true &&
    metrics?.strictMetricsTargetsMet === true &&
    metrics?.qhoLlmAdversarialBlockedAsExpected === true &&
    Number(metrics?.strictVerificationContract?.vccr) === 1 &&
    Number(metrics?.formalArtifacts?.ufar) === 0 &&
    Number(metrics?.crossDomain?.cber) === 0 &&
    Number(metrics?.bibliography?.bier) === 0 &&
    Number(metrics?.analogies?.aper) === 0 &&
    Number(metrics?.synthesis?.sor) === 0;
  // FI-012 M6 — an empty high-severity corpus makes a zero escape rate vacuous.
  const hsNonVacuous = guardHSCorpusNonEmpty(Number(metrics?.generatedHighSeverity ?? 0)).ok;
  const failClosedOk = guardFailClosedOnError(metrics ?? { published: [], reasoningPublished: [] }, []).ok;

  const allCertifiable =
    scopesOk &&
    registryComplete &&
    manifestPresent &&
    skipped === 0 &&
    total > 0 &&
    passed > 0 &&
    hserOk &&
    hsNonVacuous &&
    failClosedOk &&
    jsLeakOk &&
    jsNonVacuous &&
    qhoOk &&
    qhoLlmOk &&
    strictMetricsOk &&
    nativeLeakOk &&
    nativeFreshOk &&
    nativeRanAll;

  // FI-013 — graded verdict vocabulary. CERTIFIED_RELEASE is reserved for a clean
  // tree WITH the native scope actually built, run and measured (§22); a dev-mode
  // run can never mint it, and neither can a release run without native evidence.
  let verdict = "NOT_CERTIFIED";
  if (allCertifiable) {
    if (mode === "release") {
      verdict = nativeIncluded ? "CERTIFIED_RELEASE" : "NOT_CERTIFIED";
      if (!nativeIncluded) {
        process.stdout.write("[fail] release_requires_native (use --with-native for CERTIFIED_RELEASE)\n");
      }
    } else {
      verdict = nativeIncluded ? "CERTIFIED_NATIVE_DEV" : "CERTIFIED_DEV";
    }
  }
  const epiRange = metrics?.registryRange ?? "001..000";
  const hser = metrics ? Number(metrics.escapeRate).toFixed(2) : "n/a";
  const hsGenerated = metrics?.generatedHighSeverity ?? 0;
  const hsPublished = metrics?.publishedHighSeverity ?? 0;
  const jsBytes = metrics?.jsCandidateBytesBeforeGate ?? -1;
  const noByteLeak = metrics ? metrics.jsNoByteLeak === true && jsBytes === 0 : false;

  // Native bytes-before-verdict from the epistemic probe when present.
  const epiNative = native.find((n) => n.metrics) ?? null;
  const nativeBytes = epiNative ? epiNative.metrics.candidateBytesBeforeVerdict : -1;
  const nativeTextBytes = epiNative ? epiNative.metrics.candidateTextBytesBeforeVerdict : -1;
  const nativeReasoningBytes = epiNative ? epiNative.metrics.candidateReasoningBytesBeforeVerdict : -1;
  const nativeBlockedCases = epiNative ? Number(epiNative.metrics.blockedCases ?? 0) : 0;
  const nativeSourceSha = epiNative ? epiNative.build.sourceSha256 : null;
  const nativeBinarySha = epiNative ? epiNative.build.binarySha256 : null;

  const dirtyAtCertify = gitDirty();

  // FI-010 — full machine-readable certificate object.
  const cert = {
    schema: "ds4_quantium_certificate_v2",
    verdict,
    timestamp: new Date().toISOString(),
    oid: `QuantiumCert-${sha256Of(`${gitHead() ?? ""}:${verdict}`).slice(0, 16)}`,
    provenance: {
      mode,
      dirty: dirtyAtCertify,
      allowDirty,
      gitHead: gitHead(),
      gitBranch: gitBranch(),
      diffSha256: dirtyAtCertify ? gitDiffSha256() : null,
      withNative: nativeIncluded
    },
    totals: { total, passed, failed, skipped },
    scopes,
    native,
    nativeIncluded,
    metrics: {
      escapeRate: metrics ? Number(metrics.escapeRate) : null,
      generatedHighSeverity: hsGenerated,
      publishedHighSeverity: hsPublished,
      jsCandidateBytesBeforeGate: jsBytes,
      jsNoByteLeak: metrics?.jsNoByteLeak ?? null,
      registryRange: epiRange,
      epiManifestSha256: metrics?.epiManifestSha256 ?? null,
      epiManifestCount: metrics?.epiManifestCount ?? null,
      epiManifestRange: metrics?.epiManifestRange ?? null
    },
    // FI-005 / §16 — split JS pre-gate byte evidence (total = text + reasoning).
    jsLeak: {
      blockedCases: jsBlockedCases,
      textBytesBeforeGate: jsText,
      reasoningBytesBeforeGate: jsReasoning,
      totalBytesBeforeGate: jsBytes
    },
    // §31/§36 — the two named QHO replay outcomes, observed in the TAP stream.
    qhoReplay,
    // Q2-019 (§34) — the QHO→LLM adversarial closure, observed the same way.
    qhoLlmReplay,
    // §72 — the six strict-mode counters, measured over that replay.
    strictMetrics: {
      strictVerificationContract: metrics?.strictVerificationContract ?? null,
      formalArtifacts: metrics?.formalArtifacts ?? null,
      crossDomain: metrics?.crossDomain ?? null,
      bibliography: metrics?.bibliography ?? null,
      analogies: metrics?.analogies ?? null,
      synthesis: metrics?.synthesis ?? null,
      nonVacuous: metrics?.strictMetricsNonVacuous ?? null,
      allTargetsMet: metrics?.strictMetricsTargetsMet ?? null
    },
    certificateSha256: "" // filled below after serialization is stable
  };

  // FI-015 — the independent auditor recomputes every derived quantity from the
  // raw counters above and downgrades the verdict when a claim exceeds the
  // evidence. It runs BEFORE the self-hash so the audit result is itself hashed.
  const audit = auditCertificate(cert);
  cert.audit = {
    verdict: audit.verdict,
    checks: audit.checks.length,
    failures: audit.failures
  };
  if (audit.verdict !== "PASS" && cert.verdict !== "NOT_CERTIFIED") {
    for (const f of audit.failures) {
      process.stdout.write(`[audit-fail] ${f.check}: ${f.reason}\n`);
    }
    cert.verdict = "NOT_CERTIFIED";
    cert.oid = `QuantiumCert-${sha256Of(`${cert.provenance.gitHead ?? ""}:NOT_CERTIFIED`).slice(0, 16)}`;
  }
  const finalVerdict = cert.verdict;
  const certified = finalVerdict !== "NOT_CERTIFIED";

  // Self-hash (FI-010): hash the canonical JSON with an empty hash field, then
  // embed. A later run that changes any evaluated field yields a different hash.
  const splice = JSON.parse(JSON.stringify(cert));
  delete splice.certificateSha256;
  const canonical = JSON.stringify(splice, null, 2);
  cert.certificateSha256 = sha256Of(canonical);

  // FI-010/011 — write JSON + markdown artifacts with hashes. The JSON file's
  // bytes are not self-hashing (that would be circular), so its sha256 and the
  // markdown's sha256 live in a sidecar manifest alongside the certificate's
  // own self-hash (certificateSha256).
  try {
    mkdirSync(outDir, { recursive: true });
    const jsonPath = join(outDir, "quantium-certificate.json");
    const mdPath = join(outDir, "quantium-certificate.md");
    const manifestPath = join(outDir, "quantium-certificate.manifest.json");
    writeFileSync(jsonPath, JSON.stringify(cert, null, 2) + "\n");
    writeFileSync(mdPath, renderMarkdown(cert));
    const manifest = {
      schema: "ds4_quantium_certificate_manifest_v1",
      certificateSha256: cert.certificateSha256,
      artifactJsonPath: basename(jsonPath),
      artifactMdPath: basename(mdPath),
      artifactJsonSha256: sha256File(jsonPath),
      artifactMdSha256: sha256File(mdPath),
      manifestSha256: ""
    };
    const mSplice = JSON.parse(JSON.stringify(manifest));
    delete mSplice.manifestSha256;
    manifest.manifestSha256 = sha256Of(JSON.stringify(mSplice, null, 2));
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    cert.artifactJsonPath = jsonPath;
    cert.artifactMdPath = mdPath;
    cert.artifactManifestPath = manifestPath;
    cert.artifactJsonSha256 = manifest.artifactJsonSha256;
    cert.artifactMdSha256 = manifest.artifactMdSha256;
    cert.artifactManifestSha256 = manifest.manifestSha256;
  } catch (err) {
    process.stdout.write(`[warn] certificate artifacts not written: ${err.message}\n`);
  }

  // REM-010.10 human output + one-line machine certificate.
  process.stdout.write(
    [
      "QUANTIUM_CERTIFICATION",
      `MODE=${mode}`,
      `SOURCE_HEAD=${cert.provenance.gitHead ?? "n/a"}`,
      `SOURCE_DIRTY=${cert.provenance.dirty}`,
      `DIFF_SHA256=${cert.provenance.diffSha256 ?? "n/a"}`,
      `TOTAL_TESTS=${total}`,
      `PASSED_TESTS=${passed}`,
      `FAILED_TESTS=${failed}`,
      `SKIPPED_TESTS=${skipped}`,
      `EPI_RANGE=${epiRange}`,
      `EPI_MANIFEST_SHA256=${cert.metrics.epiManifestSha256 ?? "n/a"}`,
      `HS_GENERATED=${hsGenerated}`,
      `HS_PUBLISHED=${hsPublished}`,
      `HIGH_SEVERITY_ESCAPE_RATE=${hser}`,
      `JS_BLOCKED_CASES=${jsBlockedCases}`,
      `JS_TEXT_BYTES_BEFORE_GATE=${jsText}`,
      `JS_REASONING_BYTES_BEFORE_GATE=${jsReasoning}`,
      `JS_CANDIDATE_BYTES_BEFORE_GATE=${jsBytes}`,
      `NATIVE_INCLUDED=${nativeIncluded}`,
      `NATIVE_EPISTEMIC_SOURCE_SHA256=${nativeSourceSha ?? "n/a"}`,
      `NATIVE_EPISTEMIC_BINARY_SHA256=${nativeBinarySha ?? "n/a"}`,
      `NATIVE_BLOCKED_CASES=${nativeBlockedCases}`,
      `NATIVE_TEXT_BYTES_BEFORE_VERDICT=${nativeTextBytes}`,
      `NATIVE_REASONING_BYTES_BEFORE_VERDICT=${nativeReasoningBytes}`,
      `NATIVE_CANDIDATE_BYTES_BEFORE_VERDICT=${nativeBytes}`,
      `NATIVE_CANDIDATE_BYTES_BEFORE_GATE=${nativeBytes}`,
      `NO_BYTE_LEAK=${noByteLeak}`,
      `QHO_BROAD_BLOCKED=${qhoReplay.broadBlocked}`,
      `QHO_NARROW_ALLOWED=${qhoReplay.narrowAllowed}`,
      `QHO_LLM_ADVERSARIAL_INCLUDED=${qhoLlmReplay.adversarialIncluded}`,
      `QHO_LLM_ADVERSARIAL_BLOCKED=${qhoLlmReplay.adversarialBlocked}`,
      `QHO_LLM_SAFE_REPAIR_ALLOWED=${qhoLlmReplay.safeRepairAllowed}`,
      `STRICT_CONTRACT_VCCR=${metrics?.strictVerificationContract?.vccr ?? "n/a"}`,
      `UFAR=${metrics?.formalArtifacts?.ufar ?? "n/a"}`,
      `CBER=${metrics?.crossDomain?.cber ?? "n/a"}`,
      `BIER=${metrics?.bibliography?.bier ?? "n/a"}`,
      `APER=${metrics?.analogies?.aper ?? "n/a"}`,
      `SOR=${metrics?.synthesis?.sor ?? "n/a"}`,
      `PROVENANCE_MODE=${mode}`,
      `INDEPENDENT_AUDIT=${cert.audit.verdict}`,
      `CERTIFICATE_SHA256=${cert.certificateSha256}`,
      `VERDICT=${finalVerdict}`,
      ""
    ].join("\n")
  );
  process.stdout.write(`CERTIFICATE_JSON=${JSON.stringify(cert)}\n`);

  return certified ? 0 : 1;
}

process.exit(main());
