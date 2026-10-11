import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  bootstrapOpenWikiEnvironment,
  configureOpenWikiRuntime,
  openWikiRuntimePaths,
  provisionOpenWikiRelease,
  readOpenWikiRuntimeSetup,
  validateOpenWikiWorkspacePath,
} from "./openwikiRuntimeSetup.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ds4-openwiki-config-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const source = path.join(root, "source");
  const workspace = path.join(root, "workspace");
  const release = path.join(root, "release");
  await Promise.all([mkdir(home), mkdir(source), mkdir(workspace), mkdir(path.join(release, "dist", "cli"), { recursive: true })]);
  await Promise.all([source, workspace, release, path.join(release, "dist"), path.join(release, "dist", "cli")].map((directory) => chmod(directory, 0o700)));
  await writeFile(path.join(release, "dist", "cli", "cli.js"), "#!/usr/bin/env node\n");
  await chmod(path.join(release, "dist", "cli", "cli.js"), 0o755);
  const { execFileSync } = await import("node:child_process");
  execFileSync("git", ["init", "--quiet", workspace]);
  return { root, home, source, workspace, release };
}

test("OpenWiki setup writes a protected gateway config and bootstraps it without environment variables", async (t) => {
  const fx = await fixture(t);
  const env = {};
  const saved = await configureOpenWikiRuntime({
    sourcePath: fx.source,
    workspacePath: fx.workspace,
    releaseDir: fx.release,
    env,
    home: fx.home,
  });
  assert.equal(saved.configured, true);
  assert.equal(saved.workspacePath, await realpath(fx.workspace));
  assert.equal(env.DS4_OPENWIKI_MODE, "on");
  assert.equal(env.DS4_OPENWIKI_WORKSPACE, "ds4-studio");

  const setup = await readOpenWikiRuntimeSetup({ env, home: fx.home });
  assert.equal(setup.configured, true);
  assert.equal(setup.sourcePath, await realpath(fx.source));
  assert.equal(setup.releasePath, await realpath(fx.release));

  const restartEnv = {};
  assert.equal(bootstrapOpenWikiEnvironment(restartEnv, fx.home), true);
  assert.equal(restartEnv.DS4_OPENWIKI_MODE, "on");
  assert.equal(restartEnv.DS4_OPENWIKI_CONFIG, openWikiRuntimePaths({}, fx.home).configPath);
  assert.equal(restartEnv.DS4_OPENWIKI_SOCKET, saved.socketPath);
});

test("an explicit OFF mode stays OFF when a persisted config is loaded", async (t) => {
  const fx = await fixture(t);
  const env = {};
  await configureOpenWikiRuntime({ sourcePath: fx.source, workspacePath: fx.workspace, releaseDir: fx.release, env, home: fx.home });
  const restartEnv = { DS4_OPENWIKI_MODE: "off" };
  assert.equal(bootstrapOpenWikiEnvironment(restartEnv, fx.home), true);
  assert.equal(restartEnv.DS4_OPENWIKI_MODE, "off");
});

test("workspace preflight rejects group-writable repository roots", async (t) => {
  const fx = await fixture(t);
  await chmod(fx.workspace, 0o775);
  assert.throws(() => validateOpenWikiWorkspacePath(fx.workspace), { code: "OPENWIKI_WORKSPACE_INVALID" });
});

test("pinned provisioning clones the selected commit and excludes checkout dirt from the build input", async (t) => {
  const fx = await fixture(t);
  const commit = "a".repeat(40);
  const lockPath = path.join(fx.root, "upstream-lock.json");
  await writeFile(lockPath, JSON.stringify({ git_commit: commit }));
  const repoRoot = path.join(fx.root, "ds4");
  await mkdir(path.join(repoRoot, "scripts"), { recursive: true });
  const calls = [];
  const runCommand = async (command, args) => {
    calls.push({ command, args });
    if (command === "git" && args.includes("--show-toplevel")) return { stdout: `${fx.source}\n` };
    if (command === "git" && args.includes("--verify")) return { stdout: `${commit}\n` };
    if (command === "git" && args[0] === "clone") {
      await mkdir(args.at(-1), { recursive: true });
    }
    return { stdout: "", stderr: "" };
  };
  const provisioned = await provisionOpenWikiRelease({
    sourcePath: fx.source,
    repoRoot,
    lockPath,
    installHome: path.join(fx.root, "installed"),
    runCommand,
    makeTempDir: (base) => mkdtemp(base),
    removeTree: (target) => rm(target, { recursive: true, force: true }),
  });
  assert.equal(provisioned.commit, commit);
  assert.equal(provisioned.releaseDir, path.join(fx.root, "installed", "releases", `${commit}-node${process.versions.modules}-${process.platform}-${process.arch}`, "package"));
  const clone = calls.find(({ command, args }) => command === "git" && args[0] === "clone");
  assert.deepEqual(clone.args.slice(0, 3), ["clone", "--no-hardlinks", "--no-checkout"]);
  assert.ok(calls.some(({ command, args }) => command === "git" && args[0] === "-C" && args.includes("--detach") && args.includes(commit)));
  // The installer is invoked by absolute path (repoRoot/scripts/...), so match its name.
  assert.ok(calls.some(({ command, args }) => command === "bash" &&
    args.some((arg) => path.basename(arg) === "openwiki-install-release.sh")));
  assert.ok(calls.some(({ command, args }) => command === "bash" && args.includes("--smoke")));
  assert.equal(calls.some(({ command, args }) => command === "git" && args.includes("status")), false);
});

test("pinned provisioning rejects a source checkout at another commit before cloning", async (t) => {
  const fx = await fixture(t);
  const lockPath = path.join(fx.root, "upstream-lock.json");
  await writeFile(lockPath, JSON.stringify({ git_commit: "a".repeat(40) }));
  const calls = [];
  await assert.rejects(provisionOpenWikiRelease({
    sourcePath: fx.source,
    repoRoot: fx.root,
    lockPath,
    runCommand: async (command, args) => {
      calls.push({ command, args });
      return { stdout: command === "git" && args.includes("--show-toplevel") ? `${fx.source}\n` : `${"b".repeat(40)}\n` };
    },
  }), { code: "OPENWIKI_SOURCE_PIN_MISMATCH" });
  assert.equal(calls.some(({ args }) => args[0] === "clone"), false);
});
