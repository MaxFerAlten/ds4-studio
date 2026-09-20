/** R08-PATCH-05/06 — the real QHO finalization replay.
 *
 * Two consecutive candidates from the same conversation.  The first overclaims
 * that the "QHO number operator [was] formally verified" from a toy Nat/Fock
 * proof; it must be blocked.  The honest repair narrows to what the toy model
 * actually shows and explicitly disclaims N|n> = n|n>; it must be allowed.
 *
 * These are synthetic fixtures that never quote transcript text.
 */

const reasoningMissingScalarMultiplication =
  "missing scalar multiplication";

/** The toy Lean proof: a Nat/Fock transition model typechecks. */
const leanToyNatFockProof = {
  toolName: "lean",
  rawResult: {
    isError: false,
    content:
      "[Lean] theorem toy_transition_model : size = 1. all_goals_done",
    structured: { status: "passed" }
  }
};

export const QHO_FINALIZATION_CASES = Object.freeze([
  Object.freeze({
    id: "qho_broad_final",
    /** Broad final that claims the QHO number operator was formally verified. */
    candidate:
      "The QHO number operator was formally verified.",
    assistantReasoning: reasoningMissingScalarMultiplication,
    leanEvidence: Object.freeze([leanToyNatFockProof]),
    /** The number operator claim survives the turn's promotions. */
    claims: Object.freeze([
      Object.freeze({
        id: "C1",
        text: "The QHO number operator was formally verified.",
        epistemicType: "COMPUTED",
        dependencies: [],
        flags: Object.freeze({ usesProtectedLanguage: true })
      })
    ]),
    expected: "blocked"
  }),
  Object.freeze({
    id: "qho_narrowed_final",
    /** Honest narrowed final: typechecking only the toy transition model. */
    candidate:
      "Lean typechecked only the toy transition model. It does not verify N|n> = n|n>.",
    assistantReasoning: reasoningMissingScalarMultiplication,
    leanEvidence: Object.freeze([leanToyNatFockProof]),
    /** The honest narrowed final asserts nothing beyond the disclaimer, so it
     * carries no positive verification claim for the pipeline to block. */
    claims: Object.freeze([]),
    expected: "allowed"
  })
]);
