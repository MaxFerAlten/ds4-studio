// WP2 of convergenza.loop.md (decision D4): the texts the C loop and the Node
// loop must share live in config/agent-text/<name>.txt, generated from the C
// sources by scripts/generate-agent-text.mjs.  Nothing else may retype them:
// frontend/server/agentTextParity.test.mjs fails if a text changes on one side
// only.
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const AGENT_TEXT_DIR = resolve(ROOT, "config/agent-text");

const cache = new Map();

export function loadAgentText(name) {
  // Names come from the code, never from a request; the pattern keeps a typo
  // from turning into a path traversal on the config directory.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error(`invalid agent text name: ${name}`);
  }
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const file = resolve(AGENT_TEXT_DIR, `${name}.txt`);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(
      `missing shared agent text "${name}" (${file}); regenerate with node scripts/generate-agent-text.mjs`,
    );
  }
  cache.set(name, text);
  return text;
}
