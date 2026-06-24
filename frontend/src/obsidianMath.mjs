// KaTeX renders bare `<` and `>` as relation operators, but Obsidian's
// markdown/HTML pass mangles them before math rendering (`x<3` looks like an
// HTML tag opener), so the formula breaks in the vault even though it renders
// in DS4 Studio. Rewrite them to the explicit \lt / \gt commands and collapse
// optional \\[..] row spacing that some renderers flag. The rendered math is
// identical, just portable across both renderers.
// Known limitation: a literal `<`/`>` inside \text{...} is also rewritten; this
// is rare in practice and the agent doctrine emits relations in math mode.
function normalizeMathOperators(math) {
  return math
    .replace(/\\\\\[[^\]\n]*\]/g, "\\\\")
    .replace(/<=/g, "\\le ")
    .replace(/>=/g, "\\ge ")
    .replace(/</g, "\\lt ")
    .replace(/>/g, "\\gt ");
}

// Display math (\[...\], $$...$$, ```latex fences) is a block-level construct so
// its pipes cannot collide with GFM table column separators. Escaping `|` to
// \vert here would corrupt KaTeX environments like \begin{array}{c|c|c} or
// \left|...\right|, which require the literal `|` character.
function normalizeDisplayMathBody(math) {
  return normalizeMathOperators(math.trim());
}

// Inline math ($...$, \(...\)) may live inside GFM table cells, where an
// unescaped `|` would split the cell. Using \vert keeps the rendering identical
// while keeping the markdown table-safe.
function normalizeInlineMathBody(math) {
  return normalizeMathOperators(math.trim()).replace(/\|/g, "\\vert ");
}

function normalizeTextMath(segment) {
  const withDisplayMath = segment.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
    const body = normalizeDisplayMathBody(math);
    return body ? `\n\n$$\n${body}\n$$\n\n` : "";
  });
  const withInlineMath = withDisplayMath.replace(
    /\\\(([\s\S]*?)\\\)/g,
    (_, math) => `$${normalizeInlineMathBody(math)}$`
  );
  const withDollarDisplayMath = withInlineMath.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    const body = normalizeDisplayMathBody(math);
    return body ? `\n\n$$\n${body}\n$$\n\n` : "";
  });
  const withDollarInlineMath = withDollarDisplayMath.replace(
    /(^|[^$])\$([^$\n]+?)\$(?!\$)/g,
    (_, prefix, math) => {
      const body = normalizeInlineMathBody(math);
      return body ? `${prefix}$${body}$` : `${prefix}$$`;
    }
  );
  return withDollarInlineMath.replace(/\n{3,}/g, "\n\n");
}

const MATH_FENCE_LANGS = new Set(["latex", "tex", "math", "katex"]);
const MATH_DELIM_RE = /\\\[|\\\(|\$\$|(^|[^$])\$[^$\n]+\$/;

export function normalizeObsidianMath(content) {
  if (!content) return "";

  const output = [];
  const textBuffer = [];
  const lines = String(content).match(/[^\n]*\n|[^\n]+/g) || [];
  let inFence = false;
  let fenceChar = "";
  let fenceLength = 0;
  let fenceIsMath = false;
  let mathFenceBody = [];

  function flushText() {
    if (!textBuffer.length) return;
    output.push(normalizeTextMath(textBuffer.join("")));
    textBuffer.length = 0;
  }

  function emitMathFenceBody() {
    const body = mathFenceBody.join("");
    mathFenceBody = [];
    if (!body.trim()) return;
    if (MATH_DELIM_RE.test(body)) {
      textBuffer.push(body);
      textBuffer.push("\n");
    } else {
      textBuffer.push(`\n\n$$\n${body.replace(/\n+$/, "")}\n$$\n\n`);
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.endsWith("\n") ? rawLine.slice(0, -1) : rawLine;
    const openingFence = line.match(/^[ \t]*(`{3,}|~{3,})\s*([A-Za-z0-9_+-]+)?/);

    if (!inFence && openingFence) {
      const lang = (openingFence[2] || "").toLowerCase();
      fenceChar = openingFence[1][0];
      fenceLength = openingFence[1].length;
      fenceIsMath = MATH_FENCE_LANGS.has(lang);
      inFence = true;
      if (!fenceIsMath) {
        flushText();
        output.push(rawLine);
      }
      continue;
    }

    if (inFence) {
      const closingFence = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
      const closing = Boolean(
        closingFence && closingFence[1][0] === fenceChar && closingFence[1].length >= fenceLength
      );
      if (fenceIsMath) {
        if (closing) {
          emitMathFenceBody();
          inFence = false;
          fenceIsMath = false;
        } else {
          mathFenceBody.push(rawLine);
        }
      } else {
        output.push(rawLine);
        if (closing) inFence = false;
      }
      continue;
    }

    textBuffer.push(rawLine);
  }

  if (inFence && fenceIsMath) emitMathFenceBody();
  flushText();
  return output.join("").trim();
}
