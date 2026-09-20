import test from "node:test";
import assert from "node:assert/strict";
import { SEVERITY } from "./epistemicContracts.mjs";
import { ENTAILMENT_PROMPT } from "./epistemicPrompts.mjs";
import { ENTAILMENT_VERDICT, checkEntailment, verifySpans } from "./epistemicEntailment.mjs";

function fakeClient(json, { throws = null } = {}) {
  return {
    calls: [],
    async completeRole(args) {
      this.calls.push(args);
      if (throws) throw throws;
      return { json, content: JSON.stringify(json), attempts: 1 };
    }
  };
}

const PASSAGES = [
  { id: "p1", text: "The energy levels of the damped oscillator scale as E_n proportional to n^(3/2)." },
  { id: "p2", text: "We leave the numerical coefficient to future work." }
];

const CLAIM = "The energy levels scale as n^(3/2).";

test("without a semantic verifier the claim cannot become a source fact", async () => {
  const out = await checkEntailment({ claim: CLAIM, passages: PASSAGES, client: null });
  // §31 fails closed: the source exists, its support is unknown. UNKNOWN is a
  // statement about what was checked, not about the paper.
  assert.equal(out.verdict, ENTAILMENT_VERDICT.UNKNOWN);
  assert.equal(out.canSupportSourceFact, false);
  assert.deepEqual(out.failureCodes, []);
  assert.match(out.reason, /no semantic verifier available/);
  assert.equal(out.passageCount, 2);
});

test("no passages is unread, not silent", async () => {
  const out = await checkEntailment({ claim: CLAIM, passages: [], client: fakeClient({ verdict: "ABSENT" }) });
  // ABSENT would assert the paper says nothing about the claim. Nothing was
  // read, so that assertion has no basis and no F02 is raised.
  assert.equal(out.verdict, ENTAILMENT_VERDICT.UNKNOWN);
  assert.deepEqual(out.failureCodes, []);
  assert.match(out.reason, /unread, not missing/);
  assert.equal(out.passageCount, 0);
});

test("supported requires a span that is actually in the passages", async () => {
  const client = fakeClient({
    verdict: "SUPPORTED",
    supportingSpans: ["E_n proportional to n^(3/2)"],
    reason: "the passage states the scaling directly"
  });
  const out = await checkEntailment({ claim: CLAIM, passages: PASSAGES, client });
  assert.equal(out.verdict, ENTAILMENT_VERDICT.SUPPORTED);
  assert.equal(out.canSupportSourceFact, true);
  assert.deepEqual(out.supportingSpans, ["E_n proportional to n^(3/2)"]);
  assert.deepEqual(out.fabricatedSpans, []);
  assert.equal(out.severity, SEVERITY.NONE);
});

test("a quote that is in no passage is a verdict about another paper", async () => {
  const client = fakeClient({
    verdict: "SUPPORTED",
    supportingSpans: ["the coefficient was measured to be 1.37"],
    reason: "stated in the results section"
  });
  const out = await checkEntailment({ claim: CLAIM, passages: PASSAGES, client });
  // The verdict is discarded, not trusted: its only evidence was written
  // rather than found.
  assert.equal(out.verdict, ENTAILMENT_VERDICT.UNKNOWN);
  assert.equal(out.canSupportSourceFact, false);
  assert.deepEqual(out.fabricatedSpans, ["the coefficient was measured to be 1.37"]);
  assert.match(out.reason, /none of its quoted spans appear/);

  // Support asserted with no quote at all is equally unusable.
  const noSpans = await checkEntailment({
    claim: CLAIM,
    passages: PASSAGES,
    client: fakeClient({ verdict: "SUPPORTED", supportingSpans: [] })
  });
  assert.equal(noSpans.verdict, ENTAILMENT_VERDICT.UNKNOWN);
  assert.match(noSpans.reason, /without quoting the passage/);
});
test("EPI-005: a density in the source is not promoted to a wavefunction claim", async () => {
  const source = [
    { id: "p1", text: "We report the ground-state probability density of the oscillator." },
    { id: "p2", text: "The density is normalised over the spatial axis." }
  ];
  const claim = "The ground-state wavefunction is the density we computed.";
  const out = await checkEntailment({
    claim,
    passages: source,
    client: fakeClient({
      verdict: "CONTRADICTED",
      supportingSpans: ["We report the ground-state probability density of the oscillator."],
      reason: "the paper shows a density; it does not assert a wavefunction"
    })
  });
  assert.equal(out.canSupportSourceFact, false);
  assert.equal(out.verdict, ENTAILMENT_VERDICT.CONTRADICTED);
  assert.deepEqual(out.failureCodes, ["F02"]);
});

test("EPI-015: KV heads in the source do not entail Hessian blocks", async () => {
  const source = [
    { id: "p1", text: "The model uses separate key and value head projections per layer." },
    { id: "p2", text: "No second-order Hessian structure is defined anywhere." }
  ];
  const claim = "The KV head projections determine the Hessian blocks of the loss.";
  const out = await checkEntailment({
    claim,
    passages: source,
    client: fakeClient({
      verdict: "ABSENT",
      supportingSpans: [],
      reason: "the source discusses KV projections and says nothing about Hessian blocks"
    })
  });
  assert.equal(out.canSupportSourceFact, false);
  assert.equal(out.failureCodes.length > 0, true);
});

test("a silent or contradicting source is F02", async () => {
  const absent = await checkEntailment({
    claim: "The oscillator was built in 1974.",
    passages: PASSAGES,
    client: fakeClient({ verdict: "ABSENT", reason: "the passages never mention a date" })
  });
  // 1+ tests must be exercised before this block can be dropped.
  assert.equal(absent.verdict, ENTAILMENT_VERDICT.ABSENT);
  assert.deepEqual(absent.failureCodes, ["F02"]);
  assert.equal(absent.severity, SEVERITY.HIGH);
  assert.equal(absent.canSupportSourceFact, false);

  const contra = await checkEntailment({
    claim: "The coefficient is 1.37.",
    passages: PASSAGES,
    client: fakeClient({
      verdict: "CONTRADICTED",
      supportingSpans: ["We leave the numerical coefficient to future work."],
      reason: "the paper declines to give a coefficient"
    })
  });
  assert.equal(contra.verdict, ENTAILMENT_VERDICT.CONTRADICTED);
  assert.deepEqual(contra.failureCodes, ["F02"]);
});

test("partial support is not a failure and not a source fact", async () => {
  const out = await checkEntailment({
    claim: "The levels scale as n^(3/2) with coefficient 1.37.",
    passages: PASSAGES,
    client: fakeClient({
      verdict: "PARTIAL",
      supportingSpans: ["E_n proportional to n^(3/2)"],
      unsupportedSubclaims: ["coefficient 1.37"],
      reason: "the exponent is stated, the coefficient is not"
    })
  });
  assert.equal(out.verdict, ENTAILMENT_VERDICT.PARTIAL);
  assert.deepEqual(out.failureCodes, []);
  assert.equal(out.canSupportSourceFact, false);
  assert.deepEqual(out.unsupportedSubclaims, ["coefficient 1.37"]);
});

test("an unusable answer degrades to UNKNOWN rather than to a verdict", async () => {
  for (const json of [{ verdict: "PROBABLY" }, { verdict: null }, { reason: "hm" }, null]) {
    const out = await checkEntailment({ claim: CLAIM, passages: PASSAGES, client: fakeClient(json) });
    assert.equal(out.verdict, ENTAILMENT_VERDICT.UNKNOWN);
    assert.equal(out.canSupportSourceFact, false);
  }
  const threw = await checkEntailment({
    claim: CLAIM,
    passages: PASSAGES,
    client: fakeClient(null, { throws: new Error("model timeout") })
  });
  assert.equal(threw.verdict, ENTAILMENT_VERDICT.UNKNOWN);
  assert.match(threw.reason, /entailment check failed: model timeout/);

  const noClaim = await checkEntailment({ claim: "  ", passages: PASSAGES, client: fakeClient({ verdict: "SUPPORTED" }) });
  assert.equal(noClaim.verdict, ENTAILMENT_VERDICT.UNKNOWN);
});

test("span matching tolerates formatting, not invention", () => {
  const passages = [{ id: "p1", text: "The tests pass, and the accuracy is 91%." }];
  const { supporting, fabricated } = verifySpans(
    ["the tests pass", "  the  accuracy is 91% ", "the accuracy is 97%", ""],
    passages
  );
  assert.deepEqual(supporting, ["the tests pass", "the  accuracy is 91%"]);
  assert.deepEqual(fabricated, ["the accuracy is 97%"]);
  assert.deepEqual(verifySpans(null, passages).supporting, []);
});

test("passages travel as text, and the claim as one claim", async () => {
  const client = fakeClient({ verdict: "ABSENT" });
  await checkEntailment({
    claim: { id: "claim_1", text: CLAIM },
    source: { id: "src_001", title: "Damped oscillators", doi: "10.5555/x", arxivId: "0710.2724" },
    passages: ["a plain string passage", { text: "an object passage" }, { text: "   " }],
    client
  });
  const [call] = client.calls;
  assert.equal(call.roleName, "epistemic_entailment");
  assert.equal(call.json, true);
  assert.equal(call.systemPrompt, ENTAILMENT_PROMPT);
  const payload = JSON.parse(call.userPrompt);
  assert.equal(payload.claim, CLAIM);
  // Empty passages are dropped rather than sent as evidence of nothing.
  assert.deepEqual(payload.passages, [
    { id: "p1", text: "a plain string passage" },
    { id: "p2", text: "an object passage" }
  ]);
  assert.equal(payload.source.doi, "10.5555/x");
});

test("the prompt states what must not count as support", () => {
  assert.match(ENTAILMENT_PROMPT, /not evidence for a claim merely because the topic is related/);
  assert.match(ENTAILMENT_PROMPT, /Do not use outside memory/);
  assert.match(ENTAILMENT_PROMPT, /exponent relation from a numeric equality/);
  assert.match(ENTAILMENT_PROMPT, /quoted background from the author's own result/);
  assert.match(ENTAILMENT_PROMPT, /copied verbatim from a passage/);
  assert.match(ENTAILMENT_PROMPT, /Return JSON only/);
});
