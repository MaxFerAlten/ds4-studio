// WP11 (convergenza.loop.md §14): tool parity C↔JS.
// `more` (C agent_tool_more, shadow ds4_agent.c:6983-6989), the C-side
// aliases google_search/visit_page (shadow 1346-1347, 9464), and the schemas
// the C advertises. bash_status/bash_stop/view_image stay native-only: the JS
// bash has no background jobs (spawn + SIGKILL on timeout, agentTools.mjs
// toolBash) and no image-input verification yet (WP14) — declared in §23.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";

import { executeTool } from "./agentTools.mjs";
import { AGENT_TOOLS, MORE_TOOL, GOOGLE_SEARCH_TOOL, VISIT_PAGE_TOOL } from "./agentToolCatalog.mjs";

const toolsSource = readFileSync(new URL("./agentTools.mjs", import.meta.url), "utf8");

test("catalog: C-shaped schemas exported, never advertised in JS", () => {
  assert.equal(MORE_TOOL.function.name, "more");
  assert.equal(MORE_TOOL.function.parameters.properties.count.type, "integer");
  assert.equal(MORE_TOOL.function.parameters.required, undefined);
  assert.deepEqual(GOOGLE_SEARCH_TOOL.function.parameters.required, ["query"]);
  assert.deepEqual(VISIT_PAGE_TOOL.function.parameters.required, ["url"]);
  for (const name of ["more", "google_search", "visit_page"]) {
    assert.equal(AGENT_TOOLS.some((t) => t.function.name === name), false, name);
  }
});

test("more: paginates the last truncated read, clears on completion or failure", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wp11-more-"));
  try {
    writeFileSync(path.join(dir, "f.txt"), Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n"));
    const moreState = { path: "", nextLine: 0, valid: false };
    const opts = { cwd: dir, moreState };

    const first = await executeTool("read", { path: "f.txt", max_lines: 5 }, opts);
    assert.equal(first.isError, false);
    assert.match(first.content, /continue_offset=6/);
    assert.equal(moreState.valid, true);
    assert.equal(moreState.nextLine, 6);

    const next = await executeTool("more", { count: 5 }, opts);
    assert.equal(next.isError, false);
    assert.match(next.content, /6: line 6/);
    assert.match(next.content, /10: line 10/);
    assert.equal(moreState.nextLine, 11);

    // A complete read clears the cursor (C set_more with a NULL path).
    await executeTool("read", { path: "f.txt", whole: true }, opts);
    assert.equal(moreState.valid, false);

    // A failed read clears it too (C "done:" path calls set_more(NULL)).
    await executeTool("read", { path: "f.txt", max_lines: 5 }, opts);
    assert.equal(moreState.valid, true);
    const missing = await executeTool("read", { path: "nope.txt" }, opts);
    assert.equal(missing.isError, true);
    assert.equal(moreState.valid, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("more: invalid input — no previous output; garbage count defaults", async () => {
  const none = await executeTool("more", {}, { moreState: { path: "", nextLine: 0, valid: false } });
  assert.equal(none.isError, true);
  assert.match(none.content, /Tool error: no previous output to continue/);
  // No moreState at all (plain API call) is the same "nothing to continue".
  const bare = await executeTool("more", {});
  assert.equal(bare.isError, true);

  const dir = mkdtempSync(path.join(tmpdir(), "wp11-more2-"));
  try {
    writeFileSync(path.join(dir, "g.txt"), Array.from({ length: 40 }, (_, i) => `row ${i + 1}`).join("\n"));
    const moreState = { path: path.join(dir, "g.txt"), nextLine: 1, valid: true };
    const r = await executeTool("more", { count: "garbage" }, { cwd: dir, moreState });
    assert.equal(r.isError, false); // C: agent_parse_int_default falls back
    assert.match(r.content, /1: row 1/);
    // 40 lines < DEFAULT_MAX_LINES (500): the whole file fits, so the
    // complete read clears the cursor (C set_more with a NULL path).
    assert.equal(moreState.valid, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("read without moreState still works (state tracking is opt-in)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wp11-more3-"));
  try {
    writeFileSync(path.join(dir, "h.txt"), "a\nb\nc\n");
    const r = await executeTool("read", { path: "h.txt" }, { cwd: dir });
    assert.equal(r.isError, false);
    assert.match(r.content, /1: a/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("aliases: google_search and visit_page dispatch to web_search/web_read", async () => {
  // Invalid input exercises the mapped handler without touching the network
  // (validateSearchQuery and the url check run first).
  const g = await executeTool("google_search", {});
  assert.equal(g.isError, true);
  const w = await executeTool("web_search", {});
  assert.equal(g.content, w.content);

  const v = await executeTool("visit_page", {});
  assert.equal(v.isError, true);
  assert.match(v.content, /url is required/);
  const r = await executeTool("web_read", {});
  assert.equal(v.content, r.content);

  // Fall-through mapping in the dispatcher (no network probe).
  assert.match(toolsSource, /case "google_search":[\s\S]{0,80}case "web_search":\s*\n\s*return await toolWebSearch/);
  assert.match(toolsSource, /case "visit_page":[\s\S]{0,80}case "web_read":\s*\n\s*return await toolWebRead/);
});
