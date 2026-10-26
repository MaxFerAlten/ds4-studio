// Import hints for Lean diagnostics.
//
// A model writing Lean 4 against a pinned Mathlib guesses module names from
// memory, and Mathlib renames modules often: "Mathlib.Algebra.BigOperators.Basic"
// no longer exists, and every wrong guess costs a full Lean call. These hints
// turn the two commonest import failures into the exact fix:
//   - a missing module gets the closest modules that exist in this runtime;
//   - an unknown notation such as `ℝ` gets the module that defines it.
// Every suggestion is checked against the runtime's own .olean tree, so a hint
// can be incomplete but never names a module that does not exist.

import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const IDENTIFIER_MODULES = Object.freeze({
  "ℝ": "Mathlib.Data.Real.Basic",
  "Real": "Mathlib.Data.Real.Basic",
  "ℂ": "Mathlib.Data.Complex.Basic",
  "Complex": "Mathlib.Data.Complex.Basic",
  "ℚ": "Mathlib.Data.Rat.Defs",
  "ℕ": "Mathlib.Data.Nat.Notation",
  "ℤ": "Mathlib.Data.Int.Notation",
  "Finset": "Mathlib.Data.Finset.Basic",
  "Finset.sum": "Mathlib.Algebra.BigOperators.Group.Finset.Basic",
  "Finset.prod": "Mathlib.Algebra.BigOperators.Group.Finset.Basic",
  "Finset.range": "Mathlib.Data.Finset.Basic",
  "Nat.choose": "Mathlib.Data.Nat.Choose.Basic",
  "add_pow": "Mathlib.Data.Nat.Choose.Sum",
  "Real.exp": "Mathlib.Analysis.SpecialFunctions.Exp",
  "Real.log": "Mathlib.Analysis.SpecialFunctions.Log.Basic",
  "Real.sin": "Mathlib.Analysis.SpecialFunctions.Trigonometric.Basic",
  "Real.cos": "Mathlib.Analysis.SpecialFunctions.Trigonometric.Basic",
  "Real.pi": "Mathlib.Analysis.SpecialFunctions.Trigonometric.Basic",
  "Real.sqrt": "Mathlib.Analysis.SpecialFunctions.Pow.Real",
  "deriv": "Mathlib.Analysis.Calculus.Deriv.Basic",
  "Matrix": "Mathlib.Data.Matrix.Basic"
});

// Notation that only parses with its module loaded: Lean reports the token,
// not an identifier, when `∑ x ∈ s, f x` is used without big operators.
const NOTATION_MODULES = Object.freeze([
  ["∑", "Mathlib.Algebra.BigOperators.Group.Finset.Defs"],
  ["∏", "Mathlib.Algebra.BigOperators.Group.Finset.Defs"]
]);

const cache = new Map();

/** Module names of every .olean under the profile's Lake build trees. */
export function listLeanModules(profileDir) {
  if (!profileDir) return new Set();
  if (cache.has(profileDir)) return cache.get(profileDir);
  const modules = new Set();
  const roots = [join(profileDir, ".lake", "build", "lib", "lean")];
  try {
    for (const pkg of readdirSync(join(profileDir, ".lake", "packages"))) {
      roots.push(join(profileDir, ".lake", "packages", pkg, ".lake", "build", "lib", "lean"));
    }
  } catch { /* a core profile has no packages */ }
  const walk = (root, dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(root, path);
      else if (entry.name.endsWith(".olean")) {
        modules.add(relative(root, path).slice(0, -".olean".length).split(sep).join("."));
      }
    }
  };
  for (const root of roots) walk(root, root);
  cache.set(profileDir, modules);
  return modules;
}

/** Up to `limit` existing modules sharing the most path segments with `missing`. */
export function closestModules(missing, modules, limit = 4) {
  const want = String(missing).split(".");
  const last = want.at(-1);
  const scored = [];
  for (const name of modules) {
    const have = name.split(".");
    if (have[0] !== want[0]) continue;
    const shared = want.filter((part) => have.includes(part)).length;
    if (shared < 2) continue;
    const score = shared * 10 + (have.at(-1) === last ? 5 : 0) - Math.abs(have.length - want.length);
    scored.push([score, name]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1])).slice(0, limit).map(([, name]) => name);
}

/**
 * Hint lines for a failed elaboration.
 *
 * @param {object[]} diagnostics - parsed Lean diagnostics
 * @param {{ profileDir?: string, imports?: string[] }} context
 * @returns {string[]}
 */
export function leanImportHints(diagnostics = [], { profileDir, imports = [], code = "" } = {}) {
  // Not an import problem, but the same guess-from-memory failure: current
  // Mathlib removed the `∑ x in s, f x` binder, and the parser only says it
  // expected ','.
  const binderHint = /[∑∏]\s*[^,]*?\sin\s/.test(code) &&
    diagnostics.some((d) => /unexpected token 'in'; expected ','/.test(String(d?.message || "")))
    ? ["IMPORT_HINT: big-operator binders use `∈`, not `in`: write `∑ x ∈ s, f x` (the `in` form was removed from Mathlib)."]
    : [];
  const modules = listLeanModules(profileDir);
  if (!modules.size) return binderHint;
  const imported = new Set(imports);
  const hints = new Set();
  const suggest = (module, why) => {
    if (modules.has(module) && !imported.has(module)) hints.add(`IMPORT_HINT: ${why}: add \`import ${module}\`.`);
  };
  for (const d of diagnostics) {
    const message = String(d?.message || "");
    const missing = /of module (\S+) does not exist/.exec(message)?.[1] ||
      /unknown module prefix '([^']+)'/.exec(message)?.[1];
    if (missing && !modules.has(missing)) {
      const near = closestModules(missing, modules);
      hints.add(near.length
        ? `IMPORT_HINT: module ${missing} does not exist in this Mathlib; closest existing modules: ${near.join(", ")}.`
        : `IMPORT_HINT: module ${missing} does not exist in this Mathlib; use lean_inspect on a symbol to find its module.`);
    }
    const unknown = /Unknown (?:identifier|constant) `([^`]+)`/.exec(message)?.[1];
    if (unknown && IDENTIFIER_MODULES[unknown]) suggest(IDENTIFIER_MODULES[unknown], `\`${unknown}\` is defined in ${IDENTIFIER_MODULES[unknown]}`);
    const token = /unexpected token '([^']+)'/.exec(message)?.[1];
    for (const [symbol, module] of NOTATION_MODULES) {
      if (token === symbol) suggest(module, `the notation ${symbol} is defined in ${module}`);
    }
  }
  return [...binderHint, ...hints];
}
