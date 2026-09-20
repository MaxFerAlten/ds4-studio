// Lean 4 diagnostic parsing for ds4-studio
// Parses Lean's own output (stdout carries elaboration diagnostics, stderr
// carries toolchain/Lake failures) into structured diagnostics.

import { LEAN_MAX_DIAGNOSTICS } from "./leanConstants.mjs";

// Lean 4 (verified against v4.32.2) prints one header line per diagnostic:
//
//   Main.lean:3:17: error: type mismatch
//   ./Main.lean:3:17-3:22: warning: unused variable `x`
//   /work/Main.lean:1:0: information: 42
//
// The path prefix varies with how the file was passed to lean/lake, the end
// position is only present for ranged messages, and Lean 4.32 emits
// `information:` where older releases emitted `info:`. Every following line
// that is not itself a header belongs to the message body and keeps its
// indentation, which is load-bearing in Lean's pretty-printed terms.
const DIAGNOSTIC_HEADER =
  /^.*?Main\.lean:(\d+):(\d+)(?:-(\d+):(\d+))?:\s*(error|warning|info|information):\s*(.*)$/;

/**
 * Parse Lean diagnostics from raw process output.
 *
 * @param {string} text - Raw stdout/stderr text
 * @param {{ maxDiagnostics?: number }} options
 * @returns {{ diagnostics: object[], truncated: boolean }} `truncated` is true
 *   only when a further diagnostic header was actually seen past the cap — the
 *   count reaching the cap on its own proves nothing.
 */
export function parseLeanDiagnostics(text, options = {}) {
  if (!text || typeof text !== "string") return { diagnostics: [], truncated: false };

  const maxDiag = options.maxDiagnostics || LEAN_MAX_DIAGNOSTICS;
  const lines = text.split("\n");
  const diagnostics = [];
  let current = null;
  let truncated = false;

  const flush = () => {
    if (current) {
      current.message = current.message.replace(/\s+$/, "");
      current.raw = current.raw.replace(/\s+$/, "");
      diagnostics.push(current);
    }
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (line.length === 0) {
      // Lean separates the paragraphs of one message with blank lines (the
      // unusedVariables linter does exactly this), so a blank line inside a
      // diagnostic is content, not a terminator. Outside one it is noise.
      // ponytail: a message runs until the next header — untagged output such
      // as `#eval` results therefore lands in the previous message. Upgrade
      // path if that ever matters: run lean with `--json` and parse records.
      if (current) {
        current.message += "\n";
        current.raw += "\n";
      }
      continue;
    }

    const match = line.match(DIAGNOSTIC_HEADER);
    if (match) {
      if (diagnostics.length + (current ? 1 : 0) >= maxDiag) {
        // One more diagnostic existed: that — not the count — is the proof of
        // truncation. Stop here; the rest of the output is more of the same.
        truncated = true;
        break;
      }
      flush();
      current = {
        severity: match[5] === "information" ? "info" : match[5],
        file: "Main.lean",
        line: parseInt(match[1], 10),
        column: parseInt(match[2], 10),
        endLine: match[3] !== undefined ? parseInt(match[3], 10) : null,
        endColumn: match[4] !== undefined ? parseInt(match[4], 10) : null,
        message: match[6].trim(),
        raw: line.trim(),
      };
    } else if (current) {
      // Continuation: keep the original indentation, Lean uses it to align
      // pretty-printed terms and expected/actual types.
      current.message += "\n" + line;
      current.raw += "\n" + line;
    }
  }

  flush();

  return { diagnostics, truncated };
}

/**
 * Summarize a finished run into one deterministic sentence.
 *
 * Every terminal status produces a non-empty summary: an empty summary reaches
 * the model as "nothing happened", which is exactly wrong for a timeout or a
 * cancellation (§R9).
 *
 * @param {object[]} diagnostics - Parsed diagnostics
 * @param {string} status - Result status
 * @param {{ timeoutSec?: number, exitCode?: number|null }} [context]
 * @returns {string}
 */
export function summarizeLeanDiagnostics(diagnostics, status, context = {}) {
  const list = Array.isArray(diagnostics) ? diagnostics : [];
  const errors = list.filter((d) => d.severity === "error");
  const warnings = list.filter((d) => d.severity === "warning");

  if (status === "timeout") {
    const budget = context.timeoutSec;
    return budget ? `Lean elaboration exceeded ${budget}s.` : "Lean elaboration exceeded its time budget.";
  }
  if (status === "cancelled") {
    return "Lean elaboration was cancelled.";
  }
  if (status === "checked") {
    if (warnings.length > 0) {
      return `Lean elaboration completed without errors (${count(warnings.length, "warning")}).`;
    }
    return "Lean elaboration completed without errors.";
  }

  if (errors.length === 0 && warnings.length === 0) {
    const exit = context.exitCode;
    return exit === null || exit === undefined
      ? "Lean elaboration failed without parseable diagnostics."
      : `Lean elaboration failed (exit ${exit}) without parseable diagnostics.`;
  }

  let summary = `Lean elaboration failed with ${count(errors.length, "error")}`;
  if (warnings.length > 0) summary += ` and ${count(warnings.length, "warning")}`;
  return summary + ".";
}

function count(n, noun) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

// Placeholder tokens. `axiom` is deliberately not one of them: declaring an
// axiom is an explicit, visible choice, not an unfinished proof like `sorry`.
// It is still reported as evidence so an operator can see it (§6.19).
const PLACEHOLDER_TOKENS = [
  { re: /\bsorry\b/g, type: "keyword", placeholder: true },
  { re: /\badmit\b/g, type: "keyword", placeholder: true },
  { re: /\bset_option\s+warn\.sorry\s+false\b/g, type: "option", placeholder: true },
  { re: /\baxiom\b/g, type: "axiom", placeholder: false },
];

/**
 * Detect placeholders in Lean source code.
 *
 * Scans the source once, blanking string literals, character literals, line
 * comments and *nested* block comments before matching tokens. The single-pass
 * scanner replaces the previous regex pipeline, which could not track block
 * comment nesting (`/- /- -/ -/` left the tail exposed) and mistook the prime
 * in identifiers like `h'` for a character literal.
 *
 * @param {string} source - Lean source code
 * @returns {{ containsPlaceholders: boolean, evidence: object[] }} evidence
 *   entries are `{ type, keyword, index, line }`; `containsPlaceholders` is
 *   true only for genuine placeholders, never for `axiom`.
 */
export function detectLeanPlaceholders(source) {
  if (!source || typeof source !== "string") {
    return { containsPlaceholders: false, evidence: [] };
  }

  const cleaned = blankCommentsAndLiterals(source);
  const evidence = [];

  for (const token of PLACEHOLDER_TOKENS) {
    token.re.lastIndex = 0;
    let m;
    while ((m = token.re.exec(cleaned)) !== null) {
      evidence.push({
        type: token.type,
        keyword: m[0].replace(/\s+/g, " "),
        index: m.index,
        line: lineOf(source, m.index),
        placeholder: token.placeholder,
      });
      if (token.re.lastIndex === m.index) token.re.lastIndex += 1;
    }
  }

  evidence.sort((a, b) => a.index - b.index);

  return {
    containsPlaceholders: evidence.some((e) => e.placeholder),
    evidence,
  };
}

// Declaration heads Lean accepts at the top level. `example` is deliberately
// absent: it declares nothing nameable.
const DECLARATION_HEAD =
  /\b(theorem|lemma|def|abbrev|instance|structure|inductive|axiom|opaque)\s+([A-Za-z_][A-Za-z0-9_.']*)/g;

/**
 * Collect the declaration names a source file introduces.
 *
 * ponytail: syntactic scan of the (comment- and literal-blanked) source. It is
 * sound enough to answer "did the model declare what it promised", because the
 * caller only trusts it for a source Lean has already elaborated without
 * errors. Upgrade path if a stronger claim is ever needed: append
 * `#print axioms <name>` per expected declaration and parse Lean's answer.
 *
 * @param {string} source - Lean source code
 * @returns {string[]} Declared names, in order, deduplicated
 */
export function collectLeanDeclarations(source) {
  if (!source || typeof source !== "string") return [];
  const cleaned = blankCommentsAndLiterals(source);
  const names = [];
  DECLARATION_HEAD.lastIndex = 0;
  let m;
  while ((m = DECLARATION_HEAD.exec(cleaned)) !== null) {
    if (!names.includes(m[2])) names.push(m[2]);
  }
  return names;
}

/**
 * Replace comments and literals with spaces, preserving every offset so
 * evidence indices still point at the real source.
 *
 * @param {string} src
 * @returns {string}
 */
function blankCommentsAndLiterals(src) {
  const out = src.split("");
  const blank = (from, to) => {
    for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
  };

  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);

    if (two === "--") {
      let end = src.indexOf("\n", i);
      if (end === -1) end = src.length;
      blank(i, end);
      i = end;
      continue;
    }

    if (two === "/-") {
      // Block comments nest in Lean; doc comments (`/-- ... -/`) are just
      // block comments that start with an extra dash.
      let depth = 0;
      const start = i;
      while (i < src.length) {
        if (src.slice(i, i + 2) === "/-") {
          depth += 1;
          i += 2;
        } else if (src.slice(i, i + 2) === "-/") {
          depth -= 1;
          i += 2;
          if (depth === 0) break;
        } else {
          i += 1;
        }
      }
      blank(start, i);
      continue;
    }

    if (src[i] === '"') {
      const start = i;
      i += 1;
      while (i < src.length) {
        if (src[i] === "\\") i += 2;
        else if (src[i] === '"') { i += 1; break; }
        else i += 1;
      }
      blank(start, i);
      continue;
    }

    if (src[i] === "'") {
      // A prime is only a character literal when it closes immediately;
      // otherwise it belongs to an identifier such as `h'` or `Nat.succ'`.
      const charLit = /^'(\\[\s\S]|[^'\\])'/.exec(src.slice(i));
      if (charLit) {
        blank(i, i + charLit[0].length);
        i += charLit[0].length;
        continue;
      }
      i += 1;
      continue;
    }

    i += 1;
  }

  return out.join("");
}

/** 1-based line number of a character offset. */
function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) {
    if (src[i] === "\n") line += 1;
  }
  return line;
}
