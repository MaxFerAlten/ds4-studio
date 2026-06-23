import assert from "node:assert/strict";
import test from "node:test";
import { documentIsVisible } from "./utils.mjs";

test("documentIsVisible allows polling when no document object exists", () => {
  assert.equal(documentIsVisible(undefined), true);
});

test("documentIsVisible follows document.hidden", () => {
  assert.equal(documentIsVisible({ hidden: false }), true);
  assert.equal(documentIsVisible({ hidden: true }), false);
});
