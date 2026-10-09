import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import {
  SHARED_TEXTS,
  extractFromShadow,
  extractSharedText
} from "../../scripts/agentTextExtract.mjs";
import { AGENT_TEXT_DIR, loadAgentText } from "./agentText.mjs";

// WP2 of convergenza.loop.md: a shared text has one source of truth, and the
// C literal and the published .txt may not drift apart.  This test re-extracts
// every text from the C sources at test time, so editing a C string without
// regenerating config/agent-text/ (or the other way round) goes red here.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PATCH_DIR = resolve(ROOT, "ds4-overlay/patches/studio");
const SHADOW = process.env.DS4_CONFORMANCE_SHADOW || "";

test("every shared text equals the C literal it was generated from", () => {
  for (const spec of SHARED_TEXTS) {
    const fromC = extractSharedText(spec, { repoRoot: ROOT, patchDir: PATCH_DIR });
    const onDisk = readFileSync(resolve(AGENT_TEXT_DIR, `${spec.name}.txt`), "utf8");
    assert.equal(
      onDisk,
      fromC,
      `${spec.name}.txt is stale or hand-edited: run node scripts/generate-agent-text.mjs`,
    );
  }
});

test("the published texts are non-empty and carry no skill markers", () => {
  for (const spec of SHARED_TEXTS) {
    const text = loadAgentText(spec.name);
    assert.ok(text.length > 0, `${spec.name} must not be empty`);
    assert.ok(!text.includes("[BEGIN DS4 ACTIVE SKILL"), `${spec.name} would break skill framing`);
    assert.ok(!text.includes("[END DS4 ACTIVE SKILL"), `${spec.name} would break skill framing`);
  }
});

test("loadAgentText serves the file bytes and rejects bad names", () => {
  const name = "evidence-core-contract";
  assert.equal(
    loadAgentText(name),
    readFileSync(resolve(AGENT_TEXT_DIR, `${name}.txt`), "utf8"),
  );
  assert.throws(() => loadAgentText("../etc/passwd"), /invalid agent text name/);
  assert.throws(() => loadAgentText("not-a-shared-text"), /missing shared agent text/);
});

test("the composed C loop sends exactly these texts", (t) => {
  if (!SHADOW) {
    return t.skip("DS4_CONFORMANCE_SHADOW is not set: shadow conformance not runnable");
  }
  for (const spec of SHARED_TEXTS.filter((entry) => entry.shadow)) {
    assert.equal(
      extractFromShadow(spec, SHADOW),
      loadAgentText(spec.name),
      `${spec.name} drifted between the composed studio/ds4_agent.c and config/agent-text/`,
    );
  }
  return undefined;
});
