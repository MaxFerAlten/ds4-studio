/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/piano-post-verdetto.001.md section 9.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: execFile-argv process invocation pattern (evolutionWorkspace.mjs, evolutionCandidateBuilder.mjs).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { hashJson } from "./evolutionIntegrity.mjs";

const execFileAsync = promisify(execFile);
const RISK_LEVELS = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 });
const SAFE_SYMBOL = /^[A-Za-z_$][A-Za-z0-9_$.]{0,255}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+/;

function highestRisk(left, right) {
  return RISK_LEVELS[left] >= RISK_LEVELS[right] ? left : right;
}

export class EvolutionGitNexusError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "EvolutionGitNexusError";
    this.code = code;
    this.details = details;
  }
}

function assertSafeSymbol(symbol) {
  if (typeof symbol !== "string" || !SAFE_SYMBOL.test(symbol)) {
    throw new EvolutionGitNexusError("UNSAFE_SYMBOL", "symbol contains unsupported characters", { symbol });
  }
}

function degradedImpact(reasonCode, targetFiles, toolVersion) {
  return Object.freeze({
    source: "gitnexus",
    trusted: false,
    risk: "HIGH",
    targets: Object.freeze([...targetFiles]),
    symbols: Object.freeze([]),
    generatedAt: new Date().toISOString(),
    toolVersion: toolVersion ?? null,
    commandHash: null,
    reasonCode
  });
}

function parseDetectChanges(stdout, { expectedFiles, expectedSymbols }) {
  const changedFiles = new Set();
  const changedSymbols = new Set();
  let riskWord = "low";
  let section = null;

  if (stdout.trim() === "No changes detected.") {
    return buildDetectChangesResult({ risk: "LOW", changedFiles, changedSymbols, expectedFiles, expectedSymbols });
  }

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      section = null;
      continue;
    }
    const riskMatch = /^Risk level:\s*(\w+)/i.exec(line);
    if (riskMatch) {
      riskWord = riskMatch[1];
      continue;
    }
    if (line === "Changed symbols:") {
      section = "symbols";
      continue;
    }
    if (line === "Affected execution flows:") {
      section = "flows";
      continue;
    }
    if (section === "symbols") {
      const fileMatch = /→\s*(\S+)\s*$/.exec(line);
      if (fileMatch) changedFiles.add(fileMatch[1]);
      continue;
    }
    if (section === "flows") {
      const changedMatch = /changed:\s*(.+)$/.exec(line);
      if (changedMatch) {
        for (const symbol of changedMatch[1].split(",")) {
          const trimmed = symbol.trim();
          if (trimmed) changedSymbols.add(trimmed);
        }
      }
    }
  }

  const risk = RISK_LEVELS_UPPER.has(riskWord.toUpperCase()) ? riskWord.toUpperCase() : "HIGH";
  return buildDetectChangesResult({ risk, changedFiles, changedSymbols, expectedFiles, expectedSymbols });
}

const RISK_LEVELS_UPPER = new Set(Object.keys(RISK_LEVELS));

function buildDetectChangesResult({ risk, changedFiles, changedSymbols, expectedFiles, expectedSymbols }) {
  const expectedFileSet = new Set(expectedFiles);
  const expectedSymbolSet = new Set(expectedSymbols);
  const actualFiles = [...changedFiles];
  const affectedSymbols = [...changedSymbols];
  const unexpectedFiles = actualFiles.filter((file) => !expectedFileSet.has(file));
  const unexpectedSymbols = affectedSymbols.filter((symbol) => !expectedSymbolSet.has(symbol));
  return {
    supported: true,
    expectedFiles: Object.freeze([...expectedFiles]),
    actualFiles: Object.freeze(actualFiles),
    expectedSymbols: Object.freeze([...expectedSymbols]),
    affectedSymbols: Object.freeze(affectedSymbols),
    unexpectedFiles: Object.freeze(unexpectedFiles),
    unexpectedSymbols: Object.freeze(unexpectedSymbols),
    risk: unexpectedFiles.length || unexpectedSymbols.length ? highestRisk(risk, "HIGH") : risk
  };
}

export class EvolutionGitNexusAdapter {
  constructor({
    repositoryRoot,
    repositoryName = "ds4-studio",
    executable = "gitnexus",
    timeoutMs = 30_000,
    autoAnalyzeGitNexus = false,
    execFileImpl = execFileAsync
  } = {}) {
    if (typeof repositoryRoot !== "string" || !repositoryRoot) throw new TypeError("repositoryRoot is required");
    this.repositoryRoot = repositoryRoot;
    this.repositoryName = repositoryName;
    this.executable = executable;
    this.timeoutMs = timeoutMs;
    this.autoAnalyzeGitNexus = autoAnalyzeGitNexus;
    this.execFileImpl = execFileImpl;
  }

  async _run(args, { cwd = this.repositoryRoot, signal } = {}) {
    return this.execFileImpl(this.executable, args, {
      cwd,
      encoding: "utf8",
      timeout: this.timeoutMs,
      maxBuffer: 5_000_000,
      signal
    });
  }

  async capabilities({ signal } = {}) {
    const checkedAt = new Date().toISOString();
    let version = null;
    try {
      const { stdout } = await this._run(["--version"], { signal });
      version = stdout.trim();
      if (!VERSION_PATTERN.test(version)) version = null;
    } catch {
      return Object.freeze({ available: false, version: null, repositoryIndexed: false, stale: true, checkedAt });
    }
    try {
      const { stdout } = await this._run(["status"], { signal });
      const indexedMatch = /Indexed commit:\s*([0-9a-f]+)/i.exec(stdout);
      const currentMatch = /Current commit:\s*([0-9a-f]+)/i.exec(stdout);
      const repositoryIndexed = /^Indexed:/m.test(stdout) && Boolean(indexedMatch);
      const stale = !repositoryIndexed || !currentMatch || indexedMatch[1] !== currentMatch[1];
      return Object.freeze({ available: true, version, repositoryIndexed, stale, checkedAt });
    } catch {
      return Object.freeze({ available: true, version, repositoryIndexed: false, stale: true, checkedAt });
    }
  }

  async ensureFreshIndex({ signal } = {}) {
    const before = await this.capabilities({ signal });
    if (!before.stale) return before;
    if (this.autoAnalyzeGitNexus !== true) {
      throw new EvolutionGitNexusError("GITNEXUS_INDEX_STALE", "index is stale and autoAnalyzeGitNexus is disabled");
    }
    await this._run(["analyze"], { signal });
    return this.capabilities({ signal });
  }

  async impact({ targetSymbols = [], targetFiles = [], direction = "upstream", depth = 2, signal } = {}) {
    const symbols = Array.isArray(targetSymbols) ? targetSymbols.map(String) : [];
    for (const symbol of symbols) assertSafeSymbol(symbol);
    if (direction !== "upstream" && direction !== "downstream") {
      throw new EvolutionGitNexusError("INVALID_DIRECTION", "direction must be upstream or downstream");
    }
    if (!symbols.length) {
      return Object.freeze({
        source: "gitnexus", trusted: true, risk: "LOW", targets: Object.freeze([...targetFiles]),
        symbols: Object.freeze([]), generatedAt: new Date().toISOString(), toolVersion: null, commandHash: null
      });
    }

    const caps = await this.capabilities({ signal });
    if (!caps.available) return degradedImpact("GITNEXUS_UNAVAILABLE", targetFiles, caps.version);
    if (caps.stale) return degradedImpact("GITNEXUS_INDEX_STALE", targetFiles, caps.version);

    const commands = [];
    const results = [];
    for (const symbol of symbols) {
      const args = ["impact", "-d", direction, "--depth", String(depth), "-r", this.repositoryName, symbol];
      commands.push(args);
      let parsed;
      try {
        const { stdout } = await this._run(args, { signal });
        parsed = JSON.parse(stdout);
      } catch {
        return degradedImpact("GITNEXUS_IMPACT_FAILED", targetFiles, caps.version);
      }
      if (!Object.hasOwn(RISK_LEVELS, parsed?.risk)) {
        return degradedImpact("GITNEXUS_IMPACT_INVALID_OUTPUT", targetFiles, caps.version);
      }
      results.push({ symbol, parsed, rawOutputHash: hashJson(parsed) });
    }

    const risk = results.reduce((acc, entry) => highestRisk(acc, entry.parsed.risk), "LOW");
    return Object.freeze({
      source: "gitnexus",
      trusted: true,
      risk,
      targets: Object.freeze([...targetFiles]),
      symbols: Object.freeze(results.map((entry) => Object.freeze({
        symbol: entry.symbol,
        directCallers: entry.parsed.summary?.direct ?? 0,
        transitiveCallers: entry.parsed.impactedCount ?? 0,
        processes: Object.freeze([...(entry.parsed.affected_processes ?? [])]),
        rawOutputHash: entry.rawOutputHash
      }))),
      generatedAt: new Date().toISOString(),
      toolVersion: caps.version,
      commandHash: hashJson({ commands })
    });
  }

  async detectChanges({ workspaceRoot, expectedFiles = [], expectedSymbols = [], signal } = {}) {
    const args = ["detect-changes", "--scope", "unstaged"];
    const commandHash = hashJson({ executable: this.executable, args });
    let stdout;
    let reasonCode = null;
    try {
      ({ stdout } = await this._run(args, { cwd: workspaceRoot ?? this.repositoryRoot, signal }));
      if (stdout.startsWith("Error:")) reasonCode = "GITNEXUS_DETECT_CHANGES_UNSUPPORTED";
    } catch (error) {
      reasonCode = error.code === "ENOENT" ? "GITNEXUS_UNAVAILABLE" : "GITNEXUS_DETECT_CHANGES_UNSUPPORTED";
    }
    if (reasonCode) {
      return Object.freeze({
        supported: false,
        expectedFiles: Object.freeze([...expectedFiles]),
        actualFiles: Object.freeze([]),
        expectedSymbols: Object.freeze([...expectedSymbols]),
        affectedSymbols: Object.freeze([]),
        unexpectedFiles: Object.freeze([...expectedFiles]),
        unexpectedSymbols: Object.freeze([...expectedSymbols]),
        risk: "HIGH",
        commandHash,
        outputHash: null,
        reasonCode
      });
    }
    const parsed = parseDetectChanges(stdout, { expectedFiles, expectedSymbols });
    return Object.freeze({ ...parsed, commandHash, outputHash: hashJson(stdout) });
  }
}
