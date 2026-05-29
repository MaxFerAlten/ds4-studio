/**
 * Agent Tool Executor — runs tools requested by the model during agentic
 * sessions.  Provides bash, read, write, edit, search, and list tools matching
 * the ds4-agent native tool set.
 *
 * All tool execution is server-side (Node.js).  The results are returned as
 * plain text that gets appended to the conversation as tool result messages.
 *
 * Security: filesystem tools are sandboxed to the workspace root by default.
 * Set DS4_AGENT_SANDBOX=0 to allow access outside the workspace.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_SEC = 30;
const DEFAULT_MAX_LINES = 500;
const READ_MAX_BYTES = 20 * 1024; // 20 KB hard cap per read result
const BASH_HEAD_BYTES = 8 * 1024;   // 8 KB head
const BASH_TAIL_BYTES = 56 * 1024;  // 56 KB tail (64 KB total budget)
const HTML_STRIPPED_MAX_BYTES = 16 * 1024;  // post-strip cap for fetched HTML pages

const HTML_ENTITY_MAP = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};

function decodeBasicEntities(s) {
  return s
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => HTML_ENTITY_MAP[name] ?? `&${name};`)
    .replace(/&#(\d+);/g, (_, num) => {
      const n = Number(num);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : "";
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const n = parseInt(hex, 16);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : "";
    });
}

function looksLikeHtml(s) {
  if (!s) return false;
  const probe = s.slice(0, 4096).toLowerCase();
  if (probe.includes("<!doctype html") || probe.includes("<html")) return true;
  const tagCount = (probe.match(/<[a-z!\/][^>]{0,200}>/gi) || []).length;
  return tagCount >= 20;
}

function stripHtml(s) {
  let out = s;
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  out = out.replace(/<!--[\s\S]*?-->/g, " ");
  out = out.replace(/<\/(p|div|li|tr|td|th|h[1-6]|br|hr|section|article|header|footer|nav)\s*>/gi, "\n");
  out = out.replace(/<(br|hr)\s*\/?>/gi, "\n");
  out = out.replace(/<[^>]+>/g, " ");
  out = decodeBasicEntities(out);
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/\n[ \t]+/g, "\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

function maybeStripHtmlBlob(s) {
  if (!looksLikeHtml(s)) return { text: s, stripped: false, truncated: false };
  const text = stripHtml(s);
  if (text.length <= HTML_STRIPPED_MAX_BYTES) {
    return { text, stripped: true, truncated: false };
  }
  return {
    text: `${text.slice(0, HTML_STRIPPED_MAX_BYTES)}\n... [html-stripped output truncated at ${HTML_STRIPPED_MAX_BYTES} bytes]`,
    stripped: true,
    truncated: true
  };
}
const MAX_SEARCH_RESULTS = 50;
const DEFAULT_WORKSPACE_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

function sandboxEnabled() {
  return process.env.DS4_AGENT_SANDBOX !== "0";
}

function workspaceRoot(options = {}) {
  return path.resolve(options.cwd || process.env.DS4_AGENT_WORKSPACE || DEFAULT_WORKSPACE_ROOT);
}

/**
 * Resolve a tool-supplied path against the workspace root.  Throws when the
 * resolved path escapes the workspace and the sandbox is enabled.
 */
function resolveToolPath(filePath, options = {}) {
  const root = workspaceRoot(options);
  const raw = String(filePath || ".");
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  if (sandboxEnabled()) {
    const rel = path.relative(root, resolved);
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error(`path outside workspace: ${raw}`);
    }
  }
  return resolved;
}

function searchPathArg(filePath, options = {}) {
  if (!filePath) return ".";
  const raw = String(filePath);
  if (path.isAbsolute(raw)) {
    // Reuse resolveToolPath to enforce the sandbox boundary.
    return resolveToolPath(raw, options);
  }
  return raw;
}

/**
 * Capture stream output with head+tail strategy.  Keeps the first
 * `headBytes` bytes and the last `tailBytes` bytes of the stream, splicing
 * an elision marker when the middle is dropped.  This preserves the start
 * of the output (which usually contains the command echo and early errors)
 * as well as the tail (which has the final state).
 */
class HeadTailBuffer {
  constructor(headBytes, tailBytes) {
    this.headBytes = headBytes;
    this.tailBytes = tailBytes;
    this.head = "";
    this.tail = "";
    this.total = 0;
    this.elided = 0;
  }

  push(chunk) {
    const s = chunk.toString();
    this.total += s.length;
    if (this.head.length < this.headBytes) {
      const room = this.headBytes - this.head.length;
      if (s.length <= room) {
        this.head += s;
        return;
      }
      this.head += s.slice(0, room);
      const remainder = s.slice(room);
      this._pushTail(remainder);
      return;
    }
    this._pushTail(s);
  }

  _pushTail(s) {
    this.tail += s;
    if (this.tail.length > this.tailBytes) {
      const drop = this.tail.length - this.tailBytes;
      this.elided += drop;
      this.tail = this.tail.slice(drop);
    }
  }

  toString() {
    if (!this.tail) return this.head;
    if (!this.elided) return this.head + this.tail;
    return `${this.head}\n... [${this.elided} bytes elided] ...\n${this.tail}`;
  }
}

/**
 * Dispatch a tool call to the appropriate handler.
 *
 * @param {string} name – Tool name (bash, read, write, edit, search, list)
 * @param {object} args – Tool arguments
 * @param {{ cwd?: string, signal?: AbortSignal, onProgress?: (chunk: string) => void }} options
 * @returns {Promise<{ content: string, isError: boolean, raw?: object }>}
 */
export async function executeTool(name, args = {}, options = {}) {
  try {
    switch (name) {
      case "bash":
        return await toolBash(args, options);
      case "read":
        return await toolRead(args, options);
      case "write":
        return await toolWrite(args, options);
      case "edit":
        return await toolEdit(args, options);
      case "search":
        return await toolSearch(args, options);
      case "list":
        return await toolList(args, options);
      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { content: `Tool ${name} error: ${err.message}`, isError: true };
  }
}

// ---------------------------------------------------------------------------
// bash
// ---------------------------------------------------------------------------

function toolBash(args, options) {
  const command = args.command;
  if (!command || typeof command !== "string") {
    return Promise.resolve({ content: "bash: command is required", isError: true });
  }

  const timeoutSec = Number(args.timeout_sec) || DEFAULT_TIMEOUT_SEC;
  const cwd = workspaceRoot(options);
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const signal = options.signal;

  return new Promise((resolve) => {
    const stdoutBuf = new HeadTailBuffer(BASH_HEAD_BYTES, BASH_TAIL_BYTES);
    const stderrBuf = new HeadTailBuffer(BASH_HEAD_BYTES, BASH_TAIL_BYTES);
    let killed = false;
    let aborted = false;

    if (signal?.aborted) {
      return resolve({ content: "bash: aborted before start", isError: true });
    }

    const child = spawn("bash", ["-c", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout.on("data", (chunk) => {
      stdoutBuf.push(chunk);
      if (onProgress) onProgress(chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      stderrBuf.push(chunk);
      if (onProgress) onProgress(chunk.toString());
    });

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutSec * 1000);

    let onAbort;
    if (signal) {
      onAbort = () => {
        aborted = true;
        child.kill("SIGKILL");
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("error", (err) => {
      clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      resolve({ content: `bash error: ${err.message}`, isError: true });
    });

    child.on("exit", (code, signalName) => {
      clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);

      const parts = [];
      const stdoutRaw = stdoutBuf.toString();
      const stderr = stderrBuf.toString();
      const htmlResult = maybeStripHtmlBlob(stdoutRaw);
      const stdout = htmlResult.text;
      if (stdout.trim()) {
        if (htmlResult.stripped) {
          parts.push(`[stdout: html stripped to plain text${htmlResult.truncated ? ", truncated" : ""}]\n${stdout.trim()}`);
        } else {
          parts.push(stdout.trim());
        }
      }
      if (stderr.trim()) parts.push(`stderr:\n${stderr.trim()}`);
      if (aborted) parts.push("(aborted by client)");
      else if (killed) parts.push("(killed: timeout exceeded)");
      else if (code !== 0) parts.push(`exit code: ${code}${signalName ? ` signal: ${signalName}` : ""}`);
      if (parts.length === 0) parts.push("(no output)");
      const truncated = stdoutBuf.elided > 0 || stderrBuf.elided > 0 || htmlResult.truncated;
      resolve({
        content: parts.join("\n\n"),
        isError: code !== 0 || killed || aborted,
        raw: {
          exit_code: code,
          signal: signalName,
          killed,
          aborted,
          truncated,
          html_stripped: htmlResult.stripped,
          stdout_bytes: stdoutBuf.total,
          stderr_bytes: stderrBuf.total
        }
      });
    });
  });
}

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

async function toolRead(args, options) {
  const filePath = args.path;
  if (!filePath) return { content: "read: path is required", isError: true };

  const resolved = resolveToolPath(filePath, options);

  try {
    await fs.access(resolved);
  } catch {
    return { content: `read: file not found: ${resolved}`, isError: true };
  }

  const raw = await fs.readFile(resolved, "utf8");
  const lines = raw.split("\n");
  const totalLines = lines.length;

  const whole = Boolean(args.whole);
  const startLine = Math.max(1, Number(args.start_line) || 1);
  const maxLines = whole ? totalLines : (Number(args.max_lines) || DEFAULT_MAX_LINES);
  let endLine = Math.min(totalLines, startLine + maxLines - 1);

  // Build numbered output line by line, stopping once we hit the byte cap.
  // The cap protects context budget: a single read can never blow past
  // READ_MAX_BYTES of tool result regardless of max_lines / whole.
  const numberedParts = [];
  let bytes = 0;
  let truncated = false;
  let actualEnd = startLine - 1;
  for (let i = startLine - 1; i < endLine; i++) {
    const piece = `${i + 1}: ${lines[i]}`;
    const pieceBytes = Buffer.byteLength(piece, "utf8") + 1; // +1 for newline
    if (bytes + pieceBytes > READ_MAX_BYTES) {
      truncated = true;
      break;
    }
    numberedParts.push(piece);
    bytes += pieceBytes;
    actualEnd = i + 1;
  }
  endLine = actualEnd >= startLine ? actualEnd : startLine;

  // The range header is emitted first AND last so the model cannot miss the
  // exact range that was returned, even when streaming the result top-down.
  const rangeTag = `RANGE: ${startLine}-${endLine} of ${totalLines}`;
  const continueOffset = endLine < totalLines ? endLine + 1 : null;
  const moreLines = totalLines - endLine;
  const truncReason = truncated
    ? `truncated at ${READ_MAX_BYTES} bytes; request a smaller range to see the rest`
    : null;
  const footerLines = [];
  if (moreLines > 0) {
    footerLines.push(`... ${moreLines} more lines available (continue_offset=${continueOffset})`);
  }
  if (truncReason) footerLines.push(`... ${truncReason}`);
  const footer = footerLines.length ? `\n${footerLines.join("\n")}` : "";

  const header = `${rangeTag}\n${resolved} (${totalLines} lines total)`;
  return {
    content: `${header}\n${numberedParts.join("\n")}${footer}\n[${rangeTag}]`,
    isError: false,
    raw: {
      path: resolved,
      total_lines: totalLines,
      start_line: startLine,
      end_line: endLine,
      max_lines: maxLines,
      next_offset: continueOffset,
      byte_truncated: truncated
    }
  };
}

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------

async function toolWrite(args, options) {
  const filePath = args.path;
  const content = args.content;
  if (!filePath) return { content: "write: path is required", isError: true };
  if (content === undefined || content === null) return { content: "write: content is required", isError: true };

  const resolved = resolveToolPath(filePath, options);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, "utf8");

  const lines = content.split("\n").length;
  return {
    content: `Wrote ${lines} lines to ${resolved}`,
    isError: false
  };
}

// ---------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------

async function toolEdit(args, options) {
  const filePath = args.path;
  if (!filePath) return { content: "edit: path is required", isError: true };

  const resolved = resolveToolPath(filePath, options);
  let fileContent;
  try {
    fileContent = await fs.readFile(resolved, "utf8");
  } catch {
    return { content: `edit: file not found: ${resolved}`, isError: true };
  }

  // old/new text replacement mode
  if (typeof args.old === "string") {
    const oldText = args.old;
    const newText = typeof args.new === "string" ? args.new : "";
    const occurrences = fileContent.split(oldText).length - 1;

    if (occurrences === 0) {
      return { content: "edit: old text not found in file", isError: true };
    }
    if (occurrences > 1) {
      return { content: `edit: old text found ${occurrences} times; must match exactly once`, isError: true };
    }

    const edited = fileContent.replace(oldText, newText);
    await fs.writeFile(resolved, edited, "utf8");
    return { content: `Edited ${resolved}: replaced 1 occurrence`, isError: false };
  }

  // line/range replacement mode
  const lines = fileContent.split("\n");
  const newText = typeof args.new === "string" ? args.new : "";

  if (args.range === "all") {
    await fs.writeFile(resolved, newText, "utf8");
    return { content: `Edited ${resolved}: full file rewrite`, isError: false };
  }

  let startLine, endLine;
  if (typeof args.line === "number") {
    startLine = args.line;
    endLine = args.line;
  } else if (typeof args.range === "string") {
    const parts = args.range.split(":");
    startLine = Number(parts[0]);
    endLine = Number(parts[1]) || startLine;
  } else {
    return { content: "edit: specify old/new, line, or range", isError: true };
  }

  if (startLine < 1 || endLine < startLine || startLine > lines.length) {
    return { content: `edit: invalid range ${startLine}:${endLine} (file has ${lines.length} lines)`, isError: true };
  }

  const newLines = newText === "" ? [] : newText.split("\n");
  lines.splice(startLine - 1, endLine - startLine + 1, ...newLines);
  await fs.writeFile(resolved, lines.join("\n"), "utf8");

  return {
    content: `Edited ${resolved}: replaced lines ${startLine}-${endLine} with ${newLines.length} line(s)`,
    isError: false
  };
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

async function toolSearch(args, options) {
  const query = args.query;
  if (!query) return { content: "search: query is required", isError: true };

  const cwd = workspaceRoot(options);
  const searchPath = searchPathArg(args.path, options);
  const maxResults = Number(args.max_results) || MAX_SEARCH_RESULTS;
  const caseSensitive = args.case_sensitive !== false;
  const signal = options.signal;

  const grepArgs = ["-rn", "--color=never"];
  if (!caseSensitive) grepArgs.push("-i");
  if (args.glob) grepArgs.push(`--include=${args.glob}`);
  grepArgs.push("--", query, searchPath);

  return new Promise((resolve) => {
    let output = "";
    let count = 0;
    if (signal?.aborted) return resolve({ content: "search: aborted", isError: true });
    const child = spawn("grep", grepArgs, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
    let onAbort;
    if (signal) {
      onAbort = () => child.kill("SIGKILL");
      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      const newLines = text.split("\n");
      for (const line of newLines) {
        if (!line.trim()) continue;
        if (count >= maxResults) break;
        output += line + "\n";
        count++;
      }
    });

    child.on("error", () => {
      clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      resolve({ content: output || "search: no results", isError: false });
    });

    child.on("exit", () => {
      clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      if (!output.trim()) {
        resolve({ content: "search: no results", isError: false });
      } else {
        const suffix = count >= maxResults ? `\n... (capped at ${maxResults} results)` : "";
        resolve({ content: `${count} result(s):\n${output.trim()}${suffix}`, isError: false });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

async function toolList(args, options) {
  const dirPath = args.path || ".";
  const resolved = resolveToolPath(dirPath, options);

  let entries;
  try {
    entries = await fs.readdir(resolved, { withFileTypes: true });
  } catch (err) {
    return { content: `list: ${err.message}`, isError: true };
  }

  const lines = entries
    .sort((a, b) => {
      // directories first, then files
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    })
    .map((entry) => {
      const suffix = entry.isDirectory() ? "/" : "";
      return `${entry.name}${suffix}`;
    });

  return {
    content: `${resolved}/\n${lines.join("\n")}`,
    isError: false
  };
}

// ---------------------------------------------------------------------------
// Read-guard — block duplicate or covered reads to save tokens and prevent
// agentic read loops.  JS port of pi-ds4-stateful/policies/read-guard.ts.
// ---------------------------------------------------------------------------

/** @typedef {{ path: string, offset: number, limit: number|"all", key: string, label: string, count: number, nextOffset?: number|null }} SeenReadRange */

function readRangeOf(input) {
  if (!input || typeof input !== "object") return undefined;
  const filePath = typeof input.path === "string" ? input.path : null;
  if (!filePath) return undefined;
  const whole = Boolean(input.whole);
  const offset = Math.max(1, Number(input.start_line) || 1);
  const limit = whole ? "all" : (Number(input.max_lines) || DEFAULT_MAX_LINES);
  return {
    path: filePath,
    offset,
    limit,
    key: `${filePath}@${offset}:${limit}`,
    label: `${filePath} lines ${offset}-${limit === "all" ? "end" : offset + limit - 1}`
  };
}

function rangeEnd(range) {
  return range.limit === "all" ? Number.POSITIVE_INFINITY : range.offset + range.limit - 1;
}

export class ReadGuard {
  constructor() {
    /** @type {Map<string, SeenReadRange>} */
    this.seen = new Map();
    /** @type {Map<string, number>} */
    this.blockedThisTurn = new Map();
    this.lastSummary = "no read guard blocks yet";
  }

  beginTurn() {
    this.blockedThisTurn.clear();
  }

  clearAll() {
    this.seen.clear();
    this.blockedThisTurn.clear();
    this.lastSummary = "no read guard blocks yet";
  }

  /** Returns true when any read on this file was blocked earlier in the turn. */
  hasBlockedReadsThisTurn(filePath) {
    if (filePath) return (this.blockedThisTurn.get(filePath) || 0) > 0;
    let total = 0;
    for (const v of this.blockedThisTurn.values()) total += v;
    return total > 0;
  }

  /**
   * Decide whether a read tool call should be blocked.  Returns a
   * `{ block: true, reason }` object on block, otherwise `undefined`.
   *
   * @param {object} input – tool arguments
   * @param {"exact"|"strict"} [mode="exact"] – when "strict", any further
   *        read on a path that already produced a duplicate/covered block
   *        in the current turn is blocked too.
   */
  checkRead(input, mode = "exact") {
    const range = readRangeOf(input);
    if (!range) return undefined;
    const seen = this.seen.get(range.key);
    if (seen) {
      this._bump(range.path);
      const reason = `Duplicate read blocked: ${range.label} was already read and is still in model context. Do not retry this read. Answer from existing context, or use grep/search for a precise fact.`;
      this.lastSummary = `blocked duplicate ${range.label}`;
      return { block: true, reason };
    }
    const covering = this._covering(range);
    if (covering) {
      this._bump(range.path);
      const reason = `Covered read blocked: ${range.label} is already covered by earlier read ${covering.label}. Answer from existing context, or use grep/search for a different precise fact.`;
      this.lastSummary = `blocked covered ${range.label}`;
      return { block: true, reason };
    }
    if (mode === "strict" && (this.blockedThisTurn.get(range.path) || 0) > 0) {
      this._bump(range.path);
      const reason = `Strict read guard: further read of ${range.label} blocked because an earlier read of this file was already blocked this turn. Answer from existing context or use grep/search for the missing fact.`;
      this.lastSummary = `strict-blocked ${range.label}`;
      return { block: true, reason };
    }
    return undefined;
  }

  /** Remember a successful read so future duplicate ranges get blocked. */
  rememberRead(input, raw) {
    const range = readRangeOf(input);
    if (!range) return;
    const existing = this.seen.get(range.key);
    const nextOffset = raw && typeof raw.next_offset === "number" ? raw.next_offset : null;
    const actualLimit = range.limit === "all" && nextOffset && nextOffset > range.offset
      ? nextOffset - range.offset
      : range.limit;
    this.seen.set(range.key, {
      ...range,
      limit: actualLimit,
      label: `${range.path} lines ${range.offset}-${actualLimit === "all" ? "end" : range.offset + actualLimit - 1}`,
      count: (existing?.count ?? 0) + 1,
      nextOffset
    });
  }

  /** Forget all reads for a file so writes/edits invalidate the cache. */
  invalidatePath(filePath) {
    if (!filePath) return;
    for (const [key, range] of this.seen) {
      if (range.path === filePath) this.seen.delete(key);
    }
  }

  _bump(p) {
    this.blockedThisTurn.set(p, (this.blockedThisTurn.get(p) ?? 0) + 1);
  }

  _rangesForPath(p) {
    return [...this.seen.values()]
      .filter((r) => r.path === p)
      .sort((a, b) => a.offset - b.offset);
  }

  _covering(range) {
    const end = rangeEnd(range);
    return this._rangesForPath(range.path).find((seen) => seen.offset <= range.offset && rangeEnd(seen) >= end);
  }
}

// ---------------------------------------------------------------------------
// Bash-file-read guard — block bash commands that dump file contents
// (cat/head/tail/sed/awk, find -exec, xargs, python/perl/node file reads).
// JS port of pi-ds4-stateful/policies/bash-file-read-guard.ts.
// ---------------------------------------------------------------------------

const FILE_DUMP_COMMANDS = new Set(["cat", "head", "tail", "sed", "awk"]);
const SCRIPT_READ_COMMANDS = new Set(["python", "python3", "perl", "node"]);
const EXEC_WRAPPERS = new Set(["command", "builtin", "sudo", "env"]);

function shellWords(text) {
  const words = [];
  let cur = "";
  let quote;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { cur += ch; escaped = false; continue; }
    if (ch === "\\" && quote !== "'") { escaped = true; continue; }
    if (quote) {
      if (ch === quote) quote = undefined;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (/\s/.test(ch)) {
      if (cur) { words.push(cur); cur = ""; }
      continue;
    }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words;
}

function commandSegments(command) {
  return command
    .split(/\|\||&&|[;\n]/)
    .flatMap((part) => part.split("|"))
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripAssignments(words) {
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(words[i])) i++;
  return words.slice(i);
}

function stripWrappers(words) {
  let out = stripAssignments(words);
  while (out[0] === "command" || out[0] === "builtin" || out[0] === "sudo") out = out.slice(1);
  if (out[0] === "env") out = stripAssignments(out.slice(1));
  return out;
}

function baseCommand(word) {
  if (!word) return undefined;
  return word.split("/").pop() ?? word;
}

function hasInputRedirection(words) {
  return words.some((word) => word === "<" || /^<[^(<]/.test(word));
}

function nonOptionArgs(words) {
  const args = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === "--") { args.push(...words.slice(i + 1)); break; }
    if (word === "<") { i++; continue; }
    if (word.startsWith("<")) continue;
    if (word.startsWith("-")) {
      if ((word === "-n" || word === "-c" || word === "-F" || word === "-f") && i + 1 < words.length) i++;
      continue;
    }
    args.push(word);
  }
  return args;
}

function looksLikeCatHeadTailDump(cmd, args) {
  if (hasInputRedirection(args)) return true;
  const positional = nonOptionArgs(args);
  if (cmd === "cat") return positional.length > 0;
  return positional.length > 0;
}

function hasSedInputFile(args) {
  if (hasInputRedirection(args)) return true;
  let sawScript = false;
  for (let i = 0; i < args.length; i++) {
    const word = args[i];
    if (word === "--") return args.length > i + 1;
    if (word === "<" || word.startsWith("<")) return true;
    if (word === "-e" || word === "-f") { i++; sawScript = true; continue; }
    if (word.startsWith("-e") || word.startsWith("-f")) { sawScript = true; continue; }
    if (word.startsWith("-")) continue;
    if (!sawScript) { sawScript = true; continue; }
    return true;
  }
  return false;
}

function hasAwkInputFile(args) {
  if (hasInputRedirection(args)) return true;
  let sawProgram = false;
  for (let i = 0; i < args.length; i++) {
    const word = args[i];
    if (word === "--") return args.length > i + 1;
    if (word === "<" || word.startsWith("<")) return true;
    if (word === "-F" || word === "-v" || word === "-f") {
      i++;
      if (word === "-f") sawProgram = true;
      continue;
    }
    if (word.startsWith("-F") || word.startsWith("-v") || word.startsWith("-f")) {
      if (word.startsWith("-f")) sawProgram = true;
      continue;
    }
    if (word.startsWith("-")) continue;
    if (!sawProgram) { sawProgram = true; continue; }
    return true;
  }
  return false;
}

function looksLikeScriptFileRead(segment) {
  return /\b(?:readFileSync|readFile|read_text)\b|\bopen\s*\(|\bPath\s*\([^)]*\)\.read_text\b/.test(segment);
}

function findExecDumpReason(command) {
  const words = shellWords(command);
  for (let i = 0; i < words.length; i++) {
    if (words[i] !== "-exec" && words[i] !== "-execdir") continue;
    let j = i + 1;
    while (EXEC_WRAPPERS.has(words[j])) j++;
    const base = baseCommand(words[j]);
    if (base && FILE_DUMP_COMMANDS.has(base)) {
      return `find ${words[i]} '${base}' appears to dump file contents`;
    }
  }
  return undefined;
}

function xargsDumpReason(command) {
  const words = shellWords(command);
  for (let i = 0; i < words.length; i++) {
    if (baseCommand(words[i]) !== "xargs") continue;
    for (let j = i + 1; j < words.length; j++) {
      const word = words[j];
      if (word === "--") continue;
      if (word === "-I" || word === "-n" || word === "-P" || word === "-0") {
        if (word !== "-0") j++;
        continue;
      }
      if (word.startsWith("-")) continue;
      let k = j;
      while (EXEC_WRAPPERS.has(words[k])) k++;
      const base = baseCommand(words[k]);
      if (base && FILE_DUMP_COMMANDS.has(base)) return `xargs '${base}' appears to dump file contents`;
      break;
    }
  }
  return undefined;
}

/**
 * Returns the reason a bash command appears to read file contents, or
 * undefined if the command looks safe.
 */
export function bashFileReadFallbackReason(input) {
  const command = input && typeof input === "object" && !Array.isArray(input)
    ? input.command
    : undefined;
  if (typeof command !== "string" || command.trim().length === 0) return undefined;
  const findReason = findExecDumpReason(command);
  if (findReason) return findReason;
  const xargsReason = xargsDumpReason(command);
  if (xargsReason) return xargsReason;
  for (const segment of commandSegments(command)) {
    const words = stripWrappers(shellWords(segment));
    const cmd = words[0];
    if (!cmd) continue;
    const base = baseCommand(cmd) ?? cmd;
    const args = words.slice(1);
    if (FILE_DUMP_COMMANDS.has(base)) {
      const dumpsFile = base === "sed" ? hasSedInputFile(args) :
        base === "awk" ? hasAwkInputFile(args) :
        looksLikeCatHeadTailDump(base, args);
      if (dumpsFile) return `bash command '${base}' appears to dump file contents`;
    }
    if (SCRIPT_READ_COMMANDS.has(base) && looksLikeScriptFileRead(segment)) {
      return `bash command '${base}' appears to read file contents`;
    }
  }
  return undefined;
}

/**
 * Returns a block decision when a bash command tries to read file contents
 * through a path that bypasses the `read` tool.
 *
 * @param {object} input – bash tool arguments
 * @param {boolean} [afterReadGuardBlock] – true when the read guard already
 *        blocked something this turn; produces a stronger refusal message.
 */
export function checkBashFileReadFallback(input, afterReadGuardBlock = false) {
  const reason = bashFileReadFallbackReason(input);
  if (!reason) return undefined;
  const context = afterReadGuardBlock ? " after a read guard block" : "";
  return {
    block: true,
    reason: `Bash guard: ${reason}${context}. Use the 'read' tool for file contents; do not bypass it with cat/head/tail/sed/awk, find -exec cat, xargs cat, or scripts. Use grep/search for precise lookups.`
  };
}
