import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("only the message role label turns strong text into a block", async () => {
  const css = await readFile(new URL("./styles.css", import.meta.url), "utf8");

  assert.doesNotMatch(css, /\.message\s+strong\s*\{[^}]*display:\s*block/s);
  assert.match(css, /\.message\s*>\s*strong\s*\{[^}]*display:\s*block/s);
});
