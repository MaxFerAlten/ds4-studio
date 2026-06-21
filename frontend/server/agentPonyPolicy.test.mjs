import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendPonyPolicy,
  buildPonyPolicy,
  normalizePonyMode,
  ponyCommandMessage,
  ponyModeLabel
} from "./agentPonyPolicy.mjs";

test("normalizes supported pony modes and aliases", () => {
  assert.equal(normalizePonyMode("start"), "full");
  assert.equal(normalizePonyMode("stop"), "off");
  assert.equal(normalizePonyMode(" FULL "), "full");
  assert.equal(normalizePonyMode("lite"), "lite");
  assert.equal(normalizePonyMode("ultra"), "ultra");
  assert.equal(normalizePonyMode("banana"), null);
  assert.equal(ponyModeLabel("banana"), "off");
});

test("builds lean-agent policy only when pony mode is enabled", () => {
  assert.equal(buildPonyPolicy("off"), "");
  const policy = buildPonyPolicy("full");
  assert.match(policy, /DS4 Lean Agent Policy/);
  assert.match(policy, /smallest safe diff/);
  assert.match(policy, /Never simplify away GitNexus/);
  assert.match(policy, /ds4-pony:/);
});

test("appends policy without touching normal prompts when disabled", () => {
  const base = "base system prompt";
  assert.equal(appendPonyPolicy(base, "off"), base);
  assert.match(appendPonyPolicy(base, "lite"), /^base system prompt\n\nDS4 Lean Agent Policy/);
});

test("formats pony command feedback", () => {
  assert.match(ponyCommandMessage("full"), /enabled: full/);
  assert.match(ponyCommandMessage("off"), /disabled/);
  assert.equal(ponyCommandMessage("bad"), null);
});
