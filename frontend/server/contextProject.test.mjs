import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import {
  upsertProjectListItem,
  readProjectDoc,
  appendProjectEvent,
  recordProjectActiveFile,
  PROJECT_DOCS
} from "./contextProject.mjs";
import { projectContextDir } from "./contextPaths.mjs";

function freshWs() {
  return `/tmp/ws-${crypto.randomUUID()}`;
}
async function cleanup(ws) {
  await fs.rm(projectContextDir(ws), { recursive: true, force: true });
}

test("upsert adds a bullet and read returns it", async () => {
  const ws = freshWs();
  try {
    const r = await upsertProjectListItem(ws, PROJECT_DOCS.decisions, "prefer blob store");
    assert.equal(r.changed, true);
    assert.deepEqual(await readProjectDoc(ws, PROJECT_DOCS.decisions), ["prefer blob store"]);
  } finally {
    await cleanup(ws);
  }
});

test("upsert is a no-op for a duplicate item", async () => {
  const ws = freshWs();
  try {
    await upsertProjectListItem(ws, PROJECT_DOCS.decisions, "same item");
    const r = await upsertProjectListItem(ws, PROJECT_DOCS.decisions, "same item");
    assert.equal(r.changed, false);
    assert.equal((await readProjectDoc(ws, PROJECT_DOCS.decisions)).length, 1);
  } finally {
    await cleanup(ws);
  }
});

test("doc carries a last-updated header", async () => {
  const ws = freshWs();
  try {
    await upsertProjectListItem(ws, PROJECT_DOCS.hazards, "rocm header path");
    const text = await fs.readFile(`${projectContextDir(ws)}/${PROJECT_DOCS.hazards}`, "utf8");
    assert.match(text, /^<!-- updated: .+ -->/);
  } finally {
    await cleanup(ws);
  }
});

test("upsert caps to the most recent max bullets", async () => {
  const ws = freshWs();
  try {
    for (let i = 0; i < 10; i++) await upsertProjectListItem(ws, PROJECT_DOCS.activeFiles, `f${i}.c`, { max: 3 });
    const docs = await readProjectDoc(ws, PROJECT_DOCS.activeFiles);
    assert.equal(docs.length, 3);
    assert.deepEqual(docs, ["f7.c", "f8.c", "f9.c"]);
  } finally {
    await cleanup(ws);
  }
});

test("recordProjectActiveFile populates active-files.md", async () => {
  const ws = freshWs();
  try {
    await recordProjectActiveFile(ws, "src/agent.c");
    assert.deepEqual(await readProjectDoc(ws, PROJECT_DOCS.activeFiles), ["src/agent.c"]);
  } finally {
    await cleanup(ws);
  }
});

test("appendProjectEvent writes the project ledger", async () => {
  const ws = freshWs();
  try {
    await appendProjectEvent(ws, { type: "decision", summary: "x" });
    const text = await fs.readFile(`${projectContextDir(ws)}/project-ledger.jsonl`, "utf8");
    assert.match(text, /"type":"decision"/);
    assert.match(text, /"at":/);
  } finally {
    await cleanup(ws);
  }
});

test("readProjectDoc returns [] for a missing doc", async () => {
  assert.deepEqual(await readProjectDoc(freshWs(), PROJECT_DOCS.decisions), []);
});
