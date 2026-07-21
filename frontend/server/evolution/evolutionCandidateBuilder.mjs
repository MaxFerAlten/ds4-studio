/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/behavioral-specification.md sections 7 and 8.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: GitNexus impact contract through an injected trusted adapter.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { validateProposal } from "./evolutionContracts.mjs";
import { sha256 } from "./evolutionIntegrity.mjs";
import { auditWorkspace } from "./evolutionWorkspace.mjs";

const execFileAsync = promisify(execFile);
const MAX_PATCH_BYTES = 2_000_000;
const RISK_LEVELS = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const DEPENDENCY_FILES = new Set([
  "package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock",
  "deno.json", "deno.lock", "go.mod", "go.sum", "Cargo.toml", "Cargo.lock",
  "requirements.txt", "pyproject.toml", "poetry.lock", "Pipfile", "Pipfile.lock"
]);

export class EvolutionCandidateError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "EvolutionCandidateError";
    this.code = code;
    this.details = details;
  }
}

function normalizePatchPath(value) {
  let candidate = String(value ?? "").trim();
  if (candidate === "/dev/null") return null;
  if (candidate.startsWith("a/") || candidate.startsWith("b/")) candidate = candidate.slice(2);
  if (!candidate || candidate.startsWith('"') || candidate.includes("\0") || /\s/.test(candidate) ||
      path.isAbsolute(candidate) || path.win32.isAbsolute(candidate)) {
    throw new EvolutionCandidateError("UNSAFE_PATCH_PATH", String(value));
  }
  const normalized = path.posix.normalize(candidate.replaceAll("\\", "/")).replace(/^\.\//, "");
  if (!normalized || normalized === ".." || normalized.startsWith("../")) {
    throw new EvolutionCandidateError("UNSAFE_PATCH_PATH", candidate);
  }
  return normalized;
}

function scopeContains(scope, candidate) {
  return candidate === scope || candidate.startsWith(`${scope}/`);
}

export function inspectUnifiedPatch(patchText, options = {}) {
  if (typeof patchText !== "string" || !patchText.trim()) {
    throw new EvolutionCandidateError("EMPTY_PATCH", "candidate patch is empty");
  }
  const bytes = Buffer.byteLength(patchText, "utf8");
  if (bytes > (options.maxBytes ?? MAX_PATCH_BYTES)) {
    throw new EvolutionCandidateError("PATCH_TOO_LARGE", `patch is ${bytes} bytes`);
  }
  if (patchText.includes("\0")) throw new EvolutionCandidateError("UNSAFE_PATCH_CONTENT", "patch contains NUL byte");
  if (/^(GIT binary patch|Binary files )/m.test(patchText)) {
    throw new EvolutionCandidateError("BINARY_CHANGE_FORBIDDEN", "binary patch detected");
  }
  if (/^(new file mode|old mode|new mode) 120000$/m.test(patchText)) {
    throw new EvolutionCandidateError("SYMLINK_CHANGE_FORBIDDEN", "symlink patch detected");
  }

  const touched = new Set();
  let addedLines = 0;
  let deletedLines = 0;
  let hunks = 0;
  for (const line of patchText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/([^\s]+) b\/([^\s]+)$/.exec(line);
      if (!match) throw new EvolutionCandidateError("UNSAFE_PATCH_PATH", line);
      touched.add(normalizePatchPath(match[1]));
      touched.add(normalizePatchPath(match[2]));
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const candidate = normalizePatchPath(line.slice(4).split("\t", 1)[0]);
      if (candidate) touched.add(candidate);
      continue;
    }
    if (line.startsWith("@@")) {
      hunks += 1;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) addedLines += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletedLines += 1;
  }
  touched.delete(null);
  if (!touched.size || !hunks) throw new EvolutionCandidateError("INVALID_PATCH", "patch contains no file hunk");
  return Object.freeze({
    files: Object.freeze([...touched].sort()),
    filesChanged: touched.size,
    addedLines,
    deletedLines,
    bytes,
    patchHash: sha256(patchText)
  });
}

function assertScope(metadata, taskContract) {
  for (const file of metadata.files) {
    const mutable = taskContract.mutablePaths.some((scope) => scopeContains(scope, file));
    const immutable = taskContract.immutablePaths.some((scope) => scopeContains(scope, file));
    if (!mutable || immutable) throw new EvolutionCandidateError("IMMUTABLE_PATH_WRITE", file);
  }
  if (metadata.filesChanged > taskContract.budgets.maxFilesChanged) {
    throw new EvolutionCandidateError("FILE_BUDGET_EXCEEDED", `${metadata.filesChanged} files`);
  }
  if (metadata.addedLines > taskContract.budgets.maxAddedLines ||
      metadata.deletedLines > taskContract.budgets.maxDeletedLines) {
    throw new EvolutionCandidateError("LINE_BUDGET_EXCEEDED", "patch exceeds configured line limits");
  }
}

function dependencyFiles(metadata) {
  return metadata.files.filter((file) => DEPENDENCY_FILES.has(path.posix.basename(file)));
}

async function applyPatch(workspaceRoot, patchText) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-patch-"));
  const patchFile = path.join(temporary, "candidate.patch");
  try {
    await fs.writeFile(patchFile, patchText, { encoding: "utf8", mode: 0o600 });
    for (const args of [
      ["apply", "--check", "--whitespace=error-all", "--", patchFile],
      ["apply", "--whitespace=error-all", "--", patchFile]
    ]) {
      try {
        await execFileAsync("git", args, {
          cwd: workspaceRoot,
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 1_000_000
        });
      } catch (error) {
        throw new EvolutionCandidateError("PATCH_APPLY_FAILED", String(error.stderr ?? error.message).slice(0, 2_000));
      }
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

export class EvolutionCandidateBuilder {
  constructor({ impactProvider = null, dependencyPolicy = null } = {}) {
    this.impactProvider = impactProvider;
    this.dependencyPolicy = dependencyPolicy;
  }

  async build({ taskContract, proposal: proposalInput, patchText, sourceRoot, workspaceRoot }) {
    const proposal = validateProposal(proposalInput, taskContract);
    if (proposal.stopInstead) throw new EvolutionCandidateError("PROPOSAL_REQUESTED_STOP", proposal.summary);
    const metadata = inspectUnifiedPatch(patchText);
    assertScope(metadata, taskContract);
    if (metadata.files.join("\n") !== [...proposal.targetFiles].sort().join("\n")) {
      throw new EvolutionCandidateError("PROPOSAL_PATCH_MISMATCH", "proposal targetFiles do not match patch paths", {
        proposed: proposal.targetFiles,
        actual: metadata.files
      });
    }

    const dependencyChanges = dependencyFiles(metadata);
    let dependencyDecision = null;
    if (dependencyChanges.length) {
      dependencyDecision = typeof this.dependencyPolicy === "function"
        ? await this.dependencyPolicy({ files: dependencyChanges, patchText, taskContract })
        : null;
      if (dependencyDecision?.allowed !== true || dependencyDecision?.exact !== true) {
        throw new EvolutionCandidateError("DEPENDENCY_CHANGE_REJECTED", dependencyChanges.join(", "));
      }
    }

    let impact = { risk: "LOW", targets: [] };
    if (proposal.targetSymbols.length) {
      if (typeof this.impactProvider !== "function") {
        throw new EvolutionCandidateError("IMPACT_PROVIDER_UNAVAILABLE", "targeted symbols require trusted GitNexus impact analysis");
      }
      impact = await this.impactProvider({
        targetSymbols: proposal.targetSymbols,
        targetFiles: metadata.files,
        taskContract
      });
      if (!impact || !RISK_LEVELS.has(impact.risk)) {
        throw new EvolutionCandidateError("INVALID_IMPACT_RESULT", "impact provider returned no valid risk");
      }
    }

    await applyPatch(workspaceRoot, patchText);
    const audit = await auditWorkspace({ sourceRoot, workspaceRoot, taskContract });
    const auditPaths = audit.changes.map(({ path: changedPath }) => changedPath).sort();
    if (auditPaths.join("\n") !== metadata.files.join("\n")) {
      throw new EvolutionCandidateError("POST_APPLY_SCOPE_MISMATCH", "filesystem audit differs from patch metadata", {
        patchPaths: metadata.files,
        auditPaths
      });
    }
    return Object.freeze({
      proposal,
      candidateHash: metadata.patchHash,
      patchMetadata: metadata,
      audit,
      impact,
      dependencyChanges: Object.freeze(dependencyChanges),
      dependencyPolicy: dependencyDecision ? Object.freeze({ allowed: true, exact: true }) : null,
      requiresManualReview: dependencyChanges.length > 0 || impact.risk === "HIGH" || impact.risk === "CRITICAL"
    });
  }
}
