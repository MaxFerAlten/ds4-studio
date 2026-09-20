/**
 * Deterministic transformer invariants (report.fix.Quantium.001 §55-§64).
 *
 * These are the statements about attention and embeddings that are wrong on
 * the mathematics alone, independently of any paper: a row-stochastic matrix
 * is not doubly stochastic, a doubly stochastic matrix is not unitary, and a
 * vocabulary index is not a dimension. Nothing here decides whether a
 * transformer paper is right — it decides whether a sentence contradicts
 * arithmetic that holds for every such model.
 *
 * Keep this narrow. It is a list of refuted inferences, not an AI ontology.
 */

export const TRANSFORMER_PROFILE_VERSION = 1;

export const TRANSFORMER_INVARIANTS = Object.freeze([
  Object.freeze({
    id: "T1",
    // Row-wise softmax normalises rows. Columns are whatever the scores were.
    pattern: /\bsoftmax\b[^.]{0,120}\bdoubly[-\s]stochastic\b|\bdoubly[-\s]stochastic\b[^.]{0,120}\bsoftmax\b/iu,
    failureCodes: Object.freeze(["F21"]),
    reason:
      "row-wise softmax makes every row sum to 1; it says nothing about the columns, so it does not make the attention matrix doubly stochastic"
  }),
  Object.freeze({
    id: "T2",
    pattern:
      /\bdoubly[-\s]stochastic\b[^.]{0,140}\b(?:unitary|orthogonal|norm[-\s]preserving|preserves? the\s+(?:l2\s+)?norm|isometr\w+)\b/iu,
    failureCodes: Object.freeze(["F21"]),
    reason:
      "the all-1/2 matrix is doubly stochastic and AᵀA ≠ I, so doubly stochastic does not imply unitary or norm-preserving"
  }),
  Object.freeze({
    id: "T3",
    pattern:
      /\b(?:self[-\s])?attention\b[^.]{0,80}\bis\b[^.]{0,40}\b(?:unitary|an? unitary (?:operator|map|matrix))\b|\bunitary\b[^.]{0,40}\bself[-\s]attention\b/iu,
    failureCodes: Object.freeze(["F21"]),
    reason:
      "standard self-attention is a row-stochastic mixing followed by a value projection; it is not unitary and no verifier in this build establishes that it is"
  }),
  Object.freeze({
    id: "T4",
    pattern:
      /\b(?:embedding|semantic|hidden)\s+(?:space|dimension|dim)\b[^.]{0,100}\b(?:vocabular\w+|vocab)\b|\b(?:vocabular\w+|vocab)\s+size\b[^.]{0,60}\b(?:equals?|is|=)\b[^.]{0,40}\b(?:d_?model|embedding dimension)\b/iu,
    failureCodes: Object.freeze(["F32", "F15"]),
    reason:
      "V (vocabulary size) and d_model (embedding dimension) are independent; an embedding space does not take its dimension from the token count"
  }),
  Object.freeze({
    id: "T5",
    pattern:
      /\btoken embeddings?\b[^.]{0,100}\b(?:orthonormal|orthogonal|form an? (?:orthonormal|orthogonal) basis)\b/iu,
    failureCodes: Object.freeze(["F21"]),
    reason:
      "token embeddings are learned vectors in R^d_model and are not orthonormal by default; only an explicitly constructed abstract basis has that property"
  })
]);
