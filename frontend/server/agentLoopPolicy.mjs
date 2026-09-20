// Loader for the shared agent loop policy.
//
// Reads generated/agent-loop-policy.json rather than config/, so a Node process
// running against a stale generated header is not silently using different
// numbers from the C worker compiled beside it.

import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DESCRIPTOR = resolve(ROOT, "generated/agent-loop-policy.json");

let cached = null;

export function loadAgentLoopPolicy({ path = DESCRIPTOR, reload = false } = {}) {
  if (cached && !reload && path === DESCRIPTOR) return cached;
  const policy = Object.freeze(JSON.parse(readFileSync(path, "utf8")));
  if (path === DESCRIPTOR) cached = policy;
  return policy;
}

export { DESCRIPTOR as AGENT_LOOP_POLICY_DESCRIPTOR };
