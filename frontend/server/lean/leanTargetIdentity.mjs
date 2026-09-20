// leanTargetIdentity.mjs — Conservative Lean theorem/lemma target extraction
// and canonical statement fingerprinting.
//
// Fail closed: authoritative proof targets use an explicit `:= by` boundary so
// statement identity never depends on guessing where the proof body begins.
//
// Exports:
//   LEAN_TARGET_IDENTITY_ALGORITHM  — algorithm identifier used in hashing
//   normalizeLeanTargetStatement    — canonical whitespace normalization
//   extractLeanTargetIdentity       — scan source, locate target, hash statement

import { createHash } from "node:crypto";

export const LEAN_TARGET_IDENTITY_ALGORITHM = "lean-target-statement-v1";

// --- Scanner states --------------------------------------------------------

const S_NORMAL = 0;
const S_LINE_COMMENT = 1;
const S_BLOCK_COMMENT = 2;
const S_STRING = 3;
const S_CHAR = 4;

// --- Regex for declaration name validation --------------------------------
const DECL_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.']*$/;

// --- Helpers --------------------------------------------------------------

function isIdentStart(ch) {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentCont(ch) {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9") || ch === "." || ch === "'";
}

// --- Normalize statement text for hashing ---------------------------------

/**
 * Canonicalize a Lean declaration header for fingerprinting.
 *
 * Rules:
 *   - normalize \r\n → \n
 *   - remove comments as whitespace
 *   - compress external whitespace sequences to single space
 *   - preserve byte content of strings and char literals including escapes
 *   - trim leading/trailing whitespace
 *   - do NOT change token order, pretty-print, or math-normalize expressions
 *
 * @param {string} text
 * @returns {{ ok: boolean, value?: string, error?: string }}
 */
export function normalizeLeanTargetStatement(text) {
  if (typeof text !== "string") {
    return { ok: false, error: "LEAN_TARGET_SOURCE_INVALID: input must be a string" };
  }

  const len = text.length;
  const out = [];
  let i = 0;
  let state = S_NORMAL;
  let blockDepth = 0;
  let prevSpace = false;

  // Emit a character unless we are compressing whitespace
  function emit(ch) {
    if (state === S_NORMAL || state === S_STRING || state === S_CHAR) {
      if (ch <= " " && (state === S_NORMAL)) {
        // whitespace in normal mode — compress
        if (!prevSpace) {
          out.push(" ");
          prevSpace = true;
        }
        return;
      }
      prevSpace = false;
      out.push(ch);
    }
    // In comments we simply skip characters (treat as whitespace)
  }

  while (i < len) {
    const ch = text[i];
    const next = i + 1 < len ? text[i + 1] : null;

    switch (state) {
      case S_NORMAL:
        // Lean line comments start with `--`, not `//`
        if (ch === "-" && next === "-") {
          state = S_LINE_COMMENT;
          prevSpace = true; // comment acts as whitespace separator
          i += 2;
          continue;
        }
        // Lean block comments use /- ... -/, not /* ... */
        if (ch === "/" && next === "-") {
          state = S_BLOCK_COMMENT;
          blockDepth = 1;
          prevSpace = true;
          i += 2;
          continue;
        }
        if (ch === '"') {
          state = S_STRING;
          out.push(ch);
          i += 1;
          continue;
        }
        if (ch === "'") {
          state = S_CHAR;
          out.push(ch);
          i += 1;
          continue;
        }
        emit(ch);
        i += 1;
        break;

      case S_LINE_COMMENT:
        if (ch === "\n") {
          state = S_NORMAL;
          prevSpace = true;
          i += 1;
          continue;
        }
        i += 1;
        break;

      case S_BLOCK_COMMENT:
        // Nested open: /- ... /- ... -/
        if (ch === "/" && next === "-") {
          blockDepth++;
          i += 2;
          continue;
        }
        if (ch === "-" && next === "/") {
          blockDepth--;
          if (blockDepth === 0) {
            state = S_NORMAL;
            prevSpace = true;
            i += 2;
            continue;
          }
          i += 2;
          continue;
        }
        // Also accept */- for compatibility with some Lean code
        if (ch === "*" && next === "/") {
          blockDepth--;
          if (blockDepth === 0) {
            state = S_NORMAL;
            prevSpace = true;
            i += 2;
            continue;
          }
          i += 2;
          continue;
        }
        i += 1;
        break;

      case S_STRING:
        out.push(ch);
        if (ch === "\\" && next !== null) {
          // escape sequence — consume next char verbatim
          i += 1;
          out.push(text[i]);
        } else if (ch === '"') {
          state = S_NORMAL;
        }
        i += 1;
        break;

      case S_CHAR:
        out.push(ch);
        if (ch === "\\" && next !== null) {
          i += 1;
          out.push(text[i]);
        } else if (ch === "'") {
          state = S_NORMAL;
        }
        i += 1;
        break;
    }
  }

  let result = out.join("");
  // Trim leading/trailing whitespace
  result = result.trim();

  return { ok: true, value: result };
}

// --- Extract target identity from source ----------------------------------

/**
 * Locate a theorem/lemma declaration in Lean source and produce its statement
 * fingerprint.
 *
 * @param {string} source - Full Lean source text
 * @param {string} targetDeclaration - Exact name of the theorem or lemma
 * @returns {{ ok: true, value: object } | { ok: false, error: object }}
 */
export function extractLeanTargetIdentity(source, targetDeclaration) {
  if (typeof source !== "string" || source.length === 0) {
    return {
      ok: false,
      error: { code: "LEAN_TARGET_SOURCE_INVALID", message: "Source must be a non-empty string." },
    };
  }
  if (!targetDeclaration || typeof targetDeclaration !== "string") {
    return {
      ok: false,
      error: { code: "LEAN_TARGET_DECLARATION_REQUIRED", message: "A target declaration name is required." },
    };
  }
  if (!DECL_NAME_RE.test(targetDeclaration)) {
    return {
      ok: false,
      error: { code: "LEAN_TARGET_DECLARATION_INVALID", message: `Invalid declaration name: ${targetDeclaration}` },
    };
  }

  const len = source.length;
  let i = 0;
  let state = S_NORMAL;
  let blockDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  const candidates = [];
  let line = 1;
  let col = 0;

  // Advance i by n characters, tracking line/col
  function advance(n) {
    for (let j = 0; j < n && i < len; j++) {
      if (source[i] === "\n") { line++; col = 0; } else { col++; }
      i++;
    }
  }

  function scanToEndOfName(startIdx) {
    let end = startIdx;
    while (end < len && isIdentCont(source[end])) end++;
    return end;
  }

  // --- First pass: locate the target declaration ---------------------------
  while (i < len) {
    const ch = source[i];
    const next = i + 1 < len ? source[i + 1] : null;

    switch (state) {
      case S_NORMAL:
        if (ch === "-" && next === "-") { state = S_LINE_COMMENT; i += 2; continue; }
        if (ch === "/" && next === "-") { state = S_BLOCK_COMMENT; blockDepth = 1; i += 2; continue; }
        if (ch === '"') { state = S_STRING; i += 1; continue; }
        if (ch === "'") { state = S_CHAR; i += 1; continue; }

        if (ch === "(") parenDepth++;
        else if (ch === ")") parenDepth--;
        else if (ch === "[") bracketDepth++;
        else if (ch === "]") bracketDepth--;
        else if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;

        // Detect `theorem` or `lemma` keyword at token boundary
        if ((ch === "t" || ch === "l") && col === 0) {
          let kind = null;
          let kwLen = 0;
          if (len - i >= 7 &&
              source[i + 0] === "t" && source[i + 1] === "h" &&
              source[i + 2] === "e" && source[i + 3] === "o" &&
              source[i + 4] === "r" && source[i + 5] === "e" &&
              source[i + 6] === "m" && !isIdentCont(source[i + 7] || "")) {
            kind = "theorem";
            kwLen = 7;
          } else if (len - i >= 5 &&
                     source[i + 0] === "l" && source[i + 1] === "e" &&
                     source[i + 2] === "m" && source[i + 3] === "m" &&
                     source[i + 4] === "a" && !isIdentCont(source[i + 5] || "")) {
            kind = "lemma";
            kwLen = 5;
          }

          if (kind !== null) {
            // Skip whitespace after keyword to find name
            let pos = i + kwLen;
            while (pos < len && source[pos] <= " ") pos++;
            if (pos >= len) { advance(1); continue; }
            const nameStart = pos;
            const nameEnd = scanToEndOfName(nameStart);
            if (nameEnd > nameStart) {
              const name = source.slice(nameStart, nameEnd);
              if (name === targetDeclaration) {
                candidates.push({
                  kind,
                  name,
                  startOffset: i,
                  startLine: line,
                });
              }
            }
            advance(nameEnd - i);
            continue;
          }
        }

        advance(1);
        break;

      case S_LINE_COMMENT:
        if (ch === "\n") { state = S_NORMAL; advance(1); continue; }
        advance(1);
        break;

      case S_BLOCK_COMMENT:
        if (ch === "/" && next === "-") { blockDepth++; advance(2); continue; }
        if (ch === "-" && next === "/") { blockDepth--; if (blockDepth === 0) state = S_NORMAL; advance(2); continue; }
        advance(1);
        break;

      case S_STRING:
        if (ch === "\\" && next !== null) { advance(2); continue; }
        if (ch === '"') { state = S_NORMAL; }
        advance(1);
        break;

      case S_CHAR:
        if (ch === "\\" && next !== null) { advance(2); continue; }
        if (ch === "'") { state = S_NORMAL; }
        advance(1);
        break;
    }
  }

  // Validate candidates
  if (candidates.length === 0) {
    return {
      ok: false,
      error: { code: "LEAN_TARGET_DECLARATION_NOT_FOUND", message: `Declaration '${targetDeclaration}' not found in source.` },
    };
  }

  if (candidates.length > 1) {
    return {
      ok: false,
      error: { code: "LEAN_TARGET_DECLARATION_AMBIGUOUS", message: `Multiple declarations named '${targetDeclaration}'. Use a unique name.` },
    };
  }

  const cand = candidates[0];

  // --- Second pass: find the proof marker `:= by` at top level ------------
  let scanState = S_NORMAL;

  let scanDepth = 0;
  let sparen = 0, sbracket = 0, sbrace = 0;
  let proofMarkerOffset = -1;
  scanLoop:
  for (let pos = cand.startOffset; pos < len; ) {
    const ch2 = source[pos];
    const nx = pos + 1 < len ? source[pos + 1] : null;

    switch (scanState) {
      case S_NORMAL:
        if (ch2 === "-" && nx === "-") { scanState = S_LINE_COMMENT; pos += 2; continue; }
        if (ch2 === "/" && nx === "-") { scanState = S_BLOCK_COMMENT; scanDepth = 1; pos += 2; continue; }
        if (ch2 === '"') { scanState = S_STRING; pos += 1; continue; }
        if (ch2 === "'") { scanState = S_CHAR; pos += 1; continue; }

        if (ch2 === "(") sparen++;
        else if (ch2 === ")") sparen--;
        else if (ch2 === "[") sbracket++;
        else if (ch2 === "]") sbracket--;
        else if (ch2 === "{") sbrace++;
        else if (ch2 === "}") sbrace--;

        // Check for `:=` at top level
        if (sparen === 0 && sbracket === 0 && sbrace === 0 &&
            ch2 === ":" && nx === "=") {
          const afterEq = pos + 2;
          // Skip whitespace/comment before checking for `by`
          let bp = afterEq;
          while (bp < len && source[bp] <= " ") bp++;
          if (bp < len - 1 && source[bp] === "b" && source[bp + 1] === "y" &&
              !isIdentCont(source[bp + 2] || "")) {
            proofMarkerOffset = pos;
            break scanLoop;
          }
          // `:=` found but not followed by `by` — reject
          return {
            ok: false,
            error: { code: "LEAN_TARGET_PROOF_FORM_UNSUPPORTED", message: `Target '${targetDeclaration}' must use ':= by' syntax. Found ':=' without following 'by'.` },
          };
        }

        pos += 1;
        break;

      case S_LINE_COMMENT:
        if (ch2 === "\n") { scanState = S_NORMAL; }
        pos += 1;
        break;

      case S_BLOCK_COMMENT:
        if (ch2 === "/" && nx === "-") { scanDepth++; pos += 2; continue; }
        if (ch2 === "-" && nx === "/") { scanDepth--; if (scanDepth === 0) scanState = S_NORMAL; pos += 2; continue; }
        pos += 1;
        break;

      case S_STRING:
        if (ch2 === "\\" && pos + 1 < len) { pos += 2; continue; }
        if (ch2 === '"') { scanState = S_NORMAL; }
        pos += 1;
        break;

      case S_CHAR:
        if (ch2 === "\\" && pos + 1 < len) { pos += 2; continue; }
        if (ch2 === "'") { scanState = S_NORMAL; }
        pos += 1;
        break;
    }
  }

  // If no proof marker found, reject
  if (proofMarkerOffset < 0) {
    return {
      ok: false,
      error: { code: "LEAN_TARGET_PROOF_FORM_UNSUPPORTED", message: `Target '${targetDeclaration}' has no top-level ':= by' proof marker.` },
    };
  }

  // Extract statement text: from startOffset to proofMarkerOffset
  const statementText = source.slice(cand.startOffset, proofMarkerOffset);

  // Normalize and hash
  const normalized = normalizeLeanTargetStatement(statementText);
  if (!normalized.ok) {
    return {
      ok: false,
      error: { code: "LEAN_TARGET_SOURCE_INVALID", message: normalized.error },
    };
  }

  const hashInput = `${LEAN_TARGET_IDENTITY_ALGORITHM}\n${normalized.value}`;
  const statementSha256 = createHash("sha256").update(hashInput, "utf8").digest("hex");

  return {
    ok: true,
    value: {
      algorithm: LEAN_TARGET_IDENTITY_ALGORITHM,
      kind: cand.kind,
      name: cand.name,
      statementText: normalized.value,
      statementSha256,
      startOffset: cand.startOffset,
      proofMarkerOffset,
      startLine: cand.startLine,
    },
  };
}
