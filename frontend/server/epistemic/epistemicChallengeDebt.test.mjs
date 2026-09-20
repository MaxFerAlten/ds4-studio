import test from "node:test";
import assert from "node:assert/strict";

import {
  CHALLENGE_ORIGIN,
  CHALLENGE_STATUS,
  challengeDebt,
  openChallengeDebt
} from "./epistemicChallengeDebt.mjs";
import { CLAIM_EVENT_KIND, ClaimHistory } from "./epistemicClaimHistory.mjs";

function challenge(history, overrides = {}) {
  return history.append({
    eventId: overrides.eventId ?? "challenge-event",
    claimId: overrides.claimId ?? "c1",
    kind: CLAIM_EVENT_KIND.CHALLENGED,
    challengeId: overrides.challengeId ?? "ch-1",
    origin: overrides.origin ?? CHALLENGE_ORIGIN.MODEL_SELF,
    text: overrides.text ?? "the model is missing scalar multiplication",
    severity: overrides.severity ?? 4,
    material: overrides.material,
    at: overrides.at ?? "2026-08-29T10:00:00.000Z"
  });
}

test("open challenge is counted as material debt", () => {
  const history = new ClaimHistory();
  challenge(history);
  const debt = openChallengeDebt({ claimId: "c1", history });
  assert.equal(debt.total, 1);
  assert.equal(debt.material, 1);
  assert.equal(debt.items[0].status, CHALLENGE_STATUS.OPEN);
});

test("resolved challenge is excluded from open debt", () => {
  const history = new ClaimHistory();
  challenge(history);
  history.append({
    eventId: "resolution-event",
    claimId: "c1",
    kind: CLAIM_EVENT_KIND.CHALLENGE_RESOLVED,
    challengeId: "ch-1",
    status: CHALLENGE_STATUS.RESOLVED_NARROWED,
    evidenceIds: ["ev-narrowed"]
  });

  assert.equal(openChallengeDebt({ claimId: "c1", history }).total, 0);
  assert.equal(challengeDebt({ claimId: "c1", history })[0].status, CHALLENGE_STATUS.RESOLVED_NARROWED);
});

test("independent challenges are resolved independently", () => {
  const history = new ClaimHistory();
  challenge(history);
  challenge(history, { eventId: "challenge-event-2", challengeId: "ch-2", severity: 3 });
  history.append({
    eventId: "resolution-event",
    claimId: "c1",
    kind: CLAIM_EVENT_KIND.CHALLENGE_RESOLVED,
    challengeId: "ch-1",
    status: CHALLENGE_STATUS.RESOLVED_SUPPORTED
  });

  assert.deepEqual(openChallengeDebt({ claimId: "c1", history }).items.map((item) => item.id), ["ch-2"]);
});

test("resolution cannot target a nonexistent challenge", () => {
  const history = new ClaimHistory();
  history.append({
    eventId: "orphan-resolution",
    claimId: "c1",
    kind: CLAIM_EVENT_KIND.CHALLENGE_RESOLVED,
    challengeId: "missing",
    status: CHALLENGE_STATUS.RESOLVED_REJECTED
  });

  assert.throws(
    () => openChallengeDebt({ claimId: "c1", history }),
    /resolution targets unknown challenge/
  );
});

test("material filter excludes explicitly non-material objections", () => {
  const history = new ClaimHistory();
  challenge(history, { material: false, severity: 1 });
  const debt = openChallengeDebt({ claimId: "c1", history });
  assert.equal(debt.total, 1);
  assert.equal(debt.material, 0);
});
