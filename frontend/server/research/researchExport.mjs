// Export a completed research session to Markdown or a self-contained HTML
// document. PDF is deferred to Phase 2b. The markdown is the report the
// reporter produced (citations already appended by formatCitations); export
// only frames it with a small header and, for HTML, a minimal renderer.

import { normalizeObsidianMath } from "../../src/obsidianMath.mjs";

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inline(text) {
  // Escape first, then apply a tiny inline-markdown subset on the safe text.
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, (_m, b) => `<strong>${b}</strong>`);
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_m, label, href) =>
    `<a href="${escapeHtml(href)}">${label}</a>`
  );
  return out;
}

export function exportMarkdown(state) {
  const title = (state.query || "Deep Research").trim();
  const body = normalizeObsidianMath(state.finalReport || "_(no report produced)_");
  return `<!-- Deep Research export -->\n# ${title}\n\n${body.trim()}\n`;
}

// Minimal, dependency-free markdown -> HTML for the report subset the reporter
// emits: ATX headings, unordered/ordered lists, fenced code, blank-line
// paragraphs, inline code/bold/links. Anything else is rendered as a paragraph.
export function markdownToHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let para = [];
  let list = null; // { tag: "ul" | "ol", items: [] }
  let inCode = false;
  let code = [];

  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((i) => `<li>${inline(i)}</li>`).join("");
      html.push(`<${list.tag}>${items}</${list.tag}>`);
      list = null;
    }
  };

  for (const line of lines) {
    const fence = line.match(/^```/);
    if (fence) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
        inCode = false;
      } else {
        flushPara();
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const ul = line.match(/^\s*[-*]\s+(.+)$/);
    const ol = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ul || ol) {
      flushPara();
      const tag = ul ? "ul" : "ol";
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push((ul || ol)[1]);
      continue;
    }

    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    para.push(line.trim());
  }
  if (inCode) html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  flushPara();
  flushList();
  return html.join("\n");
}

export function exportHtml(state) {
  const title = escapeHtml((state.query || "Deep Research").trim());
  const bodyHtml = markdownToHtml(state.finalReport || "_(no report produced)_");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body { max-width: 760px; margin: 2rem auto; padding: 0 1rem; font: 16px/1.6 system-ui, sans-serif; }
pre { background: #f4f4f4; padding: .8rem; overflow-x: auto; }
code { font-family: ui-monospace, monospace; }
h1, h2, h3 { line-height: 1.25; }
</style>
</head>
<body>
<h1>${title}</h1>
${bodyHtml}
</body>
</html>
`;
}

export function exportSession(state, format = "md") {
  if (format === "md" || format === "markdown") {
    return { contentType: "text/markdown; charset=utf-8", ext: "md", body: exportMarkdown(state) };
  }
  if (format === "html") {
    return { contentType: "text/html; charset=utf-8", ext: "html", body: exportHtml(state) };
  }
  throw Object.assign(new Error(`unsupported export format: ${format}`), { status: 400 });
}
