import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  diffSageArtifacts,
  executeTool,
  extractSageMeta,
  findLatestSageImageArtifact,
  listSageArtifacts,
  mergeCurrentRunSageArtifacts,
  structuredSageResult
} from "./agentTools.mjs";

const HAS_SAGE = spawnSync("sage", ["--version"], { encoding: "utf8" }).status === 0;

async function withTmpDir(prefix, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withStructuredSage(fn) {
  const previous = process.env.DS4_SAGE_STRUCTURED_RESULT;
  const previousAuthoritative = process.env.DS4_SAGE_AUTHORITATIVE_LOOP;
  process.env.DS4_SAGE_STRUCTURED_RESULT = "1";
  process.env.DS4_SAGE_AUTHORITATIVE_LOOP = "0";
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.DS4_SAGE_STRUCTURED_RESULT;
    else process.env.DS4_SAGE_STRUCTURED_RESULT = previous;
    if (previousAuthoritative === undefined) delete process.env.DS4_SAGE_AUTHORITATIVE_LOOP;
    else process.env.DS4_SAGE_AUTHORITATIVE_LOOP = previousAuthoritative;
  }
}

test("extractSageMeta removes and parses the last sentinel block", () => {
  const parsed = extractSageMeta([
    "answer: 4",
    "__DS4_SAGE_META_BEGIN__",
    '{"contractVersion":"sage_result_v1","report":null,"validation":null}',
    "__DS4_SAGE_META_END__"
  ].join("\n"));

  assert.equal(parsed.cleanStdout, "answer: 4");
  assert.equal(parsed.meta.contractVersion, "sage_result_v1");
  assert.equal(parsed.parseError, null);
});

test("extractSageMeta falls back cleanly on invalid metadata", () => {
  const parsed = extractSageMeta([
    "visible",
    "__DS4_SAGE_META_BEGIN__",
    "{broken",
    "__DS4_SAGE_META_END__"
  ].join("\n"));

  assert.equal(parsed.cleanStdout, "visible");
  assert.equal(parsed.meta, null);
  assert.ok(parsed.parseError);
  assert.doesNotMatch(parsed.cleanStdout, /DS4_SAGE_META/);
});

test("structured Sage preserves legacy top-level fields", { skip: !HAS_SAGE }, async () => {
  await withTmpDir("ds4-sage-structured-", async (sageWorkdir) => {
    const result = await withStructuredSage(() => executeTool(
      "sage",
      { code: "2^3", task_type: "evaluate", phase: "compute" },
      { sageWorkdir, sessionKey: "session-a" }
    ));

    assert.equal(result.isError, false);
    assert.equal(typeof result.content, "string");
    assert.equal(typeof result.raw, "object");
    assert.equal(result.sageResult.contractVersion, "sage_result_v1");
    assert.equal(result.sageResult.taskType, "evaluate");
    assert.equal(result.sageResult.phase, "compute");
    assert.match(result.content, /Result:\s*8/);
    assert.doesNotMatch(result.content, /DS4_SAGE_META/);
  });
});

test("structured Sage treats model validation as a non-authoritative claim", { skip: !HAS_SAGE }, async () => {
  await withTmpDir("ds4-sage-report-", async (sageWorkdir) => {
    const code = [
      "__ds4_report__ = {'kind': 'math_report', 'title': 'Somma', 'sections': []}",
      "__ds4_validation__ = {'passed': True, 'checks': ['exact'], 'warnings': []}",
      "result = 2 + 2"
    ].join("\n");
    const result = await withStructuredSage(() => executeTool(
      "sage",
      { code, task_type: "evaluate", phase: "validate" },
      { sageWorkdir, sessionKey: "session-report" }
    ));

    assert.equal(result.sageResult.candidateReport.kind, "math_report");
    assert.equal(result.sageResult.validation.authoritative, false);
    assert.equal(result.sageResult.validation.passed, false);
    assert.equal(result.sageResult.publication.publishable, false);
    assert.equal(result.sageResult.debug.claimedValidation.passed, true);
    assert.doesNotMatch(result.content, /\"passed\"\s*:\s*true/);
    assert.match(result.content, /Structured report/);
  });
});

test("structured candidate cannot self-authorize without Sage installed", () => {
  const result = structuredSageResult({
    stdout: "Result: 4",
    stderr: "",
    exitCode: 0,
    signalName: null,
    killed: false,
    durationMs: 1,
    taskType: "evaluate",
    phase: "validate",
    attempt: 1,
    latexOutput: "4",
    meta: {
      contractVersion: "sage_result_v2",
      report: { kind: "math_report", title: "Somma", sections: [] },
      validation: {
        passed: true,
        checks: [{ code: "INVENTED", passed: true }]
      }
    },
    parseError: null,
    artifacts: [],
    cwd: "/tmp/sage-candidate"
  });

  assert.equal(result.contractVersion, "sage_result_v1");
  assert.equal(result.validation.authoritative, false);
  assert.equal(result.validation.passed, false);
  assert.equal(result.publication.publishable, false);
  assert.equal(result.debug.claimedValidation.passed, true);
  assert.equal(result.candidateReport.kind, "math_report");
  assert.doesNotMatch(result.model.content, /INVENTED|\"passed\"\s*:\s*true/);
});

test("stderr stays out of content and remains in bounded debug", { skip: !HAS_SAGE }, async () => {
  await withTmpDir("ds4-sage-stderr-", async (sageWorkdir) => {
    const result = await withStructuredSage(() => executeTool(
      "sage",
      { code: "import sys\nsys.stderr.write('private-warning')\nresult = 4" },
      { sageWorkdir }
    ));

    assert.equal(result.isError, false);
    assert.doesNotMatch(result.content, /private-warning|stderr:/);
    assert.match(result.debug.stderrPreview, /private-warning/);
    assert.ok(Buffer.byteLength(result.debug.stderrPreview, "utf8") <= 8 * 1024);
  });
});

test("tracebacks are debug-only and set isError", { skip: !HAS_SAGE }, async () => {
  await withTmpDir("ds4-sage-traceback-", async (sageWorkdir) => {
    const result = await withStructuredSage(() => executeTool(
      "sage",
      { code: "raise ValueError('private-failure')", phase: "compute" },
      { sageWorkdir }
    ));

    assert.equal(result.isError, true);
    assert.doesNotMatch(result.content, /Traceback|private-failure|stderr:/);
    assert.match(result.debug.stderrPreview, /Traceback|private-failure/);
  });
});

test("timeout returns a structured error", { skip: !HAS_SAGE }, async () => {
  await withTmpDir("ds4-sage-timeout-", async (sageWorkdir) => {
    const result = await withStructuredSage(() => executeTool(
      "sage",
      { code: "import time\ntime.sleep(2)", timeout_sec: 0.05 },
      { sageWorkdir }
    ));

    assert.equal(result.isError, true);
    assert.equal(result.sageResult.status, "timeout");
    assert.equal(result.raw.killed, true);
  });
});

test("new non-empty artifacts are public and empty files are ignored", { skip: !HAS_SAGE }, async () => {
  await withTmpDir("ds4-sage-artifact-", async (sageWorkdir) => {
    const code = [
      "open('plot.png', 'wb').write(b'png-data')",
      "open('empty.png', 'wb').close()",
      "result = 1"
    ].join("\n");
    const result = await withStructuredSage(() => executeTool(
      "sage",
      { code, phase: "plot" },
      { sageWorkdir, sessionKey: "artifact/session" }
    ));

    assert.deepEqual(result.artifacts.map((artifact) => artifact.name), ["plot.png"]);
    assert.equal(result.artifacts[0].mediaType, "image/png");
    assert.equal(result.artifacts[0].url, "/api/sage/artifacts/artifact_session/plot.png");
    assert.match(result.content, /!\[plot\.png\]\(\/api\/sage\/artifacts\/artifact_session\/plot\.png\)/);
    assert.doesNotMatch(JSON.stringify(result.artifacts), new RegExp(sageWorkdir));
  });
});

test("findLatestSageImageArtifact selects the newest matching session image", async () => {
  await withTmpDir("ds4-sage-latest-", async (workspace) => {
    const olderDir = path.join(workspace, "sage_older");
    const newerDir = path.join(workspace, "sage_newer");
    await mkdir(olderDir);
    await mkdir(newerDir);
    const older = path.join(olderDir, "plot.png");
    const newer = path.join(newerDir, "plot.png");
    await writeFile(older, "older");
    await writeFile(newer, "newer");
    await utimes(older, new Date(1_000), new Date(1_000));
    await utimes(newer, new Date(2_000), new Date(2_000));

    const artifact = await findLatestSageImageArtifact(workspace, "plot.png");
    assert.equal(artifact.physicalPath, newer);
    assert.equal(await findLatestSageImageArtifact(workspace, "../plot.png"), null);
    assert.equal(await findLatestSageImageArtifact(workspace, "report.csv"), null);
  });
});

test("structured Sage captures images saved to the workspace root", { skip: !HAS_SAGE }, async () => {
  await withTmpDir("ds4-sage-external-artifact-", async (workspace) => {
    const sageWorkdir = path.join(workspace, "sage_session");
    const externalImage = path.join(workspace, "absolute_plot.png");
    await mkdir(sageWorkdir);
    const code = `open(${JSON.stringify(externalImage)}, 'wb').write(b'png-data')\nresult = 1`;
    const result = await withStructuredSage(() => executeTool(
      "sage",
      { code, phase: "plot" },
      { sageWorkdir, sessionKey: "session" }
    ));

    assert.deepEqual(result.artifacts.map((artifact) => artifact.name), ["absolute_plot.png"]);
    assert.equal(result.artifacts[0].url, "/api/sage/artifacts/session/absolute_plot.png");
    const copied = await listSageArtifacts(sageWorkdir, { sessionId: "session" });
    assert.equal(copied.has("absolute_plot.png"), true);
  });
});

test("artifact snapshots reject symlinks that escape the Sage directory", async () => {
  await withTmpDir("ds4-sage-confinement-", async (base) => {
    const sageDir = path.join(base, "sage_session");
    const outside = path.join(base, "outside.png");
    await mkdir(sageDir);
    await writeFile(outside, "outside");
    await symlink(outside, path.join(sageDir, "escape.png"));

    const artifacts = await listSageArtifacts(sageDir, { sessionId: "session" });
    assert.equal(artifacts.has("escape.png"), false);
  });
});

test("artifact diff reports only new or changed files", async () => {
  await withTmpDir("ds4-sage-diff-", async (sageDir) => {
    await writeFile(path.join(sageDir, "old.png"), "old");
    const before = await listSageArtifacts(sageDir);
    await writeFile(path.join(sageDir, "new.csv"), "a,b\n1,2\n");
    const after = await listSageArtifacts(sageDir);

    assert.deepEqual(diffSageArtifacts(before, after).map((item) => item.name), ["new.csv"]);
  });
});

test("artifact registry retains only unchanged files from the same run", () => {
  const priorPlot = {
    artifactId: "plot-sha-1",
    runId: "run-1",
    name: "plot.png",
    url: "/api/sage/artifacts/run-1/plot.png"
  };
  const replacedCsv = {
    artifactId: "csv-sha-2",
    runId: "run-1",
    name: "table.csv",
    url: "/api/sage/artifacts/run-1/table.csv"
  };
  const currentFiles = new Map([
    ["plot.png", { artifactId: "plot-sha-1", runId: "run-1" }],
    ["table.csv", { artifactId: "csv-sha-2", runId: "run-1" }],
    ["foreign.png", { artifactId: "foreign-sha", runId: "run-2" }]
  ]);

  const artifacts = mergeCurrentRunSageArtifacts([
    priorPlot,
    { artifactId: "csv-sha-1", runId: "run-1", name: "table.csv" },
    { artifactId: "deleted-sha", runId: "run-1", name: "deleted.png" },
    { artifactId: "foreign-sha", runId: "run-1", name: "foreign.png" }
  ], [replacedCsv], currentFiles);

  assert.deepEqual(artifacts, [priorPlot, replacedCsv]);
});

test("large stdout keeps the structured envelope intact", { skip: !HAS_SAGE }, async () => {
  await withTmpDir("ds4-sage-large-", async (sageWorkdir) => {
    const result = await withStructuredSage(() => executeTool(
      "sage",
      { code: "print('x' * 5000)" },
      { sageWorkdir }
    ));

    assert.ok(Buffer.byteLength(result.content, "utf8") > 4096);
    assert.equal(result.sageResult.display.title, "SageMath");
    assert.equal(Array.isArray(result.sageResult.artifacts), true);
  });
});

test("legacy output mode preserves the previous stderr-visible shape", { skip: !HAS_SAGE }, async () => {
  await withTmpDir("ds4-sage-legacy-", async (sageWorkdir) => {
    const result = await withStructuredSage(() => executeTool(
      "sage",
      {
        code: "import sys\nsys.stderr.write('legacy-warning')\nresult = 4",
        output_mode: "legacy"
      },
      { sageWorkdir }
    ));

    assert.equal("sageResult" in result, false);
    assert.match(result.content, /stderr: legacy-warning/);
    assert.equal(result.isError, false);
  });
});

test("non-Sage tool results remain unchanged", async () => {
  await withTmpDir("ds4-sage-non-regression-", async (cwd) => {
    await writeFile(path.join(cwd, "visible.txt"), "ok");
    const result = await executeTool("list", { path: "." }, { cwd });

    assert.equal(result.isError, false);
    assert.match(result.content, /visible\.txt/);
    assert.equal("sageResult" in result, false);
    assert.equal("displayContent" in result, false);
  });
});
