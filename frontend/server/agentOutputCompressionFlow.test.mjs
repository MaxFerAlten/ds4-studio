import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentLoopGuard, guardAssistantDelta, hasStructuredSynthesis } from "./agentLoopGuard.mjs";
import { ReadGuard } from "./agentTools.mjs";
import { checkVerifiedClaim } from "./claimGuard.mjs";
import { ToolBlobStore } from "./toolBlobStore.mjs";
import { compressToolResultForModel } from "./toolOutputCompressor.mjs";

test("scenario A: list output is compressed and assistant file echo is blocked", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "ds4-agent-output-flow-"));
  try {
    const blobStore = new ToolBlobStore(tmp);
    const original = Array.from({ length: 100 }, (_, i) => `src/file_${i}.c`).join("\n");
    const result = await compressToolResultForModel(
      "list",
      { content: original, isError: false },
      blobStore
    );

    assert.equal(result.compressed, true);
    assert.match(result.content, /\[TOOL_OUTPUT_COMPRESSED\]/);

    const guard = new AgentLoopGuard();
    const first = guardAssistantDelta(
      "",
      Array.from({ length: 40 }, (_, i) => `file_${i}.c`).join(" "),
      guard
    );
    const blocked = guardAssistantDelta(first.content, " file_40.c", guard);

    assert.equal(blocked.accepted, false);
    assert.equal(blocked.decision?.type, "STOP_FILE_LIST_ECHO");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("scenario B: third documentation read requires synthesis", () => {
  const guard = new ReadGuard();
  for (const file of ["doc/a.md", "doc/b.md"]) {
    const args = { path: file, start_line: 1, max_lines: 100 };
    assert.equal(guard.checkRead(args), undefined);
    guard.rememberRead(args, { next_offset: 101 }, "documentation");
  }

  const block = guard.checkRead({ path: "doc/c.md", start_line: 1, max_lines: 100 });
  assert.equal(block?.type, "DOC_READ_SUMMARY_REQUIRED");
});

test("scenario C: repeated ambiguity is blocked", () => {
  const guard = new AgentLoopGuard();

  assert.equal(guard.checkAssistantText("Perhaps the user means doc/ or the parent repository."), undefined);
  const block = guard.checkAssistantText("Given the ambiguity, maybe the docs or the parent repository.");

  assert.equal(block?.type, "STOP_AMBIGUITY_LOOP");
});

test("scenario D: verified claim without evidence is blocked", () => {
  const block = checkVerifiedClaim("All bugs are fixed and make cpu passes.", "");

  assert.equal(block?.type, "STOP_UNSUPPORTED_VERIFIED_CLAIM");
  assert.equal(block?.block, true);
});

test("scenario E: valid structured synthesis clears observation and read budgets", () => {
  const loopGuard = new AgentLoopGuard();
  const readGuard = new ReadGuard();
  for (const file of ["doc/a.md", "doc/b.md"]) {
    readGuard.rememberRead(
      { path: file, start_line: 1, max_lines: 100 },
      { next_offset: 101 },
      "documentation"
    );
  }
  assert.equal(
    readGuard.checkRead({ path: "doc/c.md", start_line: 1, max_lines: 100 })?.type,
    "DOC_READ_SUMMARY_REQUIRED"
  );

  loopGuard.recordCompressedObservation();
  const synthesis = [
    "[OBSERVATION] Large repo listing suppressed.",
    "[COMPRESSED] Relevant area is frontend/server agent runtime.",
    "[TARGET_SELECTED] frontend/server/toolOutputCompressor.mjs",
    "[VERDICT] GO"
  ].join("\n");

  assert.equal(loopGuard.checkAssistantText(synthesis), undefined);
  if (hasStructuredSynthesis(synthesis)) readGuard.markSummaryProduced();

  assert.equal(loopGuard.requiresStructuredObservation(), false);
  assert.equal(
    readGuard.checkRead({ path: "doc/c.md", start_line: 1, max_lines: 100 }),
    undefined
  );
});
