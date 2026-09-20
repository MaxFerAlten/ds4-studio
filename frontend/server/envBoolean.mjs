const warnedAliases = new Set();

export const SAGE_AUTONOMOUS_ORCHESTRATION_ALIASES = Object.freeze([
  "DS4_SAGE_ORCHESTRATION_V2",
  "DS4_SAGE_V2",
]);

export function envBoolean(value, defaultValue = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off", ""].includes(normalized)) return false;
  return Boolean(defaultValue);
}

export function envBooleanWithAliases({
  env = process.env,
  key,
  aliases = [],
  defaultValue = false,
  onDeprecated = (message) => console.warn(message),
} = {}) {
  if (Object.prototype.hasOwnProperty.call(env, key)) {
    return envBoolean(env[key], defaultValue);
  }
  for (const alias of aliases) {
    if (!Object.prototype.hasOwnProperty.call(env, alias)) continue;
    if (!warnedAliases.has(alias)) {
      warnedAliases.add(alias);
      onDeprecated?.(`${alias} is deprecated; use ${key}`);
    }
    return envBoolean(env[alias], defaultValue);
  }
  return Boolean(defaultValue);
}

export function resetEnvBooleanWarningsForTests() {
  warnedAliases.clear();
}

/**
 * Tri-state parse. Unlike envBoolean() this reports "not a boolean" instead of
 * collapsing onto a default, which is what lets a resolver warn about a typo
 * and fall back to the file layer rather than silently flipping a switch.
 *
 * @returns {boolean|null}
 */
export function parseEnvBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

/**
 * One boolean through the control-plane precedence: env > file > default.
 *
 * Records where the value came from in `sources[key]` and appends deprecation
 * or "not a boolean" notes to `warnings`, the same shape the numeric budget
 * resolvers already produce.
 */
export function resolveBooleanLayer({
  env = process.env,
  envKey,
  aliases = [],
  fileValue,
  defaultValue,
  sources = {},
  key,
  warnings = [],
} = {}) {
  const field = key ?? envKey;
  for (const candidate of [envKey, ...aliases]) {
    const raw = env?.[candidate];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    const parsed = parseEnvBoolean(raw);
    if (parsed === null) {
      warnings.push(`${candidate}='${raw}' is not a boolean; using the config file value`);
      break;
    }
    if (candidate !== envKey && !warnedAliases.has(candidate)) {
      warnedAliases.add(candidate);
      warnings.push(`${candidate} is deprecated; use ${envKey}`);
    }
    sources[field] = "env";
    return parsed;
  }
  if (typeof fileValue === "boolean") {
    sources[field] = "file";
    return fileValue;
  }
  sources[field] = "default";
  return defaultValue;
}
