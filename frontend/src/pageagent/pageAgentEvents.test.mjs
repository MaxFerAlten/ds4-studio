import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGEAGENT_EVENTS, dispatchPageAgentEvent } from "./pageAgentEvents.mjs";

test("PAGEAGENT_EVENTS defines expected event types", () => {
  assert.equal(PAGEAGENT_EVENTS.STATUS_CHANGE, "pageagent_status");
  assert.equal(PAGEAGENT_EVENTS.ACTIVITY, "pageagent_activity");
  assert.equal(PAGEAGENT_EVENTS.RESULT, "pageagent_result");
  assert.equal(PAGEAGENT_EVENTS.ERROR, "pageagent_error");
});

test("dispatchPageAgentEvent dispatches a CustomEvent with detail", () => {
  const events = [];
  const fakeTarget = {
    dispatchEvent(event) {
      events.push(event);
    }
  };

  dispatchPageAgentEvent(PAGEAGENT_EVENTS.STATUS_CHANGE, { status: "idle" }, fakeTarget);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "pageagent_status");
  assert.equal(events[0].detail.status, "idle");
});
