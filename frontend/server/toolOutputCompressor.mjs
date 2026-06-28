/**
 * Tool output compressor — JS equivalent of ds4_tool_compress.c
 *
 * Classifies tool output by content type and applies lossy compression
 * strategies (head/tail, top matches, hunk summary, etc.).  When compression
 * reduces the size below 80% of the original and the original is ≥ 4096 bytes,
 * the original is saved to a ToolBlobStore and replaced with a marker + summary.
 */

// Thresholds matching ds4_tool_compress.c
const MIN_BYTES = 4096;
const HUGE_BYTES = 32_768;
const MAX_INLINE_BYTES = 12_000;
const MIN_RATIO_NUM = 4;
const MIN_RATIO_DEN = 5;

/** Content kind enum matching ds4_tool_content_kind */
export const ContentKind = Object.freeze({
  UNKNOWN: "unknown",
  SEARCH: "search",
  LOG: "log",
  JSON_ARRAY: "json_array",
  DIFF: "diff",
  FILE: "file",
  TRACE: "trace"
});

/** Important keywords (case-insensitive) — lines containing these are always kept */
const IMPORTANT_NEEDLES = [
  "error", "fatal", "failed", "traceback", "panic", "exception",
  "warning", "undefined reference", "segmentation fault", "todo", "fail"
];

function isImportantLine(line) {
  const lower = line.toLowerCase();
  for (const needle of IMPORTANT_NEEDLES) {
    if (lower.includes(needle)) return true;
  }
  return false;
}

function looksGrepLine(line) {
  if (!line || line[0] === " " || line[0] === "\t") return false;
  const colon = line.indexOf(":");
  if (colon <= 0 || colon + 2 >= line.length) return false;
  let i = colon + 1;
  let digits = 0;
  while (i < line.length && line[i] >= "0" && line[i] <= "9") { digits++; i++; }
  return digits > 0 && i < line.length && line[i] === ":";
}

function looksNumberedMatchLine(line) {
  const trimmed = line.trimStart();
  if (!trimmed) return false;
  let i = 0;
  let digits = 0;
  while (i < trimmed.length && trimmed[i] >= "0" && trimmed[i] <= "9") { digits++; i++; }
  return digits > 0 && i < trimmed.length && (trimmed[i] === " " || trimmed[i] === "\t");
}

function countSubstring(text, needle) {
  if (!needle || needle.length > text.length) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(needle, pos)) !== -1) { count++; pos += needle.length; }
  return count;
}

/**
 * Classify tool output by content type.
 * Mirrors ds4_tool_classify_output() from ds4_tool_compress.c
 *
 * @param {string|null} toolName - The tool that produced the output
 * @param {string} text - The full output text
 * @param {number} len - Byte length of text
 * @returns {string} ContentKind value
 */
export function classifyOutput(toolName, text, len) {
  if (!text) text = "";
  if (toolName === "retrieve_context_blob") return ContentKind.UNKNOWN;
  if (toolName === "read" || toolName === "more" || toolName === "cat")
    return ContentKind.FILE;

  const p = text.trimStart();
  const rem = len - (text.length - p.length);
  if ((rem >= 10 && p.startsWith("diff --git")) ||
      text.includes("\ndiff --git ") ||
      countSubstring(text, "\n@@ ") >= 2)
    return ContentKind.DIFF;
  if (rem > 0 && p[0] === "[" && p.includes("{") && len > MIN_BYTES)
    return ContentKind.JSON_ARRAY;
  if ((toolName === "search") || text.includes("matches shown\n") ||
      countSubstring(text, ":") > 20) {
    const lines = text.split("\n");
    let grepish = 0, numbered = 0;
    for (let i = 0; i < Math.min(lines.length, 300); i++) {
      if (looksGrepLine(lines[i])) grepish++;
      if (looksNumberedMatchLine(lines[i])) numbered++;
    }
    if (grepish >= 8 || numbered >= 8 || toolName === "search")
      return ContentKind.SEARCH;
  }
  if (text.includes("Traceback") || text.includes("FAILED") ||
      text.includes("panic") || text.includes("error:") ||
      text.includes("warning:") || text.includes("Exception") ||
      text.includes("undefined reference"))
    return ContentKind.LOG;
  if (toolName === "bash" || toolName === "bash_status" || toolName === "bash_stop")
    return ContentKind.LOG;
  if ((text.includes("Tool result") && (text.includes("(read)") || text.includes("(more)"))) ||
      text.includes("continue_offset=") || text.includes("[Read truncated"))
    return ContentKind.FILE;
  return ContentKind.UNKNOWN;
}

/**
 * Compress a tool output.  Returns null if compression would not save enough
 * space.  When compression happens, the original text is stored in the blob
 * store and the returned text contains a marker + summary + blob id.
 *
 * @param {string} toolName - Tool name for classification
 * @param {string} text - Full output text
 * @param {number} len - Byte length of text
 * @param {ToolBlobStore} blobStore - Instance for saving originals
 * @returns {Promise<{changed:boolean, text:string|null, kind:string, strategy:string,
 *   originalBytes:number, compressedBytes:number, blobId:string|null,
 *   omittedLines:number}|null>}
 */
export async function compressToolOutput(toolName, text, len, blobStore) {
  if (!text) text = "";
  if (toolName === "retrieve_context_blob") return null;
  if (len < MIN_BYTES) return null;

  const kind = classifyOutput(toolName, text, len);
  let cand = null;

  switch (kind) {
    case ContentKind.SEARCH:
      cand = compressSearch(text, len);
      break;
    case ContentKind.DIFF:
      cand = compressDiff(text, len);
      break;
    case ContentKind.JSON_ARRAY:
      cand = compressJsonArray(text, len);
      break;
    case ContentKind.FILE:
      cand = compressFile(text, len);
      break;
    case ContentKind.LOG:
      cand = compressLog(text, len);
      break;
    default:
      if (len >= HUGE_BYTES) {
        cand = compressFile(text, len);
      }
      break;
  }

  if (!cand) return null;

  const candLen = Buffer.byteLength(cand.text, "utf8");
  if (candLen * MIN_RATIO_DEN >= len * MIN_RATIO_NUM) return null; // ratio too low

  if (!blobStore) return null;

  const blobResult = await blobStore.put(text);
  if (!blobResult || !blobResult.id) return null;

  const compressedBytes = candLen;
  const marker = buildMarker({
    strategy: cand.strategy,
    kind,
    originalBytes: len,
    compressedBytes,
    blobId: blobResult.id,
    omittedLines: cand.omittedLines
  }, cand.text);

  const markerLen = Buffer.byteLength(marker, "utf8");
  if (markerLen * MIN_RATIO_DEN >= len * MIN_RATIO_NUM) return null; // with marker, still too large

  return {
    changed: true,
    text: marker,
    kind,
    strategy: cand.strategy,
    originalBytes: len,
    compressedBytes: markerLen,
    blobId: blobResult.id,
    omittedLines: cand.omittedLines
  };
}

function buildMarker(info, body) {
  const lines = [
    "[ds4 compressed tool output]",
    `strategy: ${info.strategy}`,
    `kind: ${info.kind}`,
    `original_bytes: ${info.originalBytes}`,
    `compressed_bytes: ${info.compressedBytes}`,
    `blob_id: ${info.blobId}`,
    `retrieve: retrieve_context_blob id=${info.blobId} offset=0 length=20000`,
    "note: lossy live-zone compression; use retrieve_context_blob for exact original bytes.",
    "",
    body || ""
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Compression strategies
// ---------------------------------------------------------------------------

function compressLog(text, len) {
  const lines = text.split("\n");
  const totalLines = lines.length;

  // Show head 40, tail 80 (if enough lines), plus important lines
  const head = Math.min(totalLines, 40);
  const tailStart = totalLines > 80 ? totalLines - 80 : 0;
  const show = new Array(totalLines).fill(false);

  for (let i = 0; i < head; i++) show[i] = true;
  for (let i = tailStart; i < totalLines; i++) show[i] = true;

  let importantAdded = 0;
  for (let i = 0; i < totalLines && importantAdded < 200; i++) {
    if (isImportantLine(lines[i])) {
      if (!show[i]) importantAdded++;
      show[i] = true;
    }
  }

  const shown = show.filter(Boolean).length;
  const omittedLines = totalLines - shown;

  let out = `[log output compressed]\noriginal_lines: ${totalLines}\nshown_lines: ${shown}\nomitted_lines: ${omittedLines}\n\nimportant/head/tail lines:\n`;

  for (let i = 0; i < totalLines; i++) {
    if (!show[i]) continue;
    if (out.length > MAX_INLINE_BYTES) break;
    out += lines[i] + "\n";
  }

  return { text: out, omittedLines, strategy: "log_compressor" };
}

function compressSearch(text, len) {
  const lines = text.split("\n");
  const totalLines = lines.length;
  const show = new Array(totalLines).fill(false);

  /** @type {{name:string, total:number, shown:number}[]} */
  const fileStats = [];
  let currentFile = null;
  let currentFileLen = 0;

  for (let i = 0; i < totalLines; i++) {
    const line = lines[i];
    if (line.length === 0) continue;

    let fileName = currentFile;
    let fileLen = currentFileLen;
    let matchLine = false;

    if (looksGrepLine(line)) {
      const colon = line.indexOf(":");
      fileName = line.slice(0, colon);
      fileLen = colon;
      matchLine = true;
    } else if (looksNumberedMatchLine(line) && currentFile) {
      matchLine = true;
    } else if (line[0] !== " " && line[0] !== "\t" && !line.includes("matches shown")) {
      currentFile = line;
      currentFileLen = line.length;
      // Register new file
      const idx = fileStats.findIndex(f => f.name === line);
      if (idx < 0 && fileStats.length < 96) {
        fileStats.push({ name: line.slice(0, 192), total: 0, shown: 0 });
      }
      show[i] = true; // show file headers
    }

    if (!matchLine) continue;

    let si = fileName ? fileStats.findIndex(f => f.name === fileName) : -1;
    if (si < 0 && fileStats.length < 96) {
      si = fileStats.length;
      fileStats.push({ name: fileName.slice(0, 192), total: 0, shown: 0 });
    }
    if (si >= 0) fileStats[si].total++;
    const important = isImportantLine(line);
    if ((si >= 0 && fileStats[si].shown < 5) || important) {
      show[i] = true;
      if (si >= 0) fileStats[si].shown++;
    }
  }

  const shown = show.filter(Boolean).length;
  const omittedLines = totalLines - shown;

  let out = `[search output compressed]\noriginal_lines: ${totalLines}\nshown_lines: ${shown}\nomitted_lines: ${omittedLines}\nmatches_by_file:\n`;
  for (const s of fileStats) {
    if (!s.name) continue;
    out += `- ${s.name}: ${s.total} matches, shown ${s.shown}\n`;
  }
  out += "\nTop matches:\n";
  for (let i = 0; i < totalLines; i++) {
    if (!show[i]) continue;
    if (out.length > MAX_INLINE_BYTES) break;
    out += lines[i] + "\n";
  }

  return { text: out, omittedLines, strategy: "search_compressor" };
}

function compressDiff(text, len) {
  const lines = text.split("\n");
  let files = 0, plus = 0, minus = 0, shown = 0;
  let body = "";

  for (const line of lines) {
    let keep = false;
    if (line.startsWith("diff --git")) { files++; keep = true; }
    else if (line.startsWith("@@ ")) keep = true;
    else if (line.startsWith("+++ ") || line.startsWith("--- ")) keep = true;
    else if (line.startsWith("+") && !line.startsWith("+++")) { plus++; keep = true; }
    else if (line.startsWith("-") && !line.startsWith("---")) { minus++; keep = true; }
    if (!keep) continue;
    if (body.length < MAX_INLINE_BYTES) { body += line + "\n"; shown++; }
  }

  const omittedLines = lines.length - shown;
  let out = `[diff compressed]\nfiles_changed: ${files}\nsummary: +${plus} -${minus}\nshown_lines: ${shown}\nomitted_lines: ${omittedLines}\nshown_hunks:\n`;
  out += body;

  return { text: out, omittedLines, strategy: "diff_compressor" };
}

function compressJsonArray(text, len) {
  const objects = countSubstring(text, "{");
  const head = Math.min(len, 6000);
  const tail = len > head + 4000 ? 4000 : 0;

  let out = `[json array compressed]\nestimated_items: ${objects}\nshown: first ${head} bytes${tail ? " + last 4000 bytes" : ""}\n\nsample_first:\n`;
  out += text.slice(0, head);
  if (!out.endsWith("\n")) out += "\n";
  if (tail) {
    out += "\nsample_last:\n";
    out += text.slice(len - tail);
    if (!out.endsWith("\n")) out += "\n";
  }

  return { text: out, omittedLines: 0, strategy: "json_array_compressor" };
}

function compressFile(text, len) {
  const lines = text.split("\n");
  const totalLines = lines.length;
  const head = Math.min(totalLines, 100);
  const tail = totalLines > head + 80 ? 80 : 0;
  const shown = head + tail;
  const omittedLines = totalLines - shown;

  let out = `[file content compressed]\noriginal_lines: ${totalLines}\nshown: head ${head} lines${tail ? " + tail 80 lines" : ""}\nomitted_lines: ${omittedLines}\n\nhead:\n`;

  for (let i = 0; i < head; i++) {
    if (out.length > MAX_INLINE_BYTES) break;
    out += lines[i] + "\n";
  }

  if (tail) {
    out += "\ntail:\n";
    for (let i = totalLines - tail; i < totalLines; i++) {
      if (out.length > MAX_INLINE_BYTES) break;
      out += lines[i] + "\n";
    }
  }

  return { text: out, omittedLines, strategy: "file_head_tail_compressor" };
}
