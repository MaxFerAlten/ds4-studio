import assert from "node:assert/strict";
import test from "node:test";
import {
  clearStoredExportIncludeReasoning,
  readStoredExportIncludeReasoning,
  writeStoredExportIncludeReasoning
} from "./exportPreferences.mjs";

function createStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
    removeItem(key) {
      entries.delete(key);
    }
  };
}

test("reads no saved export reasoning preference as null", () => {
  assert.equal(readStoredExportIncludeReasoning(createStorage()), null);
});

test("persists export reasoning preference as a boolean", () => {
  const storage = createStorage();

  writeStoredExportIncludeReasoning(true, storage);
  assert.equal(readStoredExportIncludeReasoning(storage), true);

  writeStoredExportIncludeReasoning(false, storage);
  assert.equal(readStoredExportIncludeReasoning(storage), false);
});

test("ignores invalid saved export reasoning values", () => {
  assert.equal(readStoredExportIncludeReasoning(createStorage({ "ds4.export.includeReasoning": "maybe" })), null);
});

test("clears saved export reasoning preference", () => {
  const storage = createStorage();
  writeStoredExportIncludeReasoning(true, storage);
  clearStoredExportIncludeReasoning(storage);

  assert.equal(readStoredExportIncludeReasoning(storage), null);
});
