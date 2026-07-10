import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { appendJsonlCapped, trimJsonlToCap } from "./contextJsonl.mjs";

async function tmpFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-jsonl-"));
  return path.join(dir, "log.jsonl");
}
function rows(text) {
  return text.split(/\r?\n/).filter(Boolean);
}

test("trimJsonlToCap keeps only the last cap rows", async () => {
  const file = await tmpFile();
  await fs.writeFile(file, Array.from({ length: 20 }, (_, i) => JSON.stringify({ i })).join("\n") + "\n");
  await trimJsonlToCap(file, 10);
  const kept = rows(await fs.readFile(file, "utf8")).map((l) => JSON.parse(l).i);
  assert.equal(kept.length, 10);
  assert.equal(kept[0], 10);
  assert.equal(kept[9], 19);
});

test("trimJsonlToCap is a no-op under cap", async () => {
  const file = await tmpFile();
  await fs.writeFile(file, JSON.stringify({ a: 1 }) + "\n");
  await trimJsonlToCap(file, 100);
  assert.equal(rows(await fs.readFile(file, "utf8")).length, 1);
});

test("appendJsonlCapped bounds file growth to ~cap", async () => {
  const file = await tmpFile();
  const cap = 10;
  for (let i = 0; i < 200; i++) await appendJsonlCapped(file, { i }, cap);
  const n = rows(await fs.readFile(file, "utf8")).length;
  // trimming runs every ~cap/5 appends, so the file never exceeds cap + margin.
  assert.ok(n <= cap + Math.floor(cap / 5), `rows=${n}`);
  assert.ok(n >= cap - 1, `rows=${n}`);
});

test("appendJsonlCapped with cap=0 never trims", async () => {
  const file = await tmpFile();
  for (let i = 0; i < 5; i++) await appendJsonlCapped(file, { i }, 0);
  assert.equal(rows(await fs.readFile(file, "utf8")).length, 5);
});
