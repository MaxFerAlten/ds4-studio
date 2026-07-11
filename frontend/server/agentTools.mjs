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
import { compressToolOutput, ContentKind } from "./toolOutputCompressor.mjs";
import { validateSearchQuery } from "./searchQueryGuard.mjs";
import { webSearch, webReadPage } from "./webSearchTool.mjs";
import { crawlUrl } from "./crawlClient.mjs";
import { summarizeCrawlManifest } from "./crawlSummarizer.mjs";
import { formatResearchSources } from "./researchFormatter.mjs";
import { searchChatHistory, formatHistoryResults } from "./historyTool.mjs";
import { toolPageSnapshot, toolPageAction } from "./pageAgentTool.mjs";
import { toolPageTask } from "./pageAgentTask.mjs";
import { enqueuePageAgentTool, isClientConnected } from "./pageAgentBridge.mjs";
import {
  SAGE_RESULT_CONTRACT_VERSION,
  buildLegacySageResult,
  normalizeSagePhase,
  normalizeSageTaskType,
  validateSageResult
} from "./sageResultContract.mjs";

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
 * Filesystem-safe, bounded session id used to name the per-session sage dir.
 * Non [A-Za-z0-9._-] chars collapse to "_"; a blank/garbage id becomes
 * "default" so a directory name is always produced.
 */
export function sanitizeSessionId(sessionId) {
  const cleaned = String(sessionId || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 128);
  return cleaned || "default";
}

/**
 * Per-session working directory for SageMath: `<base>/sage_<sessionId>`.
 * Sage writes preparse artifacts (.sage.py), saved plots and any other
 * generated files into its cwd, so isolating each session here keeps those
 * artifacts out of the project tree and grouped by conversation, inside the
 * same workspace that holds chat history and sessions.
 */
export function sageSessionDir(base, sessionId) {
  return path.join(path.resolve(base), `sage_${sanitizeSessionId(sessionId)}`);
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
      case "sage":
        return await toolSage(args, options);
      case "web_search":
        return await toolWebSearch(args, options);
      case "web_read":
        return await toolWebRead(args, options);
      case "crawl":
        return await toolCrawl(args, options);
      case "research_discover":
        return await toolResearchDiscover(args, options);
      case "retrieve_context_blob":
        return await toolRetrieveContextBlob(args, options);
      case "chat_history_search":
        return toolHistory(args, options);
      case "context_search": {
        // ponytail: dynamic import — tool only reachable when ContextWiki is enabled.
        const { contextSearch } = await import("./contextSearchTool.mjs");
        const result = await contextSearch({ sessionKey: options?.sessionKey, query: args?.query, limit: args?.limit });
        return { content: JSON.stringify(result), isError: result.status === "error" };
      }
      case "page_snapshot":
        if (isClientConnected()) {
          const result = await enqueuePageAgentTool("page_snapshot", args);
          if (result) return result;
        }
        return toolPageSnapshot(args, options);
      case "page_action":
        if (isClientConnected()) {
          const result = await enqueuePageAgentTool("page_action", args);
          if (result) return result;
        }
        return toolPageAction(args, options);
      case "page_task":
        if (isClientConnected()) {
          const result = await enqueuePageAgentTool("page_task", args);
          if (result) return result;
        }
        return toolPageTask(args, options);
      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { content: `Tool ${name} error: ${err.message}`, isError: true };
  }
}

async function toolRetrieveContextBlob(args, options) {
  const store = options?.toolBlobStore;
  if (!store || typeof store.get !== "function") {
    return { content: "retrieve_context_blob: blob store is unavailable", isError: true };
  }
  const id = typeof args?.id === "string" ? args.id : "";
  const offset = Math.max(0, Math.trunc(Number(args?.offset) || 0));
  const requestedLength = Math.trunc(Number(args?.length) || 20_000);
  if (!id || requestedLength < 1 || requestedLength > 200_000) {
    return { content: "retrieve_context_blob: valid id and length 1..200000 are required", isError: true };
  }

  const content = await store.get(id, offset, requestedLength);
  if (content === null) {
    return { content: `retrieve_context_blob: blob not found or invalid id: ${id}`, isError: true };
  }
  return {
    content: [
      `context_blob id=${id} offset=${offset} bytes=${Buffer.byteLength(content, "utf8")} requested_length=${requestedLength}`,
      "<context_blob_range>",
      content,
      "</context_blob_range>"
    ].join("\n"),
    isError: false,
    raw: { id, offset, length: requestedLength }
  };
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

// Near-duplicate read detection: a "monotonic drift" loop (read 55-84, then
// 56-85, …) is not caught by exact/covered checks but is still a loop.
const NEAR_DUPLICATE_READ_RATIO = 0.8;

function overlapRatio(aStart, aEnd, bStart, bEnd) {
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart) + 1);
  const shortest = Math.max(1, Math.min(aEnd - aStart + 1, bEnd - bStart + 1));
  return overlap / shortest;
}

export class ReadGuard {
  constructor() {
    /** @type {Map<string, SeenReadRange>} */
    this.seen = new Map();
    /** @type {Map<string, number>} */
    this.blockedThisTurn = new Map();
    this.lastSummary = "no read guard blocks yet";
    // Read-batch progress budget: after a small batch of reads without a
    // structured synthesis the guard forces the model to summarize, so it
    // anticipates the native "tool results are empty" loop guard instead of
    // letting it fire as an emergency brake. Counters persist across turns and
    // reset only on a real synthesis (markSummaryProduced) or clearAll.
    this.readCount = 0;
    this.docReadCount = 0;
    this.rawChars = 0;
    this.maxReadsBeforeSummary = Number(process.env.DS4_AGENT_READ_BATCH_LIMIT) || 3;
    this.maxDocReadsBeforeSummary = Number(process.env.DS4_AGENT_DOC_READ_BATCH_LIMIT) || 2;
    this.maxRawCharsBeforeSummary = Number(process.env.DS4_AGENT_RAW_DOC_CHARS_LIMIT) || 12000;
  }

  beginTurn() {
    this.blockedThisTurn.clear();
  }

  /** A structured synthesis was emitted — release the read-batch budget. */
  markSummaryProduced() {
    this.readCount = 0;
    this.docReadCount = 0;
    this.rawChars = 0;
  }

  clearAll() {
    this.seen.clear();
    this.blockedThisTurn.clear();
    this.lastSummary = "no read guard blocks yet";
    this.markSummaryProduced();
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
    const near = this._nearDuplicate(range);
    if (near) {
      this._bump(range.path);
      const reason = `Near-duplicate read blocked: ${range.label} substantially overlaps earlier read ${near.label}. Do not retry with slightly shifted line numbers. Use the previous result, jump to a non-overlapping range, or stop with a verdict.`;
      this.lastSummary = `blocked near-duplicate ${range.label}`;
      return { block: true, reason };
    }
    // This is a novel read (not duplicate/covered/near-duplicate). Once the
    // per-batch budget of novel reads is spent, force a synthesis instead.
    const batch = this._checkBatchBudget(range);
    if (batch) return batch;
    if (mode === "strict" && (this.blockedThisTurn.get(range.path) || 0) > 0) {
      this._bump(range.path);
      const reason = `Strict read guard: further read of ${range.label} blocked because an earlier read of this file was already blocked this turn. Answer from existing context or use grep/search for the missing fact.`;
      this.lastSummary = `strict-blocked ${range.label}`;
      return { block: true, reason };
    }
    return undefined;
  }

  /** Remember a successful read so future duplicate ranges get blocked. */
  rememberRead(input, raw, content = "") {
    const range = readRangeOf(input);
    if (!range) return;
    // Account this read against the per-batch progress budget.
    this.readCount += 1;
    if (this._isDocPath(range.path)) this.docReadCount += 1;
    const lines = typeof range.limit === "number" ? range.limit : DEFAULT_MAX_LINES;
    const actualChars = String(content || "").length;
    this.rawChars += actualChars > 0 ? actualChars : lines * 50;
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

  _isDocPath(p) {
    return typeof p === "string" && (/\.(md|markdown|txt|rst|adoc)$/i.test(p) || /(^|\/)docs?\//i.test(p));
  }

  /**
   * Block a read when the per-batch budget is spent, returning a structured
   * progress-guidance result (distinct from duplicate blocks: the caller
   * surfaces it as a non-error tool result).  Doc budget is checked first so a
   * doc-heavy batch trips the tighter doc threshold before the general one.
   */
  _checkBatchBudget(range) {
    if (this._isDocPath(range.path) && this.docReadCount >= this.maxDocReadsBeforeSummary) {
      return this._progressBlock("DOC_READ_SUMMARY_REQUIRED",
        `Already read ${this.docReadCount} doc/markdown file(s) this batch without a synthesis.`);
    }
    if (this.readCount >= this.maxReadsBeforeSummary) {
      return this._progressBlock("READ_BATCH_SUMMARY_REQUIRED",
        `Already performed ${this.readCount} reads this batch without a synthesis.`);
    }
    if (this.rawChars >= this.maxRawCharsBeforeSummary) {
      return this._progressBlock("RAW_DOC_CONTEXT_SUMMARY_REQUIRED",
        `Already pulled ~${this.rawChars} chars of file context this batch without a synthesis.`);
    }
    return undefined;
  }

  _progressBlock(type, reason) {
    this.lastSummary = `progress guard: ${type}`;
    const guidance = [
      reason,
      "Stop reading now. Produce a partial analysis from what you already have:",
      "[OBSERVATION] what was learned so far",
      "[COMPRESSED] <= 10 lines",
      "[TARGET_SELECTED] the single next thing to read, if any",
      "[VERDICT] GO / STOP / RETEST"
    ].join("\n");
    return { block: true, progressGuidance: true, type, reason, guidance };
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

  _nearDuplicate(range) {
    const end = rangeEnd(range);
    if (!Number.isFinite(end)) return undefined; // whole-file reads handled by _covering
    return this._rangesForPath(range.path).find((seen) => {
      const seenEnd = rangeEnd(seen);
      if (!Number.isFinite(seenEnd)) return false;
      return overlapRatio(seen.offset, seenEnd, range.offset, end) >= NEAR_DUPLICATE_READ_RATIO;
    });
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

  // Detect when bash is used to call sage manually — redirect to sage tool.
  // It may appear after shell control operators, e.g. `cd repo && sage file.sage`.
  const sagePattern = /(?:^|[;&|()])\s*(sage|Sage)\b/m;
  if (sagePattern.test(command.trim())) {
    return "bash command invokes sage manually. Use the 'sage' tool instead — it returns LaTeX automatically and logs to Call Debug.";
  }

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
// ---------------------------------------------------------------------------
// sage
// ---------------------------------------------------------------------------

const SAGE_META_BEGIN = "__DS4_SAGE_META_BEGIN__";
const SAGE_META_END = "__DS4_SAGE_META_END__";
const DEFAULT_SAGE_ARTIFACT_MAX_BYTES = 25 * 1024 * 1024;
const SAGE_ARTIFACT_MEDIA_TYPES = Object.freeze({
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".csv": "text/csv",
  ".json": "application/json"
});

function sageArtifactMaxBytes() {
  const configured = Number(process.env.DS4_SAGE_MAX_ARTIFACT_BYTES);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_SAGE_ARTIFACT_MAX_BYTES;
}

function pathIsInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function listSageArtifacts(
  dir,
  { sessionId = "default", maxBytes = sageArtifactMaxBytes() } = {}
) {
  const artifacts = new Map();
  let root;
  let entries;
  try {
    root = await fs.realpath(dir);
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return artifacts;
  }

  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    const mediaType = SAGE_ARTIFACT_MEDIA_TYPES[extension];
    if (!mediaType) continue;

    const unresolved = path.join(root, entry.name);
    try {
      const physicalPath = await fs.realpath(unresolved);
      if (!pathIsInside(root, physicalPath)) continue;
      const stats = await fs.stat(physicalPath);
      if (!stats.isFile() || stats.size <= 0 || stats.size > maxBytes) continue;
      artifacts.set(entry.name, {
        name: entry.name,
        physicalPath,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        ino: stats.ino,
        mediaType,
        url: `/api/sage/artifacts/${encodeURIComponent(sanitizeSessionId(sessionId))}/${encodeURIComponent(entry.name)}`
      });
    } catch {
      // An artifact that disappears or cannot be resolved is not publishable.
    }
  }
  return artifacts;
}

export function diffSageArtifacts(before, after) {
  const created = [];
  for (const [name, artifact] of after instanceof Map ? after : []) {
    const previous = before instanceof Map ? before.get(name) : null;
    if (previous && previous.size === artifact.size &&
        previous.mtimeMs === artifact.mtimeMs && previous.ino === artifact.ino) {
      continue;
    }
    created.push({
      name: artifact.name,
      url: artifact.url,
      mediaType: artifact.mediaType,
      size: artifact.size
    });
  }
  return created.sort((left, right) => left.name.localeCompare(right.name));
}

export function extractSageMeta(stdout) {
  const source = String(stdout ?? "");
  const begin = source.lastIndexOf(SAGE_META_BEGIN);
  if (begin < 0) return { cleanStdout: source.trim(), meta: null, parseError: null };

  const jsonStart = begin + SAGE_META_BEGIN.length;
  const end = source.indexOf(SAGE_META_END, jsonStart);
  if (end < 0) {
    return {
      cleanStdout: source.slice(0, begin).trim(),
      meta: null,
      parseError: "Sage metadata end sentinel is missing."
    };
  }

  const cleanStdout = `${source.slice(0, begin)}${source.slice(end + SAGE_META_END.length)}`
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  try {
    return {
      cleanStdout,
      meta: JSON.parse(source.slice(jsonStart, end).trim()),
      parseError: null
    };
  } catch (error) {
    return { cleanStdout, meta: null, parseError: error.message };
  }
}

function normalizeSageOutputMode(value) {
  const normalized = String(value ?? "auto").trim().toLowerCase();
  return ["auto", "structured", "legacy"].includes(normalized) ? normalized : "auto";
}

function redactSageLocalPaths(value, cwd) {
  let text = String(value ?? "");
  if (cwd) text = text.split(String(cwd)).join("[sage-session]");
  return text.replace(/\/(?:home|mnt|tmp|var\/tmp)\/[^\s"'`<>\])}]+/g, "[local-path]");
}

function sageModelContent({ stdout, latexOutput, report, artifacts, status, cwd }) {
  const parts = [];
  const cleanStdout = redactSageLocalPaths(stdout, cwd).trim();
  if (cleanStdout) parts.push(cleanStdout);
  if (latexOutput && !cleanStdout.includes(latexOutput)) {
    parts.push(`LaTeX: ${latexOutput}`);
  }
  if (report) {
    parts.push(`Structured report:\n${redactSageLocalPaths(JSON.stringify(report), cwd)}`);
  }
  if (artifacts.length) {
    parts.push([
      "Artifacts:",
      ...artifacts.map((artifact) => `- [${artifact.name}](${artifact.url})`)
    ].join("\n"));
  }
  if (!parts.length) {
    parts.push(status === "ok"
      ? "SageMath completed without standard output."
      : "SageMath execution failed. Technical diagnostics are available in debug.");
  }
  return parts.join("\n\n");
}

function structuredSageResult({
  stdout,
  stderr,
  exitCode,
  signalName,
  killed,
  durationMs,
  taskType,
  phase,
  attempt,
  latexOutput,
  meta,
  parseError,
  artifacts,
  cwd
}) {
  const fallback = buildLegacySageResult({
    stdout,
    stderr,
    exitCode,
    signal: signalName,
    killed,
    durationMs,
    taskType,
    phase,
    attempt,
    latexOutput
  });
  fallback.artifacts = artifacts;
  fallback.model.content = sageModelContent({
    stdout,
    latexOutput,
    report: null,
    artifacts,
    status: fallback.status,
    cwd
  });
  if (parseError) fallback.debug.metaParseError = parseError;

  if (!meta || meta.contractVersion !== SAGE_RESULT_CONTRACT_VERSION) return fallback;

  const validation = meta.validation && typeof meta.validation === "object" &&
      typeof meta.validation.passed === "boolean"
    ? {
        ...meta.validation,
        checks: Array.isArray(meta.validation.checks) ? meta.validation.checks : [],
        warnings: Array.isArray(meta.validation.warnings) ? meta.validation.warnings : []
      }
    : fallback.validation;
  const report = meta.report ?? null;
  const candidate = {
    ...fallback,
    display: {
      ...fallback.display,
      summary: fallback.status === "ok"
        ? report
          ? "Report matematico preparato."
          : artifacts.length
            ? "Calcolo completato con artefatti."
            : fallback.display.summary
        : fallback.display.summary
    },
    model: {
      content: sageModelContent({
        stdout,
        latexOutput,
        report,
        artifacts,
        status: fallback.status,
        cwd
      }),
      latex: latexOutput ? [latexOutput] : [],
      facts: []
    },
    report,
    artifacts,
    validation
  };
  const checked = validateSageResult(candidate);
  if (!checked.ok) {
    fallback.debug.metaValidationErrors = checked.errors.map((error) => ({
      code: error.code,
      path: error.path
    }));
    return fallback;
  }
  return candidate;
}

/**
 * Execute a SageMath computation and return the result.
 * Uses `sage -c "code"` which runs Sage and prints output.
 * Falls back to `sage -c "print(\"LaTeX:\"); print(latex(\"code\"))"` for
 * LaTeX-formatted math when possible.
 */
export async function toolSage(args, options) {
  const code = args.code;
  if (!code || typeof code !== "string") {
    return { content: "sage: code is required", isError: true };
  }

  const timeoutSec = Number(args.timeout_sec) || 60;
  const taskType = normalizeSageTaskType(args.task_type);
  const phase = normalizeSagePhase(args.phase);
  const outputMode = normalizeSageOutputMode(args.output_mode);
  const attempt = Number(options.sageAttempt) || 1;
  const structuredEnabled = process.env.DS4_SAGE_STRUCTURED_RESULT !== "0" &&
    outputMode !== "legacy";
  // Sage writes preparse artifacts (.sage.py), saved plots and other generated
  // files into its cwd. Prefer the per-session sage directory when provided so
  // those artifacts land in the workspace (grouped by session) instead of the
  // project tree; fall back to the workspace root for backward compatibility.
  const cwd = options.sageWorkdir
    ? path.resolve(options.sageWorkdir)
    : workspaceRoot(options);
  try {
    await fs.mkdir(cwd, { recursive: true });
  } catch {
    // best effort: a real cwd failure surfaces as a spawn error below
  }
  const sageCallLog = options.sageCallLog;
  const beforeFiles = structuredEnabled
    ? await listSageArtifacts(cwd, { sessionId: options.sessionKey })
    : new Map();

  // Wrap the user code so Sage can run either a single expression or a full
  // multi-statement Sage script.  We preparse the submitted Sage syntax before
  // compile/eval/exec so Sage-only constructs such as `2^3`, `var('x')`, and
  // `f(x) = ...` keep their normal meaning.  Expression results are printed as
  // both LaTeX and plain text.  For scripts, stdout is preserved; if the script
  // assigns `result` or `__result__`, that value is also rendered as LaTeX.
  const userCodeLiteral = JSON.stringify(code);
  const structuredPrelude = structuredEnabled
    ? "__ds4_report__ = None\n__ds4_validation__ = None"
    : "";
  const structuredEpilogue = structuredEnabled
    ? `
import json as __ds4_json__
print("${SAGE_META_BEGIN}")
print(__ds4_json__.dumps({
    "contractVersion": "${SAGE_RESULT_CONTRACT_VERSION}",
    "report": __ds4_report__,
    "validation": __ds4_validation__
}, default=str))
print("${SAGE_META_END}")`
    : "";
  const wrapper = `
from sage.all import *
from sage.repl.preparse import preparse

${structuredPrelude}
__ds4_user_code__ = ${userCodeLiteral}
__ds4_code__ = preparse(__ds4_user_code__)
__ds4_sentinel__ = object()
__ds4_result__ = __ds4_sentinel__
__ds4_globals__ = globals()

try:
    __ds4_result__ = eval(compile(__ds4_code__, "<ds4-sage-tool>", "eval"), __ds4_globals__, __ds4_globals__)
except SyntaxError:
    exec(compile(__ds4_code__, "<ds4-sage-tool>", "exec"), __ds4_globals__, __ds4_globals__)
    if "__result__" in __ds4_globals__:
        __ds4_result__ = __ds4_globals__["__result__"]
    elif "result" in __ds4_globals__:
        __ds4_result__ = __ds4_globals__["result"]

if __ds4_result__ is not __ds4_sentinel__ and __ds4_result__ is not None:
    try:
        print("LaTeX:", latex(__ds4_result__))
    except Exception:
        pass
    print("Result:", __ds4_result__)
${structuredEpilogue}
`;

  return new Promise((resolve) => {
    const stdoutBuf = new HeadTailBuffer(64 * 1024, 0);
    const stderrBuf = new HeadTailBuffer(8 * 1024, 0);
    let killed = false;
    let settled = false;
    const startTime = Date.now();

    const child = spawn("sage", ["-c", wrapper], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout.on("data", (chunk) => stdoutBuf.push(chunk));
    child.stderr.on("data", (chunk) => stderrBuf.push(chunk));

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutSec * 1000);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      if (sageCallLog) {
        sageCallLog.record({
          type: "sage_call",
          code: code.slice(0, 200),
          status: "error",
          error: err.message,
          durationMs
        });
      }
      if (!structuredEnabled) {
        resolve({ content: `sage error: ${err.message}`, isError: true });
        return;
      }
      const sageResult = buildLegacySageResult({
        stdout: "",
        stderr: err.message,
        exitCode: null,
        signal: null,
        killed: false,
        durationMs,
        taskType,
        phase,
        attempt,
        latexOutput: null
      });
      resolve({
        content: sageResult.model.content,
        isError: true,
        latexOutput: null,
        sageResult,
        displayContent: sageResult.display.summary,
        artifacts: [],
        debug: sageResult.debug,
        raw: {
          exit_code: null,
          signal: null,
          killed: false,
          stdout_bytes: 0,
          stderr_bytes: Buffer.byteLength(err.message, "utf8")
        }
      });
    });

    child.on("exit", (exitCode, signalName) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = stdoutBuf.toString().trim();
      const stderr = stderrBuf.toString().trim();
      const durationMs = Date.now() - startTime;

      // Extract LaTeX for frontend rendering hint
      let latexOutput = null;
      const extracted = structuredEnabled
        ? extractSageMeta(stdout)
        : { cleanStdout: stdout, meta: null, parseError: null };
      const latexMatch = extracted.cleanStdout.match(/^LaTeX:\s*(.+)$/m);
      if (latexMatch) {
        latexOutput = latexMatch[1].trim();
      }

      // Log to sage call debug
      const sageCode = args.code; // original code string (not shadowed by exit code)
      if (sageCallLog) {
        sageCallLog.record({
          type: "sage_call",
          code: typeof sageCode === "string" ? sageCode.slice(0, 200) : String(sageCode),
          status: killed ? "timeout" : exitCode === 0 ? "success" : "error",
          exitCode,
          stdoutBytes: stdoutBuf.total,
          stderrBytes: stderrBuf.total,
          durationMs,
          latexOutput,
          stdout,
          stderr
        });
      }

      const doResolve = async () => {
        if (!structuredEnabled) {
          const parts = [];
          if (stdout) parts.push(stdout);
          if (stderr) parts.push(`stderr: ${stderr}`);
          if (killed) parts.push("(killed: timeout exceeded)");
          else if (exitCode !== 0 && !stdout) parts.push(`sage exit code: ${exitCode}`);
          let content = parts.join("\n\n");
          if (options.toolBlobStore && content && Buffer.byteLength(content, "utf8") >= 4096) {
            const compressed = await compressToolOutput(
              "sage", content, Buffer.byteLength(content, "utf8"), options.toolBlobStore
            );
            if (compressed && compressed.changed && compressed.text) content = compressed.text;
          }
          resolve({
            content,
            isError: (exitCode !== 0 && !stdout) || killed,
            latexOutput,
            raw: {
              exit_code: exitCode,
              signal: signalName,
              killed,
              stdout_bytes: stdoutBuf.total,
              stderr_bytes: stderrBuf.total
            }
          });
          return;
        }

        const afterFiles = await listSageArtifacts(cwd, { sessionId: options.sessionKey });
        const artifacts = diffSageArtifacts(beforeFiles, afterFiles);
        const sageResult = structuredSageResult({
          stdout: extracted.cleanStdout,
          stderr,
          exitCode,
          signalName,
          killed,
          durationMs,
          taskType,
          phase,
          attempt,
          latexOutput,
          meta: extracted.meta,
          parseError: extracted.parseError,
          artifacts,
          cwd
        });
        let content = sageResult.model.content;
        if (options.toolBlobStore && content && Buffer.byteLength(content, "utf8") >= 4096) {
          const compressed = await compressToolOutput(
            "sage", content, Buffer.byteLength(content, "utf8"), options.toolBlobStore
          );
          if (compressed && compressed.changed && compressed.text) {
            content = compressed.text;
            sageResult.model.content = content;
          }
        }
        resolve({
          content,
          isError: sageResult.status !== "ok",
          latexOutput,
          sageResult,
          displayContent: sageResult.display.summary,
          artifacts: sageResult.artifacts,
          debug: sageResult.debug,
          raw: {
            exit_code: exitCode,
            signal: signalName,
            killed,
            stdout_bytes: stdoutBuf.total,
            stderr_bytes: stderrBuf.total
          }
        });
      };
      doResolve();
    });
  });
}

// ---------------------------------------------------------------------------
// web_search / web_read
// ---------------------------------------------------------------------------

async function toolWebSearch(args, options) {
  const validation = validateSearchQuery(args.query);

  if (!validation.ok) {
    return {
      content: `web_search blocked: ${validation.reason}`,
      isError: true,
      raw: {
        query: validation.query,
        reason: validation.reason
      }
    };
  }

  const maxResults = Number(args.max_results) || 10;

  try {
    const content = await webSearch(validation.query, maxResults);
    return {
      content,
      isError: false,
      raw: { query: validation.query }
    };
  } catch (err) {
    return { content: `web_search error: ${err.message}`, isError: true };
  }
}

async function toolWebRead(args, options) {
  const url = args.url;
  if (!url) return { content: "web_read: url is required", isError: true };
  const signal = options.signal;

  try {
    const content = await webReadPage(url);
    return { content, isError: false };
  } catch (err) {
    return { content: `web_read error: ${err.message}`, isError: true };
  }
}

async function toolCrawl(args, options) {
  const url = args.url;
  if (!url) return { content: "crawl: url is required", isError: true };
  if (!options.crawlBaseUrl) {
    return { content: "crawl error: crawl service is not configured", isError: true };
  }
  try {
    const res = await crawlUrl(fetch, {
      baseUrl: options.crawlBaseUrl,
      token: options.crawlToken,
      url,
      signal: options.signal
    });
    if (!res.ok) return { content: `crawl error: ${res.message}`, isError: true };
    return { content: summarizeCrawlManifest(res.manifest), isError: false, raw: { url, manifest: res.manifest } };
  } catch (err) {
    return { content: `crawl error: ${err.message}`, isError: true };
  }
}

async function toolResearchDiscover(args, options) {
  const validation = validateSearchQuery(args.query);
  if (!validation.ok) {
    return {
      content: `research_discover blocked: ${validation.reason}`,
      isError: true,
      raw: { query: validation.query, reason: validation.reason }
    };
  }

  const service = options.researchService;
  if (!service || !service.enabled()) {
    // No research providers configured — degrade to plain web_search.
    try {
      const content = await webSearch(validation.query, 10);
      return {
        content: `(research service not configured — fell back to web_search)\n\n${content}`,
        isError: false,
        raw: { query: validation.query, fallback: true }
      };
    } catch (err) {
      return { content: `research_discover error: ${err.message}`, isError: true };
    }
  }

  try {
    const sources = await service.gather([validation.query], { signal: options.signal });
    return {
      content: formatResearchSources(sources, {
        depth: args.depth,
        requirePrimarySources: Boolean(args.requirePrimarySources)
      }),
      isError: false,
      raw: { query: validation.query, count: sources.length }
    };
  } catch (err) {
    return { content: `research_discover error: ${err.message}`, isError: true };
  }
}

function toolHistory(args, options) {
  const messages = Array.isArray(options.history) ? options.history : [];
  const rows = searchChatHistory(messages, {
    query: args.query,
    kind: args.kind,
    maxResults: Number(args.max_results) || 10
  });
  return {
    content: formatHistoryResults(rows, { query: args.query }),
    isError: false,
    raw: { count: rows.length }
  };
}

export function checkBashFileReadFallback(input, afterReadGuardBlock = false) {
  const reason = bashFileReadFallbackReason(input);
  if (!reason) return undefined;
  const context = afterReadGuardBlock ? " after a read guard block" : "";
  return {
    block: true,
    reason: `Bash guard: ${reason}${context}. Use the 'read' tool for file contents; do not bypass it with cat/head/tail/sed/awk, find -exec cat, xargs cat, or scripts. Use grep/search for precise lookups.`
  };
}
