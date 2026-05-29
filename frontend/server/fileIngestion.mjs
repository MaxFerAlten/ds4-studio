import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

export const DEFAULT_WORKSPACE_ROOT = "/home/tendermachine/workspace_ds4studio";
export const UPLOAD_DIR_NAME = "upload";
export const EXTRACT_DIR_NAME = "extract";

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".log",
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".env",
  ".conf",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".py",
  ".sh",
  ".bash",
  ".zsh",
  ".sql",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cu",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".swift",
  ".php",
  ".rb",
  ".lua",
  ".diff",
  ".patch"
]);

const PANDOC_INPUT_FORMATS = new Map([
  [".docx", "docx"],
  [".odt", "odt"],
  [".rtf", "rtf"],
  [".epub", "epub"],
  [".html", "html"],
  [".htm", "html"]
]);

export const SUPPORTED_EXTENSIONS = Object.freeze([
  ...TEXT_EXTENSIONS,
  ".pdf",
  ".docx",
  ".odt",
  ".rtf",
  ".epub"
].sort());

export const ACCEPT_ATTRIBUTE = SUPPORTED_EXTENSIONS.join(",");

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function extensionForName(name) {
  return path.extname(String(name || "")).toLowerCase();
}

export function isSupportedFileName(name) {
  return SUPPORTED_EXTENSIONS.includes(extensionForName(name));
}

export function sanitizeFileName(name) {
  const ext = extensionForName(name);
  const base = path.basename(String(name || "file"), ext);
  const cleanBase =
    base
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[._-]+|[._-]+$/g, "") || "file";
  const cleanExt = ext.replace(/[^a-z0-9.]/g, "");
  return `${cleanBase}${cleanExt}`;
}

export function workspacePaths(workspaceRoot = process.env.DS4_STUDIO_WORKSPACE || DEFAULT_WORKSPACE_ROOT) {
  return {
    root: workspaceRoot,
    uploadDir: path.join(workspaceRoot, UPLOAD_DIR_NAME),
    extractDir: path.join(workspaceRoot, EXTRACT_DIR_NAME)
  };
}

export async function ensureWorkspace(workspaceRoot) {
  const paths = workspacePaths(workspaceRoot);
  await mkdir(paths.uploadDir, { recursive: true });
  await mkdir(paths.extractDir, { recursive: true });
  return paths;
}

export function storedFileName(originalName, { now = new Date(), uniqueId = randomUUID().slice(0, 8) } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return `${stamp}-${uniqueId}-${sanitizeFileName(originalName)}`;
}

function languageForExtension(ext) {
  return ext.replace(/^\./, "") || "text";
}

function wrapMarkdown(name, body, ext) {
  const text = String(body || "").replace(/\0/g, "").trimEnd();
  if (ext === ".md" || ext === ".markdown") return `# File: ${name}\n\n${text}\n`;
  return `# File: ${name}\n\n\`\`\`${languageForExtension(ext)}\n${text}\n\`\`\`\n`;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (err) => reject(httpError(500, `${command} not available: ${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      const details = Buffer.concat(stderr).toString("utf8").trim();
      reject(httpError(422, `${command} failed${details ? `: ${details}` : ""}`));
    });
  });
}

async function extractMarkdown(uploadPath, originalName) {
  const ext = extensionForName(originalName);
  if (!isSupportedFileName(originalName)) {
    throw httpError(415, `unsupported file type: ${ext || "unknown"}`);
  }
  if (ext === ".pdf") {
    const text = await runCommand("pdftotext", ["-layout", uploadPath, "-"]);
    return wrapMarkdown(sanitizeFileName(originalName), text, ".txt");
  }
  if (PANDOC_INPUT_FORMATS.has(ext) && ext !== ".html" && ext !== ".htm") {
    const markdown = await runCommand("pandoc", ["-f", PANDOC_INPUT_FORMATS.get(ext), "-t", "gfm", uploadPath]);
    return `# File: ${sanitizeFileName(originalName)}\n\n${markdown.trimEnd()}\n`;
  }
  const body = await readFile(uploadPath, "utf8");
  return wrapMarkdown(sanitizeFileName(originalName), body, ext);
}

async function putUploadInWorkspace(sourcePath, uploadPath) {
  try {
    await rename(sourcePath, uploadPath);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    await copyFile(sourcePath, uploadPath);
  }
}

export async function ingestUploadedFile(file, options = {}) {
  if (!file) throw httpError(400, "missing file");
  if (!isSupportedFileName(file.originalname)) {
    throw httpError(415, `unsupported file type: ${extensionForName(file.originalname) || "unknown"}`);
  }

  const paths = await ensureWorkspace(options.workspaceRoot);
  const safeName = sanitizeFileName(file.originalname);
  const storedName = storedFileName(safeName, options);
  const uploadPath = path.join(paths.uploadDir, storedName);
  const extractPath = path.join(paths.extractDir, `${storedName}.md`);

  if (path.resolve(file.path) !== path.resolve(uploadPath)) {
    await putUploadInWorkspace(file.path, uploadPath);
  }

  const markdown = await extractMarkdown(uploadPath, safeName);
  await writeFile(extractPath, markdown, "utf8");

  return {
    name: safeName,
    originalName: file.originalname,
    size: file.size,
    uploadPath,
    extractPath,
    markdown
  };
}

const APPROX_CHARS_PER_TOKEN = 4;

export function approxTokenCount(text) {
  if (!text) return 0;
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

function pushSegment(segments, body, title) {
  const trimmed = body.replace(/^\s+|\s+$/g, "");
  if (!trimmed) return;
  segments.push({ title: title || "", body: trimmed });
}

function splitByHeadings(text) {
  const lines = text.split(/\r?\n/);
  const segments = [];
  let currentTitle = "";
  let buffer = [];
  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) {
      pushSegment(segments, buffer.join("\n"), currentTitle);
      currentTitle = m[2];
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  pushSegment(segments, buffer.join("\n"), currentTitle);
  return segments;
}

function splitByBlankLines(body) {
  return body.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
}

function hardSplit(text, maxChars) {
  const parts = [];
  for (let i = 0; i < text.length; i += maxChars) parts.push(text.slice(i, i + maxChars));
  return parts;
}

export function splitMarkdownChunks(text, targetTokens = 25000) {
  if (!text || !text.trim()) return [];
  const targetChars = Math.max(2000, Math.floor(targetTokens * APPROX_CHARS_PER_TOKEN));
  const segments = splitByHeadings(text);
  const chunks = [];
  let currentTitle = "";
  let currentBody = "";

  const flush = () => {
    if (currentBody.trim()) {
      chunks.push({
        index: chunks.length,
        title: currentTitle,
        body: currentBody.trim(),
        approxTokens: approxTokenCount(currentBody)
      });
    }
    currentBody = "";
  };

  for (const seg of segments) {
    const segText = seg.title ? `## ${seg.title}\n\n${seg.body}` : seg.body;
    if (segText.length <= targetChars) {
      if (currentBody.length + segText.length + 2 > targetChars) {
        flush();
        currentTitle = seg.title || currentTitle;
      } else if (!currentTitle) {
        currentTitle = seg.title || "";
      }
      currentBody += (currentBody ? "\n\n" : "") + segText;
      continue;
    }
    flush();
    const paragraphs = splitByBlankLines(seg.body);
    let para = seg.title ? `## ${seg.title}` : "";
    for (const p of paragraphs) {
      if (para.length + p.length + 2 > targetChars) {
        if (para.trim()) {
          chunks.push({
            index: chunks.length,
            title: seg.title,
            body: para.trim(),
            approxTokens: approxTokenCount(para)
          });
        }
        para = "";
        if (p.length > targetChars) {
          for (const slice of hardSplit(p, targetChars)) {
            chunks.push({
              index: chunks.length,
              title: seg.title,
              body: slice,
              approxTokens: approxTokenCount(slice)
            });
          }
          continue;
        }
      }
      para += (para ? "\n\n" : "") + p;
    }
    if (para.trim()) {
      chunks.push({
        index: chunks.length,
        title: seg.title,
        body: para.trim(),
        approxTokens: approxTokenCount(para)
      });
    }
    currentTitle = "";
    currentBody = "";
  }
  flush();
  return chunks;
}
