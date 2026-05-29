import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  exportConversationMarkdown,
  parseConversationMarkdown,
  parseConversationMetadata
} from "../src/conversationExport.mjs";

export function historyFileName(date = new Date(), uniqueId = randomUUID().slice(0, 8)) {
  const stamp = date.toISOString().slice(0, 19).replace("T", "-").replaceAll(":", "-");
  return `ds4-history-${stamp}-${uniqueId}.md`;
}

export async function saveConversationHistory(messages, {
  dir,
  includeReasoning = false,
  now = new Date(),
  uniqueId = randomUUID().slice(0, 8),
  fileName: requestedFileName,
  metadata = null
} = {}) {
  const historyDir = String(dir || "").trim();
  if (!historyDir) throw new Error("history directory is required");

  const resolvedDir = path.resolve(historyDir);
  await fs.mkdir(resolvedDir, { recursive: true });

  let fileName;
  if (requestedFileName) {
    assertSafeHistoryFileName(requestedFileName);
    fileName = requestedFileName;
  } else {
    fileName = historyFileName(now, uniqueId);
  }
  const filePath = path.join(resolvedDir, fileName);
  const markdown = exportConversationMarkdown(messages, { includeReasoning, metadata });
  await fs.writeFile(filePath, markdown, "utf8");

  return { fileName, filePath };
}

function historyTitle(messages) {
  const firstUser = messages.find((message) => message.role === "user" && message.content);
  const raw = firstUser?.content || messages[0]?.content || "Conversation";
  const firstLine = String(raw).split(/\r?\n/).find((line) => line.trim()) || "Conversation";
  return firstLine.trim().slice(0, 120);
}

function assertSafeHistoryFileName(fileName) {
  if (!fileName || fileName !== path.basename(fileName) || !fileName.endsWith(".md")) {
    throw new Error("invalid history file");
  }
}

export async function listConversationHistory(dir, { limit = 50 } = {}) {
  const historyDir = String(dir || "").trim();
  if (!historyDir) return [];
  const resolvedDir = path.resolve(historyDir);

  let entries;
  try {
    entries = await fs.readdir(resolvedDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const sessions = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = path.join(resolvedDir, entry.name);
    const [stats, markdown] = await Promise.all([
      fs.stat(filePath),
      fs.readFile(filePath, "utf8").catch(() => "")
    ]);
    const messages = parseConversationMarkdown(markdown);
    sessions.push({
      fileName: entry.name,
      title: historyTitle(messages),
      modifiedAt: stats.mtime.toISOString(),
      size: stats.size,
      messages: messages.length
    });
  }

  return sessions
    .sort((a, b) => b.fileName.localeCompare(a.fileName))
    .slice(0, limit);
}

export async function loadConversationHistory(dir, fileName) {
  const historyDir = String(dir || "").trim();
  if (!historyDir) throw new Error("history directory is required");
  assertSafeHistoryFileName(fileName);

  const resolvedDir = path.resolve(historyDir);
  const filePath = path.join(resolvedDir, fileName);
  const markdown = await fs.readFile(filePath, "utf8");
  return {
    fileName,
    markdown,
    messages: parseConversationMarkdown(markdown),
    metadata: parseConversationMetadata(markdown)
  };
}

export async function deleteConversationHistory(dir, fileName) {
  const historyDir = String(dir || "").trim();
  if (!historyDir) throw new Error("history directory is required");
  assertSafeHistoryFileName(fileName);

  const resolvedDir = path.resolve(historyDir);
  const filePath = path.join(resolvedDir, fileName);
  await fs.unlink(filePath);
  return { fileName };
}

export async function deleteAllConversationHistory(dir) {
  const historyDir = String(dir || "").trim();
  if (!historyDir) throw new Error("history directory is required");
  const resolvedDir = path.resolve(historyDir);

  let entries;
  try {
    entries = await fs.readdir(resolvedDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return { deleted: 0, fileNames: [] };
    throw err;
  }

  const deleted = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    await fs.unlink(path.join(resolvedDir, entry.name));
    deleted.push(entry.name);
  }
  return { deleted: deleted.length, fileNames: deleted };
}
