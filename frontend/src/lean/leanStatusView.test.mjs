// R13 — the UI must never report "Ready" from enabled=true alone.
import test from "node:test";
import assert from "node:assert/strict";

import { leanStatusView } from "./leanStatusView.mjs";

const ready = (over = {}) => ({
  enabled: true,
  effective: { enabled: true },
  policyLoaded: true,
  policyRevision: "05156c293a07ffaf92baa983981741cd2ddedc5a",
  preflight: {
    ok: true,
    sandboxAvailable: true,
    profiles: {
      core: { ok: true, toolchain: "leanprover/lean4:v4.32.2" },
      mathlib: { ok: true, toolchain: "leanprover/lean4:v4.32.2" },
    },
    errors: [],
  },
  ...over,
});

test("no status at all is reported as such, never as ready", () => {
  const v = leanStatusView(null);
  assert.equal(v.state, "unknown");
  assert.equal(v.tone, "bad");
});

test("disabled is disabled", () => {
  const v = leanStatusView({ enabled: false, effective: { enabled: false } }, { enabled: false });
  assert.equal(v.state, "disabled");
  assert.equal(v.restartRequired, false);
});

test("a saved toggle the running process has not picked up says so", () => {
  const v = leanStatusView({ enabled: false, effective: { enabled: false } }, { enabled: true });
  assert.equal(v.state, "configured-restart-required");
  assert.equal(v.restartRequired, true);
  assert.match(v.detail, /restart|running server/i);
});

test("enabled with a broken sandbox is never ready", () => {
  const v = leanStatusView(
    ready({
      preflight: {
        ok: false,
        sandboxAvailable: false,
        profiles: { core: { ok: false, toolchain: null } },
        errors: ["bwrap cannot create a user namespace"],
      },
    })
  );
  assert.equal(v.state, "sandbox-unavailable");
  assert.equal(v.tone, "bad");
  assert.match(v.detail, /namespace/);
});

test("enabled with an unprepared core profile is never ready", () => {
  const v = leanStatusView(
    ready({
      preflight: {
        ok: false,
        sandboxAvailable: true,
        profiles: { core: { ok: false, toolchain: null } },
        errors: [],
      },
    })
  );
  assert.equal(v.state, "runtime-unavailable");
});

test("core ready without mathlib is degraded, not ready", () => {
  const v = leanStatusView(
    ready({
      preflight: {
        ok: true,
        sandboxAvailable: true,
        profiles: {
          core: { ok: true, toolchain: "leanprover/lean4:v4.32.2" },
          mathlib: { ok: false, toolchain: "leanprover/lean4:v4.32.2" },
        },
        errors: [],
      },
    })
  );
  assert.equal(v.state, "degraded");
  assert.match(v.label, /Core ready/);
  assert.match(v.detail, /fail closed/);
});

test("both profiles ready reports the policy as available, not active", () => {
  const v = leanStatusView(ready());
  assert.equal(v.state, "core-mathlib-ready");
  assert.match(v.label, /Core \+ Mathlib ready/);
  assert.match(v.detail, /\/skill lean start/);
  assert.match(v.detail, /05156c29/);
});

test("an active policy is distinguished from an available one", () => {
  const v = leanStatusView(
    ready({
      policy: {
        available: true,
        availableRevision: "05156c293a07ffaf92baa983981741cd2ddedc5a",
        active: true,
        activeRevision: "05156c293a07ffaf92baa983981741cd2ddedc5a",
      },
    })
  );
  assert.equal(v.state, "policy-active");
  assert.match(v.label, /policy active/);
});

test("a missing policy file keeps the tool fail-closed in the UI wording", () => {
  const v = leanStatusView(ready({ policyLoaded: false, policyRevision: "" }));
  assert.equal(v.tone, "warn");
  assert.match(v.detail, /fail-closed/);
});

test("a run in flight shows busy", () => {
  const v = leanStatusView(ready(), { enabled: true }, { busy: true });
  assert.equal(v.state, "busy");
});

test("core-only ready without a mathlib profile entry is ready, not degraded", () => {
  const v = leanStatusView(
    ready({
      preflight: {
        ok: true,
        sandboxAvailable: true,
        profiles: { core: { ok: true, toolchain: "leanprover/lean4:v4.32.2" } },
        errors: [],
      },
    })
  );
  assert.equal(v.state, "core-ready");
});
