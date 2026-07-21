/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/clean-room-provenance.md sections 8, 9, and 14.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: strict Evolution provenance contract validation.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateProvenanceRecord } from "./evolutionContracts.mjs";
import { hashJson } from "./evolutionIntegrity.mjs";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(MODULE_DIR, "../../..");
const CLEAN_ROOM_HEADER = "DS4 Evolution — independently designed clean-room implementation.";
const NO_COPY_HEADER = "External source code or prompts copied: none.";
const REQUIREMENT_ID = /^(?:(?:BEH|SEC)-[A-Z]+-\d{3}|CR-\d{3})$/;
const IMPORT_SPECIFIER = /\b(?:from\s+|import\s*\()\s*["']([^"']+)["']/g;

export class EvolutionProvenanceError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "EvolutionProvenanceError";
    this.code = code;
    this.details = details;
  }
}

async function pathExists(file) {
  return fs.access(file).then(() => true, () => false);
}

async function listFiles(root) {
  const result = [];
  const visit = async (directory) => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile()) result.push(candidate);
    }
  };
  if (await pathExists(root)) await visit(root);
  return result;
}

function relative(repositoryRoot, file) {
  return path.relative(repositoryRoot, file).split(path.sep).join("/");
}

function bannedPackageName(value) {
  const name = String(value).toLowerCase();
  return name === "sia" || name === "sia-agent" || name.endsWith("/sia") || name.endsWith("/sia-agent");
}

function importedSpecifiers(source) {
  const result = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER)) result.push(match[1]);
  return result;
}

function dependencyNames(lockOrPackage) {
  const result = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      if (value[section] && typeof value[section] === "object") {
        for (const name of Object.keys(value[section])) result.add(name);
      }
    }
    if (typeof value.name === "string") result.add(value.name);
    for (const [key, child] of Object.entries(value)) {
      if (key === "packages" && child && typeof child === "object") {
        for (const packagePath of Object.keys(child)) {
          const marker = "node_modules/";
          const offset = packagePath.lastIndexOf(marker);
          if (offset >= 0) result.add(packagePath.slice(offset + marker.length));
        }
      }
      if (child && typeof child === "object") visit(child);
    }
  };
  visit(lockOrPackage);
  return [...result].sort();
}

function check(testId, requirement, violations) {
  return Object.freeze({
    testId,
    requirement,
    status: violations.length ? "FAIL" : "PASS",
    violations: Object.freeze([...violations])
  });
}

export async function scanEvolutionProvenance(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT);
  const productionDir = path.resolve(options.productionDir ?? path.join(repositoryRoot, "frontend/server/evolution"));
  const manifestPath = path.resolve(options.manifestPath ?? path.join(productionDir, "provenance-manifest.json"));
  const packageFiles = options.packageFiles ?? [
    path.join(repositoryRoot, "package.json"),
    path.join(repositoryRoot, "package-lock.json"),
    path.join(repositoryRoot, "frontend/package.json"),
    path.join(repositoryRoot, "frontend/package-lock.json")
  ];
  const sourceFiles = (await listFiles(productionDir)).filter((file) => file.endsWith(".mjs"));
  const productionFiles = sourceFiles.filter((file) => !file.endsWith(".test.mjs"));
  const testFiles = sourceFiles.filter((file) => file.endsWith(".test.mjs"));
  const sourceByFile = new Map(await Promise.all(sourceFiles.map(async (file) => [file, await fs.readFile(file, "utf8")])));

  let manifest = null;
  const manifestViolations = [];
  try {
    manifest = validateProvenanceRecord(JSON.parse(await fs.readFile(manifestPath, "utf8")));
  } catch (error) {
    manifestViolations.push(error.code ?? "PROVENANCE_MANIFEST_INVALID");
  }

  const dependencyViolations = [];
  for (const file of packageFiles) {
    if (!(await pathExists(file))) continue;
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      for (const name of dependencyNames(parsed)) {
        if (bannedPackageName(name)) dependencyViolations.push(`BANNED_DEPENDENCY:${relative(repositoryRoot, file)}:${name}`);
      }
    } catch {
      dependencyViolations.push(`DEPENDENCY_MANIFEST_INVALID:${relative(repositoryRoot, file)}`);
    }
  }

  const importViolations = [];
  for (const file of productionFiles) {
    for (const specifier of importedSpecifiers(sourceByFile.get(file))) {
      if (bannedPackageName(specifier) || /(^|\/)sia-agent(\/|$)/i.test(specifier)) {
        importViolations.push(`BANNED_IMPORT:${relative(repositoryRoot, file)}:${specifier}`);
      }
    }
  }

  const headerViolations = [];
  for (const file of productionFiles) {
    const source = sourceByFile.get(file);
    const sourcePath = relative(repositoryRoot, file);
    if (!source.includes(CLEAN_ROOM_HEADER) || !source.includes(NO_COPY_HEADER)) {
      headerViolations.push(`PROVENANCE_HEADER_MISSING:${sourcePath}`);
    }
    const testFile = file.replace(/\.mjs$/, ".test.mjs");
    if (!(await pathExists(testFile))) headerViolations.push(`DIRECT_TEST_MISSING:${sourcePath}`);
  }

  if (manifest) {
    const declared = new Set(manifest.new_files);
    const implementationRoots = [productionDir, path.join(repositoryRoot, "benchmarks/agentic/evolution")];
    for (const root of implementationRoots) {
      for (const file of await listFiles(root)) {
        const sourcePath = relative(repositoryRoot, file);
        if (!declared.has(sourcePath)) manifestViolations.push(`UNDECLARED_IMPLEMENTATION_FILE:${sourcePath}`);
      }
    }
    for (const sourcePath of declared) {
      if (!(await pathExists(path.join(repositoryRoot, sourcePath)))) manifestViolations.push(`DECLARED_FILE_MISSING:${sourcePath}`);
    }
    if (manifest.requirements.some((id) => !REQUIREMENT_ID.test(String(id)))) {
      manifestViolations.push("INVALID_REQUIREMENT_MAPPING");
    }
  }

  const promptViolations = manifest?.external_prompts_copied === false ? [] : ["PROMPT_ATTESTATION_MISSING"];
  const testIndependenceViolations = manifest?.external_tests_copied === false ? [] : ["TEST_ATTESTATION_MISSING"];
  for (const file of testFiles) {
    if (!/test origin:/i.test(sourceByFile.get(file))) {
      testIndependenceViolations.push(`TEST_ORIGIN_MISSING:${relative(repositoryRoot, file)}`);
    }
  }

  const checks = Object.freeze([
    check("CR-001", "No SIA runtime dependency", dependencyViolations),
    check("CR-002", "No imports from external SIA modules", importViolations),
    check("CR-003", "Production provenance headers and direct tests present", headerViolations),
    check("CR-004", "Machine-readable provenance manifest complete", manifestViolations),
    check("CR-005", "Prompt independence attested", promptViolations),
    check("CR-006", "Tests derive from the DS4 acceptance contract", testIndependenceViolations)
  ]);
  const violations = checks.flatMap((entry) => entry.violations);
  const report = {
    schema: "ds4_evolution_provenance_report_v1",
    passed: violations.length === 0,
    checks,
    violations: Object.freeze(violations),
    manifestHash: manifest ? hashJson(manifest) : null,
    productionFiles: Object.freeze(productionFiles.map((file) => relative(repositoryRoot, file))),
    testFiles: Object.freeze(testFiles.map((file) => relative(repositoryRoot, file)))
  };
  return Object.freeze(report);
}
