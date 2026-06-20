import { Children, createElement, isValidElement, useEffect, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  canShowMermaidFullscreen,
  MermaidFullscreen
} from "./MermaidFullscreen.mjs";

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];
const markdownComponents = { pre: MarkdownPre };
let mermaidModulePromise;
let mermaidRenderSequence = 0;

function loadMermaid() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import("mermaid").then((module) => {
      const mermaid = module.default || module;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: "dark",
        fontFamily: "inherit",
        flowchart: { useMaxWidth: true }
      });
      return mermaid;
    });
  }
  return mermaidModulePromise;
}

export function markIncompleteMermaidFences(content) {
  if (!content) return "";

  const output = [];
  const lines = content.match(/[^\n]*\n|[^\n]+/g) || [];
  let inFence = false;
  let fenceChar = "";
  let fenceLength = 0;
  let mermaidOpeningIndex = -1;

  for (const rawLine of lines) {
    const line = rawLine.endsWith("\n") ? rawLine.slice(0, -1) : rawLine;

    if (!inFence) {
      const openingFence = line.match(/^[ \t]*(`{3,}|~{3,})\s*([A-Za-z0-9_+-]+)?/);
      if (openingFence) {
        inFence = true;
        fenceChar = openingFence[1][0];
        fenceLength = openingFence[1].length;
        if ((openingFence[2] || "").toLowerCase() === "mermaid") {
          mermaidOpeningIndex = output.length;
        }
      }
      output.push(rawLine);
      continue;
    }

    const closingFence = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
    const closing = Boolean(
      closingFence && closingFence[1][0] === fenceChar && closingFence[1].length >= fenceLength
    );
    output.push(rawLine);
    if (closing) {
      inFence = false;
      mermaidOpeningIndex = -1;
    }
  }

  if (inFence && mermaidOpeningIndex >= 0) {
    output[mermaidOpeningIndex] = output[mermaidOpeningIndex].replace(
      /^([ \t]*(?:`{3,}|~{3,})\s*)mermaid\b/i,
      "$1mermaid-incomplete"
    );
  }

  return output.join("");
}

function MermaidDiagram({ source, complete }) {
  const reactId = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const [showSource, setShowSource] = useState(false);
  const [renderState, setRenderState] = useState({
    status: complete ? "pending" : "generating",
    svg: "",
    error: ""
  });

  useEffect(() => {
    let cancelled = false;
    setShowSource(false);

    if (!complete) {
      setRenderState({ status: "generating", svg: "", error: "" });
      return () => {
        cancelled = true;
      };
    }

    const definition = String(source || "").trim();
    setRenderState({ status: "pending", svg: "", error: "" });

    if (!definition) {
      setRenderState({
        status: "error",
        svg: "",
        error: "Il blocco Mermaid è vuoto."
      });
      return () => {
        cancelled = true;
      };
    }

    const diagramId = `ds4-mermaid-${reactId}-${++mermaidRenderSequence}`;
    loadMermaid()
      .then((mermaid) => mermaid.render(diagramId, definition))
      .then(({ svg }) => {
        if (!cancelled) setRenderState({ status: "ready", svg, error: "" });
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error && error.message
          ? error.message.split("\n", 1)[0]
          : "Sintassi Mermaid non valida.";
        setRenderState({ status: "error", svg: "", error: message });
      });

    return () => {
      cancelled = true;
    };
  }, [complete, source]);

  const children = [];
  if (showSource) {
    children.push(
      createElement(
        "pre",
        { className: "mermaid-diagram-source", key: "source" },
        createElement("code", null, source)
      )
    );
  } else if (renderState.status === "ready") {
    children.push(
      createElement("div", {
        className: "mermaid-diagram-svg",
        dangerouslySetInnerHTML: { __html: renderState.svg },
        key: "svg"
      })
    );
  } else {
    children.push(
      createElement(
        "div",
        { className: "mermaid-diagram-status", key: "status" },
        renderState.status === "generating"
          ? "Diagramma in generazione..."
          : renderState.status === "error"
            ? `Diagramma Mermaid non valido: ${renderState.error}`
            : "Rendering diagramma Mermaid..."
      )
    );
    if (renderState.status === "error") {
      children.push(
        createElement(
          "pre",
          { className: "mermaid-diagram-source", key: "source" },
          createElement("code", null, source)
        )
      );
    }
  }

  if (complete) {
    const actions = [
      createElement(
        "button",
        {
          "aria-label": showSource ? "Mostra diagramma Mermaid" : "Mostra sorgente Mermaid",
          "aria-pressed": showSource,
          className: "mermaid-diagram-toggle",
          key: "toggle",
          onClick: () => setShowSource((current) => !current),
          type: "button"
        },
        showSource ? "Diagramma" : "Testo"
      )
    ];
    if (canShowMermaidFullscreen(renderState.status, showSource)) {
      actions.push(
        createElement(MermaidFullscreen, {
          key: "fullscreen",
          svg: renderState.svg
        })
      );
    }
    children.push(
      createElement(
        "div",
        { className: "mermaid-diagram-actions", key: "actions" },
        actions
      )
    );
  }

  return createElement(
    "div",
    {
      className: "mermaid-diagram",
      "data-state": renderState.status,
      "aria-label": "Diagramma Mermaid"
    },
    children
  );
}

function MarkdownPre({ children, node: _node, ...props }) {
  const items = Children.toArray(children);
  const code = items.length === 1 && isValidElement(items[0]) ? items[0] : null;
  const className = code?.props?.className || "";
  if (/(?:^|\s)language-mermaid-incomplete(?:\s|$)/.test(className)) {
    return createElement(MermaidDiagram, {
      source: String(code.props.children || "").replace(/\n$/, ""),
      complete: false
    });
  }
  if (/(?:^|\s)language-mermaid(?:\s|$)/.test(className)) {
    return createElement(MermaidDiagram, {
      source: String(code.props.children || "").replace(/\n$/, ""),
      complete: true
    });
  }
  return createElement("pre", props, children);
}

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

function fencedCodeBlock(content, language = "") {
  const raw = String(content || "").replace(/\n+$/g, "");
  const longest = Math.max(3, ...Array.from(raw.matchAll(/`+/g), (match) => match[0].length + 1));
  const fence = "`".repeat(longest);
  return `${fence}${language}\n${raw}\n${fence}`;
}

function latexListingLanguage(environment, options = "") {
  if (environment !== "lstlisting") return "";
  if (/python/i.test(options)) return "python";
  return "";
}

function normalizeLatexCodeListings(content) {
  return content.replace(
    /\\begin\s*\{(verbatim|lstlisting)\}(\s*\[[^\]]*\])?([\s\S]*?)\\end\s*\{\1\}/g,
    (_match, environment, options, body) =>
      `\n\n${fencedCodeBlock(body.replace(/^\n/, ""), latexListingLanguage(environment, options))}\n\n`
  );
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

  body = normalizeLatexCodeListings(body);
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
    createElement(
      ReactMarkdown,
      { remarkPlugins, rehypePlugins, components: markdownComponents },
      normalizeMathDelimiters(markIncompleteMermaidFences(content))
    )
  );
}
