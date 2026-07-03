import test from "node:test";
import assert from "node:assert/strict";
import { getChromePath, takeSnapshot, executeAction } from "./pageAgentFixture.mjs";

test("getChromePath returns path or null", () => {
  const path = getChromePath();
  if (path) {
    assert.ok(path.endsWith("google-chrome") || path.endsWith("chromium"));
  } else {
    assert.equal(path, null);
  }
});

test("takeSnapshot returns a formatted string", async () => {
  const page = {
    url: () => "http://127.0.0.1:5173",
    title: async () => "DS4 Studio",
    evaluate: async (fn) => {
      if (typeof fn === "function") return [];
      return "";
    }
  };

  const snap = await takeSnapshot(page, false);
  assert.match(snap, /URL: http/);
  assert.match(snap, /Title: DS4 Studio/);
});

test("takeSnapshot with controls includes control list", async () => {
  let callCount = 0;
  const page = {
    url: () => "http://127.0.0.1:5173",
    title: async () => "DS4 Studio",
    evaluate: async (fn) => {
      callCount++;
      if (callCount === 1) return "";
      return [
        { tag: "button", type: "submit", text: "Send", id: "send-btn", "data-agent-id": "" },
        { tag: "input", type: "text", text: "", id: "chat-input", "data-agent-id": "chat-input" }
      ];
    }
  };

  const snap = await takeSnapshot(page, true);
  assert.match(snap, /Visible controls/);
  assert.match(snap, /send-btn/);
  assert.match(snap, /chat-input/);
});

test("executeAction click returns ok for found target", async () => {
  const mockEl = { click: async () => {} };
  const page = {
    $$: async (sel) => {
      if (sel.includes("send-btn") || sel === "send-btn") return [mockEl];
      return [];
    }
  };

  const result = await executeAction(page, "click", "send-btn");
  assert.equal(result.ok, true);
});

test("executeAction click returns error for missing target", async () => {
  const page = { $$: async () => [] };
  const result = await executeAction(page, "click", "nonexistent");
  assert.equal(result.ok, false);
  assert.match(result.error, /Target not found/);
});

test("executeAction returns error for unknown action", async () => {
  const page = { $$: async () => [] };
  const result = await executeAction(page, "fly", "");
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown action/);
});
