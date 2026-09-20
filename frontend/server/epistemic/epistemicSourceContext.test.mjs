import test from "node:test";
import assert from "node:assert/strict";
import { EpistemicSourceContext } from "./epistemicSourceContext.mjs";

test("source bindings are claim-specific and returned as copies", () => {
  const context = new EpistemicSourceContext();
  const source = { id: "s1", title: "Paper" };
  context.bind("c1", { evidenceId: "ev1", source, passages: [{ id: "p1", text: "proof" }] });
  assert.equal(context.forClaim("c2"), null);
  const first = context.forClaim("c1");
  first.source.title = "mutated";
  first.passages[0].text = "mutated";
  assert.equal(context.forClaim("c1").source.title, "Paper");
  assert.equal(context.forClaim("c1").passages[0].text, "proof");
});

test("a binding cannot exist without claim and evidence identity", () => {
  const context = new EpistemicSourceContext();
  assert.throws(() => context.bind("", { evidenceId: "ev1" }), /claim id/);
  assert.throws(() => context.bind("c1", {}), /evidence id/);
});
