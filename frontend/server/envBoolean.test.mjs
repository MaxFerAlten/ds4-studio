import assert from "node:assert/strict";
import test from "node:test";

import {
  envBoolean,
  envBooleanWithAliases,
  resetEnvBooleanWarningsForTests,
} from "./envBoolean.mjs";

test("canonical boolean spellings are normalized", () => {
  for (const value of ["1", "true", "YES", " on "]) assert.equal(envBoolean(value), true);
  for (const value of ["0", "false", "NO", " off ", ""]) assert.equal(envBoolean(value, true), false);
  assert.equal(envBoolean("unexpected", true), true);
  assert.equal(envBoolean("unexpected", false), false);
});

test("deprecated aliases warn once and canonical value wins", () => {
  resetEnvBooleanWarningsForTests();
  const warnings = [];
  const options = {
    key: "CANONICAL",
    aliases: ["LEGACY"],
    onDeprecated: (message) => warnings.push(message),
  };
  assert.equal(envBooleanWithAliases({ ...options, env: { LEGACY: "1" } }), true);
  assert.equal(envBooleanWithAliases({ ...options, env: { LEGACY: "1" } }), true);
  assert.equal(warnings.length, 1);
  assert.equal(
    envBooleanWithAliases({ ...options, env: { CANONICAL: "0", LEGACY: "1" } }),
    false
  );
});
