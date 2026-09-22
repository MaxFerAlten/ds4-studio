import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { LaunchCalibrator } from "./launchCalibration.mjs";

const STOP_TIMEOUT_MS = 5000;
const MAX_LOG_LINES = 500;

export function compactEnv(env = {}) {
  return Object.fromEntries(
    Object.entries(env || {})
      .filter(([, value]) => value !== undefined && value !== null && String(value) !== "")
      .map(([key, value]) => [key, String(value)])
  );
}

/**
 * The parent environment a sidecar actually needs: toolchain lookup, locale,
 * temp dirs, TLS trust and proxies. Nothing that could be a credential.
 * The main DS4 backend deliberately does not use this — see index.mjs.
 */
export const SAFE_SIDECAR_ENV_KEYS = Object.freeze([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy"
]);

/**
 * Copy only the listed keys, only when present. Emptiness is compactEnv's job.
 *
 * @param {object} [env] - source environment; never mutated.
 * @param {string[]} [keys] - allowlist.
 */
export function pickEnv(env = process.env, keys = []) {
  const out = {};
  for (const key of keys) {
    if (env && Object.prototype.hasOwnProperty.call(env, key)) out[key] = env[key];
  }
  return out;
}

export class Ds4ProcessManager extends EventEmitter {
  // buildBaseEnv defaults to the full parent environment so the DS4 backend and
  // any call site that has not opted in keep their current behaviour; a sidecar
  // passes an allowlist instead.
  constructor({
    buildCommand,
    buildEnv = () => ({}),
    buildBaseEnv = () => process.env,
    healthCheck,
    cwd = process.cwd()
  }) {
    super();
    this.buildCommand = buildCommand;
    this.buildEnv = buildEnv;
    this.buildBaseEnv = buildBaseEnv;
    this.healthCheck = healthCheck;
    this.cwd = cwd;
    this.child = null;
    this.currentCommand = [];
    this.overrideCommand = null;
    this.logs = [];
    this.calibrator = new LaunchCalibrator();
    this.lastExit = null;
    this.healthy = false;
  }

  setOverrideCommand(argv) {
    if (argv === null || argv === undefined) {
      this.overrideCommand = null;
      return;
    }
    if (!Array.isArray(argv) || argv.length === 0) {
      throw new Error("override command must be a non-empty argv array");
    }
    this.overrideCommand = argv.map(String);
  }

  /** The environment actually handed to spawn(). */
  resolveEnv() {
    return {
      ...compactEnv(this.buildBaseEnv()),
      ...compactEnv(this.buildEnv())
    };
  }

  resolveCommand() {
    if (this.overrideCommand && this.overrideCommand.length) {
      const [command, ...args] = this.overrideCommand;
      return { command, args };
    }
    return this.buildCommand();
  }

  appendLog(stream, chunk) {
    const text = String(chunk);
    for (const message of text.split(/\r?\n/).filter(Boolean)) {
      const entry = { time: new Date().toISOString(), stream, message };
      this.logs.push(entry);
      if (this.logs.length > MAX_LOG_LINES) this.logs.shift();
      // What this launch actually cost, for the startup model picker. Never
      // allowed to throw: telemetry must not be able to kill a backend.
      try { this.calibrator.observe(message); } catch { /* ignore */ }
      this.emit("log", entry);
    }
  }

  async start() {
    if (this.child) {
      await this.refreshHealth();
      return this.status();
    }
    const { command, args = [] } = this.resolveCommand();
    this.currentCommand = [command, ...args];
    this.lastExit = null;
    this.healthy = false;
    const child = spawn(command, args, {
      cwd: this.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: this.resolveEnv()
    });
    this.child = child;
    child.stdout.on("data", (chunk) => this.appendLog("stdout", chunk));
    child.stderr.on("data", (chunk) => this.appendLog("stderr", chunk));
    child.on("error", (error) => {
      if (this.child === child) this.child = null;
      this.healthy = false;
      this.lastExit = {
        code: null,
        signal: null,
        error: error.code || error.message,
        time: new Date().toISOString()
      };
      this.appendLog("error", error.message);
      this.emit("processError", error);
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      this.lastExit = { code, signal, time: new Date().toISOString() };
      this.healthy = false;
      this.child = null;
      this.emit("exit", this.lastExit);
    });
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (!this.child || this.child !== child) return this.status();
      let healthy = false;
      try {
        healthy = await this.healthCheck();
      } catch {
        // A backend that is binding its socket or loading a model may accept
        // the connection and immediately reset it. That is "not ready yet",
        // not a reason to abandon the remaining startup probes.
      }
      if (healthy) {
        if (this.child === child) this.healthy = true;
        return this.status();
      }
    }
    return this.status();
  }

  async stop() {
    if (!this.child) return this.status();
    const child = this.child;
    let exited = false;
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!exited) child.kill("SIGKILL");
      }, STOP_TIMEOUT_MS);
      child.once("exit", () => {
        exited = true;
        clearTimeout(timer);
        resolve();
      });
    });
    if (this.child === child) this.child = null;
    this.healthy = false;
    return this.status();
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  async refreshHealth() {
    const child = this.child;
    if (!child) {
      this.healthy = false;
      return false;
    }
    try {
      const healthy = await this.healthCheck();
      if (this.child !== child) return false;
      this.healthy = healthy;
    } catch {
      if (this.child !== child) return false;
      this.healthy = false;
    }
    return this.healthy;
  }

  status() {
    return {
      running: Boolean(this.child),
      pid: this.child?.pid || null,
      healthy: this.healthy,
      command: this.currentCommand,
      lastExit: this.lastExit,
      logs: this.logs.slice(-120)
    };
  }
}
