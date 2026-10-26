import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLeanToolProfile } from "./leanToolProfile.mjs";
import { LeanTurnTracker } from "./leanTurnTracker.mjs";
import { createLeanTaskSpec } from "./leanTaskSpec.mjs";

test("an omitted profile follows real Mathlib imports before the proof is sealed", () => {
  for (const code of [
    "import Mathlib\ntheorem t : True := by trivial",
    "import Mathlib.Data.Nat.Choose.Sum\ntheorem t : True := by trivial",
    "import Std Mathlib.Tactic.Ring\n",
    "/- /- nested -/ header -/\npublic import Mathlib.Data.Nat.Basic\n",
    "import /- module comment -/ Mathlib.Data.Nat.Basic\n"
  ]) assert.equal(resolveLeanToolProfile({ code }), "mathlib", code);
});

test("comments, strings and similarly named modules do not select Mathlib", () => {
  for (const code of [
    "-- import Mathlib\ntheorem t : True := by trivial",
    "/-\n/- nested -/\nimport Mathlib\n-/\nimport Std\n",
    'def s := "example:\nimport Mathlib\n"',
    'def s := "escaped \\\"\nimport Mathlib\n"',
    "import MathlibExtra\n"
  ]) assert.equal(resolveLeanToolProfile({ code }), "core", code);
});

test("configured defaults and explicit profiles remain authoritative", () => {
  assert.equal(resolveLeanToolProfile({ code: "import Std" }, { defaultProfile: "mathlib" }), "mathlib");
  assert.equal(resolveLeanToolProfile({ code: "import Mathlib", profile: "core" }), "core");
  assert.equal(resolveLeanToolProfile({ profile: "invalid" }), "invalid", "validation must still reject invalid profiles");
});

test("an omitted repair profile reuses the seal even if the imports change", () => {
  assert.equal(resolveLeanToolProfile({ code: "import Std" }, { lockedProfile: "mathlib" }), "mathlib");
  assert.equal(resolveLeanToolProfile({ code: "import Mathlib" }, { lockedProfile: "core" }), "core");
  assert.equal(resolveLeanToolProfile({ profile: "core" }, { lockedProfile: "mathlib" }), "core", "an explicit drift must reach the tracker and be refused");
});

test("a placeholder rejection does not lock a Mathlib proof into core", () => {
  const first = { code: "import Mathlib\ntheorem t : True := by sorry" };
  const profile = resolveLeanToolProfile(first);
  const sealed = createLeanTaskSpec({
    targetDeclaration: "t", targetStatement: "theorem t : True", requiredProfile: profile
  });
  assert.equal(sealed.ok, true);
  const tracker = new LeanTurnTracker();
  assert.equal(tracker.begin({ targetDeclaration: "t", profile, taskSpec: sealed.value }).allowed, true);
  assert.equal(tracker.beforeAttempt({ code: first.code, targetDeclaration: "t", profile }).allowed, true);
  tracker.recordResult({
    status: "rejected", errorCode: "LEAN_CANDIDATE_PREFLIGHT_BLOCKED",
    containsPlaceholders: true, attemptConsumed: false, profile
  });
  const repaired = { code: "theorem t : True := by trivial" };
  const repairProfile = resolveLeanToolProfile(repaired, { lockedProfile: sealed.value.requiredProfile });
  const repair = tracker.beforeAttempt({ code: repaired.code, targetDeclaration: "t", profile: repairProfile });
  assert.equal(repair.allowed, true, repair.reason);
  assert.equal(tracker.snapshot().profile, "mathlib");
  const drift = tracker.beforeAttempt({ code: repaired.code, targetDeclaration: "t", profile: "core" });
  assert.equal(drift.code, "LEAN_PROFILE_CHANGED_WITHIN_PROOF");
});
