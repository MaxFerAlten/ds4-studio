import test from "node:test";
import assert from "node:assert/strict";
import {
  cancelResearch,
  createResearchSession,
  fetchResearchState,
  launchResearch,
  listResearchSessions,
  openResearchStream,
  researchExportUrl,
  sendFeedback,
  startResearch,
  uploadResearchDocument
} from "./researchApi.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

test("startResearch posts the query and returns sessionId", async () => {
  let captured;
  const out = await startResearch("q", {
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return jsonResponse({ sessionId: "rs_1" });
    }
  });
  assert.equal(out.sessionId, "rs_1");
  assert.equal(captured.url, "/api/research/start");
  assert.equal(captured.body.query, "q");
});

test("startResearch surfaces the server error message", async () => {
  await assert.rejects(
    () =>
      startResearch("q", {
        fetchImpl: async () => jsonResponse({ error: "research mode is disabled" }, 403)
      }),
    /disabled/
  );
});

test("sendFeedback posts action and plan", async () => {
  let captured;
  await sendFeedback("rs_1", "edit", { steps: [{ id: "s1" }] }, {
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return jsonResponse({ status: "running" });
    }
  });
  assert.equal(captured.url, "/api/research/feedback");
  assert.equal(captured.body.action, "edit");
  assert.equal(captured.body.sessionId, "rs_1");
  assert.ok(captured.body.plan.steps.length);
});

test("cancelResearch posts the sessionId", async () => {
  let captured;
  await cancelResearch("rs_1", {
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return jsonResponse({ status: "cancelled" });
    }
  });
  assert.equal(captured.url, "/api/research/cancel");
  assert.equal(captured.body.sessionId, "rs_1");
});

test("fetchResearchState gets the state", async () => {
  const out = await fetchResearchState("rs_1", {
    fetchImpl: async (url) => {
      assert.equal(url, "/api/research/state/rs_1");
      return jsonResponse({ state: { status: "completed" } });
    }
  });
  assert.equal(out.state.status, "completed");
});

test("listResearchSessions gets persisted research summaries", async () => {
  const sessions = [{ sessionId: "rs_1", query: "q", status: "running" }];
  const out = await listResearchSessions({
    fetchImpl: async (url, options) => {
      assert.equal(url, "/api/research/sessions");
      assert.equal(options, undefined);
      return jsonResponse({ sessions });
    }
  });
  assert.deepEqual(out, sessions);
});

test("listResearchSessions surfaces server errors", async () => {
  await assert.rejects(
    () =>
      listResearchSessions({
        fetchImpl: async () => jsonResponse({ error: "research disabled" }, 403)
      }),
    /research disabled/
  );
});

test("createResearchSession posts the query to the session endpoint", async () => {
  let captured;
  const out = await createResearchSession("q", {
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return jsonResponse({ sessionId: "rs_draft" });
    }
  });
  assert.equal(out.sessionId, "rs_draft");
  assert.equal(captured.url, "/api/research/session");
  assert.equal(captured.body.query, "q");
});

test("launchResearch starts an existing draft session by id", async () => {
  let captured;
  await launchResearch("rs_1", {
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return jsonResponse({ sessionId: "rs_1" });
    }
  });
  assert.equal(captured.url, "/api/research/start");
  assert.equal(captured.body.sessionId, "rs_1");
});

test("uploadResearchDocument posts multipart form to the documents endpoint", async () => {
  let captured;
  const fakeFile = new Blob(["text"], { type: "text/markdown" });
  const out = await uploadResearchDocument("rs_1", fakeFile, {
    fetchImpl: async (url, options) => {
      captured = { url, method: options.method, isForm: options.body instanceof FormData };
      return jsonResponse({ document: { docId: "doc000" }, documents: [{ docId: "doc000" }] });
    }
  });
  assert.equal(captured.url, "/api/research/rs_1/documents");
  assert.equal(captured.method, "POST");
  assert.equal(captured.isForm, true);
  assert.equal(out.document.docId, "doc000");
});

test("researchExportUrl builds the download url with format", () => {
  assert.equal(researchExportUrl("rs_1", "html"), "/api/research/export/rs_1?format=html");
  assert.equal(researchExportUrl("rs_1"), "/api/research/export/rs_1?format=md");
});

test("openResearchStream parses research_event payloads and skips garbage", () => {
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      FakeEventSource.last = this;
    }
    addEventListener(name, fn) {
      this.listeners[name] = fn;
    }
    close() {
      this.closed = true;
    }
  }
  const seen = [];
  const es = openResearchStream("rs_1", (e) => seen.push(e), {
    EventSourceImpl: FakeEventSource,
    lastSeq: 5
  });
  assert.equal(FakeEventSource.last.url, "/api/research/stream/rs_1?lastSeq=5");
  FakeEventSource.last.listeners.research_event({
    data: JSON.stringify({ type: "research_started", seq: 6 })
  });
  FakeEventSource.last.listeners.research_event({ data: "not json" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, "research_started");
  assert.equal(es, FakeEventSource.last);
});

test("createResearchSession and startResearch send the selected engine", async () => {
  const bodies = [];
  const fetchImpl = async (_url, opt) => {
    bodies.push(JSON.parse(opt.body));
    return { ok: true, json: async () => ({ sessionId: "rs_1" }) };
  };
  await createResearchSession("q", { engine: "gemini", fetchImpl });
  await startResearch("q", { engine: "local", fetchImpl });
  assert.equal(bodies[0].engine, "gemini");
  assert.equal(bodies[1].engine, "local");
});
