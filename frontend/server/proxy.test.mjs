import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import { readRequestBody, requestHeadersForProxy } from "./proxy.mjs";

test("proxy buffers POST bodies and forwards an explicit content length", async () => {
  const req = Readable.from([Buffer.from('{"messages":[{"role":"user","content":"ciao"}]}')]);
  req.method = "POST";
  req.headers = {
    host: "127.0.0.1:5173",
    connection: "keep-alive",
    "content-type": "application/json"
  };

  const body = await readRequestBody(req);
  const headers = requestHeadersForProxy(req, body);

  assert.equal(body.toString("utf8"), '{"messages":[{"role":"user","content":"ciao"}]}');
  assert.equal(headers["content-type"], "application/json");
  assert.equal(headers["content-length"], String(body.length));
  assert.equal(headers.host, undefined);
  assert.equal(headers.connection, undefined);
  assert.equal(headers["transfer-encoding"], undefined);
});
