// checkNativeMetrics.mjs — consumes the native epistemic metrics JSON produced
// by tests/ds4_agent_epistemic_test --metrics and validates it (FI-014 step 4/5):
// nonzero exit on any mismatch, so `make certify-quantium-native` fails closed.
// It never silences an unavailable/broken compiler — the build step above already
// propagated any failure; here we only verify the evidence shape.

import { readFileSync } from "node:fs";
import {
  guardNoPreGateLeak,
  guardHSCorpusNonEmpty
} from "./certificationGuards.mjs";

const file = process.argv[2];
if (!file) {
  process.stderr.write("checkNativeMetrics: usage: node checkNativeMetrics.mjs <metrics.json>\n");
  process.exit(2);
}

let json;
try {
  json = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  process.stderr.write(`checkNativeMetrics: unparseable native metrics JSON (${file}): ${err.message}\n`);
  process.exit(1);
}

const problems = [];

if (json.schema !== "ds4_native_epistemic_metrics_v1") {
  problems.push(`schema field is '${json.schema}', expected 'ds4_native_epistemic_metrics_v1'`);
}
if (json.testsFailed !== 0) {
  problems.push(`testsFailed=${json.testsFailed}, expected 0`);
}

// M5 — zero candidate bytes before verdict (text + reasoning).
const leak = guardNoPreGateLeak(
  json.candidateTextBytesBeforeVerdict,
  json.candidateReasoningBytesBeforeVerdict
);
if (!leak.ok) problems.push(leak.reason);

// M6 — non-vacuous blocking: adversarial cases non-empty and all blocked.
if (json.adversarialBlocked !== true || json.blockedCases !== json.adversarialCases) {
  problems.push(
    `adversarial blocking not complete (blocked=${json.blockedCases}/${json.adversarialCases}, adversarialBlocked=${json.adversarialBlocked})`
  );
}
if (guardHSCorpusNonEmpty(json.adversarialCases).ok !== true) {
  problems.push(`adversarial corpus empty/non-positive (${json.adversarialCases})`);
}

// Non-vacuity of the clean path: some byte must be published after ALLOW, and
// the hard gate must have withheld candidate bytes.
if (json.publishedCleanAfterVerdict !== true || json.publishedCleanBytesAfterVerdict <= 0) {
  problems.push(
    `clean candidate not published after verdict (after=${json.publishedCleanBytesAfterVerdict}, flag=${json.publishedCleanAfterVerdict})`
  );
}
if (json.withheldCandidateBytes <= 0) {
  problems.push(`withheldCandidateBytes=${json.withheldCandidateBytes}, expected >0`);
}
if (json.verdict !== "ALLOW") {
  problems.push(`verdict is '${json.verdict}', expected 'ALLOW'`);
}

if (problems.length > 0) {
  process.stderr.write(`checkNativeMetrics: FAIL\n  ${problems.join("\n  ")}\n`);
  process.exit(1);
}
process.stdout.write("checkNativeMetrics: OK (native epistemic metrics valid)\n");
process.exit(0);
