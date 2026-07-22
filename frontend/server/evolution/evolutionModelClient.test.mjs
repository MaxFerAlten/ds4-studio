/** Test origin: DS4 acceptance requirements BEH-MODEL-001..003 and SEC-MODEL-001..004. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { EvolutionModelClient } from "./evolutionModelClient.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("BEH-MODEL-001/003 SEC-MODEL-001/004 returns bounded validated evidence, complete usage, and no reasoning", async () => {
  const calls = [];
  const client = {
    model: "fixture-model",
    async completeRole(input) {
      calls.push(input);
      return { json: { ok: true }, reasoning: "must not persist", usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } };
    }
  };
  const model = new EvolutionModelClient({ client });
  const result = await model.completeStructured({ role: "critic", userInput: { x: 1 }, validator: (value) => value });
  assert.deepEqual(result.value, { ok: true });
  assert.equal(result.evidence.role, "critic");
  assert.deepEqual(result.evidence.usage, { promptTokens: 2, completionTokens: 3, totalTokens: 5 });
  assert.equal(Object.hasOwn(result.evidence, "reasoning"), false);
  assert.equal(calls[0].temperature, 0);
  assert.equal(calls[0].think, false);
});

test("BEH-MODEL-002 SEC-MODEL-002 performs at most one semantic repair", async () => {
  let calls = 0;
  const model = new EvolutionModelClient({
    client: {
      model: "fixture-model",
      async completeRole() {
        calls += 1;
        return {
          json: { valid: calls === 2 },
          attempts: calls === 1 ? 2 : 1,
          usage: { prompt_tokens: calls, completion_tokens: 1, total_tokens: calls + 1 }
        };
      }
    }
  });
  const result = await model.completeStructured({
    role: "proposer",
    userInput: {},
    maxRepairs: 1,
    validator(value) {
      if (!value.valid) throw Object.assign(new Error("invalid"), { code: "INVALID" });
      return value;
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.evidence.repairs, 1);
  assert.equal(result.evidence.calls, 3);
  assert.deepEqual(result.evidence.usage, { promptTokens: 3, completionTokens: 2, totalTokens: 5 });
});

test("SEC-MODEL-002 clamps caller-provided semantic repair budgets to one", async () => {
  let calls = 0;
  const model = new EvolutionModelClient({
    client: {
      async completeRole() {
        calls += 1;
        return { json: {}, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
      }
    }
  });
  await assert.rejects(
    () => model.completeStructured({ role: "critic", userInput: {}, maxRepairs: 99, validator() { throw new Error("invalid"); } }),
    (error) => error.code === "MODEL_SCHEMA_INVALID" && error.details.repairs === 1
  );
  assert.equal(calls, 2);
});

test("SEC-MODEL-003 fails closed when complete usage is absent", async () => {
  const model = new EvolutionModelClient({ client: { async completeRole() { return { json: {}, usage: null }; } } });
  await assert.rejects(
    () => model.completeStructured({ role: "critic", userInput: {}, validator: (value) => value }),
    (error) => error.code === "MODEL_USAGE_MISSING"
  );
});

test("proposer prompt forbids echoing the task objective as a proposal field", async () => {
  const prompt = await fs.readFile(path.join(__dirname, "prompts", "proposer.md"), "utf8");
  assert.match(prompt, /Do not echo it as a top-level field\./);
  assert.match(prompt, /Allowed top-level keys:/);
  assert.ok(prompt.includes("Use the supplied task objective only as input. Do not echo it as a top-level field."));
});

test("patcher prompt requires the generated patch schema and forbids nested patch payloads", async () => {
  const prompt = await fs.readFile(path.join(__dirname, "prompts", "patcher.md"), "utf8");
  assert.match(prompt, /Return exactly one JSON object matching `ds4_evolution_generated_patch_v1` and nothing else\./);
  assert.match(prompt, /Allowed top-level keys:/);
  assert.match(prompt, /do not return a nested `patch` object/i);
  assert.match(prompt, /`patchText` must be a single unified diff string/i);
  assert.match(prompt, /do not wrap `patchText` in markdown fences or quotes/i);
  assert.match(prompt, /`patchText` must start with `diff --git a\/\.\.\. b\/\.\.\.`/);
  assert.match(prompt, /`patchText` must include at least one hunk header line that starts with `@@`/);
});
