// The six Lean/Sage switches that are configuration, not GPU tuning.
//
// They used to live as strings in ds4-ui.config.json `server.env`, which made
// them invisible to the Node resolvers and untypeable in the UI. They are typed
// JSON fields now; this module is the only bridge between the typed field and
// the environment variable the Node modules and the C backend still read.
//
//   normalizeLegacySemanticEnv()  server.env string  -> typed JSON field
//   buildDs4SemanticEnv()         resolved boolean   -> "1" / "0" for the child
//
// Neither direction invents a default: defaults live in defaultConfig.mjs and,
// for the native side, in ds4_agent.c / ds4_agent_runtime.c.

import { SAGE_AUTONOMOUS_ORCHESTRATION_ALIASES } from "./envBoolean.mjs";

/** env key <-> typed path, plus the deprecated spellings still accepted. */
export const SEMANTIC_ENV_BINDINGS = Object.freeze([
  Object.freeze({
    env: "DS4_LEAN_POLICY_AUTO",
    path: Object.freeze(["lean", "policyAuto"]),
    aliases: Object.freeze(["DS4_LEAN_SKILL_AUTO"])
  }),
  Object.freeze({
    env: "DS4_SAGE_POLICY_AUTO",
    path: Object.freeze(["sage", "policyAuto"]),
    aliases: Object.freeze(["DS4_SAGE_SKILL_AUTO"])
  }),
  Object.freeze({
    env: "DS4_LEAN_AUTONOMOUS_ORCHESTRATION",
    path: Object.freeze(["lean", "orchestration", "enabled"]),
    aliases: Object.freeze([])
  }),
  Object.freeze({
    env: "DS4_LEAN_AUTONOMOUS_PROMPT",
    path: Object.freeze(["lean", "orchestration", "prompt"]),
    aliases: Object.freeze([])
  }),
  Object.freeze({
    env: "DS4_SAGE_AUTONOMOUS_ORCHESTRATION",
    path: Object.freeze(["sage", "orchestration", "enabled"]),
    aliases: SAGE_AUTONOMOUS_ORCHESTRATION_ALIASES
  }),
  Object.freeze({
    env: "DS4_SAGE_AUTONOMOUS_PROMPT",
    path: Object.freeze(["sage", "orchestration", "prompt"]),
    aliases: Object.freeze([])
  })
]);

/** Every spelling that must no longer be stored in `server.env`. */
export const LEGACY_SEMANTIC_ENV_KEYS = Object.freeze(
  new Set(SEMANTIC_ENV_BINDINGS.flatMap((b) => [b.env, ...b.aliases]))
);

const TRUE_TEXT = new Set(["1", "true", "yes", "on"]);
const FALSE_TEXT = new Set(["0", "false", "no", "off"]);

/**
 * Parse a dotenv-style boolean.
 *
 * @returns {boolean|null} null when the text is not a recognised boolean, so a
 *   typo stays visible to validateConfig instead of collapsing onto a default.
 */
export function parseBooleanText(value) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (TRUE_TEXT.has(normalized)) return true;
  if (FALSE_TEXT.has(normalized)) return false;
  return null;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function cloneMigrationPaths(input) {
  const out = { ...input };
  if (isPlainObject(input.server)) {
    out.server = { ...input.server };
    if (isPlainObject(input.server.env)) out.server.env = { ...input.server.env };
  }
  for (const key of ["lean", "sage"]) {
    if (!isPlainObject(input[key])) continue;
    out[key] = { ...input[key] };
    if (isPlainObject(input[key].orchestration)) {
      out[key].orchestration = { ...input[key].orchestration };
    }
  }
  return out;
}

function readPath(source, path) {
  let node = source;
  for (const key of path) {
    if (!isPlainObject(node)) return undefined;
    node = node[key];
  }
  return node;
}

function writePath(target, path, value) {
  let node = target;
  for (const key of path.slice(0, -1)) {
    if (!isPlainObject(node[key])) node[key] = {};
    node = node[key];
  }
  node[path.at(-1)] = value;
}

/**
 * Move the six legacy `server.env` switches onto their typed fields.
 *
 * Precedence: an explicit typed field wins over `server.env`, and the canonical
 * env key wins over its deprecated aliases. A value that is not a boolean is
 * left in `server.env` on purpose when no typed field covers it — that is what
 * lets validateConfig reject it instead of silently defaulting.
 *
 * @param {object} [input] - raw config object; never mutated.
 * @returns {object} a clone with the migration applied.
 */
export function normalizeLegacySemanticEnv(input = {}) {
  if (!isPlainObject(input)) return input;
  const out = cloneMigrationPaths(input);
  const serverEnv = isPlainObject(out.server?.env) ? out.server.env : null;
  if (!serverEnv) return out;

  for (const binding of SEMANTIC_ENV_BINDINGS) {
    const present = [binding.env, ...binding.aliases].filter((key) =>
      Object.prototype.hasOwnProperty.call(serverEnv, key)
    );
    if (present.length === 0) continue;

    const typed = readPath(out, binding.path);
    if (typeof typed === "boolean") {
      for (const key of present) delete serverEnv[key];
      continue;
    }

    const parsed = parseBooleanText(serverEnv[present[0]]);
    if (parsed === null) continue; // stays visible to validateConfig
    writePath(out, binding.path, parsed);
    for (const key of present) delete serverEnv[key];
  }
  return out;
}

/**
 * Translate the resolved runtime config into the six environment variables the
 * Node modules and the C backend read. Booleans must already be resolved: this
 * is a translator, not another layer of the precedence chain.
 *
 * @param {object} config - a resolved config with lean/sage blocks.
 * @returns {Record<string, "0"|"1">} always the same six keys.
 */
export function buildDs4SemanticEnv(config = {}) {
  const env = {};
  for (const binding of SEMANTIC_ENV_BINDINGS) {
    const value = readPath(config, binding.path);
    if (typeof value !== "boolean") {
      throw new TypeError(
        `buildDs4SemanticEnv: ${binding.path.join(".")} must be a resolved boolean`
      );
    }
    env[binding.env] = value ? "1" : "0";
  }
  return env;
}

/**
 * Translate the resolved epistemic block into the environment variable the C
 * backend reads. `enabled=false` always forces "off": the effective native
 * mode is `enabled ? mode : "off"`, never the raw configured mode.
 *
 * @param {object} config - a resolved config with an agent.epistemic block.
 * @returns {{DS4_EPISTEMIC_MODE: "off"|"shadow"|"block", DS4_EPISTEMIC_MAX_REPAIR_ROUNDS: string}}
 */
export function buildDs4EpistemicEnv(config = {}) {
  const epistemic = config?.agent?.epistemic;

  if (!epistemic || typeof epistemic !== "object") {
    throw new TypeError(
      "buildDs4EpistemicEnv: config.agent.epistemic must be a resolved object"
    );
  }

  if (typeof epistemic.enabled !== "boolean") {
    throw new TypeError(
      "buildDs4EpistemicEnv: agent.epistemic.enabled must be boolean"
    );
  }

  const configuredMode = String(epistemic.mode ?? "");

  if (!["off", "shadow", "block"].includes(configuredMode)) {
    throw new TypeError(
      `buildDs4EpistemicEnv: invalid mode '${configuredMode}'`
    );
  }

  if (
    !Number.isInteger(epistemic.maxRepairRounds) ||
    epistemic.maxRepairRounds < 0 ||
    epistemic.maxRepairRounds > 8
  ) {
    throw new TypeError(
      "buildDs4EpistemicEnv: agent.epistemic.maxRepairRounds must be an integer between 0 and 8"
    );
  }

  const effectiveMode =
    epistemic.enabled === true
      ? configuredMode
      : "off";

  return {
    DS4_EPISTEMIC_MODE: effectiveMode,
    DS4_EPISTEMIC_MAX_REPAIR_ROUNDS: String(epistemic.maxRepairRounds)
  };
}
