import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

const STOP_TIMEOUT_MS = 5000;
const MAX_LOG_LINES = 500;

export class Ds4ProcessManager extends EventEmitter {
  constructor({ buildCommand, healthCheck, cwd = process.cwd() }) {
    super();
    this.buildCommand = buildCommand;
    this.healthCheck = healthCheck;
    this.cwd = cwd;
    this.child = null;
    this.currentCommand = [];
    this.overrideCommand = null;
    this.logs = [];
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
      this.emit("log", entry);
    }
  }

  async start() {
    if (this.child) return this.status();
    const { command, args = [] } = this.resolveCommand();
    this.currentCommand = [command, ...args];
    this.lastExit = null;
    this.healthy = false;
    const child = spawn(command, args, {
      cwd: this.cwd,
      stdio: ["ignore", "pipe", "pipe"]
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
    await new Promise((resolve) => setTimeout(resolve, 150));
    await this.refreshHealth();
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
