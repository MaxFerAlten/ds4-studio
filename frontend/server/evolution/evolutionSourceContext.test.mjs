/** Test origin: DS4 acceptance requirement SEC-PROPOSER-001. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { EvolutionSourceContext } from "./evolutionSourceContext.mjs";

test("SEC-PROPOSER-001 reads only approved regular files within byte limits", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-source-context-"));
  try {
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src", "a.mjs"), "export const a = 1;\n");
    await fs.symlink(path.join(root, "src", "a.mjs"), path.join(root, "src", "link.mjs"));
    const source = new EvolutionSourceContext({ repositoryRoot: root, maxFileBytes: 100, maxTotalBytes: 100 });
    const taskContract = { mutablePaths: ["src"], immutablePaths: ["src/private"] };
    const context = await source.build({ taskContract, targetFiles: ["src/a.mjs"] });
    assert.equal(context.files[0].path, "src/a.mjs");
    await assert.rejects(() => source.build({ taskContract, targetFiles: ["src/link.mjs"] }), /UNSUPPORTED/);
    await assert.rejects(() => source.build({ taskContract, targetFiles: ["src/private/x.mjs"] }), /FORBIDDEN/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
