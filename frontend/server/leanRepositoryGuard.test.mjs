import test from "node:test";
import assert from "node:assert/strict";

import {
  bashCommandIsReadOnly,
  classifyRepositoryMutation,
  containsForbiddenPlaceholder,
  LEAN_FORBIDDEN_PLACEHOLDER,
  LEAN_REPOSITORY_MUTATION_BLOCKED
} from "./leanRepositoryGuard.mjs";

const LEAN_ACTIVE = { leanRepositoryMutationBlocked: true };

// ---------------------------------------------------------------------------
// §110 — the exact files the regression left behind
// ---------------------------------------------------------------------------

test("write is blocked while a Lean task is active", () => {
  const decision = classifyRepositoryMutation(
    "write",
    { path: "tests/fixtures/lean/my_cauchy_mvt.lean", content: "theorem t : True := by trivial" },
    LEAN_ACTIVE
  );
  assert.equal(decision.blocked, true);
  assert.equal(decision.code, LEAN_REPOSITORY_MUTATION_BLOCKED);
  assert.match(decision.message, /lean_check\(code=\.\.\.\)/);
});

test("edit is blocked while a Lean task is active", () => {
  const decision = classifyRepositoryMutation(
    "edit",
    { path: "src/foo.c", old: "a", new: "b" },
    LEAN_ACTIVE
  );
  assert.equal(decision.blocked, true);
  assert.equal(decision.code, LEAN_REPOSITORY_MUTATION_BLOCKED);
});

test("write and edit are untouched outside a Lean task", () => {
  assert.equal(
    classifyRepositoryMutation("write", { path: "notes.md", content: "hello" }).blocked,
    false
  );
});

// ---------------------------------------------------------------------------
// §54 — blocking write/edit alone is not enough
// ---------------------------------------------------------------------------

test("read-only discovery commands still run during a Lean task", () => {
  const allowed = [
    "grep -rn 'exists_deriv_eq_slope' /usr/lib/lean",
    "rg --files-with-matches MeanValue",
    "find . -name '*.lean' -maxdepth 3",
    "cat tests/fixtures/lean/positive_cauchy_mvt_mathlib.lean",
    "sed -n '1,40p' Mathlib/Analysis/Calculus/Deriv/MeanValue.lean",
    "head -20 foo.lean",
    "tail -n 5 foo.lean",
    "ls tests/fixtures/lean",
    "wc -l foo.lean",
    "git status --porcelain",
    "git log --oneline -5",
    "grep -c sorry foo.lean 2>/dev/null"
  ];
  for (const command of allowed) {
    assert.equal(bashCommandIsReadOnly(command), true, command);
    assert.equal(
      classifyRepositoryMutation("bash", { command }, LEAN_ACTIVE).blocked,
      false,
      command
    );
  }
});

test("shell commands that can write are blocked", () => {
  const blocked = [
    "cat > tests/fixtures/lean/my_cauchy.lean",
    "printf 'theorem t : True := by trivial' > foo.lean",
    "echo x >> foo.lean",
    "tee foo.lean",
    "sed -i 's/a/b/' foo.lean",
    "perl -pi -e 's/a/b/' foo.lean",
    "rm tests/fixtures/lean/my_cauchy.lean",
    "mv a.lean b.lean",
    "cp a.lean b.lean",
    "mkdir -p scratch",
    "touch foo.lean",
    "git apply patch.diff",
    "git checkout -- foo.lean",
    "git add .",
    "grep -rn sorry . && rm foo.lean",
    "cat $(echo foo) > bar"
  ];
  for (const command of blocked) {
    assert.equal(bashCommandIsReadOnly(command), false, command);
    const decision = classifyRepositoryMutation("bash", { command }, LEAN_ACTIVE);
    assert.equal(decision.blocked, true, command);
    assert.equal(decision.code, LEAN_REPOSITORY_MUTATION_BLOCKED);
  }
});

test("the classifier fails closed on commands it does not know", () => {
  assert.equal(bashCommandIsReadOnly("some_unknown_binary --flag"), false);
  assert.equal(bashCommandIsReadOnly("python3 write_stuff.py"), false);
});

test("bash is unrestricted outside a Lean task", () => {
  assert.equal(
    classifyRepositoryMutation("bash", { command: "rm -rf build" }).blocked,
    false
  );
});

// ---------------------------------------------------------------------------
// §9/§111 — no placeholder ever reaches the repository
// ---------------------------------------------------------------------------

test("placeholders are recognised", () => {
  assert.equal(containsForbiddenPlaceholder("theorem t : True := by\n  sorry\n"), true);
  assert.equal(containsForbiddenPlaceholder("theorem t : True := by\n  admit\n"), true);
  assert.equal(containsForbiddenPlaceholder("theorem t : True := by?\n"), true);
  assert.equal(containsForbiddenPlaceholder("theorem t : True := by\n  trivial\n"), false);
  // A name that merely contains the word is not a placeholder.
  assert.equal(containsForbiddenPlaceholder("theorem sorry_free : True := by trivial"), false);
  assert.equal(containsForbiddenPlaceholder("-- no_sorry here\ntheorem t : True := by trivial"), false);
});

test("a .lean file carrying sorry is refused even outside a Lean task", () => {
  const decision = classifyRepositoryMutation("write", {
    path: "tests/fixtures/lean/my_cauchy_mvt_minimal.lean",
    content: "theorem cauchy_mvt : True := by\n  sorry\n"
  });
  assert.equal(decision.blocked, true);
  assert.equal(decision.code, LEAN_FORBIDDEN_PLACEHOLDER);
});

test("editing a .lean file to introduce sorry is refused", () => {
  const decision = classifyRepositoryMutation("edit", {
    path: "foo.lean",
    old: "trivial",
    new: "sorry"
  });
  assert.equal(decision.blocked, true);
  assert.equal(decision.code, LEAN_FORBIDDEN_PLACEHOLDER);
});

test("a clean .lean file is still writable outside a Lean task", () => {
  const decision = classifyRepositoryMutation("write", {
    path: "tests/fixtures/lean/positive.lean",
    content: "theorem t : True := by trivial\n"
  });
  assert.equal(decision.blocked, false);
});
