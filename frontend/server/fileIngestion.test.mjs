import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  ACCEPT_ATTRIBUTE,
  ingestUploadedFile,
  isSupportedFileName,
  sanitizeFileName
} from "./fileIngestion.mjs";

test("sanitizes uploaded file names and rejects unsupported extensions", () => {
  assert.equal(sanitizeFileName("../Report Finale!.md"), "Report_Finale.md");
  assert.equal(isSupportedFileName("notes.md"), true);
  assert.equal(isSupportedFileName("archive.exe"), false);
  assert.match(ACCEPT_ATTRIBUTE, /\.pdf/);
  assert.match(ACCEPT_ATTRIBUTE, /\.docx/);
});

test("ingestUploadedFile stores the upload and writes extracted markdown", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "ds4-ingest-"));
  try {
    const source = path.join(tmp, "source.md");
    await writeFile(source, "# Titolo\n\nContenuto da analizzare.\n", "utf8");

    const result = await ingestUploadedFile(
      { path: source, originalname: "../Report Finale!.md", size: 32 },
      { workspaceRoot: path.join(tmp, "workspace"), now: new Date("2026-05-15T12:00:00Z"), uniqueId: "abc123" }
    );

    assert.equal(path.dirname(result.uploadPath), path.join(tmp, "workspace", "upload"));
    assert.equal(path.dirname(result.extractPath), path.join(tmp, "workspace", "extract"));
    assert.equal(path.basename(result.uploadPath), "20260515T120000Z-abc123-Report_Finale.md");
    assert.equal(path.basename(result.extractPath), "20260515T120000Z-abc123-Report_Finale.md.md");
    assert.equal(result.name, "Report_Finale.md");
    assert.match(result.markdown, /# File: Report_Finale\.md/);
    assert.match(result.markdown, /Contenuto da analizzare/);

    const extracted = await readFile(result.extractPath, "utf8");
    assert.equal(extracted, result.markdown);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
