import test from "node:test";
import assert from "node:assert/strict";

import {
  QFIX_PARITY_CASES,
  QUANTUM_HALLUCINATION_CASES
} from "./fixtures/quantumHallucinationCases.mjs";
import { scanDeterministicEpistemicFailures } from "./epistemicDeterministicPolicy.mjs";

test("§58 QHO fixture contains only short synthetic claims", () => {
  assert.deepEqual(
    QUANTUM_HALLUCINATION_CASES.map((item) => item.id),
    ["qho_ntk_oscillator", "qho_fake_internal_analysis", "qho_repair_citation"]
  );
  for (const item of QUANTUM_HALLUCINATION_CASES) {
    assert.ok(item.candidate.length < 180);
    assert.match(item.expectedFailure, /^F\d{2}$/);
  }
});

test("§62 JS policy returns the required parity failure code", () => {
  assert.deepEqual(
    QFIX_PARITY_CASES.map((item) => item.id),
    [
      "QFIX-PARITY-001",
      "QFIX-PARITY-002",
      "QFIX-PARITY-003",
      "QFIX-PARITY-004",
      "QFIX-PARITY-005"
    ]
  );

  for (const item of QFIX_PARITY_CASES) {
    const result = scanDeterministicEpistemicFailures({
      text: item.candidate,
      challengeTurn: item.challengeTurn === true
    });
    assert.equal(result.verdict, "BLOCK_UNSUPPORTED", item.id);
    assert.ok(result.failureCodes.includes(item.expectedFailure), item.id);
  }
});

test("P0 matches disappear only when the matching evidence class exists", () => {
  const bash = { evidenceType: "tool_execution", status: "EXECUTED", toolName: "bash" };
  const source = { evidenceType: "tool_execution", status: "EXECUTED", toolName: "crawl" };
  assert.equal(
    scanDeterministicEpistemicFailures({ text: "This is working code.", evidence: [bash] }).blocked,
    false
  );
  assert.equal(
    scanDeterministicEpistemicFailures({ text: "The ID is arXiv:2305.12345.", evidence: [source] })
      .blocked,
    false
  );
});
