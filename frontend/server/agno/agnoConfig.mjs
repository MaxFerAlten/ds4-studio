import path from "node:path";
import fs from "node:fs/promises";

/**
 * Resolve Agno service paths relative to the project root.
 *
 * Contract:
 * - serviceDir relative must resolve under projectRoot
 * - dbFile relative must resolve under projectRoot
 * - paths with ".." that escape projectRoot are rejected
 * - absolute paths are rejected in MVP (prefer relative)
 *
 * @param {object} options
 * @param {string} options.projectRoot - absolute path to project root
 * @param {object} options.config - merged config (config.agno.*)
 * @returns {{ serviceDir: string, dbFile: string }}
 */
export function resolveAgnoPaths({ projectRoot, config }) {
  const ag = config.agno || {};
  const serviceDir = resolveRelativeOrReject(ag.serviceDir, projectRoot, "serviceDir");
  const dbFile = resolveRelativeOrReject(ag.dbFile, projectRoot, "dbFile");
  return { serviceDir, dbFile };
}

function resolveRelativeOrReject(relativePath, projectRoot, label) {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new Error(`agno.${label}: must be a non-empty string`);
  }
  const resolved = path.resolve(projectRoot, relativePath);
  // Ensure the resolved path stays inside projectRoot
  if (!resolved.startsWith(projectRoot + path.sep) && resolved !== projectRoot) {
    throw new Error(`agno.${label}: path escapes project root`);
  }
  return resolved;
}

export async function checkAgnoPathsExist({ serviceDir, dbFile }) {
  // Check that serviceDir exists (or can be created)
  try {
    await fs.access(serviceDir);
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`agno service directory not found: ${serviceDir}`);
    }
    throw err;
  }
  // dbFile parent must be creatable
  const dbParent = path.dirname(dbFile);
  try {
    await fs.mkdir(dbParent, { recursive: true });
  } catch (err) {
    throw new Error(`cannot create agno db directory: ${dbParent}: ${err.message}`);
  }
}
