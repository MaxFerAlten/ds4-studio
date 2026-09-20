// Lean repository immutability (plan §7-§9, §53-§57, §127-§128, §167).
//
// During the Cauchy regression the agent used the repository as scratch space:
// it created tests/fixtures/lean/my_cauchy_mvt*.lean, one of them containing
// `sorry`. A Lean utility request must not leave anything behind.
//
// Blocking `write` and `edit` is not enough — `cat > file`, `tee`, `sed -i`,
// `rm` and friends reach the same filesystem. A read-only bind mount would be
// the robust answer (§54.1), but the agent's bash tool spawns directly rather
// than through a sandbox, so this is the fail-closed command classifier of
// §54.2: known read-only commands pass, everything else is denied. The upgrade
// path is a read-only mount for the whole bash tool, which would make the
// classifier unnecessary.

export const LEAN_REPOSITORY_MUTATION_BLOCKED =
  "LEAN_UTILITY_REPOSITORY_MUTATION_BLOCKED";
export const LEAN_FORBIDDEN_PLACEHOLDER = "LEAN_FORBIDDEN_PLACEHOLDER";

const MUTATING_TOOLS = new Set(["write", "edit"]);

/** Commands that only read. Anything absent from this set is denied. */
const READ_ONLY_COMMANDS = new Set([
  "awk", "basename", "cat", "cd", "column", "comm", "cut", "date", "diff",
  "dirname", "du", "echo", "env", "file", "find", "fgrep", "grep", "head",
  "jq", "less", "ls", "md5sum", "nl", "od", "printf", "pwd", "readlink",
  "realpath", "rg", "sed", "sha256sum", "sort", "stat", "tail", "tr", "true",
  "type", "uniq", "wc", "which", "xxd", "yes"
]);

/** git subcommands that only read. */
const READ_ONLY_GIT = new Set([
  "blame", "branch", "cat-file", "config", "diff", "grep", "log", "ls-files",
  "ls-tree", "rev-parse", "shortlog", "show", "status", "tag"
]);

/** Redirections that write to a discard sink or to another fd, not to a file. */
const HARMLESS_REDIRECTS = [
  />\s*\/dev\/null/g,
  />\s*&\s*\d/g,
  /\d\s*>\s*&\s*\d/g
];

const PLACEHOLDER_PATTERN = /(^|[^A-Za-z0-9_.])(sorry|admit)(?![A-Za-z0-9_])/;

/** True when the source carries a placeholder that must never be persisted. */
export function containsForbiddenPlaceholder(source) {
  const text = String(source ?? "");
  if (/\bby\?/.test(text)) return true;
  return PLACEHOLDER_PATTERN.test(text);
}

function stripQuoted(command) {
  return command.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
}

function hasFileRedirect(segment) {
  let rest = segment;
  for (const pattern of HARMLESS_REDIRECTS) rest = rest.replace(pattern, "");
  return />/.test(rest);
}

function commandHeadIsReadOnly(segment) {
  const words = segment.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  // Skip leading VAR=value assignments and common prefixes.
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
  if (i >= words.length) return true;
  const head = words[i].replace(/^.*\//, "");

  if (head === "git") {
    const sub = words.slice(i + 1).find((w) => !w.startsWith("-"));
    return Boolean(sub) && READ_ONLY_GIT.has(sub);
  }
  if (head === "sed") {
    // sed -n is a reader; sed -i rewrites in place.
    return !words.slice(i + 1).some((w) => /^-[a-zA-Z]*i/.test(w));
  }
  return READ_ONLY_COMMANDS.has(head);
}

/** True when the shell command only reads. Fail-closed on anything unknown. */
export function bashCommandIsReadOnly(command) {
  const text = stripQuoted(String(command ?? ""));
  if (!text.trim()) return true;
  // Command substitution can hide anything; do not try to out-parse a shell.
  if (/\$\(|`/.test(text)) return false;
  const segments = text.split(/\|\||&&|[;|\n]/);
  for (const segment of segments) {
    if (hasFileRedirect(segment)) return false;
    if (!commandHeadIsReadOnly(segment)) return false;
  }
  return true;
}

/**
 * Decide whether a tool call may touch the repository.
 *
 * @param {string} name - tool name
 * @param {object} args - tool arguments
 * @param {{ leanRepositoryMutationBlocked?: boolean }} options
 * @returns {{ blocked: false } | { blocked: true, code: string, message: string }}
 */
export function classifyRepositoryMutation(name, args = {}, options = {}) {
  // §9 — a placeholder-bearing .lean file must never be persisted, Lean turn
  // or not. A fixture committed by a developer is a different thing from a
  // scratch file the agent drops mid-task (§235).
  if (name === "write" || name === "edit") {
    const target = String(args?.path ?? args?.file ?? args?.filename ?? "");
    const body = name === "write" ? args?.content : args?.new;
    if (target.endsWith(".lean") && containsForbiddenPlaceholder(body)) {
      return {
        blocked: true,
        code: LEAN_FORBIDDEN_PLACEHOLDER,
        message:
          "Refusing to persist a Lean source containing 'sorry'/'admit'/'by?'. " +
          "An incomplete candidate is transient: pass it to lean_check directly " +
          "instead of writing it to the repository."
      };
    }
  }

  if (!options.leanRepositoryMutationBlocked) return { blocked: false };

  if (MUTATING_TOOLS.has(name)) {
    return {
      blocked: true,
      code: LEAN_REPOSITORY_MUTATION_BLOCKED,
      message:
        `Tool '${name}' is blocked while a Lean task is active: this task did not ` +
        "ask for repository changes. Pass the source to lean_check(code=...) " +
        "directly — do not create scratch files under the workspace."
    };
  }

  if (name === "bash" && !bashCommandIsReadOnly(args?.command)) {
    return {
      blocked: true,
      code: LEAN_REPOSITORY_MUTATION_BLOCKED,
      message:
        "This shell command can modify the workspace, and a Lean task that was " +
        "not asked to change the repository may not do so. Read-only discovery " +
        "(grep, rg, find, cat, sed -n, head, tail, ls) is allowed; pass proof " +
        "candidates to lean_check(code=...) instead of writing files."
    };
  }

  return { blocked: false };
}
