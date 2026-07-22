/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/piano-post-verdetto.001.md section 11.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: execFile-argv process invocation (evolutionGitNexusAdapter.mjs).
 */

import { access, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const LEVEL_RANK = Object.freeze({ B: 0, C: 1, D: 2, E: 3 });

async function fileExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function probeCommand(commandPath) {
  try {
    const { stdout } = await execFileAsync(commandPath, ["--version"], { timeout: 5_000 });
    const firstLine = stdout.toString().split("\n")[0].trim();
    const match = firstLine.match(/(\d+\.\d+[\.\d]*)/);
    return { ok: true, version: match ? match[1] : firstLine };
  } catch {
    return { ok: false, version: null };
  }
}

async function probeGit() {
  try {
    const { stdout } = await execFileAsync("git", ["--version"], { timeout: 5_000 });
    return { ok: true, version: stdout.toString().trim().replace(/^git version\s+/, "") };
  } catch {
    return { ok: false, version: null };
  }
}

async function probePatch() {
  try {
    const { stdout, stderr } = await execFileAsync("patch", ["--version"], { timeout: 5_000 });
    const text = (stdout + stderr).toString();
    const match = text.match(/(\d+\.\d+[\.\d]*)/);
    return { ok: true, version: match ? match[1] : text.split("\n")[0].trim() };
  } catch {
    return { ok: false, version: null };
  }
}

async function probeDirectory(label, dirPath) {
  try {
    const s = await stat(dirPath);
    return { ok: s.isDirectory(), reasonCode: s.isDirectory() ? null : `${label}_NOT_DIRECTORY` };
  } catch {
    return { ok: false, reasonCode: `${label}_INACCESSIBLE` };
  }
}

async function probeWriteAuth() {
  const tokenEnv = process.env.DS4_EVOLUTION_WRITE_TOKEN;
  return { ok: Boolean(tokenEnv && tokenEnv.length >= 32), reasonCode: tokenEnv ? null : "WRITE_TOKEN_MISSING" };
}

export class EvolutionPreflight {
  constructor({
    repositoryRoot,
    stateDir = "data/evolution-runs",
    workDir = "../ds4-studio-evolution-workspaces",
    modelClient = null,
    modelEndpoint = null,
    gitNexusAdapter = null,
    configuredMaxLevel = "B",
    bwrapPath = "/usr/bin/bwrap",
    prlimitPath = "/usr/bin/prlimit"
  } = {}) {
    this.repositoryRoot = repositoryRoot;
    this.stateDir = stateDir;
    this.workDir = workDir;
    this.modelClient = modelClient;
    this.modelEndpoint = modelEndpoint;
    this.gitNexusAdapter = gitNexusAdapter;
    this.configuredMaxLevel = configuredMaxLevel;
    this.bwrapPath = bwrapPath;
    this.prlimitPath = prlimitPath;
  }

  async inspect({ includeModelProbe = false } = {}) {
    const checks = {};

    const repoCheck = await probeDirectory("repository", this.repositoryRoot);
    checks.repository = { ok: repoCheck.ok, reasonCode: repoCheck.reasonCode };

    const stateCheck = await probeDirectory("stateDir", this.stateDir);
    checks.stateDir = { ok: stateCheck.ok, reasonCode: stateCheck.reasonCode };

    const workCheck = await probeDirectory("workDir", this.workDir);
    checks.workDir = { ok: workCheck.ok, reasonCode: workCheck.reasonCode };

    checks.git = await probeGit();
    checks.patch = await probePatch();
    checks.bubblewrap = await probeCommand(this.bwrapPath);
    checks.prlimit = await probeCommand(this.prlimitPath);

    if (includeModelProbe && this.modelClient) {
      try {
        await this.modelClient.probe();
        checks.model = { ok: true, model: null, endpoint: this.modelEndpoint, reasonCode: null };
      } catch (error) {
        checks.model = { ok: false, model: null, endpoint: this.modelEndpoint, reasonCode: "MODEL_UNREACHABLE" };
      }
    } else {
      checks.model = { ok: false, model: null, endpoint: this.modelEndpoint, reasonCode: includeModelProbe ? "MODEL_CLIENT_MISSING" : "MODEL_PROBE_SKIPPED" };
    }

    if (this.gitNexusAdapter) {
      try {
        const gnCaps = await this.gitNexusAdapter.capabilities();
        checks.gitnexus = { ok: gnCaps.available, version: gnCaps.version, indexed: gnCaps.repositoryIndexed, stale: gnCaps.stale, reasonCode: gnCaps.available ? null : "GITNEXUS_UNAVAILABLE" };
      } catch {
        checks.gitnexus = { ok: false, version: null, indexed: false, stale: true, reasonCode: "GITNEXUS_ERROR" };
      }
    } else {
      checks.gitnexus = { ok: false, version: null, indexed: false, stale: true, reasonCode: "GITNEXUS_ADAPTER_MISSING" };
    }

    checks.writeAuth = await probeWriteAuth();

    const bBlockers = [];
    if (!checks.repository.ok) bBlockers.push(`REPOSITORY: ${checks.repository.reasonCode}`);
    if (!checks.stateDir.ok) bBlockers.push(`STATE_DIR: ${checks.stateDir.reasonCode}`);
    if (!checks.git.ok) bBlockers.push("GIT_NOT_AVAILABLE");
    if (!checks.patch.ok) bBlockers.push("PATCH_NOT_AVAILABLE");
    if (!checks.bubblewrap.ok) bBlockers.push("BUBBLEWRAP_NOT_AVAILABLE");
    if (!checks.prlimit.ok) bBlockers.push("PRLIMIT_NOT_AVAILABLE");
    if (!checks.writeAuth.ok) bBlockers.push(`WRITE_AUTH: ${checks.writeAuth.reasonCode}`);

    const cBlockers = [...bBlockers];
    if (!checks.model.ok) cBlockers.push(`MODEL: ${checks.model.reasonCode}`);

    const dBlockers = [...cBlockers];
    if (!checks.gitnexus.ok || checks.gitnexus.stale) dBlockers.push(`GITNEXUS: ${checks.gitnexus.stale ? "INDEX_STALE" : checks.gitnexus.reasonCode}`);

    const levels = {
      B: { available: bBlockers.length === 0, blockers: bBlockers },
      C: { available: cBlockers.length === 0, blockers: cBlockers },
      D: { available: dBlockers.length === 0, blockers: dBlockers },
      E: { available: false, blockers: ["LEVEL_E_NOT_CERTIFIED"] }
    };

    const effectiveMaxLevel = this.computeEffectiveMaxLevel(levels);

    return Object.freeze({
      schema: "ds4_evolution_capabilities_v1",
      enabled: checks.repository.ok && checks.writeAuth.ok,
      configuredMaxLevel: this.configuredMaxLevel,
      effectiveMaxLevel,
      platform: process.platform,
      checks,
      levels,
      checkedAt: new Date().toISOString()
    });
  }

  computeEffectiveMaxLevel(levels) {
    let result = "B";
    const configuredRank = LEVEL_RANK[this.configuredMaxLevel] ?? 0;
    for (const level of ["B", "C", "D", "E"]) {
      if (LEVEL_RANK[level] <= configuredRank && levels[level].available) {
        result = level;
      }
    }
    return result;
  }
}
