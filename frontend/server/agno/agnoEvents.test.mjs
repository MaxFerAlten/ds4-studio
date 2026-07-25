import assert from "node:assert";
import { describe, it } from "node:test";
import { AgnoEventStream } from "./agnoEvents.mjs";

describe("AgnoEventStream", () => {
  it("parses single event", () => {
    const events = [];
    const parser = new AgnoEventStream({ onEvent: (e) => events.push(e) });
    parser.feed('event: content_delta\ndata: {"type":"content_delta","runId":"abc","seq":1}\n\n');
    assert(events.length === 1);
    assert(events[0].runId === "abc");
    assert(events[0].seq === 1);
  });

  it("handles chunked data", () => {
    const events = [];
    const parser = new AgnoEventStream({ onEvent: (e) => events.push(e) });
    parser.feed('event: content_delta\ndata: {"type":"conte');
    parser.feed('nt_delta","runId":"abc","seq":1}\n\n');
    assert(events.length === 1);
    assert(events[0].type === "content_delta");
  });

  it("deduplicates by (runId, seq)", () => {
    const events = [];
    const parser = new AgnoEventStream({ onEvent: (e) => events.push(e) });
    parser.feed('event: content_delta\ndata: {"type":"content_delta","runId":"abc","seq":1}\n\n');
    parser.feed('event: content_delta\ndata: {"type":"content_delta","runId":"abc","seq":1}\n\n');
    assert(events.length === 1, "duplicate should be ignored");
  });

  it("handles heartbeat comments", () => {
    const events = [];
    const parser = new AgnoEventStream({ onEvent: (e) => events.push(e) });
    parser.feed(": heartbeat\n\n");
    parser.feed('event: content_delta\ndata: {"type":"content_delta","runId":"abc","seq":1}\n\n');
    assert(events.length === 1, "heartbeat should not create event");
  });

  it("handles terminal events", () => {
    const events = [];
    const parser = new AgnoEventStream({ onEvent: (e) => events.push(e) });
    parser.feed('event: run_completed\ndata: {"type":"run_completed","runId":"abc","seq":3}\n\n');
    assert(events.length === 1);
    assert(events[0].type === "run_completed");
  });

  it("resets state correctly", () => {
    const events = [];
    const parser = new AgnoEventStream({ onEvent: (e) => events.push(e) });
    parser.feed('event: content_delta\ndata: {"type":"content_delta","runId":"abc","seq":1}\n\n');
    parser.reset();
    parser.feed('event: content_delta\ndata: {"type":"content_delta","runId":"abc","seq":1}\n\n');
    assert(events.length === 1, "reset should clear dedup state");
  });
});
