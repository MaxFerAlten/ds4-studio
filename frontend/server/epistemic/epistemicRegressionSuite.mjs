/**
 * §57 — stable routing from every EPI regression to its owning test module, and
 * REM-009 — the exact named test that exercises that scenario.
 *
 * `module exists` never proved `scenario exists`: the registry had routed several
 * EPI ids to modules that contained no test for that scenario. REM-009 closes that
 * by (a) recording the canonical `semanticScenario` for every id, (b) naming the
 * exact `testName` that exercises it, and (c) adding the concrete scenarios that
 * were only promised. The suite verifies each `testName` is really present in the
 * mapped module, so a drift in either direction fails the build.
 */
export const EPI_REGRESSION_SUITE = Object.freeze([
  // #1..20 — the first arithmetic / entailment / gate regressions.
  ["EPI-001", "epistemicMathVerifier.test.mjs", "a passing check buys COMPUTED, and a symbolic one buys DERIVED", "a derived oscillator claim rejected or downgraded"],
  ["EPI-002", "epistemicMathVerifier.test.mjs", "EPI-002: a wrong ODE solution is refuted by Sage validation", "wrong ODE solution rejected by Sage validation"],
  ["EPI-003", "epistemicMathVerifier.test.mjs", "EPI-003: sqrt(124000000) = 11 is refuted, not accepted", "wrong square-root arithmetic rejected"],
  ["EPI-004", "epistemicMathVerifier.test.mjs", "EPI-004: wrong scaling arithmetic is refuted, not accepted", "wrong scaling arithmetic rejected"],
  ["EPI-005", "epistemicEntailment.test.mjs", "EPI-005: a density in the source is not promoted to a wavefunction claim", "density is not promoted to wavefunction"],
  ["EPI-006", "epistemicMathVerifier.test.mjs", "EPI-006: an invalid block shape presented as an equality is refuted", "invalid block shape rejected"],
  ["EPI-007", "epistemicMathVerifier.test.mjs", "EPI-007: a symmetric/antisymmetric mismatch is a wrong equality and is refuted", "symmetric/antisymmetric mismatch rejected"],
  ["EPI-008", "epistemicMathVerifier.test.mjs", "EPI-008: a negative derivative that contradicts conservation is refuted", "negative derivative contradicts conservation"],
  ["EPI-009", "epistemicFinalizationGate.test.mjs", "EPI-009: a fabricated internal analysis with no producing run is blocked", "fabricated internal analysis blocked"],
  ["EPI-010", "epistemicExecutionVerifier.test.mjs", "EPI-010: complete and working with no execution trace is blocked", "unexecuted code cannot be working"],
  ["EPI-011", "epistemicCitationIdentity.test.mjs", "identifiers are reduced to their canonical form or rejected", "citation identity mismatch rejected"],
  ["EPI-012", "epistemicEntailment.test.mjs", "without a semantic verifier the claim cannot become a source fact", "real source without entailment rejected"],
  ["EPI-013", "epistemicRepairPolicy.test.mjs", "strict repair guidance names verifier debt without inventing replacements", "recursive repair hallucination blocked"],
  ["EPI-014", "epistemicPromotionGate.test.mjs", "a confidence score cannot authorise anything", "estimate cannot become official"],
  ["EPI-015", "epistemicEntailment.test.mjs", "EPI-015: KV heads in the source do not entail Hessian blocks", "KV heads do not entail Hessian blocks"],
  ["EPI-016", "epistemicChallengeExtractor.test.mjs", "conceding to a critique without checking is F25", "user critique is not a verdict"],
  ["EPI-017", "epistemicSelfCritique.test.mjs", "EPI-017: a self-critique asks the verifiers before it changes anything", "self-critique invokes verifiers"],
  ["EPI-018", "epistemicFinalizationGate.test.mjs", "F26: a repair summary may only restate what the repair verified", "repair summary contamination blocked"],
  ["EPI-019", "epistemicLedger.test.mjs", "a dependency failure invalidates the whole subtree", "dependent claims are invalidated"],
  // #20..24 — bridge / authorization / axiom / debt.
  ["EPI-020", "epistemicModelingBridge.test.mjs", "Nat functions without a bridge cannot represent QHO operators", "Nat functions without a bridge cannot represent QHO operators"],
  ["EPI-021", "epistemicModelingBridge.test.mjs", "model prose alone cannot mark a bridge VERIFIED", "model prose alone cannot mark a bridge VERIFIED"],
  ["EPI-022", "epistemicVerificationClaimAuthorization.test.mjs", "AUTHOR-000: ASSERTION_LEVEL and protected vocabulary are frozen and non-empty", "claim authorization matrix names every required evidence class"],
  ["EPI-023", "epistemicLeanAxiomAudit.test.mjs", "an axiom is postulated, never proved", "an axiom is postulated, never proved"],
  ["EPI-024", "epistemicChallengeDebt.test.mjs", "open challenge is counted as material debt", "open challenge is counted as material debt"],
  // #25..40 — F27..F40 failure-mode regressions.
  ["EPI-025", "epistemicVerifierScope.test.mjs", "Nat toy substituted for Hilbert operator scope is MISMATCH", "F27 scope mismatch: Nat toy substituted for Hilbert operator scope is MISMATCH"],
  ["EPI-026", "epistemicVerifierCertificate.test.mjs", "VerifierCertificate records the exact checked scope", "F28 only a real checked statement earns a certificate recording the exact scope"],
  ["EPI-027", "epistemicSubcheckAggregator.test.mjs", "mandatory aggregation table never hides an inconclusive or failed check", "F29 mandatory aggregation never hides an inconclusive or failed check"],
  ["EPI-028", "epistemicVerificationPlan.test.mjs", "no planned mandatory checks is UNKNOWN rather than vacuous PASS", "F30 no planned mandatory checks is UNKNOWN rather than a vacuous PASS"],
  ["EPI-029", "epistemicAssumptions.test.mjs", "one UNKNOWN assumption limits the claim to conditional wording", "F31 one UNKNOWN assumption limits the claim to conditional wording"],
  ["EPI-030", "epistemicDomainInvariants.test.mjs", "a QHO claim on a toy index model is a domain model mismatch", "F32 a QHO claim on a toy index model is a domain model mismatch"],
  ["EPI-031", "epistemicSubcheckAggregator.test.mjs", "optional error reports PARTIAL without hiding mandatory success", "F33 aggregation reports PARTIAL rather than hiding failure and overclaiming"],
  ["EPI-032", "epistemicTurn.test.mjs", "challenges and repair state reach the gate", "F34 a self challenge persists through the turn into the gate"],
  ["EPI-033", "epistemicLeanAxiomAudit.test.mjs", "a theorem that proves its own statement is clean", "F35 a theorem that proves its own statement is clean, an axiom never is a proof"],
  ["EPI-034", "epistemicSessionLedger.test.mjs", "UNKNOWN and PARTIAL are audit state, not accepted session knowledge", "F36 the session round-trips as plain data and carries corrective state"],
  ["EPI-035", "epistemicSourceRole.test.mjs", "the framing the source used is read off the passage", "F37 the framing the source used is read off the passage, not upgraded"],
  ["EPI-036", "epistemicModelCapabilities.test.mjs", "EPI-043: the number-operator claim cannot be certified by the toy model", "F38 the number-operator claim cannot be certified by the toy model"],
  ["EPI-037", "epistemicChallengeDebt.test.mjs", "resolution cannot target a nonexistent challenge", "F39 open challenge debt blocks promotion and cannot be resolved to a nonexistent id"],
  ["EPI-038", "epistemicLeanAxiomAudit.test.mjs", "a premise stays visible in the audit", "F40 a premise stays visible in the audit; proof dependencies are not silently dropped"],
  ["EPI-039", "epistemicRepairPolicy.test.mjs", "R06-TRIG-001: F27..F40 verification debt classes all open a repair", "every F27..F40 failure class opens a repair"],
  ["EPI-040", "epistemicRepairPolicy.test.mjs", "R06-PATCH-06 / EPI-057: the same claim:code thrice forces a cannot-paraphrase outcome", "the same claim:code recurring forces narrow or abandon, never endless paraphrase"],
  // #41..53 — corrective-history regressions.
  ["EPI-041", "epistemicTurn.test.mjs", "EPI-041: a self challenge in the candidate survives into the promotion gate", "a self challenge survives into the promotion gate"],
  ["EPI-042", "epistemicTurn.test.mjs", "EPI-042: an axiom that typechecks cannot be reported as a proof", "an axiom that typechecks is not a proof"],
  ["EPI-043", "epistemicModelCapabilities.test.mjs", "EPI-043: the number-operator claim cannot be certified by the toy model", "a toy model without scalar multiplication certifies nothing"],
  ["EPI-044", "epistemicLeanAxiomAudit.test.mjs", "EPI-044: a proof about naturals does not cover a claim about QHO energy", "Nat positivity is not QHO energy positivity"],
  ["EPI-045", "epistemicDomainInvariants.test.mjs", "EPI-045: row softmax does not make attention doubly stochastic", "row softmax is not doubly stochastic"],
  ["EPI-046", "epistemicDomainInvariants.test.mjs", "EPI-046: doubly stochastic does not imply unitary or norm preserving", "doubly stochastic is not unitary"],
  ["EPI-047", "epistemicDomainInvariants.test.mjs", "EPI-047: the vocabulary does not set the embedding dimension", "vocabulary size is not the embedding dimension"],
  ["EPI-048", "epistemicTurn.test.mjs", "EPI-048: rewording a challenged claim does not clear its debt", "a paraphrase cannot escape challenge debt"],
  ["EPI-049", "epistemicSourceRole.test.mjs", "EPI-049: an assumption stated as fact is F37", "a source assumption stays an assumption"],
  ["EPI-050", "epistemicPromotionGate.test.mjs", "EPI-050: an open material challenge blocks VERIFIED even when every verifier passes", "open material debt blocks VERIFIED"],
  ["EPI-051", "epistemicPromotionGate.test.mjs", "EPI-051: new evidence can close challenge debt and permit promotion", "new evidence can close challenge debt"],
  ["EPI-052", "epistemicClaimEquivalence.test.mjs", "EPI-052: narrower claim records lineage without copying open debt", "narrowing is a valid repair"],
  ["EPI-053", "epistemicTurn.test.mjs", "EPI-053: a self challenge that appears only in observable reasoning survives finalization", "reasoning-only self challenge survives finalization, honest narrowing is not punished"],
  // #54..57 — cross-turn, serialization and repair debt completion.
  ["EPI-054", "epistemicOrchestration.e2e.test.mjs", "EPI-054 (R05): a cross-turn paraphrase cannot escape a rejected claim", "a cross-turn paraphrase cannot escape a rejected claim's debt"],
  ["EPI-055", "epistemicOrchestration.e2e.test.mjs", "EPI-055 (R05): a cross-turn narrowing can proceed after fresh scope evaluation", "a cross-turn narrowing can proceed after fresh scope evaluation"],
  ["EPI-056", "epistemicSessionLedger.test.mjs", "R05-PATCH-07/11 (EPI-056): stageClaims persists bounded events and round-trips through JSON", "session corrective-history serialization round-trips through JSON"],
  ["EPI-057", "epistemicRepairPolicy.test.mjs", "R06-PATCH-06 / EPI-057: the same claim:code thrice forces a cannot-paraphrase outcome", "the same claim:code thrice forces repair cannot-paraphrase rather than restating"],
  // #58..68 — REM-009.5 concrete scenarios added under new ids (never reusing an id).
  ["EPI-058", "epistemicDomainInvariants.test.mjs", "the CCR has no exact finite-dimensional realisation", "finite-truncation CCR has no exact finite-dimensional realisation"],
  ["EPI-059", "epistemicDomainInvariants.test.mjs", "standard attention is not unitary", "unitary transformer overclaim rejected"],
  ["EPI-060", "epistemicModelingBridge.test.mjs", "EPI-060: circular CAS validation cannot verify a modeling bridge", "circular CAS validation cannot verify a bridge"],
  ["EPI-061", "epistemicModelingBridge.test.mjs", "EPI-061: Lean success without a verified modeling bridge certifies nothing", "Lean success + unverified modeling bridge certifies nothing"],
  ["EPI-062", "epistemicSubcheckAggregator.test.mjs", "EPI-062: an UNKNOWN subcheck qualifies the output, never a clean pass", "UNKNOWN subcheck qualified output"],
  ["EPI-063", "epistemicExecutionVerifier.test.mjs", "a passing suite needs a test command that actually passed", "tool binary exists is not verification"],
  ["EPI-064", "epistemicLeanAxiomAudit.test.mjs", "EPI-044: a proof about naturals does not cover a claim about QHO energy", "correct narrow Lean report stays narrow"],
  ["EPI-065", "epistemicDomainInvariants.test.mjs", "EPI-045: row softmax does not make attention doubly stochastic", "softmax/Born equivalence reclassified as domain overclaim"],
  ["EPI-066", "epistemicCitationIdentity.test.mjs", "the same mismatch rendered as a verified citation is S5", "citation identity pass + entailment fail"],
  ["EPI-067", "epistemicSubcheckAggregator.test.mjs", "optional error reports PARTIAL without hiding mandatory success", "partial Sage global pass reported as PARTIAL not clean"],
  ["EPI-068", "epistemicVerificationClaimAuthorization.test.mjs", "AUTHOR-001A (REM-004.7): VERIFIED + protected wording + no certificate blocks with F18", "printed assertion presented as verification is blocked"],
  // #69..76 — remediation.Quantiom.002 §28: the QHO->LLM adversarial closure.
  ["EPI-069", "epistemicModelCapabilities.test.mjs", "EPI-069 (Q2-006 §9): a constructor-injectivity toy cannot certify a QHO spectrum claim", "constructor injectivity presented as a QHO spectrum proof"],
  ["EPI-070", "epistemicTurn.test.mjs", "Q2-008 / EPI-070 (§11, §49): a timed-out Lean run leaves open debt, not silence", "a failed Mathlib theorem presented as verified"],
  ["EPI-071", "epistemicTurn.test.mjs", "Q2-008 / EPI-071 (§11): a sorry proof opens FORMAL_PROOF_INCOMPLETE debt", "a sorry proof presented as a unitary Transformer theorem"],
  ["EPI-072", "epistemicModelingBridge.test.mjs", "EPI-072 (Q2-009 §12, §50): an abstract C^V basis claim about real embeddings needs a bridge", "an abstract token basis conflated with real LLM embeddings"],
  ["EPI-073", "epistemicAnalogyAuthorization.test.mjs", "EPI-073 (§51): attention collapsing a quantum semantic superposition is blocked without a bridge", "a quantum measurement analogy promoted to an LLM mechanism"],
  ["EPI-074", "epistemicSourceIdentityAuthority.test.mjs", "EPI-074 (§14): a secondary mention published as a certified arXiv paper is blocked", "a secondary mention presented as certified paper identity"],
  ["EPI-075", "qhoLlmAdversarialRegression.test.mjs", "EPI-075 (§16): the self-detected CCR failure is not erased by the later toy proof", "a self-detected CCR model failure forgotten in the final synthesis"],
  ["EPI-076", "epistemicSynthesisAuthorization.test.mjs", "EPI-076 (§17): partial formal results aggregated as full formal verification are blocked", "partial formal results aggregated as full formal verification"]
].map(([id, module, testName, semanticScenario]) =>
  Object.freeze({ id, module, testName, semanticScenario })
));
