/**
 * DS4 Quantum Fix — how a source presents a proposition.
 *
 * report.fix.Quantium.001 §50-§54. Identity and entailment are not enough: a
 * paper can be correctly identified, correctly quoted, and still be saying
 * "we assume", "we model" or "we interpret". Publishing that as a fact about
 * real systems is F37, and no amount of citation checking catches it, because
 * the citation is genuine.
 *
 * The classifier reads the passage the claim was bound to. It decides how the
 * source frames the proposition, never whether the proposition is true.
 */

export const SOURCE_ROLE = Object.freeze({
  ASSUMPTION: "ASSUMPTION",
  HYPOTHESIS: "HYPOTHESIS",
  MODEL: "MODEL",
  METHOD: "METHOD",
  RESULT: "RESULT",
  INTERPRETATION: "INTERPRETATION",
  LIMITATION: "LIMITATION",
  BACKGROUND_FACT: "BACKGROUND_FACT",
  UNKNOWN: "UNKNOWN"
});

const VALID_ROLES = new Set(Object.values(SOURCE_ROLE));

/** Roles that cannot become a claim about the world on the source's authority. */
export const NON_FACTUAL_ROLES = Object.freeze(
  new Set([SOURCE_ROLE.ASSUMPTION, SOURCE_ROLE.HYPOTHESIS, SOURCE_ROLE.MODEL, SOURCE_ROLE.INTERPRETATION])
);

export const SOURCE_ROLE_PROMPT = `Classify how the source itself presents the proposition.
Return JSON only as {"role":"ASSUMPTION|HYPOTHESIS|MODEL|METHOD|RESULT|INTERPRETATION|LIMITATION|BACKGROUND_FACT|UNKNOWN","evidenceSpan":"...","reason":"..."}.
Do not decide whether the proposition is true.
Do not upgrade "we model" to RESULT. Do not upgrade "we assume" to FACT.`;

/** Framings that are explicit enough to read off the sentence. */
const ROLE_MARKERS = Object.freeze([
  [SOURCE_ROLE.ASSUMPTION, /\b(?:we assume|assuming that|under the assumption|we posit|supponiamo|assumiamo|per ipotesi)\b/iu],
  [SOURCE_ROLE.HYPOTHESIS, /\b(?:we hypothesi[sz]e|our hypothesis|we conjecture|ipotizziamo|congetturiamo)\b/iu],
  [SOURCE_ROLE.MODEL, /\b(?:we model|we represent|we treat .{0,30} as|our model|modelliamo|rappresentiamo)\b/iu],
  [SOURCE_ROLE.INTERPRETATION, /\b(?:we interpret|can be (?:seen|viewed|understood) as|this suggests|interpretiamo|può essere (?:vista|interpretata) come)\b/iu],
  [SOURCE_ROLE.LIMITATION, /\b(?:we do not|a limitation|we leave .{0,20} to future work|is beyond the scope|limite di questo lavoro)\b/iu],
  [SOURCE_ROLE.METHOD, /\b(?:we train|we implement|we evaluate|our method|the procedure is|addestriamo|implementiamo)\b/iu],
  [SOURCE_ROLE.RESULT, /\b(?:we (?:find|show|prove|observe|measure)|our (?:results?|experiments?) show|risultati mostrano|abbiamo misurato)\b/iu]
]);

/** The deterministic reading of a passage, used alone or as the fallback. */
export function lexicalSourceRole(passage) {
  const text = String(passage ?? "");
  if (!text.trim()) return { role: SOURCE_ROLE.UNKNOWN, evidenceSpan: "", reason: "no passage bound to the claim" };
  for (const [role, pattern] of ROLE_MARKERS) {
    const match = pattern.exec(text);
    if (match) {
      return { role, evidenceSpan: match[0], reason: `the source frames this with "${match[0]}"` };
    }
  }
  return {
    role: SOURCE_ROLE.UNKNOWN,
    evidenceSpan: "",
    reason: "the passage carries no explicit framing; the role was not established"
  };
}

/**
 * Classify how the source presents the proposition behind a claim.
 *
 * @param {{claim: object, passage: string, client?: object|null, signal?: AbortSignal}} input
 * @returns {Promise<{role: string, evidenceSpan: string, reason: string, source: string}>}
 */
export async function classifySourceClaimRole({ claim, passage, client = null, signal } = {}) {
  const text = String(passage ?? "");
  const lexical = lexicalSourceRole(text);
  if (!client || typeof client.completeRole !== "function" || !text.trim()) {
    return { ...lexical, source: "lexical" };
  }

  try {
    const response = await client.completeRole({
      roleName: "epistemic_source_role",
      systemPrompt: SOURCE_ROLE_PROMPT,
      userPrompt: JSON.stringify({ claim: String(claim?.text ?? ""), passage: text }),
      json: true,
      signal
    });
    const role = response?.json?.role;
    if (!VALID_ROLES.has(role)) return { ...lexical, source: "lexical" };
    return {
      role,
      evidenceSpan: String(response.json.evidenceSpan ?? lexical.evidenceSpan),
      reason: String(response.json.reason ?? lexical.reason),
      source: "model"
    };
  } catch {
    // An unavailable classifier leaves the deterministic reading standing; it
    // never upgrades the role.
    return { ...lexical, source: "lexical" };
  }
}

/** Wording that asserts the proposition of the world rather than of the paper. */
const ASSERTED_AS_FACT =
  /\b(?:is|are|has|have|does|do|sono|è|hanno)\b/iu;
const ATTRIBUTED =
  /\b(?:the paper|the authors|they|il paper|gli autori|according to|secondo|assumes?|assume|models?|modella|hypothesi[sz]es?|ipotizza|proposes?|propone|suggests?|suggerisce|claims?)\b/iu;

/**
 * Whether a claim states as fact what the source only assumed (§52).
 *
 * @param {{claimText: string, role: string}} input
 * @returns {{promoted: boolean, failureCodes: string[], reason: string|null}}
 */
export function sourceRolePromotion({ claimText, role } = {}) {
  if (!NON_FACTUAL_ROLES.has(role)) return { promoted: false, failureCodes: [], reason: null };
  const text = String(claimText ?? "");
  if (ATTRIBUTED.test(text)) {
    // The wording keeps the proposition with the source, which is the repair.
    return { promoted: false, failureCodes: [], reason: null };
  }
  if (!ASSERTED_AS_FACT.test(text)) return { promoted: false, failureCodes: [], reason: null };
  return {
    promoted: true,
    failureCodes: ["F37"],
    reason: `the source presents this as ${role}; the answer states it as a fact about the world`
  };
}
