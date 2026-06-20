// Export a completed research session to Markdown, HTML, or PDF.
// The markdown is the report the reporter produced (citations already
// appended by formatCitations); export only frames it with a small
// header and, for HTML/PDF, a minimal renderer.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { normalizeObsidianMath } from "../../src/obsidianMath.mjs";
import { latexToMarkdown, prepareTexForCompile, relaxTexForCompat } from "./prismResearchClient.mjs";

// Prism stores the paper as a captured `.tex` artifact (plus sibling code
// files). When present, re-derive the report from it so the export reflects the
// current LaTeX->Markdown conversion instead of a possibly stale finalReport.
function texArtifact(state) {
  const artifacts = Array.isArray(state?.artifacts) ? state.artifacts : [];
  return artifacts.find(
    (a) => a?.filePath && a.filePath.endsWith(".tex") && typeof a.content === "string"
  ) || null;
}

function reportMarkdown(state) {
  const tex = texArtifact(state);
  if (tex) return latexToMarkdown(tex.content, { artifacts: state.artifacts });
  return state.finalReport || "_(no report produced)_";
}

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
  const body = normalizeObsidianMath(reportMarkdown(state));
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
  const bodyHtml = markdownToHtml(reportMarkdown(state));
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

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TMP_DIR = path.join(PROJECT_ROOT, "data", "tmp");

async function ensureTmpDir() {
  await fs.mkdir(TMP_DIR, { recursive: true });
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stderr = "";
    let stdout = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${(stderr || stdout).trim().slice(0, 500)}`));
    });
  });
}

// Compile the captured `.tex` (and its sibling code artifacts) with pdflatex —
// this reproduces prism's real paper with proper math rendering. Two passes so
// hyperref/refs resolve. Throws if pdflatex is missing or compilation fails, so
// callers can fall back to the markdown renderer.
async function compileTexToPdf(state, tex, { pdflatexPath = "pdflatex" } = {}) {
  await ensureTmpDir();
  const buildDir = await fs.mkdtemp(path.join(TMP_DIR, "tex-"));
  const mainName = path.basename(tex.filePath) || "main.tex";
  try {
    for (const artifact of state.artifacts || []) {
      if (!artifact?.filePath || typeof artifact.content !== "string") continue;
      if (artifact.filePath === tex.filePath) continue;
      const dest = path.join(buildDir, artifact.filePath);
      if (!dest.startsWith(buildDir + path.sep)) continue; // guard against path escape
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, artifact.content, "utf-8");
    }
    const prepared = prepareTexForCompile(tex.content, state.artifacts);
    const args = ["-interaction=nonstopmode", "-halt-on-error", mainName];
    const pdfPath = path.join(buildDir, mainName.replace(/\.tex$/, ".pdf"));
    const compile = async (source) => {
      await fs.writeFile(path.join(buildDir, mainName), source, "utf-8");
      for (let pass = 0; pass < 2; pass++) {
        await runProcess(pdflatexPath, args, { cwd: buildDir });
      }
      const pdf = await fs.readFile(pdfPath);
      if (!pdf.length) throw new Error("pdflatex produced an empty PDF");
      return pdf;
    };
    try {
      return await compile(prepared);
    } catch {
      // Retry once with babel dropped — the usual blocker on a minimal TeX
      // install is a missing language pack (e.g. babel-italian).
      await fs.rm(pdfPath, { force: true });
      return await compile(relaxTexForCompat(prepared));
    }
  } finally {
    await fs.rm(buildDir, { recursive: true, force: true });
  }
}

export async function exportPdf(state, { wkhtmltopdfPath = "wkhtmltopdf", pdflatexPath = "pdflatex" } = {}) {
  const tex = texArtifact(state);
  if (tex) {
    try {
      return await compileTexToPdf(state, tex, { pdflatexPath });
    } catch {
      // pdflatex unavailable or the captured .tex won't compile — fall back to
      // rendering the markdown report below so the export never hard-fails.
    }
  }
  await ensureTmpDir();
  const html = exportHtml(state);
  const tmpHtml = path.join(TMP_DIR, `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`);
  const tmpPdf = tmpHtml.replace(/\.html$/, ".pdf");
  try {
    await fs.writeFile(tmpHtml, html, "utf-8");
    await new Promise((resolve, reject) => {
      const child = spawn(wkhtmltopdfPath, [
        "--encoding", "UTF-8",
        "--no-outline",
        "--margin-top", "15mm",
        "--margin-bottom", "15mm",
        "--margin-left", "18mm",
        "--margin-right", "18mm",
        tmpHtml,
        tmpPdf
      ]);
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", (err) => reject(err));
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`wkhtmltopdf exited ${code}: ${stderr.trim().slice(0, 500)}`));
      });
    });
    return fs.readFile(tmpPdf);
  } finally {
    await fs.rm(tmpHtml, { force: true });
    await fs.rm(tmpPdf, { force: true });
  }
}

export async function exportSession(state, format = "md") {
  if (format === "md" || format === "markdown") {
    return { contentType: "text/markdown; charset=utf-8", ext: "md", body: exportMarkdown(state) };
  }
  if (format === "html") {
    return { contentType: "text/html; charset=utf-8", ext: "html", body: exportHtml(state) };
  }
  if (format === "pdf") {
    const body = await exportPdf(state);
    return { contentType: "application/pdf", ext: "pdf", body };
  }
  throw Object.assign(new Error(`unsupported export format: ${format}`), { status: 400 });
}
