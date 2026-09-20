// Boots the production frontend server for end-to-end Lean tests.
//
// R11: the E2E matrix has to cross the real route, the real registry and the
// real executor in one process — the unit suites can only prove each module is
// consistent with itself. Everything expensive that the UI server normally
// starts (model backend, crawl service, agno) is pointed at nothing, so the
// only live subsystem is the one under test.
//
// Also usable as a CLI, which is how the native-bridge shell test gets a
// server without reimplementing any of this:
//
//   node leanServerHarness.mjs            # prints one JSON line, waits for SIGTERM
//   node leanServerHarness.mjs --disabled # same, with the Lean feature off

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");
const SERVER_ENTRY = resolve(REPO_ROOT, "frontend/server/index.mjs");

/** An ephemeral port the OS just told us is free. */
export function freePort() {
  return new Promise((res, rej) => {
    const probe = createServer();
    probe.on("error", rej);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => res(port));
    });
  });
}

/**
 * Start the real server on a free port.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.leanEnabled=true] - value of DS4_LEAN_ENABLED
 * @param {object} [opts.env] - extra environment for the server process
 * @param {number} [opts.readyTimeoutMs=90000]
 * @returns {Promise<{port:number,baseUrl:string,runsRoot:string,stop:Function,logs:Function}>}
 */
export async function startLeanServer(opts = {}) {
  const { leanEnabled = true, env = {}, readyTimeoutMs = 90000 } = opts;

  const port = await freePort();
  const crawlPort = await freePort();
  const workDir = await mkdtemp(resolve(tmpdir(), "ds4-lean-e2e-"));
  const runsRoot = resolve(workDir, "runs");
  const configPath = resolve(workDir, "ds4-ui.config.json");

  await writeFile(
    configPath,
    JSON.stringify(
      {
        control: { host: "127.0.0.1", port },
        // A backend that does not exist: the manager's spawn fails, the Lean
        // routes do not care, and no model is loaded for an E2E run.
        server: { binary: resolve(workDir, "no-such-backend") },
        crawl: { port: crawlPort },
        lean: { enabled: leanEnabled, defaultProfile: "core" },
      },
      null,
      2
    )
  );

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      DS4_UI_CONFIG: configPath,
      DS4_UI_PORT: String(port),
      DS4_LEAN_ENABLED: leanEnabled ? "1" : "0",
      DS4_LEAN_SANDBOX_REQUIRED: "1",
      DS4_LEAN_RUNS_ROOT: runsRoot,
      DS4_LEAN_RUNTIME_ROOT: resolve(REPO_ROOT, "lean-runtime"),
      // Keep the harness from spawning a python crawl service.
      DS4_CRAWL_PYTHON: resolve(workDir, "no-such-python"),
      ...env,
    },
  });

  const log = [];
  const keep = (stream) => (chunk) => {
    log.push(String(chunk));
    if (log.length > 400) log.shift();
  };
  child.stdout.on("data", keep("stdout"));
  child.stderr.on("data", keep("stderr"));

  let exited = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = () => log.join("");

  const stop = async () => {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    if (exited || child.exitCode !== null) return;
    child.kill("SIGTERM");
    const dead = await Promise.race([
      new Promise((res) => child.once("exit", () => res(true))),
      new Promise((res) => setTimeout(() => res(false), 8000)),
    ]);
    if (!dead) child.kill("SIGKILL");
  };

  const deadline = Date.now() + readyTimeoutMs;
  for (;;) {
    if (exited) {
      throw new Error(`server exited before becoming ready (${JSON.stringify(exited)})\n${logs()}`);
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`server did not answer /api/lean/status within ${readyTimeoutMs}ms\n${logs()}`);
    }
    try {
      const r = await fetch(`${baseUrl}/api/lean/status`);
      if (r.ok) break;
    } catch {
      // not listening yet
    }
    await new Promise((res) => setTimeout(res, 250));
  }

  return { port, baseUrl, runsRoot, configPath, stop, logs, pid: child.pid };
}

// CLI mode for the shell tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startLeanServer({ leanEnabled: !process.argv.includes("--disabled") });
  process.stdout.write(
    JSON.stringify({ port: server.port, runsRoot: server.runsRoot, pid: server.pid }) + "\n"
  );
  const bye = async () => {
    await server.stop();
    process.exit(0);
  };
  process.on("SIGTERM", bye);
  process.on("SIGINT", bye);
}
