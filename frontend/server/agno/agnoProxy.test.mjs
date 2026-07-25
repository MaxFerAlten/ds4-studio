import assert from "node:assert";
import { describe, it } from "node:test";
import { forwardEventStream, proxyPostToAgno } from "./agnoProxy.mjs";

describe("forwardEventStream", () => {
  it("forwards upstream body to response", async () => {
    const chunks = [];
    const upstream = {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from("hello world"));
          controller.close();
        },
      }),
    };
    const res = {
      write: (chunk) => chunks.push(chunk.toString()),
      end: () => {},
    };
    await forwardEventStream(upstream, res);
    assert(chunks.length === 1);
    assert(chunks[0] === "hello world");
  });

  it("handles missing upstream body", async () => {
    const upstream = { body: null };
    let ended = false;
    const res = { end: () => { ended = true; } };
    await forwardEventStream(upstream, res);
    assert(ended === true);
  });
});

describe("proxyPostToAgno", () => {
  it("forwards POST request body and returns response", async () => {
    const baseUrl = "http://127.0.0.1:7777";
    const req = {
      method: "POST",
      headers: {},
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify({ message: "hi" }));
      },
    };
    let forwardedBody = null;
    const fetchImpl = async (url, options = {}) => {
      forwardedBody = options.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: "ok" }),
        body: null,
      };
    };
    const res = { json: (data) => {}, status: () => {} };
    await proxyPostToAgno(baseUrl, "/ds4/runs", req, res, { fetchImpl });
    assert(forwardedBody !== null);
    assert(forwardedBody.includes("message"));
  });
});
