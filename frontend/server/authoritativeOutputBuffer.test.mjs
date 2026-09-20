import assert from "node:assert/strict";
import test from "node:test";

import { AuthoritativeOutputBuffer } from "./authoritativeOutputBuffer.mjs";

test("discard releases no authoritative delta", () => {
  const buffer = new AuthoritativeOutputBuffer();
  const written = [];
  buffer.append("premature ");
  buffer.append("claim");
  buffer.discard();

  assert.equal(buffer.flush((chunk) => written.push(chunk)), 0);
  assert.deepEqual(written, []);
});

test("flush writes each accepted delta once and empties the buffer", () => {
  const buffer = new AuthoritativeOutputBuffer();
  const written = [];
  buffer.append("checked ");
  buffer.append("source");

  assert.equal(buffer.flush((chunk) => written.push(chunk)), 2);
  assert.equal(buffer.flush((chunk) => written.push(chunk)), 0);
  assert.deepEqual(written, ["checked ", "source"]);
});
