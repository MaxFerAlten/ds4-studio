import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildServerLaunchConfig,
  prepareServerLaunchPaths,
  resolveOptionalLaunchDirectory,
  resolveOptionalLaunchFile,
} from "./serverLaunchConfig.mjs";

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "ds4-launch-"));
}

test("empty optional values disable launch paths", () => {
  assert.equal(resolveOptionalLaunchDirectory("", "/project", "kv"), "");
  assert.equal(resolveOptionalLaunchDirectory("   ", "/project", "kv"), "");
  assert.equal(resolveOptionalLaunchFile(null, "/project", "trace"), "");
});

test("relative KV path is anchored below project runtime", () => {
  assert.equal(
    resolveOptionalLaunchDirectory(".runtime/kv-cache", "/project", "kv"),
    path.resolve("/project/.runtime/kv-cache"),
  );
  assert.throws(() => resolveOptionalLaunchDirectory(".", "/project", "kv"));
  assert.throws(() => resolveOptionalLaunchDirectory("..", "/project", "kv"));
  assert.throws(() => resolveOptionalLaunchDirectory("frontend/cache", "/project", "kv"));
  assert.throws(() => resolveOptionalLaunchDirectory("../outside", "/project", "kv"));
});

test("launch config is a non-mutating runtime copy", () => {
  const config = { server: { trace: ".runtime/trace.log", kvDiskDir: ".runtime/kv-cache" } };
  const launch = buildServerLaunchConfig(config, "/project");
  assert.notStrictEqual(launch, config);
  assert.notStrictEqual(launch.server, config.server);
  assert.equal(config.server.kvDiskDir, ".runtime/kv-cache");
  assert.equal(launch.server.kvDiskDir, path.resolve("/project/.runtime/kv-cache"));
  assert.equal(launch.server.trace, path.resolve("/project/.runtime/trace.log"));
});

test("prepare creates private KV directory and trace parent", async () => {
  const root = await tempRoot();
  const launch = buildServerLaunchConfig(
    { server: { trace: ".runtime/logs/server.log", kvDiskDir: ".runtime/kv-cache" } },
    root,
  );
  await prepareServerLaunchPaths(launch, root);
  const kv = await fs.stat(launch.server.kvDiskDir);
  assert.equal(kv.isDirectory(), true);
  assert.equal(kv.mode & 0o777, 0o700);
  const traceParent = await fs.stat(path.dirname(launch.server.trace));
  assert.equal(traceParent.isDirectory(), true);
  await fs.rm(root, { recursive: true, force: true });
});

test("prepare rejects regular file and final symlink", async () => {
  const root = await tempRoot();
  const file = path.join(root, "not-a-directory");
  await fs.writeFile(file, "x");
  await assert.rejects(() => prepareServerLaunchPaths({ server: { kvDiskDir: file } }, root));
  const target = path.join(root, "target");
  await fs.mkdir(target);
  const link = path.join(root, "link");
  await fs.symlink(target, link);
  await assert.rejects(() => prepareServerLaunchPaths({ server: { kvDiskDir: link } }, root));
  await fs.rm(root, { recursive: true, force: true });
});
