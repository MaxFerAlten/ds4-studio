import test from "node:test";
import assert from "node:assert/strict";
import { createEpistemicTurn, evaluateEpistemicTurn, withholdsOutput } from "./epistemicTurn.mjs";

const BLOCKING = Object.freeze({ enabled: true, mode: "block", blockSeverity: 4, maxClaimsPerTurn: 8 });
const SHADOW = Object.freeze({ enabled: true, mode: "shadow", blockSeverity: 4 });

function toolCall(command, exitCode) {
  return {
    callId: `c_${command.length}_${exitCode}`,
    toolName: "bash",
    arguments: { command },
    rawResult: { content: "out", isError: exitCode !== 0, raw: { exit_code: exitCode } }
  };
}

test("a disabled turn collects nothing and decides nothing", async () => {
  const turn = createEpistemicTurn({ sessionKey: "s1", revision: 3, config: { enabled: false, mode: "shadow" } });
  assert.equal(turn.enabled, false);
  const out = await evaluateEpistemicTurn(turn, { assistantContent: "The code is complete and working." });
  assert.equal(out.code, "EPISTEMIC_NOT_ACTIVE");
  assert.equal(out.allowed, true);
  assert.equal(out.extraction, null);
});

test("EPI-010 end to end: no tool ran and the answer says it works", async () => {
  const turn = createEpistemicTurn({ sessionKey: "s1", revision: 1, config: BLOCKING });
  const out = await evaluateEpistemicTurn(turn, {
    assistantContent: "The implementation is complete and working."
  });
  assert.equal(out.code, "EPISTEMIC_EXECUTION_CLAIM_WITHOUT_TRACE");
  assert.equal(out.allowed, false);
  assert.equal(out.mustContinue, true);
  assert.ok(out.guidance.length > 0);
  // Without a model client the extraction is lexical, and it says so rather
  // than reporting a complete pass over the response.
  assert.equal(out.extraction.status, "EXTRACTION_PARTIAL");

  // The same answer with a run behind it is allowed.
  const withRun = createEpistemicTurn({ sessionKey: "s1", revision: 1, config: BLOCKING });
  withRun.addToolResult(toolCall("make cpu", 0));
  const allowed = await evaluateEpistemicTurn(withRun, {
    assistantContent: "The implementation is complete and working."
  });
  assert.equal(allowed.code, "EPISTEMIC_CLEAN");
  assert.equal(allowed.allowed, true);
});

test("shadow mode reports the same finding and lets the turn ship", async () => {
  const turn = createEpistemicTurn({ sessionKey: "s1", revision: 1, config: SHADOW });
  const out = await evaluateEpistemicTurn(turn, {
    assistantContent: "The implementation is complete and working."
  });
  assert.equal(out.code, "EPISTEMIC_EXECUTION_CLAIM_WITHOUT_TRACE");
  assert.equal(out.allowed, true);
  assert.equal(out.mustContinue, false);
});

test("evidence collection cannot fail the turn it observes", () => {
  const turn = createEpistemicTurn({ config: BLOCKING });
  // A result that cannot be turned into evidence is recorded as dropped, so a
  // gate can tell "no tool ran" from "the collector failed".
  const circular = { content: "x" };
  circular.self = circular;
  assert.doesNotThrow(() => turn.addToolResult({ callId: "c1", toolName: "bash", arguments: circular, rawResult: circular }));
  assert.doesNotThrow(() => turn.addToolResult(null));
  assert.equal(turn.evidence.size + turn.evidence.dropped.length >= 1, true);
});

test("the same assertion twice is one claim", async () => {
  const turn = createEpistemicTurn({ config: SHADOW });
  await evaluateEpistemicTurn(turn, { assistantContent: "We measured a 42% improvement." });
  const first = turn.ledger.allClaims().length;
  await evaluateEpistemicTurn(turn, { assistantContent: "We measured a 42% improvement.  " });
  assert.equal(turn.ledger.allClaims().length, first);
  assert.ok(first > 0);
});

test("challenges and repair state reach the gate", async () => {
  const challenged = createEpistemicTurn({ config: BLOCKING });
  challenged.noteChallenges([{ id: "ch1", targetClaimId: "c1", challengeText: "that DOI is wrong" }]);
  const sycophantic = await evaluateEpistemicTurn(challenged, {
    assistantContent: "Hai ragione, il valore corretto è 3.2."
  });
  assert.equal(sycophantic.code, "EPISTEMIC_CHALLENGE_ACCEPTED_WITHOUT_VERIFICATION");

  const repairing = createEpistemicTurn({ config: BLOCKING });
  repairing.markRepairSummary(2);
  assert.deepEqual(repairing.repairState, { summarizing: true, round: 2 });
  // A claim carried into the summary that the repair never verified. Not an
  // empirical one: that condition is checked earlier and would mask this.
  repairing.ledger.create({ text: "The parser now handles nested quotes." });
  const contaminated = await evaluateEpistemicTurn(repairing, {
    assistantContent: "Summary of the repair: the parser now handles nested quotes."
  });
  assert.equal(contaminated.code, "EPISTEMIC_REPAIR_SUMMARY_CONTAMINATED");
});

test("a gate that could not run fails closed in block and open in shadow", async () => {
  const exploding = { async completeRole() { throw new Error("boom"); } };
  // The extractor absorbs a model failure, so break the ledger instead: this is
  // the "the gate itself threw" path, not "a verifier failed".
  const broken = createEpistemicTurn({ config: BLOCKING });
  broken.ledger.allClaims = () => {
    throw new Error("ledger unavailable");
  };
  const blocked = await evaluateEpistemicTurn(broken, { assistantContent: "x", client: exploding });
  assert.equal(blocked.code, "EPISTEMIC_GATE_ERROR");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.mustContinue, true);
  assert.match(blocked.guidance, /nothing may be published as verified/);

  const shadow = createEpistemicTurn({ config: SHADOW });
  shadow.ledger.allClaims = () => {
    throw new Error("ledger unavailable");
  };
  const shipped = await evaluateEpistemicTurn(shadow, { assistantContent: "x" });
  assert.equal(shipped.code, "EPISTEMIC_GATE_ERROR");
  assert.equal(shipped.allowed, true);
  assert.equal(shipped.mustContinue, false);
});

test("the snapshot describes the turn without exposing its contents", async () => {
  const turn = createEpistemicTurn({ sessionKey: "s9", revision: 4, config: SHADOW });
  turn.addToolResult(toolCall("npm test", 0));
  await evaluateEpistemicTurn(turn, { assistantContent: "All tests pass." });
  const snap = turn.snapshot();
  assert.equal(snap.sessionKey, "s9");
  assert.equal(snap.revision, 4);
  assert.equal(snap.mode, "shadow");
  assert.equal(snap.evidenceCount, 1);
  assert.equal(snap.droppedEvidence, 0);
  assert.ok(snap.claimCount >= 1);
  assert.ok(Object.hasOwn(snap, "byStatus"));
});

test("only block mode withholds the candidate answer", () => {
  assert.equal(withholdsOutput({ enabled: true, mode: "block", withholdOutput: true }), true);
  // The default is to withhold: an absent flag must not open the stream.
  assert.equal(withholdsOutput({ enabled: true, mode: "block" }), true);
  assert.equal(withholdsOutput({ enabled: true, mode: "block", withholdOutput: false }), false);
  // shadow keeps the current streaming behaviour (§37).
  assert.equal(withholdsOutput({ enabled: true, mode: "shadow", withholdOutput: true }), false);
  assert.equal(withholdsOutput({ enabled: false, mode: "block", withholdOutput: true }), false);
  assert.equal(withholdsOutput(undefined), false);
});

test("repair rounds are bounded on the JS turn and preserve user text", () => {
  const turn = createEpistemicTurn({
    config: { ...BLOCKING, maxRepairRounds: 2 },
    userText: "Fai autocritica."
  });
  assert.equal(turn.userText, "Fai autocritica.");
  assert.equal(turn.canRepair(), true);
  assert.equal(turn.beginRepair(), 1);
  assert.equal(turn.canRepair(), true);
  assert.equal(turn.beginRepair(), 2);
  assert.equal(turn.canRepair(), false);
});

/** A client that extracts one claim and objects to it in the same turn. */
function selfChallengingClient(claim, challenges) {
  return {
    async completeRole(args) {
      if (args.roleName === "epistemic_claim_extractor") {
        return { json: { claims: [claim] } };
      }
      if (args.roleName === "epistemic_self_challenge_extractor") {
        return { json: { challenges } };
      }
      throw new Error(`unexpected semantic role ${args.roleName}`);
    }
  };
}

test("EPI-041: a self challenge in the candidate survives into the promotion gate", async () => {
  const turn = createEpistemicTurn({ config: BLOCKING });
  // The same run that made the plain claim publishable in EPI-010.
  turn.addToolResult(toolCall("make cpu", 0));

  const client = selfChallengingClient(
    {
      id: "C1",
      text: "The implementation is complete and working.",
      epistemicType: "EXECUTED",
      dependencies: [],
      flags: { assertsExecution: true, usesProtectedLanguage: true }
    },
    [
      {
        targetClaimId: "C1",
        text: "we are missing the scalar multiplication the claim needs",
        challengeClass: "MODEL_INADEQUACY",
        severity: 4
      }
    ]
  );

  await evaluateEpistemicTurn(turn, {
    assistantContent:
      "The implementation is complete and working. We are missing scalar multiplication, so the toy model cannot represent the number operator.",
    client
  });

  const claims = turn.ledger.allClaims();
  assert.equal(claims.length, 1);
  // The objection is debt on the claim, and debt outranks a clean tool run:
  // nothing reaches VERIFIED while it is open.
  assert.equal(claims[0].challengeDebtIds.length, 1);
  // Challenged once, then downgraded when the debt blocked promotion.
  assert.equal(claims[0].correctiveEpoch >= 1, true);
  // Withheld, not refuted: UNKNOWN keeps the claim reachable by a later
  // turn that actually verifies it, and spares its dependents.
  assert.equal(claims[0].status, "UNKNOWN");
  assert.ok(claims[0].failureCodes.includes("F39"));
  const challenged = turn.ledger.history.allEvents().filter((e) => e.kind === "CHALLENGED");
  assert.equal(challenged.length, 1);
  assert.equal(challenged[0].origin, "MODEL_SELF");
});

test("RFQ001-04: an ordinary answer opens no self-challenge debt", async () => {
  const turn = createEpistemicTurn({ config: BLOCKING });
  turn.addToolResult(toolCall("make cpu", 0));
  await evaluateEpistemicTurn(turn, { assistantContent: "The implementation is complete and working." });
  assert.equal(turn.ledger.history.allEvents().filter((e) => e.kind === "CHALLENGED").length, 0);
});

function leanCall(code) {
  return {
    callId: `lean_${code.length}`,
    toolName: "lean_check",
    arguments: { code },
    rawResult: { content: "status=checked", isError: false, raw: { exit_code: 0 } }
  };
}

/** A client that extracts exactly the claims it is given. */
function claimClient(claims, { relation = null } = {}) {
  return {
    async completeRole(args) {
      if (args.roleName === "epistemic_claim_extractor") return { json: { claims } };
      if (args.roleName === "epistemic_self_challenge_extractor") return { json: { challenges: [] } };
      if (args.roleName === "epistemic_claim_equivalence" && relation) return { json: { relation } };
      throw new Error(`unexpected semantic role ${args.roleName}`);
    }
  };
}

test("EPI-042: an axiom that typechecks cannot be reported as a proof", async () => {
  const turn = createEpistemicTurn({ config: BLOCKING });
  turn.addToolResult(leanCall("axiom commutation : 1 = 1\ntheorem t : 1 = 1 := commutation"));

  await evaluateEpistemicTurn(turn, {
    assistantContent: "Lean proved the commutation relation.",
    client: claimClient([
      { id: "C1", text: "Lean proved the commutation relation.", epistemicType: "DERIVED", dependencies: [], flags: { usesProtectedLanguage: true } }
    ])
  });

  const claim = turn.ledger.allClaims()[0];
  assert.ok(claim.failureCodes.includes("F35"));
  assert.ok(claim.failureCodes.includes("F40"));
  assert.notEqual(claim.status, "VERIFIED");
});

test("EPI-042: a theorem that proves its own statement stays publishable", async () => {
  const turn = createEpistemicTurn({ config: BLOCKING });
  turn.addToolResult(leanCall("theorem t (n : Nat) : 0 < n.succ := Nat.succ_pos n"));

  await evaluateEpistemicTurn(turn, {
    assistantContent: "Lean proved that the successor of any natural number is positive.",
    client: claimClient([
      { id: "C1", text: "Lean proved that the successor of any natural number is positive.", epistemicType: "DERIVED", dependencies: [], flags: { usesProtectedLanguage: true } }
    ])
  });

  const claim = turn.ledger.allClaims()[0];
  assert.equal(claim.failureCodes.includes("F35"), false);
  assert.equal(claim.failureCodes.includes("F40"), false);
});

test("EPI-043: a toy model that cannot state the claim does not certify it", async () => {
  const turn = createEpistemicTurn({ config: BLOCKING });
  turn.addToolResult(
    leanCall(`
inductive FockState where
  | Zero : FockState
  | Basis : Nat -> FockState
theorem raise_basis (n : Nat) : True := trivial
`)
  );

  await evaluateEpistemicTurn(turn, {
    assistantContent: "Lean formally verified the number operator relation N|n> = n|n>.",
    client: claimClient([
      {
        id: "C1",
        text: "Lean formally verified the number operator relation N|n> = n|n>.",
        epistemicType: "DERIVED",
        dependencies: [],
        flags: { usesProtectedLanguage: true }
      }
    ])
  });

  const claim = turn.ledger.allClaims()[0];
  // The model has no scalar multiplication, so it cannot state the equation.
  assert.ok(claim.failureCodes.includes("F38"));
  assert.ok(claim.failureCodes.includes("F32"));
  assert.notEqual(claim.status, "VERIFIED");
});

test("EPI-044: a proof about naturals is not a proof about QHO energy", async () => {
  const turn = createEpistemicTurn({ config: BLOCKING });
  turn.addToolResult(leanCall("theorem t (n : Nat) : 0 < n.succ := Nat.succ_pos n"));

  await evaluateEpistemicTurn(turn, {
    assistantContent: "Lean proves all QHO energy levels are positive.",
    client: claimClient([
      {
        id: "C1",
        text: "Lean proves all QHO energy levels are positive.",
        epistemicType: "DERIVED",
        dependencies: [],
        flags: { usesProtectedLanguage: true }
      }
    ])
  });

  const claim = turn.ledger.allClaims()[0];
  assert.ok(claim.failureCodes.includes("F27"));
  assert.notEqual(claim.status, "VERIFIED");
});

test("EPI-048: rewording a challenged claim does not clear its debt", async () => {
  const turn = createEpistemicTurn({ config: BLOCKING });
  const claim = turn.ledger.create({
    text: "Lean proves the QHO number operator.",
    epistemicType: "DERIVED"
  });
  turn.ledger.noteChallenge({
    claimId: claim.id,
    origin: "MODEL_SELF",
    text: "the formal model lacks scalar multiplication",
    severity: 4
  });

  await evaluateEpistemicTurn(turn, {
    assistantContent: "The number-operator relation has been machine certified.",
    // The rewording is only semantically equivalent; string comparison reads
    // it as a different sentence, which is the escape this test closes.
    client: claimClient(
      [
        {
          id: "C2",
          text: "The number-operator relation has been machine certified.",
          epistemicType: "DERIVED",
          dependencies: [],
          flags: { usesProtectedLanguage: true }
        }
      ],
      { relation: "PARAPHRASE" }
    )
  });

  const reworded = turn.ledger.allClaims().find((c) => c.id !== claim.id);
  assert.ok(reworded, "the rewording was extracted as its own claim");
  assert.equal(reworded.inheritedClaimRelation !== null, true);
  assert.equal(reworded.challengeDebtIds.length > 0, true);
  assert.notEqual(reworded.status, "VERIFIED");
});

test("EPI-053: a self challenge that appears only in observable reasoning survives finalization", async () => {
  const turn = createEpistemicTurn({ config: BLOCKING });
  // The execution tool ran cleanly, so the claim would otherwise be able to
  // promote; the reasoning-only self challenge is what must block it.
  turn.addToolResult(toolCall("make cpu", 0));
  const claimText = "Lean formally verified the QHO number operator.";
  const claim = {
    id: "C1",
    text: claimText,
    epistemicType: "DERIVED",
    dependencies: [],
    flags: { assertsExecution: true, usesProtectedLanguage: true }
  };
  const out = await evaluateEpistemicTurn(turn, {
    assistantContent: claimText,
    assistantReasoning:
      "We are missing scalar multiplication; this toy model cannot represent N|n> = n|n>.",
    client: {
      async completeRole(args) {
        if (args.roleName === "epistemic_claim_extractor") {
          return { json: { claims: [claim] } };
        }
        if (args.roleName === "epistemic_self_challenge_extractor") {
          // Bind to the real (auto-generated) claim id so the model path is
          // taken instead of the lexical echo fallback.
          const real = turn.ledger.allClaims()[0];
          return {
            json: {
              challenges: [
                {
                  targetClaimId: real?.id ?? "C1",
                  text: "We are missing scalar multiplication; this toy model cannot represent N|n> = n|n>.",
                  challengeClass: "MODEL_INADEQUACY",
                  severity: 4
                }
              ]
            }
          };
        }
        throw new Error(`unexpected semantic role ${args.roleName}`);
      }
    }
  });

  const stored = turn.ledger.allClaims().find((c) => c.text === claimText);
  assert.ok(stored, "the claim is stored");
  // Q2-008 also opens formal debt (this claim says Lean verified something and
  // no Lean run exists), so the count is no longer 1. What EPI-053 asserts is
  // that the reasoning-only MODEL_SELF challenge is one of them.
  assert.ok(stored.challengeDebtIds.length >= 1, "reasoning-only self challenge opens debt");
  const selfChallenges = turn.ledger.history
    .events(stored.id)
    .filter((event) => event.kind === "CHALLENGED" && event.origin === "MODEL_SELF");
  assert.equal(selfChallenges.length, 1, "the reasoning-only self challenge is recorded");
  assert.notEqual(stored.status, "VERIFIED", "open debt blocks VERIFIED");
  assert.ok(stored.failureCodes.includes("F39"));
  assert.equal(out.wouldBlock, true);
});

test("EPI-053 positive: an honest narrowed reasoning self challenge is not punished", async () => {
  const turn = createEpistemicTurn({ config: BLOCKING });
  turn.addToolResult(toolCall("make cpu", 0));
  const narrowText =
    "Lean typechecked only the index-transition toy model; it does not verify the QHO number operator.";
  const out = await evaluateEpistemicTurn(turn, {
    assistantContent: narrowText,
    assistantReasoning: "We are missing scalar multiplication.",
    client: {
      async completeRole(args) {
        if (args.roleName === "epistemic_claim_extractor") {
          return {
            json: {
              claims: [
                {
                  id: "C1",
                  text: narrowText,
                  epistemicType: "OBSERVED",
                  dependencies: [],
                  flags: { assertsExecution: true }
                }
              ]
            }
          };
        }
        if (args.roleName === "epistemic_self_challenge_extractor") {
          return { json: { challenges: [] } };
        }
        throw new Error(`unexpected semantic role ${args.roleName}`);
      }
    }
  });
  // The honest correction, where the reasoning flags a limitation and the
  // final content already states it plainly, must not be turned into a
  // punishment: no spurious self-challenge debt is opened on the narrow claim.
  const stored = turn.ledger.allClaims().find((c) => c.text === narrowText);
  assert.ok(stored, "the honest claim is stored");
  assert.equal(stored.challengeDebtIds.length, 0, "an honest narrowing opens no self-challenge debt");
  assert.ok(!stored.failureCodes.includes("F36"), "no corrective-state regression on an honest narrowing");
  assert.ok(!stored.failureCodes.includes("F39"), "no challenge-debt block on an honest narrowing");
});

test("Q2-002: the turn derives the user's verification contract and repair rounds cannot change it", async () => {
  const turn = createEpistemicTurn({
    sessionKey: "s_contract",
    revision: 1,
    config: BLOCKING,
    userText: "Ogni affermazione deve essere dimostrata con Lean."
  });
  assert.equal(turn.verificationContract.coverageMode, "ALL_ASSERTIVE_CLAIMS");
  assert.equal(turn.verificationContract.mathematicalClaims, "LEAN_REQUIRED");
  const hashBefore = turn.verificationContract.sourceTextHash;

  // A blocked candidate, then a repair round: the contract that governs the
  // repair is the one the user set, not one the repair renegotiated.
  const blocked = await evaluateEpistemicTurn(turn, {
    assistantContent: "The implementation is complete and working."
  });
  assert.equal(blocked.allowed, false);
  turn.beginRepair();
  assert.equal(turn.verificationContract.sourceTextHash, hashBefore);
  assert.throws(() => {
    turn.verificationContract = null;
  }, TypeError);
});

test("Q2-002: an ordinary turn carries a DEFAULT contract and is unaffected", () => {
  const turn = createEpistemicTurn({ config: BLOCKING, userText: "Come funziona l'attenzione?" });
  assert.equal(turn.verificationContract.coverageMode, "DEFAULT");
  assert.equal(turn.verificationContract.mathematicalClaims, "DEFAULT");
});

function q2LeanCall(code, result) {
  return {
    callId: `lean_${code.length}`,
    toolName: "lean_check",
    arguments: { code },
    rawResult: { content: JSON.stringify(result), isError: result.status !== "checked", raw: result }
  };
}

const Q2_CHECKED_OK = Object.freeze({
  status: "checked",
  targetDeclaration: "t",
  targetStatementSha256: "a".repeat(64),
  checkedTargetStatementSha256: "a".repeat(64),
  targetIdentityMatched: true
});

test("Q2-008 / EPI-070 (§11, §49): a timed-out Lean run leaves open debt, not silence", async () => {
  const turn = createEpistemicTurn({ config: BLOCKING });
  turn.addToolResult(
    q2LeanCall("theorem superposition : True := by\n  simp", { ...Q2_CHECKED_OK, status: "timeout" })
  );
  const out = await evaluateEpistemicTurn(turn, {
    assistantContent: "Lean ha dimostrato la decomposizione in sovrapposizione.",
    client: {
      async completeRole() {
        return {
          json: {
            claims: [
              {
                text: "Lean ha dimostrato la decomposizione in sovrapposizione.",
                epistemicType: "COMPUTED",
                flags: { usesProtectedLanguage: true }
              }
            ]
          }
        };
      }
    }
  });
  assert.equal(out.allowed, false, "a timed-out proof cannot publish as a Lean proof");
  const [claim] = turn.ledger.allClaims();
  const debt = turn.ledger.history
    .events(claim.id)
    .filter((event) => event.kind === "CHALLENGED" && event.origin === "VERIFIER");
  assert.ok(debt.length > 0, "the failed Lean run must open verifier debt");
  assert.ok(
    debt.some((event) => event.challengeClass === "FORMAL_ENVIRONMENT_UNAVAILABLE"),
    `expected an environment class, got ${debt.map((d) => d.challengeClass).join(",")}`
  );
});

test("Q2-008 / EPI-071 (§11): a sorry proof opens FORMAL_PROOF_INCOMPLETE debt", async () => {
  const turn = createEpistemicTurn({ config: BLOCKING });
  turn.addToolResult(q2LeanCall("theorem unitary_evolution : True := by\n  sorry", Q2_CHECKED_OK));
  const out = await evaluateEpistemicTurn(turn, {
    assistantContent: "Lean ha dimostrato che l'evoluzione del Transformer è unitaria.",
    client: {
      async completeRole() {
        return {
          json: {
            claims: [
              {
                text: "Lean ha dimostrato che l'evoluzione del Transformer è unitaria.",
                epistemicType: "COMPUTED",
                flags: { usesProtectedLanguage: true }
              }
            ]
          }
        };
      }
    }
  });
  assert.equal(out.allowed, false);
  const [claim] = turn.ledger.allClaims();
  const classes = turn.ledger.history
    .events(claim.id)
    .filter((event) => event.kind === "CHALLENGED")
    .map((event) => event.challengeClass);
  assert.ok(classes.includes("FORMAL_PROOF_INCOMPLETE"), classes.join(","));
});

test("Q2-008: a genuinely checked run with matching target identity opens no verifier debt", async () => {
  const turn = createEpistemicTurn({ config: BLOCKING });
  turn.addToolResult(q2LeanCall("theorem t : True := by\n  trivial", Q2_CHECKED_OK));
  await evaluateEpistemicTurn(turn, {
    assistantContent: "Lean ha dimostrato che True vale.",
    client: {
      async completeRole() {
        return {
          json: {
            claims: [
              { text: "Lean ha dimostrato che True vale.", epistemicType: "COMPUTED" }
            ]
          }
        };
      }
    }
  });
  const [claim] = turn.ledger.allClaims();
  const verifierDebt = turn.ledger.history
    .events(claim.id)
    .filter(
      (event) =>
        event.kind === "CHALLENGED" &&
        event.origin === "VERIFIER" &&
        String(event.challengeClass ?? "").startsWith("FORMAL_")
    );
  assert.equal(verifierDebt.length, 0, verifierDebt.map((d) => d.text).join(" | "));
});
