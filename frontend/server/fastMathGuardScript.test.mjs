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
const GUARD_SCRIPT = path.join(PROJECT_ROOT, "tests", "ds4-studio", "fast_math_guard.sh");

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-fast-math-guard-"));
  const source = path.join(root, "src");
  const bin = path.join(root, "bin");
  await fs.mkdir(path.join(source, "tests", "test-vectors", "prompts"), { recursive: true });
  await fs.mkdir(path.join(source, "benchmarks"), { recursive: true });
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(source, "Makefile"), "all:\n\t@true\n");
  await fs.writeFile(path.join(source, "ds4flash.gguf"), "");
  await fs.writeFile(path.join(source, "tests", "test-vectors", "prompts", "short_italian_fact.txt"), "ciao\n");
  await fs.writeFile(path.join(source, "benchmarks", "ds4-regression-baseline.env"), [
    "DS4_EXPECT_CUDA_Q8_F16_CACHE_MB=11264",
    "DS4_EXPECT_CUDA_Q8_F16_CACHE_RESERVE_MB=512",
    "DS4_EXPECT_CUDA_COPY_MODEL_CHUNKED=1",
    ""
  ].join("\n"));

  const fakeMake = path.join(bin, "make");
  await fs.writeFile(fakeMake, `#!/usr/bin/env bash
set -euo pipefail
echo "cwd=$PWD args=$*" >> "$DS4_FAST_MATH_GUARD_FAKE_LOG"
cat > ds4 <<'DS4'
#!/usr/bin/env bash
set -euo pipefail
echo "ds4:$PWD:$*" >> "$DS4_FAST_MATH_GUARD_FAKE_LOG"
echo "env:q8=\${DS4_CUDA_Q8_F16_CACHE_MB:-}:reserve=\${DS4_CUDA_Q8_F16_CACHE_RESERVE_MB:-}:chunked=\${DS4_CUDA_COPY_MODEL_CHUNKED:-}:arena=\${DS4_CUDA_WEIGHT_ARENA_CHUNK_MB:-}" >> "$DS4_FAST_MATH_GUARD_FAKE_LOG"
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--dump-logprobs" ]; then
    out="$2"
    shift 2
    continue
  fi
  shift
done
[ -n "$out" ] || exit 2
cat > "$out" <<'JSON'
{
  "source": "ds4",
  "steps": [
    {
      "step": 0,
      "selected": {"text": "A", "id": 1},
      "top_logprobs": [
        {"token": {"text": "A", "id": 1}, "logit": 1.0, "logprob": -0.1},
        {"token": {"text": "B", "id": 2}, "logit": 0.5, "logprob": -0.6}
      ]
    }
  ]
}
JSON
DS4
cat > ds4_test <<'DS4TEST'
#!/usr/bin/env bash
set -euo pipefail
echo "ds4_test:$PWD:$*" >> "$DS4_FAST_MATH_GUARD_FAKE_LOG"
echo "env:q8=\${DS4_CUDA_Q8_F16_CACHE_MB:-}:reserve=\${DS4_CUDA_Q8_F16_CACHE_RESERVE_MB:-}:chunked=\${DS4_CUDA_COPY_MODEL_CHUNKED:-}:arena=\${DS4_CUDA_WEIGHT_ARENA_CHUNK_MB:-}" >> "$DS4_FAST_MATH_GUARD_FAKE_LOG"
if [[ "$PWD" == *strict* && "\${DS4_FAST_MATH_GUARD_FAKE_STRICT_FAIL:-0}" = "1" ]]; then
  exit 7
fi
DS4TEST
chmod +x ds4 ds4_test
`, { mode: 0o755 });

  return { root, source, bin, log: path.join(root, "calls.log") };
}

function runGuard(fixture, extraEnv = {}, options = {}) {
  return spawnSync("bash", [GUARD_SCRIPT], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PATH: `${fixture.bin}:${process.env.PATH}`,
      DS4_FAST_MATH_GUARD_SOURCE_ROOT: fixture.source,
      DS4_FAST_MATH_GUARD_BUILD_ROOT: options.buildRoot ?? path.join(fixture.root, "build"),
      DS4_FAST_MATH_GUARD_FAKE_LOG: fixture.log,
      DS4_FAST_MATH_GUARD_KEEP: "1",
      ...extraEnv
    },
    encoding: "utf8"
  });
}

test("fast math guard builds default and strict math variants", async () => {
  const fixture = await makeFixture();

  const result = runGuard(fixture);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = await fs.readFile(fixture.log, "utf8");
  assert.match(calls, /cwd=.*default.*args=.*ds4.*ds4_test/);
  assert.match(calls, /cwd=.*strict.*args=.*ds4.*ds4_test/);
  assert.match(calls, /strict.*CFLAGS=-O3/);
  assert.doesNotMatch(calls, /strict.*-ffast-math/);
});

test("fast math guard fails when the strict test-vector run fails", async () => {
  const fixture = await makeFixture();

  const result = runGuard(fixture, {
    DS4_FAST_MATH_VECTOR_FLAGS: "--local-golden-vectors",
    DS4_FAST_MATH_GUARD_FAKE_STRICT_FAIL: "1"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /strict math test-vector run failed/);
});

test("fast math guard keeps ds4_test vector checks opt-in for ROCm runs", async () => {
  const fixture = await makeFixture();

  const result = runGuard(fixture);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = await fs.readFile(fixture.log, "utf8");
  const testRuns = calls.split("\n").filter((line) => line.startsWith("ds4_test:"));
  assert.deepEqual(testRuns, []);
});

test("fast math guard applies the deterministic accuracy GPU environment", async () => {
  const fixture = await makeFixture();

  const result = runGuard(fixture);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = await fs.readFile(fixture.log, "utf8");
  assert.match(calls, /env:q8=0:reserve=512:chunked=1:arena=1024/);
});

test("fast math guard normalizes relative build roots before dumping logprobs", async () => {
  const fixture = await makeFixture();
  const relativeRoot = path.join("tmp", `ds4-fast-math-${path.basename(fixture.root)}`);

  try {
    const result = runGuard(fixture, {}, { buildRoot: relativeRoot });

    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await fs.rm(path.join(PROJECT_ROOT, relativeRoot), { recursive: true, force: true });
  }
});
