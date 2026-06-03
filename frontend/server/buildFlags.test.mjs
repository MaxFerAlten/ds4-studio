import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SERVER_DIR, "..", "..");

test("host C and ObjC release flags avoid fast-math by default", async () => {
  const makefile = await fs.readFile(path.join(PROJECT_ROOT, "Makefile"), "utf8");
  const cflags = makefile.match(/^CFLAGS \?= .+$/m)?.[0] ?? "";
  const objcflags = makefile.match(/^OBJCFLAGS \?= .+$/m)?.[0] ?? "";

  assert.ok(cflags, "missing CFLAGS default");
  assert.ok(objcflags, "missing OBJCFLAGS default");
  assert.doesNotMatch(cflags, /-ffast-math/);
  assert.doesNotMatch(objcflags, /-ffast-math/);
});
