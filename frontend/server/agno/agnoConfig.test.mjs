import assert from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveAgnoPaths } from "./agnoConfig.mjs";

const PROJECT_ROOT = "/tmp/test-project";

describe("resolveAgnoPaths", () => {
  it("resolves relative serviceDir under projectRoot", () => {
    const { serviceDir } = resolveAgnoPaths({
      projectRoot: PROJECT_ROOT,
      config: { agno: { serviceDir: "agno_service", dbFile: "data/agno/agno.db" } }
    });
    const expected = path.join(PROJECT_ROOT, "agno_service");
    assert(serviceDir === expected, `expected ${expected}, got ${serviceDir}`);
  });

  it("resolves relative dbFile under projectRoot", () => {
    const { dbFile } = resolveAgnoPaths({
      projectRoot: PROJECT_ROOT,
      config: { agno: { serviceDir: "agno_service", dbFile: "data/agno/agno.db" } }
    });
    const expected = path.join(PROJECT_ROOT, "data/agno/agno.db");
    assert(dbFile === expected, `expected ${expected}, got ${dbFile}`);
  });

  it("rejects path that escapes projectRoot via ..", () => {
    assert.throws(() => resolveAgnoPaths({
      projectRoot: PROJECT_ROOT,
      config: { agno: { serviceDir: "../../tmp/evil", dbFile: "data/agno/agno.db" } }
    }), /escapes project root/i);
  });

  it("rejects empty serviceDir", () => {
    assert.throws(() => resolveAgnoPaths({
      projectRoot: PROJECT_ROOT,
      config: { agno: { serviceDir: "", dbFile: "data/agno/agno.db" } }
    }), /non-empty/i);
  });

  it("rejects empty dbFile", () => {
    assert.throws(() => resolveAgnoPaths({
      projectRoot: PROJECT_ROOT,
      config: { agno: { serviceDir: "agno_service", dbFile: "" } }
    }), /non-empty/i);
  });
});
