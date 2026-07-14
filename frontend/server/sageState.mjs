/**
 * SageMath state manager — tracks whether Sage is enabled, provides
 * health-check (binary present + responsive), and maintains a dedicated
 * call log for Sage invocations.
 */

import { spawn, execSync } from "node:child_process";
// Synchronous fs API: SageCallLog persists the NDJSON ring with existsSync/
// readFileSync/appendFileSync/writeFileSync. Importing node:fs/promises here
// silently broke persistence (those sync methods are absent on that surface and
// the surrounding try/catch swallowed the TypeError).
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  loadSagePolicy,
  SAGE_POLICY_PATH
} from "./sagePolicyLoader.mjs";

export const DEFAULT_SAGE_SKILL_PATH = SAGE_POLICY_PATH;
export const SAGE_POLICY_BEGIN = "<!-- ds4-sage-policy:start -->";
export const SAGE_POLICY_END = "<!-- ds4-sage-policy:end -->";

// ---------------------------------------------------------------------------
// Sage call debug ring (in-memory + persisted NDJSON)
// ---------------------------------------------------------------------------

export class SageCallLog {
  constructor({ dir, maxEntries = 100 } = {}) {
    this.dir = dir;
    this.maxEntries = maxEntries;
    this.file = path.join(dir, "sage-calls.ndjson");
    this.ring = [];
    this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = fs.readFileSync(this.file, "utf8");
      const lines = raw.split("\n").filter(Boolean).slice(-this.maxEntries);
      for (const line of lines) {
        try { this.ring.push(JSON.parse(line)); } catch { /* skip */ }
      }
    } catch { /* best effort */ }
  }

  record(entry) {
    const full = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      ...entry
    };
    this.ring.push(full);
    while (this.ring.length > this.maxEntries) this.ring.shift();
    try {
      fs.appendFileSync(this.file, JSON.stringify(full) + "\n");
    } catch { /* best effort */ }
    return full;
  }

  list({ limit } = {}) {
    const n = limit && limit > 0 ? limit : this.maxEntries;
    return this.ring.slice(-n).reverse();
  }

  clear() {
    this.ring = [];
    try {
      fs.writeFileSync(this.file, "");
    } catch { /* best effort */ }
  }
}

// ---------------------------------------------------------------------------
// Sage health checks
// ---------------------------------------------------------------------------

/**
 * Check if the `sage` binary is installed and reachable.
 */
export function sageBinaryExists() {
  try {
    execSync("which sage 2>/dev/null", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Sage responds by running a trivial computation.
 * Returns { ok, version, error }.
 */
export function sageResponds() {
  return new Promise((resolve) => {
    const child = spawn("sage", ["-c", "print('LaTeX:', latex(pi))"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (d) => stdout.push(d));
    child.stderr.on("data", (d) => stderr.push(d));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, error: "sage did not respond within 30s" });
    }, 30_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString().trim();
      const err = Buffer.concat(stderr).toString().trim();
      if (code === 0 && out.includes("LaTeX:")) {
        resolve({ ok: true, version: out.split("\n")[0] || "", error: null });
      } else {
        resolve({ ok: false, error: err || `exit code ${code}` });
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
  });
}

// ---------------------------------------------------------------------------
// State holder
// ---------------------------------------------------------------------------

/** Shared mutable state for the SageMath integration. */
export const sageState = {
  enabled: false,
  version: null,
  lastCheck: null,
  policyPrompt: null,
  policyPath: DEFAULT_SAGE_SKILL_PATH,
  policyRevision: null
};

export function activateSagePolicy({ skillPath = DEFAULT_SAGE_SKILL_PATH } = {}) {
  const policy = loadSagePolicy({ policyPath: skillPath });
  if (!policy.ready) throw new Error(`Sage policy is unavailable: ${policy.path}`);
  sageState.enabled = true;
  sageState.policyPrompt = policy.prompt;
  sageState.policyPath = policy.path;
  sageState.policyRevision = policy.revision;
  return policy.prompt;
}

export function deactivateSagePolicy() {
  sageState.enabled = false;
  sageState.policyPrompt = null;
  sageState.policyRevision = null;
}

export function sagePolicyIsActive() {
  return sageState.enabled === true &&
    typeof sageState.policyPrompt === "string" &&
    sageState.policyPrompt.length > 0;
}

function isSagePolicyMessage(message) {
  return message?.role === "system" &&
    String(message.content || "").includes(SAGE_POLICY_BEGIN);
}

export function applySagePolicyToMessages(
  messages,
  { enabled = sageState.enabled, prompt = sageState.policyPrompt } = {}
) {
  const clean = (Array.isArray(messages) ? messages : []).filter(
    (message) => !isSagePolicyMessage(message)
  );
  if (!enabled || typeof prompt !== "string" || !prompt.trim()) return clean;

  const policyMessage = {
    role: "system",
    content: `${SAGE_POLICY_BEGIN}\n${prompt.trim()}\n${SAGE_POLICY_END}`
  };
  const firstSystem = clean.findIndex((message) => message?.role === "system");
  const insertAt = firstSystem >= 0 ? firstSystem + 1 : 0;
  return [...clean.slice(0, insertAt), policyMessage, ...clean.slice(insertAt)];
}

export function syncSageStateFromNativeCommand(
  command,
  payload,
  { skillPath = DEFAULT_SAGE_SKILL_PATH } = {}
) {
  if (payload?.ok !== true) return false;
  const match = String(command || "").trim().match(
    /^\/(?:sage-pol|sage)\s+(start|stop)\s*$/i
  );
  if (!match) return false;
  if (match[1].toLowerCase() === "start") activateSagePolicy({ skillPath });
  else deactivateSagePolicy();
  return true;
}
