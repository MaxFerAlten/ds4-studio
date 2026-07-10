// Guards the disconnect-detection contract. The regression this locks down:
// binding the upstream abort to req "close" aborts a healthy in-flight fetch
// as soon as the request body is read (Node 18+), surfacing as
// 500 {"error":"This operation was aborted"} on slow agent requests.

import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { abortOnClientDisconnect } from "./clientDisconnect.mjs";

function makeReqRes() {
  const req = new EventEmitter();
  const res = new EventEmitter();
  res.writableEnded = false;
  return { req, res };
}

// THE regression guard: req "close" fires on body-end while the client is
// still connected. It must NOT abort. (Fails if the abort is rebound to req.)
test("req 'close' (body fully read, client still connected) does NOT abort", () => {
  const { req, res } = makeReqRes();
  const { signal, cleanup } = abortOnClientDisconnect(req, res);
  req.emit("close");
  assert.equal(signal.aborted, false);
  cleanup();
});

test("res 'close' before res.end (real disconnect) aborts the upstream", () => {
  const { req, res } = makeReqRes();
  const { signal, cleanup } = abortOnClientDisconnect(req, res);
  res.writableEnded = false;
  res.emit("close");
  assert.equal(signal.aborted, true);
  cleanup();
});

test("res 'close' after a normal res.end does NOT abort", () => {
  const { req, res } = makeReqRes();
  const { signal, cleanup } = abortOnClientDisconnect(req, res);
  res.writableEnded = true;
  res.emit("close");
  assert.equal(signal.aborted, false);
  cleanup();
});

test("req 'aborted' (client abandoned request) aborts the upstream", () => {
  const { req, res } = makeReqRes();
  const { signal, cleanup } = abortOnClientDisconnect(req, res);
  req.emit("aborted");
  assert.equal(signal.aborted, true);
  cleanup();
});

test("cleanup removes listeners so later events are inert", () => {
  const { req, res } = makeReqRes();
  const { signal, cleanup } = abortOnClientDisconnect(req, res);
  cleanup();
  res.writableEnded = false;
  res.emit("close");
  req.emit("aborted");
  assert.equal(signal.aborted, false);
  assert.equal(res.listenerCount("close"), 0);
  assert.equal(req.listenerCount("aborted"), 0);
});
