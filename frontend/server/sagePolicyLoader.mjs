import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const SAGE_POLICY_PATH = path.join(PROJECT_ROOT, "skills/sage/SKILL.md");

export function sagePolicyRevision(content) {
  return createHash("sha1").update(String(content ?? ""), "utf8").digest("hex");
}

export function loadSagePolicy({ policyPath = SAGE_POLICY_PATH } = {}) {
  const resolvedPath = path.resolve(policyPath);
  try {
    const prompt = readFileSync(resolvedPath, "utf8");
    if (!prompt.trim()) {
      return { ready: false, path: resolvedPath, prompt: null, revision: null };
    }
    return {
      ready: true,
      path: resolvedPath,
      prompt,
      revision: sagePolicyRevision(prompt)
    };
  } catch {
    return { ready: false, path: resolvedPath, prompt: null, revision: null };
  }
}
