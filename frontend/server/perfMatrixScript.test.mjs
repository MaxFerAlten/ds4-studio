import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(SERVER_DIR, "..");
const PROJECT_ROOT = path.resolve(FRONTEND_DIR, "..");
const MATRIX_SCRIPT = path.join(PROJECT_ROOT, "tests", "ds4-studio", "perf_matrix.sh");

async function makeFakeLoadScript(body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-matrix-load-"));
  const script = path.join(dir, "server_load.sh");
  await fs.writeFile(script, body);
  await fs.chmod(script, 0o755);
  return { dir, script };
}

function runMatrix(env) {
  return spawnSync("bash", [MATRIX_SCRIPT], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

test("perf matrix runs every concurrency and token combination", async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-matrix-run-"));
  const callsFile = path.join(runDir, "calls.tsv");
  const { script } = await makeFakeLoadScript(`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$CONC" "$REQS" "$MAX_TOKENS" "$MODEL" "$OUT" >> "${callsFile}"
printf '200\\t0.1\\t0.2\\n' > "$OUT"
echo "ok_requests=$REQS"
echo "http_503=0"
echo "failed_requests=0"
echo "ttfb_p50=1.$CONC"
echo "ttfb_p95=2.$CONC"
echo "total_p50=3.$MAX_TOKENS"
echo "total_p95=4.$MAX_TOKENS"
echo "out=$OUT"
`);

  const result = runMatrix({
    LOAD_SCRIPT: script,
    RUN_DIR: runDir,
    DS4_MATRIX_CONC: "1 4",
    DS4_MATRIX_MAX_TOKENS: "32 64",
    DS4_MATRIX_REQS: "3",
    DS4_MATRIX_MODEL: "ds4-test"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /matrix complete/);

  const calls = (await fs.readFile(callsFile, "utf8")).trim().split("\n");
  assert.deepEqual(calls.map((line) => line.split("\t").slice(0, 4).join(":")), [
    "1:3:32:ds4-test",
    "1:3:64:ds4-test",
    "4:3:32:ds4-test",
    "4:3:64:ds4-test"
  ]);

  const matrix = (await fs.readFile(path.join(runDir, "matrix.tsv"), "utf8")).trim().split("\n");
  assert.equal(matrix.length, 5);
  assert.match(matrix[0], /^timestamp\thost\tport\tmodel\tconc\treqs\tmax_tokens\tok_requests/);
  assert.match(matrix[1], /\t1\t3\t32\t3\t0\t0\t1\.1\t2\.1\t3\.32\t4\.32\t/);
  assert.ok(await fs.stat(path.join(runDir, "summary-conc1-tok32.txt")));
  assert.ok(await fs.stat(path.join(runDir, "load-conc4-tok64.tsv")));
});

test("perf matrix fails when a load summary is missing required metrics", async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-matrix-bad-"));
  const { script } = await makeFakeLoadScript(`#!/usr/bin/env bash
set -euo pipefail
printf '200\\t0.1\\t0.2\\n' > "$OUT"
echo "ok_requests=1"
echo "http_503=0"
echo "failed_requests=0"
echo "ttfb_p50=1"
echo "ttfb_p95=2"
`);

  const result = runMatrix({
    LOAD_SCRIPT: script,
    RUN_DIR: runDir,
    DS4_MATRIX_CONC: "1",
    DS4_MATRIX_MAX_TOKENS: "32",
    DS4_MATRIX_REQS: "1"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /summary missing total_p50/);
});
