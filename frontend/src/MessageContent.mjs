import { createElement } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

function replaceBracedCommand(content, command, render) {
  const marker = `\\${command}`;
  let cursor = 0;
  let output = "";

  while (cursor < content.length) {
    const commandIndex = content.indexOf(marker, cursor);
    if (commandIndex === -1) {
      output += content.slice(cursor);
      break;
    }

    const markerEnd = commandIndex + marker.length;
    if (/[A-Za-z]/.test(content[markerEnd] || "")) {
      output += content.slice(cursor, markerEnd);
      cursor = markerEnd;
      continue;
    }

    let braceStart = markerEnd;
    while (/\s/.test(content[braceStart] || "")) braceStart += 1;
    if (content[braceStart] !== "{") {
      output += content.slice(cursor, markerEnd);
      cursor = markerEnd;
      continue;
    }

    let depth = 1;
    let braceEnd = braceStart + 1;
    for (; braceEnd < content.length && depth > 0; braceEnd += 1) {
      if (content[braceEnd] === "\\") {
        braceEnd += 1;
      } else if (content[braceEnd] === "{") {
        depth += 1;
      } else if (content[braceEnd] === "}") {
        depth -= 1;
      }
    }

    if (depth !== 0) {
      output += content.slice(cursor);
      break;
    }

    output += content.slice(cursor, commandIndex);
    output += render(content.slice(braceStart + 1, braceEnd - 1));
    cursor = braceEnd;
  }

  return output;
}

function normalizeLatexLists(content) {
  const listPattern = /\\begin\s*\{(itemize|enumerate)\}([\s\S]*?)\\end\s*\{\1\}/g;
  let previous;

  do {
    previous = content;
    content = content.replace(listPattern, (_, environment, listBody) => {
      const items = listBody
        .split(/\\item\b/)
        .slice(1)
        .map((item) => item.trim().replace(/\s*\n+\s*/g, " "))
        .filter(Boolean);
      const ordered = environment === "enumerate";
      return `\n\n${items.map((item, index) => `${ordered ? `${index + 1}.` : "-"} ${item}`).join("\n")}\n\n`;
    });
  } while (content !== previous);

  return content;
}

function readableReference(label) {
  const value = label.includes(":") ? label.slice(label.indexOf(":") + 1) : label;
  return value.replace(/[-_]+/g, " ");
}

function normalizeLatexDocument(content) {
  const documentClass = /\\documentclass(?:\s*\[[^\]]*\])?\s*\{[^{}]+\}/.exec(content);
  if (!documentClass) return content;

  const afterDocumentClass = documentClass.index + documentClass[0].length;
  const documentStart = /\\begin\s*\{document\}/.exec(content.slice(afterDocumentClass));
  if (!documentStart) return content;

  const beginIndex = afterDocumentClass + documentStart.index;
  const bodyIndex = beginIndex + documentStart[0].length;
  const prefix = content.slice(0, documentClass.index).trim();
  const preamble = content.slice(documentClass.index, beginIndex);
  const documentEnd = /\\end\s*\{document\}/.exec(content.slice(bodyIndex));
  const endIndex = documentEnd ? bodyIndex + documentEnd.index : content.length;
  const suffixIndex = documentEnd ? endIndex + documentEnd[0].length : content.length;
  let body = content.slice(bodyIndex, endIndex);
  const suffix = content.slice(suffixIndex).trim();

  const title = /\\title\s*\{([^{}]*)\}/.exec(preamble)?.[1]?.trim() || "";
  const hasTitle = /\\maketitle\b/.test(body);
  body = body.replace(/\\maketitle\b/g, "");

  const equationReferences = new Map();
  let equationNumber = 0;
  body = body.replace(
    /\\begin\s*\{(equation\*?|displaymath|align\*?|gather\*?|multline\*?)\}([\s\S]*?)\\end\s*\{\1\}/g,
    (_, environment, math) => {
      let expression = math.trim();
      const numbered = environment !== "displaymath" && !environment.endsWith("*");
      if (numbered) equationNumber += 1;
      for (const match of expression.matchAll(/\\label\s*\{([^{}]+)\}/g)) {
        equationReferences.set(match[1], numbered ? String(equationNumber) : readableReference(match[1]));
      }
      expression = expression.replace(/\\label\s*\{[^{}]*\}/g, "").trim();
      if (/^(align|gather|multline)/.test(environment)) {
        expression = `\\begin{aligned}\n${expression}\n\\end{aligned}`;
      }
      return expression ? `\n\n$$\n${expression}\n$$\n\n` : "";
    }
  );

  body = [body, suffix].filter(Boolean).join("\n\n");
  body = normalizeLatexLists(body)
    .replace(/\\subsubsection\*?\s*\{([^{}]*)\}/g, "\n\n#### $1\n\n")
    .replace(/\\subsection\*?\s*\{([^{}]*)\}/g, "\n\n### $1\n\n")
    .replace(/\\section\*?\s*\{([^{}]*)\}/g, "\n\n## $1\n\n")
    .replace(/\\paragraph\*?\s*\{([^{}]*)\}/g, "\n\n**$1**\n\n")
    .replace(/\\eqref\s*\{([^{}]+)\}/g, (_, label) => `(${equationReferences.get(label) || readableReference(label)})`)
    .replace(/\\ref\s*\{([^{}]+)\}/g, (_, label) => equationReferences.get(label) || readableReference(label))
    .replace(/\\label\s*\{[^{}]*\}/g, "")
    .trim();

  body = replaceBracedCommand(body, "textbf", (value) => `**${value}**`);
  body = replaceBracedCommand(body, "textit", (value) => `*${value}*`);
  body = replaceBracedCommand(body, "emph", (value) => `*${value}*`);
  body = replaceBracedCommand(body, "underline", (value) => `_${value}_`);
  body = replaceBracedCommand(body, "texttt", (value) => `\`${value}\``);

  return [
    prefix,
    hasTitle && title ? `# ${title}` : "",
    body
  ].filter(Boolean).join("\n\n");
}

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
    output.push(normalizeTextMath(normalizeLatexDocument(textBuffer.join(""))));
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
