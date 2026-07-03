import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUiSnapshot, formatSnapshot } from "./pageBrowserBridge.mjs";

test("buildUiSnapshot returns a structured snapshot", () => {
  const snapshot = buildUiSnapshot({ includeControls: true });
  assert.equal(snapshot.url, "http://127.0.0.1:5173");
  assert.equal(snapshot.title, "DS4 Studio");
  assert.ok(snapshot.controls.length > 0);
  assert.equal(snapshot.controls[0].role, "button");
  assert.ok(snapshot.controls[0].agentId.startsWith("right-rail-"));
});

test("buildUiSnapshot omits controls when includeControls is false", () => {
  const snapshot = buildUiSnapshot({ includeControls: false });
  assert.equal(snapshot.controls.length, 0);
});

test("buildUiSnapshot accepts custom url", () => {
  const snapshot = buildUiSnapshot({ url: "http://localhost:5173", includeControls: false });
  assert.equal(snapshot.url, "http://localhost:5173");
});

test("formatSnapshot produces Markdown output", () => {
  const snapshot = buildUiSnapshot({ includeControls: true });
  const formatted = formatSnapshot(snapshot);
  assert.match(formatted, /URL:/);
  assert.match(formatted, /Title:/);
  assert.match(formatted, /Visible controls:/);
  assert.match(formatted, /data-agent-id=/);
});
