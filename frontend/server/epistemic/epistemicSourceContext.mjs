/** Claim-specific source bindings used by citation entailment verification. */
export class EpistemicSourceContext {
  constructor() {
    this.bindings = new Map();
  }

  bind(claimId, { evidenceId, source = null, passages = [] } = {}) {
    const id = String(claimId ?? "").trim();
    const evidence = String(evidenceId ?? "").trim();
    if (!id) throw new TypeError("EpistemicSourceContext.bind requires a claim id");
    if (!evidence) throw new TypeError("EpistemicSourceContext.bind requires an evidence id");
    const normalizedPassages = (Array.isArray(passages) ? passages : [])
      .filter((passage) => passage !== null && passage !== undefined)
      .map((passage) =>
        typeof passage === "object" && passage !== null ? { ...passage } : String(passage)
      );
    const binding = { evidenceId: evidence, source: source ? { ...source } : null, passages: normalizedPassages };
    this.bindings.set(id, binding);
    return this.forClaim(id);
  }

  forClaim(claimId) {
    const binding = this.bindings.get(String(claimId ?? ""));
    if (!binding) return null;
    return {
      evidenceId: binding.evidenceId,
      source: binding.source ? { ...binding.source } : null,
      passages: binding.passages.map((passage) =>
        typeof passage === "object" && passage !== null ? { ...passage } : passage
      )
    };
  }

  get size() {
    return this.bindings.size;
  }
}
