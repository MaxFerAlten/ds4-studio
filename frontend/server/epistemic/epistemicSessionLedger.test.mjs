import test from "node:test";
import assert from "node:assert/strict";
import { AgentSessionManager } from "../agentSession.mjs";
import { createClaim } from "./epistemicLedger.mjs";
import { EpistemicSessionLedger, SESSION_LEDGER_VERSION } from "./epistemicSessionLedger.mjs";

function claim(text, overrides = {}) {
  return { ...createClaim({ text }), ...overrides };
}

test("a turn's claims are staged, not accepted", () => {
  const ledger = new EpistemicSessionLedger();
  ledger.beginTurn();
  ledger.stageClaims([claim("The suite passes.", { status: "VERIFIED", evidenceIds: ["ev_1"] })]);
  // Staged is not accepted: the gates have not ruled yet.
  assert.equal(ledger.size, 0);
  assert.equal(ledger.findAccepted("The suite passes."), null);

  const { accepted } = ledger.commitClaims();
  assert.equal(accepted.length, 1);
  assert.equal(ledger.size, 1);
  assert.equal(ledger.findAccepted("the suite passes").text, "The suite passes.");
});

test("a refused candidate is not promoted, and does not vanish either", () => {
  const ledger = new EpistemicSessionLedger();
  ledger.beginTurn();
  ledger.stageClaims([claim("sqrt(124000000) = 11")]);

  const discarded = ledger.discardCandidate("EPISTEMIC_SEVERITY_UNRESOLVED");
  assert.equal(discarded.length, 1);
  // §40: not promoted into accepted state...
  assert.equal(ledger.size, 0);
  // ...and kept as negative provenance, so the next turn cannot just restate it.
  const rejected = ledger.findRejected("sqrt(124000000) = 11");
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.discardReason, "EPISTEMIC_SEVERITY_UNRESOLVED");
});

test("a rejected claim needs new evidence to come back", () => {
  const ledger = new EpistemicSessionLedger();
  ledger.beginTurn();
  ledger.stageClaims([claim("The DOI is 10.5555/x.", { evidenceIds: ["ev_1"] })]);
  ledger.discardCandidate("EPISTEMIC_CITATION_IDENTITY_MISMATCH");

  // Restating it with the same evidence is the same claim, and the answer to
  // it has not changed.
  const same = ledger.canPromote("The DOI is 10.5555/x.", ["ev_1"]);
  assert.equal(same.allowed, false);
  assert.match(same.reason, /no new evidence/);
  assert.equal(ledger.canPromote("the doi is 10.5555/x").allowed, false);

  const fresh = ledger.canPromote("The DOI is 10.5555/x.", ["ev_1", "ev_9"]);
  assert.equal(fresh.allowed, true);
  assert.equal(fresh.reason, "new evidence");
  assert.deepEqual(fresh.newEvidenceIds, ["ev_9"]);

  // A claim nobody rejected is unencumbered.
  assert.equal(ledger.canPromote("Something else entirely.").allowed, true);
});

test("an allowed turn does not make every claim in it true", () => {
  const ledger = new EpistemicSessionLedger();
  ledger.beginTurn();
  const { accepted, rejected } = ledger.commitClaims([
    claim("The suite passes.", { status: "VERIFIED" }),
    claim("The DOI is 10.5555/x.", { status: "REJECTED" }),
    claim("The levels scale as n^2.", { status: "CONTRADICTED" })
  ]);
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 2);
  assert.equal(ledger.size, 1);
  assert.ok(ledger.findRejected("The DOI is 10.5555/x."));
  assert.ok(ledger.findRejected("The levels scale as n^2."));
});

test("turns are numbered and a new turn drops the previous candidate", () => {
  const ledger = new EpistemicSessionLedger();
  assert.equal(ledger.beginTurn(), 1);
  ledger.stageClaims([claim("first")]);
  assert.equal(ledger.beginTurn(), 2);
  // The abandoned candidate is gone rather than carried into the new turn.
  assert.equal(ledger.candidate.length, 0);
  ledger.stageClaims([claim("second", { status: "VERIFIED", evidenceIds: ["ev_2"] })]);
  ledger.commitClaims();
  assert.equal(ledger.findAccepted("first"), null);
  assert.equal(ledger.findAccepted("second").turn, 2);
});

test("UNKNOWN and PARTIAL are audit state, not accepted session knowledge", () => {
  const ledger = new EpistemicSessionLedger();
  ledger.beginTurn();
  const result = ledger.commitClaims([
    claim("unknown proposition", { status: "UNKNOWN" }),
    claim("partial proposition", { status: "PARTIAL", evidenceIds: ["ev_1"] }),
    claim("verified proposition", { status: "VERIFIED", evidenceIds: ["ev_2"] }),
    claim("invalidated proposition", { status: "INVALIDATED" })
  ]);
  assert.deepEqual(result.accepted.length, 1);
  assert.deepEqual(result.unresolved.length, 2);
  assert.deepEqual(result.rejected.length, 1);
  assert.equal(ledger.findAccepted("unknown proposition"), null);
  assert.equal(ledger.findAccepted("partial proposition"), null);
  assert.equal(ledger.findAccepted("verified proposition").status, "VERIFIED");
  assert.equal(ledger.unresolved.size, 2);
});

test("acceptedClaims returns defensive session snapshots", () => {
  const ledger = new EpistemicSessionLedger();
  ledger.beginTurn();
  ledger.commitClaims([
    claim("verified proposition", {
      status: "VERIFIED",
      evidenceIds: ["ev_1"],
      verificationRequirements: ["source_identity"]
    })
  ]);
  const accepted = ledger.acceptedClaims();
  accepted[0].evidenceIds.push("mutated");
  assert.deepEqual(ledger.findAccepted("verified proposition").evidenceIds, ["ev_1"]);
  assert.deepEqual(accepted[0].verificationRequirements, ["source_identity"]);
});

test("the ledger round-trips as plain data", () => {
  const ledger = new EpistemicSessionLedger();
  ledger.beginTurn();
  ledger.commitClaims([claim("The suite passes.", { status: "VERIFIED", evidenceIds: ["ev_1"] })]);
  ledger.beginTurn();
  ledger.stageClaims([claim("sqrt(124000000) = 11")]);
  ledger.discardCandidate("bad");

  const json = JSON.parse(JSON.stringify(ledger));
  assert.equal(json.version, SESSION_LEDGER_VERSION);
  const restored = EpistemicSessionLedger.fromJSON(json);
  assert.equal(restored.turn, 2);
  assert.equal(restored.findAccepted("The suite passes.").evidenceIds[0], "ev_1");
  assert.equal(restored.canPromote("sqrt(124000000) = 11").allowed, false);

  ledger.beginTurn();
  ledger.commitClaims([claim("unresolved", { status: "UNKNOWN" })]);
  const unresolved = EpistemicSessionLedger.fromJSON(JSON.parse(JSON.stringify(ledger)));
  assert.equal(unresolved.unresolved.get("unresolved").status, "UNKNOWN");

  // Data from another version is not guessed at.
  assert.equal(EpistemicSessionLedger.fromJSON({ version: "other" }).size, 0);
  assert.equal(EpistemicSessionLedger.fromJSON(null).size, 0);
});

test("the ledger never touches the transcript hashes", () => {
  const session = new AgentSessionManager();
  session.start();
  const user = { role: "user", content: "hello" };
  const assistant = { role: "assistant", content: "hi" };
  session.commit("reset", [user], assistant);
  const hashesBefore = [...session.state.messageHashes];
  const revisionBefore = session.state.revision;

  session.epistemic.beginTurn();
  session.epistemic.commitClaims([claim("The suite passes.", { status: "VERIFIED" })]);

  // §40: the ledger lives beside the transcript, never inside it. A claim in
  // state.messages would change the hashes and break the delta protocol.
  assert.deepEqual(session.state.messageHashes, hashesBefore);
  assert.equal(session.state.revision, revisionBefore);
  assert.equal(JSON.stringify(session.state.messages).includes("The suite passes."), false);
  assert.equal(session.epistemic.size, 1);
});

test("the session lifecycle clears the ledger", () => {
  const session = new AgentSessionManager();
  session.start();
  const fill = () => {
    session.epistemic.beginTurn();
    session.epistemic.commitClaims([claim("The suite passes.", { status: "VERIFIED" })]);
    session.epistemic.beginTurn();
    session.epistemic.stageClaims([claim("bad")]);
    session.epistemic.discardCandidate("x");
  };

  fill();
  session.reset("user reset");
  assert.equal(session.epistemic.size, 0);
  assert.equal(session.epistemic.canPromote("bad").allowed, true);

  fill();
  session.stop();
  assert.equal(session.epistemic.size, 0);

  fill();
  session.start();
  // A new session starts with no memory of the previous one's claims.
  assert.equal(session.epistemic.size, 0);
  assert.equal(session.epistemic.turn, 0);
});

function fakeHistory(eventsByClaim) {
  return {
    events(claimId) {
      return [...(eventsByClaim[claimId] ?? [])];
    }
  };
}

test("R05-PATCH-01: priorClaimsForMatching orders rejected, then unresolved, then accepted", () => {
  const ledger = new EpistemicSessionLedger();
  ledger.beginTurn();
  ledger.commitClaims([
    claim("accepted proposition", { status: "VERIFIED", evidenceIds: ["ev_1"] }),
    claim("rejected proposition", { status: "REJECTED" }),
    claim("unresolved proposition", { status: "UNKNOWN" })
  ]);
  const prior = ledger.priorClaimsForMatching();
  const texts = prior.map((c) => c.text);
  assert.ok(texts.indexOf("rejected proposition") < texts.indexOf("unresolved proposition"));
  assert.ok(texts.indexOf("unresolved proposition") < texts.indexOf("accepted proposition"));
});

test("R05-PATCH-07/11 (EPI-056): stageClaims persists bounded events and round-trips through JSON", () => {
  const ledger = new EpistemicSessionLedger();
  ledger.beginTurn();
  const history = fakeHistory({
    c1: [
      { eventId: "e1", claimId: "c1", kind: "CHALLENGED", origin: "VERIFIER", severity: 5, evidenceIds: ["ev_1"], at: "t1" },
      { eventId: "e2", claimId: "c1", kind: "RESOLVED_SUPPORTED", origin: "MODEL_SELF", severity: 0, evidenceIds: ["ev_2"], at: "t2" }
    ]
  });
  ledger.stageClaims([claim("The suite passes.", { id: "c1", status: "VERIFIED" })], { history });
  ledger.commitClaims();

  const stored = ledger.events.get("c1");
  assert.equal(stored.length, 2);
  assert.equal(stored[0].kind, "CHALLENGED");
  assert.equal(stored[0].severity, 5);
  assert.deepEqual(stored[0].evidenceIds, ["ev_1"]);
  // raw reasoning is never persisted
  assert.equal(JSON.stringify(stored).includes("missing scalar"), false);

  const json = JSON.parse(JSON.stringify(ledger));
  assert.equal(json.version, SESSION_LEDGER_VERSION);
  const restored = EpistemicSessionLedger.fromJSON(json);
  const restoredEvents = restored.events.get("c1");
  assert.equal(restoredEvents.length, 2);
  assert.equal(restoredEvents[1].kind, "RESOLVED_SUPPORTED");
  assert.equal(restoredEvents[1].at, "t2");
});

test("R05-PATCH-10/11: v1/v2 session data migrates to a readable ledger with an empty event map", () => {
  const v2 = {
    version: "epistemic_session_v2",
    turn: 3,
    accepted: [
      { ...claim("The suite passes.", { status: "VERIFIED", evidenceIds: ["ev_1"] }), normalizedText: "the suite passes" }
    ],
    rejected: [],
    unresolved: []
  };
  const restored = EpistemicSessionLedger.fromJSON(v2);
  assert.equal(restored.findAccepted("The suite passes.").status, "VERIFIED");
  assert.equal(restored.turn, 3);
  assert.equal(restored.events.size, 0);
});
