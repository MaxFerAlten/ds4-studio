import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CLI_PATH = "prism-pp-cli";
const DEFAULT_COOKIES_ENV = "PRISM_COOKIES";
const DEFAULT_REASONING_EFFORT = "medium";
const DEFAULT_PRINTING_PRESS_PATH = "cli-printing-press";

function durationMs(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function defaultPrismConfigPath(env = process.env) {
  return path.join(env.HOME || os.homedir(), ".config", "prism-pp-cli", "config.toml");
}

function parseTomlString(value) {
  const trimmed = String(value || "").trim();
  if (trimmed.startsWith("\"")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return "";
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return "";
}

function readPrismConfigCookies(configPath, readFileImpl = readFileSync) {
  try {
    const text = readFileImpl(configPath, "utf8");
    const match = /^cookies\s*=\s*(.+)$/m.exec(text);
    return match ? parseTomlString(match[1]) : "";
  } catch {
    return "";
  }
}

export function resolvePrintingPressPrismCliPath({
  cliPath = DEFAULT_CLI_PATH,
  env = process.env,
  printingPressPath = env.PRINTING_PRESS_BIN || env.CLI_PRINTING_PRESS_PATH || DEFAULT_PRINTING_PRESS_PATH,
  spawnSyncImpl = spawnSync,
  existsSyncImpl = existsSync
} = {}) {
  const requested = typeof cliPath === "string" && cliPath.trim() ? cliPath.trim() : DEFAULT_CLI_PATH;
  if (requested !== DEFAULT_CLI_PATH) return requested;

  const result = spawnSyncImpl(printingPressPath, ["library", "list", "--json"], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
  if (result?.status !== 0) return requested;

  let entries;
  try {
    entries = JSON.parse(String(result.stdout || ""));
  } catch {
    return requested;
  }
  if (!Array.isArray(entries)) return requested;

  const prism = entries.find((entry) =>
    entry?.api_name === "prism" &&
    entry?.cli_name === DEFAULT_CLI_PATH &&
    typeof entry?.dir === "string" &&
    entry.dir
  );
  if (!prism) return requested;

  const candidate = path.join(prism.dir, prism.cli_name);
  return existsSyncImpl(candidate) ? candidate : requested;
}

function buildCliEnv(env, cookiesEnv, cookiesOverride = "") {
  const childEnv = { ...process.env, ...env };
  const sourceName =
    typeof cookiesEnv === "string" && cookiesEnv.trim() ? cookiesEnv.trim() : DEFAULT_COOKIES_ENV;
  if (cookiesOverride) {
    childEnv[DEFAULT_COOKIES_ENV] = cookiesOverride;
  } else if (sourceName !== DEFAULT_COOKIES_ENV && childEnv[sourceName]) {
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

function fencedBlock(content, language = "") {
  const raw = String(content || "").replace(/\n+$/g, "");
  const longest = Math.max(3, ...Array.from(raw.matchAll(/`+/g), (match) => match[0].length + 1));
  const fence = "`".repeat(longest);
  return `${fence}${language}\n${raw}\n${fence}`;
}

const CODE_EXTENSIONS = new Set([
  ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".json", ".sh", ".bash",
  ".go", ".rb", ".rs", ".java", ".c", ".cpp", ".cc", ".h", ".hpp"
]);

function codeLanguageForPath(filePath = "") {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".py") return "python";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "javascript";
  if (ext === ".ts" || ext === ".tsx") return "typescript";
  if (ext === ".json") return "json";
  if (ext === ".sh" || ext === ".bash") return "bash";
  return "";
}

function isCodeArtifact(artifact) {
  return Boolean(
    artifact?.filePath &&
    typeof artifact.content === "string" &&
    CODE_EXTENSIONS.has(path.extname(artifact.filePath).toLowerCase())
  );
}

// Prism sometimes ships the real source as a sibling artifact while leaving a
// truncated stub inside an inline lstlisting (and naming the file in the prose,
// e.g. \path{experiments/skeleton.py}). Find the code artifact whose name is
// mentioned closest to — and before — the listing so we can inline the full file.
function findReferencedCodeArtifact(windowText, artifacts = []) {
  let best = null;
  let bestPos = -1;
  for (const artifact of artifacts) {
    if (!isCodeArtifact(artifact)) continue;
    for (const name of [artifact.filePath, path.basename(artifact.filePath)]) {
      const pos = windowText.lastIndexOf(name);
      if (pos > bestPos) {
        bestPos = pos;
        best = artifact;
      }
    }
  }
  return best;
}

function artifactLookup(artifacts = []) {
  const lookup = new Map();
  for (const artifact of artifacts) {
    if (!artifact?.filePath || typeof artifact.content !== "string") continue;
    lookup.set(artifact.filePath, artifact);
    lookup.set(path.basename(artifact.filePath), artifact);
  }
  return lookup;
}

// Strip LaTeX markup and return readable plain-text / Markdown.
// Handles the most common structural commands so the exported PDF
// looks like a real document rather than raw LaTeX source.
export function latexToMarkdown(tex, { artifacts = [] } = {}) {
  let s = tex;
  const protectedBlocks = [];
  const files = artifactLookup(artifacts);
  const stash = (markdown) => {
    const token = `@@DS4_LATEX_BLOCK_${protectedBlocks.length}@@`;
    protectedBlocks.push(String(markdown || ""));
    return token;
  };

  // Remove preamble (everything up to and including \begin{document})
  s = s.replace(/[\s\S]*?\\begin\{document\}/m, "");
  // Remove \end{document} trailer
  s = s.replace(/\\end\{document\}[\s\S]*/m, "");

  // Environments: abstract → blockquote, verbatim/lstlisting → code fence
  s = s.replace(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/g,
    (_m, body) => `> **Abstract**\n>\n${body.trim().split("\n").map((l) => `> ${l}`).join("\n")}\n`);
  s = s.replace(/\\begin\{(verbatim|lstlisting)\}(\[[^\]]*\])?([\s\S]*?)\\end\{\1\}/g,
    (_m, env, opts, body, offset, full) => {
      let language = env === "lstlisting" && /python/i.test(opts || "") ? "python" : "";
      let code = body.replace(/^\n+/, "").replace(/\n+$/g, "");
      const ref = findReferencedCodeArtifact(full.slice(Math.max(0, offset - 800), offset), artifacts);
      if (ref && ref.content.trim().length > code.trim().length) {
        code = ref.content.replace(/\n+$/g, "");
        language = codeLanguageForPath(ref.filePath) || language;
      }
      return stash(fencedBlock(code, language));
    });
  s = s.replace(/\\lstinputlisting(?:\[[^\]]*\])?\{([^}]+)\}/g, (_m, filePath) => {
    const artifact = files.get(filePath) || files.get(path.basename(filePath));
    if (!artifact) return `\`${filePath}\``;
    return stash(fencedBlock(artifact.content, codeLanguageForPath(artifact.filePath)));
  });
  // proof, theorem, lemma, corollary, definition → bold label + body
  s = s.replace(/\\begin\{(proof|theorem|lemma|corollary|definition|proposition|remark)\}([\s\S]*?)\\end\{\1\}/gi,
    (_m, env, body) => `**${env.charAt(0).toUpperCase() + env.slice(1).toLowerCase()}:** ${body.trim()}\n`);
  // equation / align / gather / displaymath → Obsidian display math
  s = s.replace(/\\begin\{(?:equation\*?|align\*?|gather\*?|displaymath)\}([\s\S]*?)\\end\{(?:equation\*?|align\*?|gather\*?|displaymath)\}/g,
    (_m, body) => stash(`$$\n${body.trim()}\n$$`));
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_m, body) => stash(`$$\n${body.trim()}\n$$`));
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_m, body) => stash(`$${body.trim()}$`));
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_m, body) => stash(`$$\n${body.trim()}\n$$`));
  s = s.replace(/(^|[^\\$])\$((?:\\.|[^\n$])+?)\$/g,
    (_m, prefix, body) => `${prefix}${stash(`$${body.trim()}$`)}`);
  // itemize / enumerate → list items
  s = s.replace(/\\begin\{(?:itemize|enumerate)\}([\s\S]*?)\\end\{(?:itemize|enumerate)\}/g,
    (_m, body) => body.replace(/^[ \t]*\\item\s*/gm, "- ") + "\n");
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
  for (let i = 0; i < protectedBlocks.length; i++) {
    s = s.split(`@@DS4_LATEX_BLOCK_${i}@@`).join(protectedBlocks[i]);
  }
  s = s.replace(/\n{3,}/g, "\n\n");

  return s.trim();
}

// Insert `\lstdefinestyle` for any lstlisting style referenced by the document
// but never defined — pdflatex aborts with "Style X undefined" otherwise.
function injectMissingLstStyles(tex) {
  const referenced = new Set(Array.from(tex.matchAll(/style=([A-Za-z][\w]*)/g), (m) => m[1]));
  const missing = [...referenced].filter(
    (name) => !new RegExp(`\\\\lstdefinestyle\\{${name}\\}`).test(tex)
  );
  if (missing.length === 0) return tex;

  const needsPackage = !/\\usepackage(?:\[[^\]]*\])?\{[^}]*\blistings\b[^}]*\}/.test(tex);
  const defs = [
    needsPackage ? "\\usepackage{listings}" : null,
    ...missing.map(
      (name) =>
        `\\lstdefinestyle{${name}}{basicstyle=\\ttfamily\\footnotesize,breaklines=true,` +
        `columns=fullflexible,keepspaces=true,showstringspaces=false}`
    )
  ].filter(Boolean).join("\n");

  return /\\begin\{document\}/.test(tex)
    ? tex.replace(/\\begin\{document\}/, `${defs}\n\\begin{document}`)
    : `${defs}\n${tex}`;
}

// Prism occasionally emits an orphan `\end{equation}` (more closes than opens),
// which makes pdflatex fail. Insert a matching `\begin{equation}` before each
// orphaned block so the document compiles.
function balanceEquationEnvironments(tex) {
  const lines = tex.split("\n");
  const beginRe = /\\begin\{equation\*?\}/;
  const endRe = /\\end\{equation\*?\}/;
  let depth = 0;
  let lastClose = -1;
  for (let i = 0; i < lines.length; i++) {
    if (beginRe.test(lines[i])) depth++;
    if (endRe.test(lines[i])) {
      if (depth > 0) {
        depth--;
        lastClose = i;
      } else {
        let insertAt = lastClose + 1;
        while (insertAt < i && lines[insertAt].trim() === "") insertAt++;
        lines.splice(insertAt, 0, "\\begin{equation}");
        i += 1;
        lastClose = i;
      }
    }
  }
  return lines.join("\n");
}

// Prepare a captured `.tex` so a local pdflatex run reproduces prism's paper:
// inline stub code listings from their shipped artifacts, define referenced
// listing styles, and balance malformed equation environments.
export function prepareTexForCompile(tex, artifacts = []) {
  let s = String(tex || "");
  s = s.replace(/\\begin\{lstlisting\}(\[[^\]]*\])?([\s\S]*?)\\end\{lstlisting\}/g,
    (match, opts, body, offset, full) => {
      const stub = body.replace(/^\n+/, "").replace(/\n+$/g, "");
      const ref = findReferencedCodeArtifact(full.slice(Math.max(0, offset - 800), offset), artifacts);
      if (ref && ref.content.trim().length > stub.trim().length) {
        return `\\begin{lstlisting}${opts || ""}\n${ref.content.replace(/\n+$/g, "")}\n\\end{lstlisting}`;
      }
      return match;
    });
  s = injectMissingLstStyles(s);
  s = balanceEquationEnvironments(s);
  // Prism's captured diff sometimes truncates the trailing `\end{document}`,
  // which makes pdflatex stop with "Emergency stop" at EOF. Restore it.
  if (/\\begin\{document\}/.test(s) && !/\\end\{document\}/.test(s)) {
    s = `${s.replace(/\s*$/, "")}\n\\end{document}\n`;
  }
  return s;
}

// Last-resort relaxation for a tex that pdflatex rejected: drop babel, which
// fatal-errors when its language pack (e.g. babel-italian) isn't installed.
// babel only affects hyphenation/auto-strings here, so dropping it keeps the
// paper intact while letting the build succeed on a minimal TeX distribution.
export function relaxTexForCompat(tex) {
  return String(tex || "").replace(/^[ \t]*\\usepackage(?:\[[^\]]*\])?\{babel\}[ \t]*\n?/gm, "");
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
      report = latexToMarkdown(texFile.content, { artifacts: codexFiles });
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
    resolveCliPathImpl = resolvePrintingPressPrismCliPath,
    configPath,
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
    this.resolveCliPathImpl = resolveCliPathImpl;
    this.configPath = configPath || defaultPrismConfigPath(env);
    this.timeoutMs = timeoutMs;
    this.pollIntervalMs = durationMs(pollIntervalMs, this.pollIntervalMs);
    this.reasoningEffort = reasoningEffort;
    this.projectId = projectId;
    this.userId = userId;
    this.maxRefreshAttempts = maxRefreshAttempts;
    this._refreshAttempts = 0;
    this._refreshedCookies = "";
  }

  isConfigured() {
    return Boolean(this.cliPath);
  }

  async refreshAuth() {
    this._refreshAttempts++;
    await this.refreshImpl({
      cliPath: this.#resolveCliPath(),
      env: buildCliEnv(this.env, this.cookiesEnv, this._refreshedCookies)
    });
    this._refreshedCookies = readPrismConfigCookies(this.configPath);
  }

  #resolveCliPath() {
    return this.resolveCliPathImpl({
      cliPath: this.cliPath,
      env: this.env
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
      cliPath: this.#resolveCliPath(),
      args,
      input: String(input ?? ""),
      env: buildCliEnv(this.env, this.cookiesEnv, this._refreshedCookies),
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
