import { createElement } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

function normalizeMathBody(math) {
  return math.trim().replace(/\|/g, "\\vert ");
}

function normalizeTextMath(segment) {
  const withBackslashDisplayMath = segment.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
    const body = normalizeMathBody(math);
    return body ? `\n\n$$\n${body}\n$$\n\n` : "";
  });

  const withBackslashInlineMath = withBackslashDisplayMath.replace(
    /\\\(([\s\S]*?)\\\)/g,
    (_, math) => `$${normalizeMathBody(math)}$`
  );

  const withDollarDisplayMath = withBackslashInlineMath.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    const body = normalizeMathBody(math);
    return body ? `\n\n$$\n${body}\n$$\n\n` : "";
  });

  const withDollarInlineMath = withDollarDisplayMath.replace(/(^|[^$])\$([^$\n]+?)\$(?!\$)/g, (_, prefix, math) => {
    const body = normalizeMathBody(math);
    return body ? `${prefix}$${body}$` : `${prefix}$$`;
  });

  return withDollarInlineMath.replace(/\n{3,}/g, "\n\n");
}

const MATH_FENCE_LANGS = new Set(["latex", "tex", "math", "katex"]);
const MATH_DELIM_RE = /\\\[|\\\(|\$\$|(^|[^$])\$[^$\n]+\$/;

export function normalizeMathDelimiters(content) {
  if (!content) return "";

  const output = [];
  const textBuffer = [];
  const lines = content.match(/[^\n]*\n|[^\n]+/g) || [];
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
  return output.join("");
}

export function MessageContent({ content }) {
  return createElement(
    "div",
    { className: "message-content" },
    createElement(ReactMarkdown, { remarkPlugins, rehypePlugins }, normalizeMathDelimiters(content))
  );
}
