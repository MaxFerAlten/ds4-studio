/** Test origin: DS4 acceptance requirements BEH-CRITIC-001, SEC-CRITIC-001..003. */

import assert from "node:assert/strict";
import test from "node:test";

import { EvolutionGitNexusAdapter, EvolutionGitNexusError } from "./evolutionGitNexusAdapter.mjs";

function stubExecFile(stdout = "", exitCode = 0) {
  return async () => {
    if (exitCode !== 0) {
      const error = new Error("command failed");
      error.code = exitCode;
      throw error;
    }
    return { stdout, stderr: "" };
  };
}

test("G-NEXUS-001 capabilities returns unavailable when gitnexus is missing", async () => {
  const adapter = new EvolutionGitNexusAdapter({
    repositoryRoot: "/tmp",
    execFileImpl: stubExecFile(null, "ENOENT")
  });
  const caps = await adapter.capabilities();
  assert.equal(caps.available, false);
  assert.equal(caps.version, null);
});

test("G-NEXUS-002 capabilities returns version and indexed status", async () => {
  let callCount = 0;
  const execFileImpl = async () => {
    callCount++;
    if (callCount === 1) return { stdout: "1.6.5\n", stderr: "" };
    return {
      stdout: "Indexed: yes\nIndexed commit: abc123\nCurrent commit: abc123\n",
      stderr: ""
    };
  };
  const adapter = new EvolutionGitNexusAdapter({ repositoryRoot: "/tmp", execFileImpl });
  const caps = await adapter.capabilities();
  assert.equal(caps.available, true);
  assert.equal(caps.version, "1.6.5");
  assert.equal(caps.repositoryIndexed, true);
  assert.equal(caps.stale, false);
});

test("G-NEXUS-003 capabilities detects stale index", async () => {
  let callCount = 0;
  const execFileImpl = async () => {
    callCount++;
    if (callCount === 1) return { stdout: "1.6.5\n", stderr: "" };
    return {
      stdout: "Indexed: yes\nIndexed commit: aaa111\nCurrent commit: bbb222\n",
      stderr: ""
    };
  };
  const adapter = new EvolutionGitNexusAdapter({ repositoryRoot: "/tmp", execFileImpl });
  const caps = await adapter.capabilities();
  assert.equal(caps.stale, true);
});

test("G-NEXUS-004 impact returns degraded result when gitnexus is unavailable", async () => {
  const adapter = new EvolutionGitNexusAdapter({
    repositoryRoot: "/tmp",
    execFileImpl: stubExecFile(null, "ENOENT")
  });
  const result = await adapter.impact({ targetSymbols: ["foo"], targetFiles: ["src/foo.mjs"] });
  assert.equal(result.trusted, false);
  assert.equal(result.risk, "HIGH");
  assert.equal(result.symbols.length, 0);
});

test("G-NEXUS-005 impact returns degraded result when index is stale", async () => {
  let callCount = 0;
  const execFileImpl = async () => {
    callCount++;
    if (callCount === 1) return { stdout: "1.6.5\n", stderr: "" };
    return {
      stdout: "Indexed: yes\nIndexed commit: aaa111\nCurrent commit: bbb222\n",
      stderr: ""
    };
  };
  const adapter = new EvolutionGitNexusAdapter({ repositoryRoot: "/tmp", execFileImpl });
  const result = await adapter.impact({ targetSymbols: ["foo"], targetFiles: ["src/foo.mjs"] });
  assert.equal(result.trusted, false);
  assert.equal(result.reasonCode, "GITNEXUS_INDEX_STALE");
});

test("G-NEXUS-006 impact returns trusted result with valid index", async () => {
  let callCount = 0;
  const execFileImpl = async (_cmd, args) => {
    callCount++;
    if (args[0] === "--version") return { stdout: "1.6.5\n", stderr: "" };
    if (args[0] === "status") {
      return { stdout: "Indexed: yes\nIndexed commit: abc\nCurrent commit: abc\n", stderr: "" };
    }
    if (args[0] === "impact") {
      return { stdout: JSON.stringify({ risk: "LOW", summary: { direct: 2 }, impactedCount: 5, affected_processes: ["proc1"] }), stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };
  const adapter = new EvolutionGitNexusAdapter({ repositoryRoot: "/tmp", execFileImpl });
  const result = await adapter.impact({ targetSymbols: ["foo"], targetFiles: ["src/foo.mjs"] });
  assert.equal(result.trusted, true);
  assert.equal(result.risk, "LOW");
  assert.equal(result.symbols.length, 1);
  assert.equal(result.symbols[0].symbol, "foo");
  assert.equal(result.symbols[0].directCallers, 2);
});

test("G-NEXUS-007 impact rejects unsafe symbol names", async () => {
  const adapter = new EvolutionGitNexusAdapter({ repositoryRoot: "/tmp", execFileImpl: stubExecFile() });
  await assert.rejects(
    () => adapter.impact({ targetSymbols: ["foo; rm -rf /"], targetFiles: [] }),
    (error) => error.code === "UNSAFE_SYMBOL"
  );
});

test("G-NEXUS-008 detectChanges returns supported false when gitnexus unavailable", async () => {
  const adapter = new EvolutionGitNexusAdapter({
    repositoryRoot: "/tmp",
    execFileImpl: stubExecFile(null, "ENOENT")
  });
  const result = await adapter.detectChanges({ expectedFiles: ["src/a.mjs"] });
  assert.equal(result.supported, false);
  assert.equal(result.risk, "HIGH");
});

test("G-NEXUS-009 detectChanges parses output correctly", async () => {
  const output = [
    "Risk level: MEDIUM",
    "",
    "Changed symbols:",
    "  foo() → src/foo.mjs",
    "",
    "Affected execution flows:",
    "  Proc1 — changed: foo, bar"
  ].join("\n");
  const adapter = new EvolutionGitNexusAdapter({
    repositoryRoot: "/tmp",
    execFileImpl: stubExecFile(output)
  });
  const result = await adapter.detectChanges({
    expectedFiles: ["src/foo.mjs"],
    expectedSymbols: ["foo", "bar"]
  });
  assert.equal(result.supported, true);
  assert.equal(result.actualFiles.includes("src/foo.mjs"), true);
  assert.equal(result.affectedSymbols.includes("foo"), true);
  assert.equal(result.affectedSymbols.includes("bar"), true);
});

test("G-NEXUS-010 detectChanges marks unexpected files as HIGH risk", async () => {
  const output = "Risk level: LOW\n\nChanged symbols:\n  foo() → src/unexpected.mjs\n";
  const adapter = new EvolutionGitNexusAdapter({
    repositoryRoot: "/tmp",
    execFileImpl: stubExecFile(output)
  });
  const result = await adapter.detectChanges({
    expectedFiles: ["src/expected.mjs"],
    expectedSymbols: []
  });
  assert.equal(result.unexpectedFiles.includes("src/unexpected.mjs"), true);
  assert.equal(result.risk, "HIGH");
});

test("G-NEXUS-011 detectChanges returns no-changes result when gitnexus reports no changes", async () => {
  const adapter = new EvolutionGitNexusAdapter({
    repositoryRoot: "/tmp",
    execFileImpl: stubExecFile("No changes detected.\n")
  });
  const result = await adapter.detectChanges({ expectedFiles: [], expectedSymbols: [] });
  assert.equal(result.supported, true);
  assert.equal(result.actualFiles.length, 0);
  assert.equal(result.risk, "LOW");
});

test("G-NEXUS-012 ensureFreshIndex throws when stale and autoAnalyze disabled", async () => {
  let callCount = 0;
  const execFileImpl = async () => {
    callCount++;
    if (callCount <= 2) {
      if (callCount === 1) return { stdout: "1.6.5\n", stderr: "" };
      return { stdout: "Indexed: yes\nIndexed commit: aaa\nCurrent commit: bbb\n", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };
  const adapter = new EvolutionGitNexusAdapter({ repositoryRoot: "/tmp", execFileImpl });
  await assert.rejects(
    () => adapter.ensureFreshIndex(),
    (error) => error.code === "GITNEXUS_INDEX_STALE"
  );
});

test("G-NEXUS-013 impact returns empty result when no symbols provided", async () => {
  const adapter = new EvolutionGitNexusAdapter({ repositoryRoot: "/tmp", execFileImpl: stubExecFile() });
  const result = await adapter.impact({ targetSymbols: [], targetFiles: ["src/a.mjs"] });
  assert.equal(result.trusted, true);
  assert.equal(result.symbols.length, 0);
});
