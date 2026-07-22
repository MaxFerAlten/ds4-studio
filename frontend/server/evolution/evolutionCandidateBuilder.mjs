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

function processErrorDetails(error) {
  const parts = [
    error?.code ? `code=${error.code}` : "",
    typeof error?.stderr === "string" ? error.stderr.trim() : "",
    typeof error?.stdout === "string" ? error.stdout.trim() : "",
    typeof error?.message === "string" ? error.message.trim() : ""
  ].filter(Boolean);
  return parts.join(" | ").slice(0, 2_000) || "process failed without diagnostic output";
}

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

function splitUnifiedPatchSections(patchText) {
  const lines = patchText.split("\n");
  const sections = [];
  let current = [];
  for (const line of lines) {
    if (line.startsWith("diff --git ") && current.length) {
      sections.push(current);
      current = [line];
      continue;
    }
    current.push(line);
  }
  if (current.length) sections.push(current);
  return sections;
}

function formatUnifiedDiffRange(start, count) {
  return count === 1 ? String(start) : `${start},${count}`;
}

function normalizeUnifiedDiffHunkCounts(lines) {
  const normalized = [...lines];
  for (let index = 0; index < normalized.length; index += 1) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(normalized[index]);
    if (!match) continue;

    const expectedOldCount = Number(match[2] ?? 1);
    const expectedNewCount = Number(match[4] ?? 1);
    let oldCount = 0;
    let newCount = 0;
    for (let bodyIndex = index + 1; bodyIndex < normalized.length; bodyIndex += 1) {
      let line = normalized[bodyIndex];
      if (line.startsWith("@@ ")) break;
      // Models occasionally omit the mandatory leading space on an empty
      // context line. Restore it only while the hunk's declared ranges still
      // require another old/new line; otherwise preserve a trailing newline.
      if (line === "" && bodyIndex < normalized.length - 1 &&
          oldCount < expectedOldCount && newCount < expectedNewCount) {
        normalized[bodyIndex] = " ";
        line = " ";
      }
      if (line === "\\ No newline at end of file") continue;
      if (line.startsWith(" ")) {
        oldCount += 1;
        newCount += 1;
        continue;
      }
      if (line.startsWith("-")) {
        oldCount += 1;
        continue;
      }
      if (line.startsWith("+")) {
        newCount += 1;
        continue;
      }
      break;
    }

    normalized[index] = `@@ -${formatUnifiedDiffRange(Number(match[1]), oldCount)} +${formatUnifiedDiffRange(Number(match[3]), newCount)} @@${match[5]}`;
  }
  return normalized;
}

function dropNoopUnifiedDiffHunks(lines) {
  const filtered = [];
  for (let index = 0; index < lines.length;) {
    if (!lines[index].startsWith("@@ ")) {
      filtered.push(lines[index]);
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < lines.length && !lines[end].startsWith("@@ ")) end += 1;
    const body = lines.slice(index + 1, end);
    const removed = body.filter((line) => line.startsWith("-")).map((line) => line.slice(1));
    const added = body.filter((line) => line.startsWith("+")).map((line) => line.slice(1));
    const isNoop = removed.length > 0 && removed.length === added.length &&
      removed.every((line, position) => line === added[position]);
    if (!isNoop) filtered.push(lines[index], ...body);
    index = end;
  }
  return filtered;
}

export function normalizeUnifiedPatchText(patchText) {
  if (typeof patchText !== "string") return patchText;
  const sections = splitUnifiedPatchSections(patchText);
  const seen = new Set();
  const normalized = [];
  for (const section of sections) {
    const repairedSection = dropNoopUnifiedDiffHunks(normalizeUnifiedDiffHunkCounts(section));
    const text = repairedSection.join("\n");
    const canonical = text.endsWith("\n") ? text : `${text}\n`;
    const header = repairedSection[0] ?? "";
    if (!header.startsWith("diff --git ")) {
      normalized.push(canonical);
      continue;
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    normalized.push(canonical);
  }
  return normalized.join("");
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
  const diffPairs = new Set();
  let addedLines = 0;
  let deletedLines = 0;
  let hunks = 0;
  for (const line of patchText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/([^\s]+) b\/([^\s]+)$/.exec(line);
      if (!match) throw new EvolutionCandidateError("UNSAFE_PATCH_PATH", line);
      const pair = `${match[1]}\n${match[2]}`;
      if (diffPairs.has(pair)) throw new EvolutionCandidateError("DUPLICATE_PATCH_SECTION", match[2]);
      diffPairs.add(pair);
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
  if (diffPairs.size !== touched.size) {
    throw new EvolutionCandidateError("INVALID_PATCH", "patch must contain exactly one diff section per touched file");
  }
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

function fallbackImpact(files) {
  const high = files.some((file) => DEPENDENCY_FILES.has(path.posix.basename(file)) || /(^|\/)(security|auth|evolutionPromotion)/.test(file));
  return Object.freeze({ source: "file-risk", trusted: false, risk: high ? "HIGH" : "MEDIUM", targets: Object.freeze([...files]) });
}

async function applyPatch(workspaceRoot, patchText) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-patch-"));
  const patchFile = path.join(temporary, "candidate.patch");
  try {
    await fs.writeFile(patchFile, patchText, { encoding: "utf8", mode: 0o600 });
    try {
      await execFileAsync("git", ["apply", "--check", "--whitespace=error-all", "--", patchFile], {
        cwd: workspaceRoot,
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 1_000_000
      });
      await execFileAsync("git", ["apply", "--whitespace=error-all", "--", patchFile], {
        cwd: workspaceRoot,
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 1_000_000
      });
      return;
    } catch (gitError) {
      // Model patches can carry stale line context after harmless source drift.
      // Validate a bounded GNU patch fallback first; never run a fuzzy apply
      // unless its dry-run succeeds, and keep the candidate scope audit intact.
      try {
        const fuzzyArgs = ["--dry-run", "--batch", "--forward", "--fuzz=2", "--no-backup-if-mismatch", "-p1", "-i", patchFile];
        await execFileAsync("patch", fuzzyArgs, {
          cwd: workspaceRoot,
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 1_000_000
        });
        await execFileAsync("patch", fuzzyArgs.slice(1), {
          cwd: workspaceRoot,
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 1_000_000
        });
        return;
      } catch (fallbackError) {
        throw new EvolutionCandidateError("PATCH_APPLY_FAILED", [
          `git apply: ${processErrorDetails(gitError)}`,
          `patch fallback: ${processErrorDetails(fallbackError)}`
        ].join("; "));
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
    const normalizedPatchText = normalizeUnifiedPatchText(patchText);
    const metadata = inspectUnifiedPatch(normalizedPatchText);
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
        ? await this.dependencyPolicy({ files: dependencyChanges, patchText: normalizedPatchText, taskContract })
        : null;
      if (dependencyDecision?.allowed !== true || dependencyDecision?.exact !== true) {
        throw new EvolutionCandidateError("DEPENDENCY_CHANGE_REJECTED", dependencyChanges.join(", "));
      }
    }

    let impact = { source: "none", trusted: true, risk: "LOW", targets: [] };
    if (proposal.targetSymbols.length) {
      if (typeof this.impactProvider !== "function") {
        if (!taskContract.automation) {
          throw new EvolutionCandidateError("IMPACT_PROVIDER_UNAVAILABLE", "targeted symbols require trusted GitNexus impact analysis");
        }
        impact = fallbackImpact(metadata.files);
      } else {
        const provided = await this.impactProvider({
          targetSymbols: proposal.targetSymbols,
          targetFiles: metadata.files,
          taskContract
        });
        impact = !taskContract.automation && provided && RISK_LEVELS.has(provided.risk)
          ? { ...provided, source: provided.source ?? "gitnexus", trusted: true }
          : (provided?.trusted === true && provided?.source === "gitnexus" ? provided : fallbackImpact(metadata.files));
      }
      if (!impact || !RISK_LEVELS.has(impact.risk)) {
        throw new EvolutionCandidateError("INVALID_IMPACT_RESULT", "impact provider returned no valid risk");
      }
    }

    await applyPatch(workspaceRoot, normalizedPatchText);
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
      patchText: normalizedPatchText,
      patchMetadata: metadata,
      audit,
      impact,
      dependencyChanges: Object.freeze(dependencyChanges),
      dependencyPolicy: dependencyDecision ? Object.freeze({ allowed: true, exact: true }) : null,
      requiresManualReview: impact.trusted !== true || dependencyChanges.length > 0 || impact.risk === "HIGH" || impact.risk === "CRITICAL"
    });
  }
}
