// Non-regression test for LeftRail panel extraction.
// LeftRail is presentational; this test locks the data/function contracts it relies on.

import assert from "node:assert/strict";
import { test } from "node:test";

import { backendHealthLabel, backendStartupDetail, streamFailureNotice } from "../utils.mjs";

test("LeftRail: backendHealthLabel returns 'Healthy' for healthy status", () => {
  assert.equal(backendHealthLabel({ healthy: true }), "Healthy");
});

test("LeftRail: backendHealthLabel detects CUDA chunk-copying", () => {
  const status = { healthy: false, logs: [{ message: "CUDA chunk-copying 80 GiB model image" }] };
  assert.equal(backendHealthLabel(status), "Loading GPU model");
});

test("LeftRail: backendHealthLabel falls back to 'Waiting for backend'", () => {
  assert.equal(backendHealthLabel({ healthy: false, logs: [] }), "Waiting for backend");
});

test("LeftRail: backendStartupDetail returns empty string when healthy or not running", () => {
  assert.equal(backendStartupDetail({ running: false, healthy: false }), "");
  assert.equal(backendStartupDetail({ running: true, healthy: true }), "");
});

test("LeftRail: backendStartupDetail parses CUDA copy timing from logs", () => {
  const status = {
    running: true, healthy: false,
    logs: [
      { time: "2026-06-01T21:40:00.000Z", message: "CUDA backend initialized" },
      { time: "2026-06-01T21:40:05.000Z", message: "CUDA chunk-copying 80.76 GiB model image" }
    ]
  };
  assert.equal(backendStartupDetail(status, new Date("2026-06-01T21:41:31.000Z")),
    "Copying 80.76 GiB to GPU · 91s elapsed");
});

test("LeftRail: streamFailureNotice detects backend termination", () => {
  assert.equal(streamFailureNotice(new Error('{"error":"terminated"}')),
    "Stream failed: backend connection ended. Wait for Healthy, then retry.");
});

test("LeftRail: streamFailureNotice passes through other errors", () => {
  assert.equal(streamFailureNotice(new Error("generic error")), "Stream failed: generic error");
});
