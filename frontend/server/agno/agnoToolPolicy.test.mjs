import test from "node:test";
import assert from "node:assert/strict";

import {
  AGNO_TOOL_PROFILE,
  AGNO_TOOL_METADATA,
  AgnoToolPolicy,
  AgnoToolPolicyError
} from "./agnoToolPolicy.mjs";
import { AGENT_TOOL_NAMES } from "../agentToolCatalog.mjs";

// --- AgnoToolPolicy.assertAllowed() ---

test("assertAllowed returns metadata for an allowed tool", () => {
  const policy = new AgnoToolPolicy({ enabled: true, profile: "safe" });
  const metadata = policy.assertAllowed("read");
  assert.equal(metadata, AGNO_TOOL_METADATA.read);
});

test("assertAllowed throws AGNO_TOOLS_DISABLED/503 when policy is disabled", () => {
  const policy = new AgnoToolPolicy({ enabled: false, profile: "full" });
  assert.throws(
    () => policy.assertAllowed("read"),
    (err) => {
      assert.ok(err instanceof AgnoToolPolicyError);
      assert.equal(err.code, "AGNO_TOOLS_DISABLED");
      assert.equal(err.status, 503);
      return true;
    }
  );
});

test("assertAllowed throws UNKNOWN_TOOL/404 for an unrecognized tool name", () => {
  const policy = new AgnoToolPolicy({ enabled: true, profile: "full" });
  assert.throws(
    () => policy.assertAllowed("does_not_exist"),
    (err) => {
      assert.ok(err instanceof AgnoToolPolicyError);
      assert.equal(err.code, "UNKNOWN_TOOL");
      assert.equal(err.status, 404);
      return true;
    }
  );
});

test("assertAllowed throws TOOL_NOT_ALLOWED/403 for a tool outside the profile", () => {
  const policy = new AgnoToolPolicy({ enabled: true, profile: "safe" });
  assert.throws(
    () => policy.assertAllowed("bash"),
    (err) => {
      assert.ok(err instanceof AgnoToolPolicyError);
      assert.equal(err.code, "TOOL_NOT_ALLOWED");
      assert.equal(err.status, 403);
      return true;
    }
  );
});

test("assertAllowed throws TOOL_NOT_ALLOWED/403 for a denied tool even if in profile", () => {
  const policy = new AgnoToolPolicy({
    enabled: true,
    profile: "full",
    deniedTools: ["bash"]
  });
  assert.throws(
    () => policy.assertAllowed("bash"),
    (err) => {
      assert.ok(err instanceof AgnoToolPolicyError);
      assert.equal(err.code, "TOOL_NOT_ALLOWED");
      assert.equal(err.status, 403);
      return true;
    }
  );
});

test("explicit allowedTools override replaces (not merges with) the profile default", () => {
  const policy = new AgnoToolPolicy({
    enabled: true,
    profile: "full",
    allowedTools: ["read"]
  });

  // "read" is in the override, so it stays allowed.
  assert.equal(policy.assertAllowed("read"), AGNO_TOOL_METADATA.read);

  // "write" is part of the "full" profile default but not in the
  // override, so it must now be rejected.
  assert.throws(
    () => policy.assertAllowed("write"),
    (err) => {
      assert.ok(err instanceof AgnoToolPolicyError);
      assert.equal(err.code, "TOOL_NOT_ALLOWED");
      assert.equal(err.status, 403);
      return true;
    }
  );
});

// --- AgnoToolPolicy.allowedToolNames() ---

test("allowedToolNames() for full profile with no overrides matches the canonical tool catalog order", () => {
  const policy = new AgnoToolPolicy({ enabled: true, profile: "full" });
  assert.deepEqual(policy.allowedToolNames(), AGENT_TOOL_NAMES);
});

test("allowedToolNames() returns an Array (not a Set)", () => {
  const policy = new AgnoToolPolicy({ enabled: true, profile: "full" });
  assert.ok(Array.isArray(policy.allowedToolNames()));
});

test("allowedToolNames() for safe profile returns a strict subset of the full profile", () => {
  const policy = new AgnoToolPolicy({ enabled: true, profile: "safe" });
  const names = policy.allowedToolNames();
  assert.deepEqual(names, AGNO_TOOL_PROFILE.safe);
  assert.ok(names.length < AGENT_TOOL_NAMES.length);
  for (const name of names) {
    assert.ok(AGENT_TOOL_NAMES.includes(name));
  }
});

test("allowedToolNames() excludes a deniedTools entry even though it's in the profile", () => {
  const policy = new AgnoToolPolicy({
    enabled: true,
    profile: "full",
    deniedTools: ["bash"]
  });
  const names = policy.allowedToolNames();
  assert.ok(!names.includes("bash"));
  assert.deepEqual(
    names,
    AGNO_TOOL_PROFILE.full.filter((name) => name !== "bash")
  );
});

// --- AGNO_TOOL_PROFILE / AGNO_TOOL_METADATA ---

test("AGNO_TOOL_PROFILE and AGNO_TOOL_METADATA are frozen", () => {
  assert.ok(Object.isFrozen(AGNO_TOOL_PROFILE));
  assert.ok(Object.isFrozen(AGNO_TOOL_PROFILE.safe));
  assert.ok(Object.isFrozen(AGNO_TOOL_PROFILE.full));
  assert.ok(Object.isFrozen(AGNO_TOOL_METADATA));
});

test("every name in AGNO_TOOL_PROFILE.safe and .full has a matching AGNO_TOOL_METADATA entry", () => {
  for (const name of [...AGNO_TOOL_PROFILE.safe, ...AGNO_TOOL_PROFILE.full]) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(AGNO_TOOL_METADATA, name),
      `missing metadata for profile tool: ${name}`
    );
  }
});

// --- AgnoToolPolicyError ---

test("AgnoToolPolicyError sets name, code and status", () => {
  const error = new AgnoToolPolicyError("SOME_CODE", "some message", 418);
  assert.equal(error.name, "AgnoToolPolicyError");
  assert.equal(error.code, "SOME_CODE");
  assert.equal(error.status, 418);
  assert.equal(error.message, "some message");
});

test("AgnoToolPolicyError defaults status to 403", () => {
  const error = new AgnoToolPolicyError("SOME_CODE", "some message");
  assert.equal(error.status, 403);
});

test("AgnoToolPolicyError is instanceof Error", () => {
  const error = new AgnoToolPolicyError("SOME_CODE", "some message");
  assert.ok(error instanceof Error);
});
