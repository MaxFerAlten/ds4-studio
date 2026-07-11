import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  diffSageArtifacts,
  executeTool,
  extractSageMeta,
  listSageArtifacts
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
  process.env.DS4_SAGE_STRUCTURED_RESULT = "1";
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.DS4_SAGE_STRUCTURED_RESULT;
    else process.env.DS4_SAGE_STRUCTURED_RESULT = previous;
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

test("structured Sage accepts a math report and validation payload", { skip: !HAS_SAGE }, async () => {
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

    assert.equal(result.sageResult.report.kind, "math_report");
    assert.equal(result.sageResult.validation.passed, true);
    assert.match(result.content, /Structured report/);
  });
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
    assert.doesNotMatch(JSON.stringify(result.artifacts), new RegExp(sageWorkdir));
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
    const result = await executeTool(
      "sage",
      {
        code: "import sys\nsys.stderr.write('legacy-warning')\nresult = 4",
        output_mode: "legacy"
      },
      { sageWorkdir }
    );

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
