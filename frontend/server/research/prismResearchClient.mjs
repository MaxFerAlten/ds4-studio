import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CLI_PATH = "prism-pp-cli";
const DEFAULT_COOKIES_ENV = "PRISM_COOKIES";
const DEFAULT_REASONING_EFFORT = "medium";

function durationMs(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function buildCliEnv(env, cookiesEnv) {
  const childEnv = { ...process.env, ...env };
  const sourceName =
    typeof cookiesEnv === "string" && cookiesEnv.trim() ? cookiesEnv.trim() : DEFAULT_COOKIES_ENV;
  if (sourceName !== DEFAULT_COOKIES_ENV && childEnv[sourceName]) {
    childEnv[DEFAULT_COOKIES_ENV] = childEnv[sourceName];
  }
  return childEnv;
}

function normalizeCitation(c) {
  if (!c || typeof c !== "object") return null;
  const url = typeof c.url === "string" ? c.url : "";
  if (!url) return null;
  return { url, title: c.title || url, snippet: c.snippet || "" };
}

function extractCodexContent(diff, status) {
  if (status !== "added" && status !== "modified") return null;
  const lines = diff.split("\n");
  let foundAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^@@/.test(lines[i])) { foundAt = i + 1; break; }
  }
  if (foundAt < 0) return null;
  const content = [];
  for (let i = foundAt; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("+")) {
      content.push(line.slice(1));
    } else if (line.startsWith("-")) {
      continue;
    } else if (/^@@/.test(line)) {
      continue;
    } else if (line.startsWith(" ")) {
      content.push(line.slice(1));
    } else {
      content.push(line);
    }
  }
  return content.join("\n");
}

// Strip LaTeX markup and return readable plain-text / Markdown.
// Handles the most common structural commands so the exported PDF
// looks like a real document rather than raw LaTeX source.
export function latexToMarkdown(tex) {
  let s = tex;

  // Remove preamble (everything up to and including \begin{document})
  s = s.replace(/[\s\S]*?\\begin\{document\}/m, "");
  // Remove \end{document} trailer
  s = s.replace(/\\end\{document\}[\s\S]*/m, "");

  // Environments: abstract → blockquote, verbatim/lstlisting → code fence
  s = s.replace(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/g,
    (_m, body) => `> **Abstract**\n>\n${body.trim().split("\n").map((l) => `> ${l}`).join("\n")}\n`);
  s = s.replace(/\\begin\{(?:verbatim|lstlisting)[^}]*\}([\s\S]*?)\\end\{(?:verbatim|lstlisting)\}/g,
    (_m, body) => `\`\`\`\n${body.trim()}\n\`\`\``);
  // proof, theorem, lemma, corollary, definition → bold label + body
  s = s.replace(/\\begin\{(proof|theorem|lemma|corollary|definition|proposition|remark)\}([\s\S]*?)\\end\{\1\}/gi,
    (_m, env, body) => `**${env.charAt(0).toUpperCase() + env.slice(1).toLowerCase()}:** ${body.trim()}\n`);
  // equation / align / gather / displaymath → code fence
  s = s.replace(/\\begin\{(?:equation\*?|align\*?|gather\*?|displaymath)\}([\s\S]*?)\\end\{(?:equation\*?|align\*?|gather\*?|displaymath)\}/g,
    (_m, body) => `\`\`\`\n${body.trim()}\n\`\`\``);
  // itemize / enumerate → list items
  s = s.replace(/\\begin\{(?:itemize|enumerate)\}([\s\S]*?)\\end\{(?:itemize|enumerate)\}/g,
    (_m, body) => body.replace(/\\item\s*/g, "- ") + "\n");
  // remove remaining environments wrappers
  s = s.replace(/\\(?:begin|end)\{[^}]+\}/g, "");

  // Sections → Markdown headings
  s = s.replace(/\\section\*?\{([^}]+)\}/g, "## $1");
  s = s.replace(/\\subsection\*?\{([^}]+)\}/g, "### $1");
  s = s.replace(/\\subsubsection\*?\{([^}]+)\}/g, "#### $1");

  // Title commands
  s = s.replace(/\\title\{([^}]+)\}/g, "# $1");
  s = s.replace(/\\author\{([^}]+)\}/g, "**Author:** $1");
  s = s.replace(/\\date\{([^}]+)\}/g, "**Date:** $1");
  s = s.replace(/\\maketitle/g, "");

  // Text formatting
  s = s.replace(/\\(?:textbf|mathbf)\{([^}]+)\}/g, "**$1**");
  s = s.replace(/\\(?:textit|emph|mathit)\{([^}]+)\}/g, "*$1*");
  s = s.replace(/\\texttt\{([^}]+)\}/g, "`$1`");
  s = s.replace(/\\underline\{([^}]+)\}/g, "$1");

  // Inline math: keep as-is between $ signs (already markdown-compatible)
  s = s.replace(/\\\(([^)]+)\\\)/g, "$$1$");
  s = s.replace(/\\\[([^\]]+)\\\]/g, "\n$$\n$1\n$$\n");

  // Citations, labels, refs → strip or simplify
  s = s.replace(/\\(?:cite|ref|label|bibitem)\{[^}]*\}/g, "");
  s = s.replace(/\\(?:bibliographystyle|bibliography)\{[^}]*\}/g, "");

  // Common macros with no text value
  s = s.replace(/\\(?:noindent|centering|raggedright|raggedleft|newpage|clearpage|pagebreak|linebreak|hfill|vfill|medskip|bigskip|smallskip)\b/g, "");
  s = s.replace(/\\(?:footnote|caption)\{([^}]+)\}/g, " ($1)");
  s = s.replace(/\\(?:href|url)\{[^}]+\}\{([^}]+)\}/g, "$1");
  s = s.replace(/\\url\{([^}]+)\}/g, "$1");

  // Collapse remaining unknown commands (both \cmd{arg} and bare \cmd)
  s = s.replace(/\\[a-zA-Z]+\{([^}]*)\}/g, "$1");
  s = s.replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, "");

  // Braces and special chars
  s = s.replace(/[{}]/g, "");
  s = s.replace(/~~/g, " ");
  s = s.replace(/~/g, " ");
  s = s.replace(/\\,|\\;|\\:/g, " ");
  s = s.replace(/\\-/g, "");
  s = s.replace(/---/g, "—");
  s = s.replace(/--/g, "–");
  s = s.replace(/``/g, "\u201C");
  s = s.replace(/''/g, "\u201D");

  // Collapse excess blank lines
  s = s.replace(/\n{3,}/g, "\n\n");

  return s.trim();
}

function extractCodexFiles(data) {
  const files = data?.response?.payload?.codexDeltaFiles;
  if (!Array.isArray(files) || files.length === 0) return [];
  return files
    .filter((f) => f?.file_path && typeof f.diff === "string")
    .map((f) => ({
      filePath: f.file_path,
      content: extractCodexContent(f.diff, f.status),
      status: f.status
    }))
    .filter((f) => f.content !== null);
}

export function parseCliResearchResult(data) {
  const status = data?.status === "success" ? "completed" : data?.status || "unknown";
  const citations = (Array.isArray(data?.citations) ? data.citations : [])
    .map(normalizeCitation)
    .filter(Boolean);
  const codexFiles = extractCodexFiles(data);
  let report = typeof data?.output_text === "string" ? data.output_text : "";
  let artifacts = [];
  if (codexFiles.length > 0) {
    const texFile = codexFiles.find((f) => f.filePath.endsWith(".tex"));
    if (texFile) {
      report = latexToMarkdown(texFile.content);
    } else {
      const parts = codexFiles.map((f) => `## ${f.filePath}\n\n\`\`\`\n${f.content}\n\`\`\``);
      report = parts.join("\n\n");
    }
    for (const f of codexFiles) {
      artifacts.push({ filePath: f.filePath, content: f.content });
    }
  }
  return {
    status,
    outputText: report,
    citations,
    conversationId: data?.conversation_id || null,
    error: data?.error || null,
    artifacts
  };
}

export function runCliProcess({ cliPath, args, input, env, timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      err ? reject(err) : resolve(value);
    };
    const onAbort = () => {
      child.kill("SIGTERM");
      finish(Object.assign(new Error("prism cli aborted"), { name: "AbortError" }));
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error(`prism cli timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    signal?.addEventListener?.("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (err) => finish(err));
    child.on("close", (code) => {
      if (code === 0) return finish(null, stdout);
      const detail = stderr.trim() || stdout.trim();
      finish(new Error(`prism cli exited ${code}: ${detail.slice(0, 500)}`));
    });
    child.stdin.end(input ?? "");
  });
}

function is401Error(err) {
  return err?.message && (err.message.includes("401") || err.message.includes("Unauthorized"));
}

function runCliRefresh(_opts) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "..", "..", "scripts", "reauth-prism.sh");
    const child = spawn(scriptPath, [], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`reauth script exited ${code}: ${stderr.trim().slice(0, 300)}`));
    });
  });
}

export class PrintingPressPrismResearchClient {
  constructor({
    cliPath = DEFAULT_CLI_PATH,
    cookiesEnv = DEFAULT_COOKIES_ENV,
    env = process.env,
    execImpl = runCliProcess,
    refreshImpl = runCliRefresh,
    timeoutMs = 3600000,
    pollIntervalMs = 3000,
    reasoningEffort = DEFAULT_REASONING_EFFORT,
    projectId = "",
    userId = "",
    maxRefreshAttempts = 2
  } = {}) {
    this.cliPath = cliPath;
    this.cookiesEnv = cookiesEnv;
    this.env = env;
    this.execImpl = execImpl;
    this.refreshImpl = refreshImpl;
    this.timeoutMs = timeoutMs;
    this.pollIntervalMs = durationMs(pollIntervalMs, this.pollIntervalMs);
    this.reasoningEffort = reasoningEffort;
    this.projectId = projectId;
    this.userId = userId;
    this.maxRefreshAttempts = maxRefreshAttempts;
    this._refreshAttempts = 0;
  }

  isConfigured() {
    return Boolean(this.cliPath);
  }

  async refreshAuth() {
    this._refreshAttempts++;
    await this.refreshImpl({
      cliPath: this.cliPath,
      env: buildCliEnv(this.env, this.cookiesEnv)
    });
  }

  async #runResearchOnce({ input, signal, timeoutMs, pollIntervalMs, reasoningEffort }) {
    const effectiveTimeoutMs = durationMs(timeoutMs, this.timeoutMs);
    const effectivePollMs = durationMs(pollIntervalMs, this.pollIntervalMs);
    const args = [
      "workflow",
      "ask",
      "--stdin",
      "--json",
      "--select",
      "status,output_text,citations,conversation_id,response",
      "--poll-interval",
      "2500ms",
      "--poll-timeout",
      `${effectiveTimeoutMs}ms`,
      "--timeout",
      `${effectiveTimeoutMs}ms`,
      "--reasoning-effort",
      reasoningEffort || this.reasoningEffort || DEFAULT_REASONING_EFFORT
    ];
    if (this.projectId) args.push("--project-id", this.projectId);
    if (this.userId) args.push("--user-id", this.userId);

    const stdout = await this.execImpl({
      cliPath: this.cliPath,
      args,
      input: String(input ?? ""),
      env: buildCliEnv(this.env, this.cookiesEnv),
      timeoutMs: effectiveTimeoutMs,
      signal
    });
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch (err) {
      throw new Error(`prism cli returned invalid JSON: ${err.message}`);
    }
    return parseCliResearchResult(parsed);
  }

  async runResearch({ input, signal, timeoutMs, pollIntervalMs, reasoningEffort } = {}) {
    if (!this.cliPath) throw new Error("prism cli: missing cliPath");
    try {
      return await this.#runResearchOnce({ input, signal, timeoutMs, pollIntervalMs, reasoningEffort });
    } catch (err) {
      if (!is401Error(err) || this._refreshAttempts >= this.maxRefreshAttempts) throw err;
      try {
        await this.refreshAuth();
      } catch (refreshErr) {
        throw Object.assign(
          new Error(`prism auth expired and refresh failed: ${refreshErr.message}`),
          { status: 401 }
        );
      }
      return this.#runResearchOnce({ input, signal, timeoutMs, pollIntervalMs, reasoningEffort });
    }
  }
}
