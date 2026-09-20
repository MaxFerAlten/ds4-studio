import test from "node:test";
import assert from "node:assert/strict";

import { CLAIM_EVENT_KIND, ClaimHistory } from "./epistemicClaimHistory.mjs";

test("ClaimHistory appends events in claim order", () => {
  const history = new ClaimHistory();
  history.append({
    eventId: "ev-1",
    claimId: "c1",
    kind: CLAIM_EVENT_KIND.CREATED,
    at: "2026-08-29T10:00:00.000Z"
  });
  history.append({
    eventId: "ev-2",
    claimId: "c1",
    kind: CLAIM_EVENT_KIND.CHALLENGED,
    at: "2026-08-29T10:00:01.000Z"
  });

  assert.deepEqual(history.events("c1").map((event) => event.eventId), ["ev-1", "ev-2"]);
});

test("ClaimHistory freezes stored events without mutating caller input", () => {
  const history = new ClaimHistory();
  const input = {
    eventId: "ev-immutable",
    claimId: "c1",
    kind: CLAIM_EVENT_KIND.CHALLENGED,
    details: { evidenceIds: ["e1"] }
  };
  const stored = history.append(input);

  input.details.evidenceIds.push("caller-only");
  assert.deepEqual(stored.details.evidenceIds, ["e1"]);
  assert.equal(Object.isFrozen(stored), true);
  assert.equal(Object.isFrozen(stored.details), true);
  assert.equal(Object.isFrozen(stored.details.evidenceIds), true);
  assert.throws(() => stored.details.evidenceIds.push("rewrite"), TypeError);
});

test("ClaimHistory snapshots cannot rewrite previous events", () => {
  const history = new ClaimHistory();
  history.append({ eventId: "ev-old", claimId: "restored-claim", kind: CLAIM_EVENT_KIND.CREATED });
  const snapshot = history.events("restored-claim");

  snapshot.length = 0;
  assert.equal(history.events("restored-claim").length, 1);
  assert.equal(history.events("unknown-claim").length, 0);
});

test("ClaimHistory rejects invalid kinds and duplicate event IDs", () => {
  const history = new ClaimHistory();
  assert.throws(
    () => history.append({ claimId: "c1", kind: "REWRITTEN" }),
    /unknown claim event kind/
  );
  history.append({ eventId: "same", claimId: "c1", kind: CLAIM_EVENT_KIND.CREATED });
  assert.throws(
    () => history.append({ eventId: "same", claimId: "c2", kind: CLAIM_EVENT_KIND.CREATED }),
    /duplicate claim event id/
  );
});
