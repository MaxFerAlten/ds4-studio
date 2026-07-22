/** Test origin: DS4 acceptance requirements BEH-CRITIC-001..002 and SEC-CRITIC-001. */

import assert from "node:assert/strict";
import test from "node:test";

import { buildEvidencePacket } from "./evolutionEvidencePacket.mjs";

const runId = "evo_0123456789abcdefabcd";

test("BEH-CRITIC-002 evidence packet is deterministic and revision-owned", () => {
  const input = {
    runId,
    revision: 1,
    objective: "Improve correctness",
    baselineMetrics: { score: 1 },
    candidateMetrics: { score: 0 },
    violations: ["B", "A"],
    diffSummary: { filesChanged: 1 },
    evidence: [{ runId, revision: 1, artifactId: "sha256:1", path: "evaluation.json", summary: "score failed" }],
    budget: { promptTokens: 0 }
  };
  const first = buildEvidencePacket(input);
  const second = buildEvidencePacket(input);
  assert.equal(first.packetHash, second.packetHash);
  assert.deepEqual(first.violations, ["A", "B"]);
});

test("SEC-CRITIC-001 rejects cross-run evidence and oversized packets", () => {
  assert.throws(
    () => buildEvidencePacket({ runId, revision: 1, evidence: [{ runId: "evo_ffffffffffffffffffff", revision: 1 }] }),
    (error) => error.code === "CROSS_RUN_ACCESS_ATTEMPT"
  );
  assert.throws(() => buildEvidencePacket({ runId, revision: 1, objective: "x".repeat(100) }, { maxBytes: 40 }), /exceeds/);
});
