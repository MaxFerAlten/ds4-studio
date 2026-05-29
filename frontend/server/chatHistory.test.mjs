import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  deleteAllConversationHistory,
  deleteConversationHistory,
  historyFileName,
  listConversationHistory,
  loadConversationHistory,
  saveConversationHistory
} from "./chatHistory.mjs";

test("historyFileName creates stable markdown names", () => {
  assert.equal(
    historyFileName(new Date("2026-05-24T12:34:56Z"), "abc123"),
    "ds4-history-2026-05-24-12-34-56-abc123.md"
  );
});

test("saveConversationHistory writes markdown to the selected directory", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "ds4-history-test-"));
  try {
    const saved = await saveConversationHistory(
      [
        { role: "user", content: "Spiega $x^2$" },
        { role: "assistant", content: "Risposta", reasoning: "ragionamento interno" }
      ],
      { dir: tmp, now: new Date("2026-05-24T12:34:56Z"), uniqueId: "abc123" }
    );

    assert.equal(saved.fileName, "ds4-history-2026-05-24-12-34-56-abc123.md");
    assert.equal(path.dirname(saved.filePath), tmp);
    assert.ok((await stat(saved.filePath)).isFile());

    const markdown = await readFile(saved.filePath, "utf8");
    assert.match(markdown, /^# DS4 Conversation/);
    assert.match(markdown, /## User\n\nSpiega \$x\^2\$/);
    assert.doesNotMatch(markdown, /ragionamento interno/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("listConversationHistory lists saved sessions newest first", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "ds4-history-list-test-"));
  try {
    await saveConversationHistory(
      [{ role: "user", content: "prima domanda" }, { role: "assistant", content: "prima risposta" }],
      { dir: tmp, now: new Date("2026-05-24T12:00:00Z"), uniqueId: "old" }
    );
    await saveConversationHistory(
      [{ role: "user", content: "seconda domanda" }, { role: "assistant", content: "seconda risposta" }],
      { dir: tmp, now: new Date("2026-05-24T12:01:00Z"), uniqueId: "new" }
    );

    const sessions = await listConversationHistory(tmp);

    assert.equal(sessions.length, 2);
    assert.match(sessions[0].fileName, /new/);
    assert.equal(sessions[0].title, "seconda domanda");
    assert.match(sessions[1].fileName, /old/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("deleteConversationHistory removes a single session file", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "ds4-history-del-test-"));
  try {
    const a = await saveConversationHistory(
      [{ role: "user", content: "a" }, { role: "assistant", content: "1" }],
      { dir: tmp, now: new Date("2026-05-24T12:00:00Z"), uniqueId: "aaa" }
    );
    const b = await saveConversationHistory(
      [{ role: "user", content: "b" }, { role: "assistant", content: "2" }],
      { dir: tmp, now: new Date("2026-05-24T12:01:00Z"), uniqueId: "bbb" }
    );

    const result = await deleteConversationHistory(tmp, a.fileName);
    assert.equal(result.fileName, a.fileName);

    const sessions = await listConversationHistory(tmp);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].fileName, b.fileName);

    await assert.rejects(() => deleteConversationHistory(tmp, "../escape.md"), /invalid history file/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("deleteAllConversationHistory removes every markdown session", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "ds4-history-delall-test-"));
  try {
    await saveConversationHistory(
      [{ role: "user", content: "a" }, { role: "assistant", content: "1" }],
      { dir: tmp, now: new Date("2026-05-24T12:00:00Z"), uniqueId: "aaa" }
    );
    await saveConversationHistory(
      [{ role: "user", content: "b" }, { role: "assistant", content: "2" }],
      { dir: tmp, now: new Date("2026-05-24T12:01:00Z"), uniqueId: "bbb" }
    );

    const result = await deleteAllConversationHistory(tmp);
    assert.equal(result.deleted, 2);
    assert.deepEqual(result.fileNames.sort(), [
      "ds4-history-2026-05-24-12-00-00-aaa.md",
      "ds4-history-2026-05-24-12-01-00-bbb.md"
    ]);

    const sessions = await listConversationHistory(tmp);
    assert.equal(sessions.length, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("loadConversationHistory reads a saved session safely", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "ds4-history-load-test-"));
  try {
    const saved = await saveConversationHistory(
      [{ role: "user", content: "ciao" }, { role: "assistant", content: "salve" }],
      { dir: tmp, now: new Date("2026-05-24T12:00:00Z"), uniqueId: "abc" }
    );

    const loaded = await loadConversationHistory(tmp, saved.fileName);

    assert.equal(loaded.fileName, saved.fileName);
    assert.deepEqual(loaded.messages, [
      { role: "user", content: "ciao", reasoning: "" },
      { role: "assistant", content: "salve", reasoning: "" }
    ]);
    await assert.rejects(() => loadConversationHistory(tmp, "../outside.md"), /invalid history file/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
