import assert from "node:assert/strict";
import test from "node:test";
import { backendHealthLabel, backendStartupDetail, streamFailureNotice } from "./utils.mjs";

test("backendHealthLabel names CUDA model copy startup", () => {
  const status = {
    running: true,
    healthy: false,
    logs: [
      { message: "ds4: CUDA backend initialized on AMD Radeon Graphics (sm_115)" },
      { message: "ds4: CUDA chunk-copying 80.76 GiB model image" }
    ]
  };

  assert.equal(backendHealthLabel(status), "Loading GPU model");
});

test("backendStartupDetail reports CUDA model copy size and elapsed time", () => {
  const status = {
    running: true,
    healthy: false,
    logs: [
      { time: "2026-06-01T21:40:00.000Z", message: "ds4: CUDA backend initialized on AMD Radeon Graphics (sm_115)" },
      { time: "2026-06-01T21:40:05.000Z", message: "ds4: CUDA chunk-copying 80.76 GiB model image" }
    ]
  };

  assert.equal(backendStartupDetail(status, new Date("2026-06-01T21:41:31.000Z")), "Copying 80.76 GiB to GPU · 91s elapsed");
});

test("backendHealthLabel keeps generic waiting label when startup reason is unknown", () => {
  assert.equal(backendHealthLabel({ running: true, healthy: false, logs: [] }), "Waiting for backend");
});

test("streamFailureNotice explains backend termination during startup or restart", () => {
  assert.equal(
    streamFailureNotice(new Error('{"error":"terminated"}')),
    "Stream failed: backend connection ended. Wait for Healthy, then retry."
  );
});
