import test from "node:test";
import assert from "node:assert/strict";

import {
  VERIFIER_CERTIFICATE_VERDICT,
  createVerifierCertificate
} from "./epistemicVerifierCertificate.mjs";

function validInput(overrides = {}) {
  return {
    id: "cert-1",
    verifier: "lean",
    claimId: "claim-1",
    requirement: "symbolic_verification",
    checkedStatement: "The submitted theorem `toy_transition` typechecks.",
    formalizationKind: "NAT_FUNCTION_MODEL",
    domain: "MATHEMATICS",
    assumptionsUsed: [],
    propertiesEstablished: ["TOY_TRANSITION"],
    propertiesNotEstablished: ["QHO_NUMBER_OPERATOR"],
    evidenceIds: ["ev-1"],
    verdict: VERIFIER_CERTIFICATE_VERDICT.PASSED,
    toolCallId: "tool-call-1",
    toolResultId: "tool-result-1",
    issuedAt: "2026-08-29T12:00:00.000Z",
    ...overrides
  };
}

test("VerifierCertificate records the exact checked scope", () => {
  const certificate = createVerifierCertificate(validInput());
  assert.equal(certificate.id, "cert-1");
  assert.equal(certificate.checkedStatement, "The submitted theorem `toy_transition` typechecks.");
  assert.equal(certificate.formalizationKind, "NAT_FUNCTION_MODEL");
  assert.deepEqual(certificate.propertiesEstablished, ["TOY_TRANSITION"]);
  assert.deepEqual(certificate.propertiesNotEstablished, ["QHO_NUMBER_OPERATOR"]);
  assert.equal(certificate.verdict, VERIFIER_CERTIFICATE_VERDICT.PASSED);
});

test("VerifierCertificate rejects identity or checked-statement omissions", () => {
  for (const field of ["verifier", "claimId", "requirement", "checkedStatement"]) {
    assert.throws(
      () => createVerifierCertificate(validInput({ [field]: "" })),
      new RegExp(`${field} must be a non-empty string`),
      field
    );
  }
});

test("VerifierCertificate rejects unknown verdicts", () => {
  assert.throws(
    () => createVerifierCertificate(validInput({ verdict: "CHECKED_ENOUGH" })),
    /unknown verifier certificate verdict/
  );
});

test("VerifierCertificate copies and deeply freezes caller data", () => {
  const assumptionsUsed = ["hbar > 0"];
  const rawResultRef = { execution: { exitCode: 0 } };
  const metadata = { theoremNames: ["toy_transition"] };
  const certificate = createVerifierCertificate(
    validInput({ assumptionsUsed, rawResultRef, metadata })
  );

  assumptionsUsed.push("omega > 0");
  rawResultRef.execution.exitCode = 1;
  metadata.theoremNames.push("invented");

  assert.deepEqual(certificate.assumptionsUsed, ["hbar > 0"]);
  assert.equal(certificate.rawResultRef.execution.exitCode, 0);
  assert.deepEqual(certificate.metadata.theoremNames, ["toy_transition"]);
  assert.equal(Object.isFrozen(certificate), true);
  assert.equal(Object.isFrozen(certificate.metadata.theoremNames), true);
  assert.throws(() => certificate.evidenceIds.push("ev-2"), TypeError);
});

test("VerifierCertificate deduplicates provenance arrays without inventing entries", () => {
  const certificate = createVerifierCertificate(
    validInput({
      evidenceIds: ["ev-1", "ev-1"],
      propertiesEstablished: ["TOY_TRANSITION", "TOY_TRANSITION"]
    })
  );
  assert.deepEqual(certificate.evidenceIds, ["ev-1"]);
  assert.deepEqual(certificate.propertiesEstablished, ["TOY_TRANSITION"]);
  assert.deepEqual(certificate.assumptionsUsed, []);
});
