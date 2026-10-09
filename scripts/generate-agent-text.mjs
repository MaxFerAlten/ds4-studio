// WP2 of convergenza.loop.md: (re)generate config/agent-text/<name>.txt from the
// C sources, so a shared text is copied byte for byte instead of retyped.
// Run this after changing a C text, then `git diff config/agent-text/`.
//
//   node scripts/generate-agent-text.mjs
import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { SHARED_TEXTS, extractSharedText } from "./agentTextExtract.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "config/agent-text");
const PATCH_DIR = resolve(ROOT, "ds4-overlay/patches/studio");

mkdirSync(OUT_DIR, { recursive: true });
const lines = [];
for (const spec of SHARED_TEXTS) {
  const value = extractSharedText(spec, { repoRoot: ROOT, patchDir: PATCH_DIR });
  const file = resolve(OUT_DIR, `${spec.name}.txt`);
  writeFileSync(file, value);
  lines.push(`${spec.name}.txt bytes=${Buffer.byteLength(value, "utf8")}`);
}
process.stdout.write(`generated ${SHARED_TEXTS.length} shared texts\n${lines.join("\n")}\n`);
