import assert from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AgnoToolSessionRegistry,
  sanitizeExternalId,
  sanitizeOptionalExternalId,
  normalizeHistory,
  sessionError
} from "./agnoToolSession.mjs";

const MODULE_PATH = fileURLToPath(new URL("./agnoToolSession.mjs", import.meta.url));

function baseContext(overrides = {}) {
  return {
    sessionId: "session-1",
    runId: "run-1",
    userId: "user-1",
    history: [],
    ...overrides
  };
}

describe("AgnoToolSessionRegistry", () => {
  it("crea record: getOrCreate builds a record with the expected shape", () => {
    const registry = new AgnoToolSessionRegistry({});
    const record = registry.getOrCreate(baseContext());

    assert.strictEqual(record.key, "session-1:run-1");
    assert.strictEqual(record.sessionId, "session-1");
    assert.strictEqual(record.runId, "run-1");
    assert.strictEqual(record.userId, "user-1");
    assert(typeof record.createdAt === "number");
    assert(typeof record.lastSeenAt === "number");
    assert(record.controller instanceof AbortController);
    assert(Array.isArray(record.history));
    assert.strictEqual(record.gitnexusPolicyState, null);
    assert(record.activeToolCalls instanceof Set);
  });

  it("riusa stesso record: a second getOrCreate with the same key returns the same record", () => {
    const registry = new AgnoToolSessionRegistry({});
    const first = registry.getOrCreate(baseContext());
    const second = registry.getOrCreate(baseContext());

    assert.strictEqual(first, second);
    assert.strictEqual(registry.sessions.size, 1);
  });

  it("separa run diversi: same sessionId, different runId yields distinct records", () => {
    const registry = new AgnoToolSessionRegistry({});
    const r1 = registry.getOrCreate(baseContext({ runId: "run-1" }));
    const r2 = registry.getOrCreate(baseContext({ runId: "run-2" }));

    assert.notStrictEqual(r1, r2);
    assert.notStrictEqual(r1.key, r2.key);
    assert.strictEqual(registry.sessions.size, 2);
  });

  it("rifiuta ID invalido: empty, too-long and invalid-charset ids throw INVALID_TOOL_CONTEXT", () => {
    const registry = new AgnoToolSessionRegistry({});

    assert.throws(
      () => registry.getOrCreate(baseContext({ sessionId: "" })),
      (err) => err.code === "INVALID_TOOL_CONTEXT"
    );

    assert.throws(
      () => registry.getOrCreate(baseContext({ sessionId: "a".repeat(129) })),
      (err) => err.code === "INVALID_TOOL_CONTEXT"
    );

    assert.throws(
      () => registry.getOrCreate(baseContext({ runId: "has whitespace" })),
      (err) => err.code === "INVALID_TOOL_CONTEXT"
    );

    assert.throws(
      () => registry.getOrCreate(baseContext({ runId: "has/slash" })),
      (err) => err.code === "INVALID_TOOL_CONTEXT"
    );
  });

  it("history cap messaggi: a longer-than-cap history is trimmed to the most recent N", () => {
    const registry = new AgnoToolSessionRegistry({ maxHistoryMessages: 3, maxHistoryBytes: 65_536 });
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: "user",
      content: `message-${i}`
    }));

    const record = registry.getOrCreate(baseContext({ history }));

    assert.strictEqual(record.history.length, 3);
    assert.deepStrictEqual(
      record.history.map((m) => m.content),
      ["message-7", "message-8", "message-9"]
    );
  });

  it("history cap byte: an oversized history is trimmed under the byte budget", () => {
    const registry = new AgnoToolSessionRegistry({ maxHistoryMessages: 64, maxHistoryBytes: 200 });
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: "user",
      content: `padding-content-${i}-${"x".repeat(20)}`
    }));

    const record = registry.getOrCreate(baseContext({ history }));

    const size = Buffer.byteLength(JSON.stringify(record.history), "utf8");
    assert(size <= 200, `expected trimmed history <= 200 bytes, got ${size}`);
    // most recent message must survive the trim
    assert.strictEqual(
      record.history.at(-1).content,
      "padding-content-19-xxxxxxxxxxxxxxxxxxxx"
    );
  });

  it("abort: cancel() aborts the controller without deleting the record", () => {
    const registry = new AgnoToolSessionRegistry({});
    const record = registry.getOrCreate(baseContext());

    registry.cancel({ sessionId: "session-1", runId: "run-1" });

    assert.strictEqual(record.controller.signal.aborted, true);
    assert.strictEqual(registry.sessions.get("session-1:run-1"), record);
  });

  it("cancel su chiave sconosciuta: no-op, does not throw", () => {
    const registry = new AgnoToolSessionRegistry({});
    assert.doesNotThrow(() =>
      registry.cancel({ sessionId: "ghost", runId: "ghost" })
    );
  });

  it("close: aborts and deletes the record; a later getOrCreate creates a fresh one", () => {
    const registry = new AgnoToolSessionRegistry({});
    const record = registry.getOrCreate(baseContext());

    registry.close({ sessionId: "session-1", runId: "run-1" });

    assert.strictEqual(record.controller.signal.aborted, true);
    assert.strictEqual(registry.sessions.has("session-1:run-1"), false);

    const fresh = registry.getOrCreate(baseContext());
    assert.notStrictEqual(fresh, record);
    assert.strictEqual(fresh.controller.signal.aborted, false);
  });

  it("close su chiave sconosciuta: no-op, does not throw", () => {
    const registry = new AgnoToolSessionRegistry({});
    assert.doesNotThrow(() =>
      registry.close({ sessionId: "ghost", runId: "ghost" })
    );
  });

  it("sweep: removes idle-expired records, leaves fresh ones untouched", () => {
    const registry = new AgnoToolSessionRegistry({ idleTtlMs: 1_000 });
    const stale = registry.getOrCreate(baseContext({ sessionId: "stale", runId: "run" }));
    const fresh = registry.getOrCreate(baseContext({ sessionId: "fresh", runId: "run" }));

    const now = Date.now();
    stale.lastSeenAt = now - 5_000;

    const swept = registry.sweep(now);

    assert.strictEqual(swept, 1);
    assert.strictEqual(stale.controller.signal.aborted, true);
    assert.strictEqual(registry.sessions.has("stale:run"), false);
    assert.strictEqual(registry.sessions.has("fresh:run"), true);
    assert.strictEqual(fresh.controller.signal.aborted, false);
  });

  it("sweep su registro vuoto: no-op, returns 0", () => {
    const registry = new AgnoToolSessionRegistry({});
    assert.strictEqual(registry.sweep(), 0);
  });

  it("closeAll: aborts and removes every record", () => {
    const registry = new AgnoToolSessionRegistry({});
    const r1 = registry.getOrCreate(baseContext({ sessionId: "a", runId: "run" }));
    const r2 = registry.getOrCreate(baseContext({ sessionId: "b", runId: "run" }));

    registry.closeAll();

    assert.strictEqual(r1.controller.signal.aborted, true);
    assert.strictEqual(r2.controller.signal.aborted, true);
    assert.strictEqual(registry.sessions.size, 0);
  });

  it("closeAll su registro vuoto: no-op, does not throw", () => {
    const registry = new AgnoToolSessionRegistry({});
    assert.doesNotThrow(() => registry.closeAll());
    assert.strictEqual(registry.sessions.size, 0);
  });

  it("nessun path injection: invalid path chars are rejected, and the module never builds a filesystem path from a raw id", () => {
    // "/" is rejected by the ID-syntax charset regex outright.
    assert.throws(
      () => sanitizeExternalId("../../etc", "session"),
      (err) => err.code === "INVALID_TOOL_CONTEXT"
    );

    // A lone ".." passes the charset/length regex (dots are valid id
    // characters) — sanitizeExternalId is an ID-syntax check, not a
    // path-safety guarantee. That's fine here because this module never
    // uses the id to build a path: it defers to sageSessionDir() /
    // sanitizeSessionId() in ../agentTools.mjs for that, in a later phase.
    assert.strictEqual(sanitizeExternalId("..", "session"), "..");

    // Runtime confirmation of the invariant: this module has zero import
    // statements, so it structurally cannot invoke path.join or
    // sageSessionDir (neither is ever in scope) — regardless of whether
    // it *mentions* them in a doc comment (it does, for context).
    const source = fs.readFileSync(MODULE_PATH, "utf8");
    const importLines = source
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line));
    assert.deepStrictEqual(
      importLines,
      [],
      "agnoToolSession.mjs must have no imports, so it cannot call path.join/sageSessionDir"
    );
  });
});

describe("sanitizeExternalId / sanitizeOptionalExternalId", () => {
  it("sanitizeExternalId trims and accepts a valid id", () => {
    assert.strictEqual(sanitizeExternalId("  abc-123.DEF:ghi  ", "session"), "abc-123.DEF:ghi");
  });

  it("sanitizeOptionalExternalId returns null for missing/empty values", () => {
    assert.strictEqual(sanitizeOptionalExternalId(undefined), null);
    assert.strictEqual(sanitizeOptionalExternalId(null), null);
    assert.strictEqual(sanitizeOptionalExternalId(""), null);
    assert.strictEqual(sanitizeOptionalExternalId("   "), null);
  });

  it("sanitizeOptionalExternalId validates a supplied value like sanitizeExternalId", () => {
    assert.strictEqual(sanitizeOptionalExternalId("user-1"), "user-1");
    assert.throws(
      () => sanitizeOptionalExternalId("a".repeat(129)),
      (err) => err.code === "INVALID_TOOL_CONTEXT"
    );
    assert.throws(
      () => sanitizeOptionalExternalId("bad id"),
      (err) => err.code === "INVALID_TOOL_CONTEXT"
    );
  });
});

describe("normalizeHistory", () => {
  it("non-array input normalizes to an empty array", () => {
    assert.deepStrictEqual(normalizeHistory(undefined, {}), []);
    assert.deepStrictEqual(normalizeHistory(null, {}), []);
    assert.deepStrictEqual(normalizeHistory("not-an-array", {}), []);
  });

  it("keeps only the canonical role/content(/tool_call_id) keys, dropping arbitrary metadata", () => {
    const out = normalizeHistory(
      [
        {
          role: "tool",
          content: "result",
          tool_call_id: "tc-1",
          secret: "should-be-dropped",
          extra: { nested: true }
        }
      ],
      { maxMessages: 10, maxBytes: 10_000 }
    );

    assert.deepStrictEqual(out, [
      { role: "tool", content: "result", tool_call_id: "tc-1" }
    ]);
  });

  it("discards entries with non-string content (raw media/base64/objects) and invalid role", () => {
    const out = normalizeHistory(
      [
        { role: "user", content: "hello" },
        { role: "assistant", content: Buffer.from("binary") },
        { role: "user", content: { not: "a string" } },
        { role: "", content: "no role" },
        { role: 42, content: "bad role type" },
        { role: "assistant", content: "world" }
      ],
      { maxMessages: 10, maxBytes: 10_000 }
    );

    assert.deepStrictEqual(out, [
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" }
    ]);
  });
});

describe("sessionError", () => {
  it("returns (does not throw) an Error with a .code property", () => {
    const err = sessionError("INVALID_TOOL_CONTEXT", "boom");
    assert(err instanceof Error);
    assert.strictEqual(err.code, "INVALID_TOOL_CONTEXT");
    assert.strictEqual(err.message, "boom");
  });
});
