import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { closestModules, leanImportHints, listLeanModules } from "./leanImportHints.mjs";

const profileDir = mkdtempSync(join(tmpdir(), "lean-hints-"));
const lib = join(profileDir, ".lake", "packages", "mathlib", ".lake", "build", "lib", "lean");
for (const module of ["Mathlib/Data/Real/Basic", "Mathlib/Algebra/BigOperators/Group/Finset/Basic",
  "Mathlib/Algebra/BigOperators/Group/Finset/Defs", "Mathlib/Algebra/BigOperators/Field", "Mathlib/Data/Nat/Choose/Sum"]) {
  const file = join(lib, `${module}.olean`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "");
}
test.after(() => rmSync(profileDir, { recursive: true, force: true }));

test("modules come from the profile's own .olean tree", () => {
  assert.ok(listLeanModules(profileDir).has("Mathlib.Data.Real.Basic"));
  assert.equal(listLeanModules(join(profileDir, "missing")).size, 0);
});

test("a renamed module gets the closest existing modules", () => {
  const near = closestModules("Mathlib.Algebra.BigOperators.Basic", listLeanModules(profileDir));
  assert.equal(near[0], "Mathlib.Algebra.BigOperators.Group.Finset.Basic");
  const [hint] = leanImportHints([{ severity: "error",
    message: "object file '/x/Basic.olean' of module Mathlib.Algebra.BigOperators.Basic does not exist" }], { profileDir });
  assert.match(hint, /Mathlib\.Algebra\.BigOperators\.Basic does not exist.*Group\.Finset\.Basic/);
});

test("unknown notation names its defining module unless already imported", () => {
  const unknown = [{ severity: "error", message: "Unknown identifier `ℝ`" }];
  assert.deepEqual(leanImportHints(unknown, { profileDir }),
    ["IMPORT_HINT: `ℝ` is defined in Mathlib.Data.Real.Basic: add `import Mathlib.Data.Real.Basic`."]);
  assert.deepEqual(leanImportHints(unknown, { profileDir, imports: ["Mathlib.Data.Real.Basic"] }), []);
  assert.match(leanImportHints([{ severity: "error", message: "unexpected token '∑'; expected term" }], { profileDir })[0],
    /Group\.Finset\.Defs/);
});

test("a hint never names a module the runtime lacks", () => {
  // Mathlib.Data.Complex.Basic is mapped but absent from this fake runtime.
  assert.deepEqual(leanImportHints([{ severity: "error", message: "Unknown identifier `ℂ`" }], { profileDir }), []);
});

test("the removed `∑ x in s` binder gets the `∈` form, only when the source uses it", () => {
  const diagnostics = [{ severity: "error", message: "unexpected token 'in'; expected ','" }];
  const code = "theorem t (n : ℕ) : ∑ r in Finset.range n, r = 0 := by sorry";
  assert.match(leanImportHints(diagnostics, { code }).join("\n"), /∑ x ∈ s, f x/);
  assert.deepEqual(leanImportHints(diagnostics, { code: "def f := let x := 1 in x" }), []);
});
