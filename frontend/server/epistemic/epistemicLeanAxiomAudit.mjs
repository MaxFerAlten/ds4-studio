/**
 * DS4 Quantum Fix — Lean assumption/proof audit.
 *
 * report.fix.Quantium.001 §30. `lean_check status=checked` means the source
 * elaborated, not that the proposition was proved: a file declaring
 * `axiom commutation : P` typechecks without proving P, and a conditional
 * theorem proves `A → B` rather than B. This module reads the source that was
 * submitted and says which of the three it was.
 *
 * The scan is deliberately conservative and lexical. It does not parse Lean —
 * it recognises the declaration keywords that introduce something unproved, and
 * anything it cannot classify becomes UNKNOWN, which is treated as
 * not-clean by every caller (§118 fail safe).
 */

export const LEAN_ASSUMPTION_ORIGIN = Object.freeze({
  THEOREM_PARAMETER: "THEOREM_PARAMETER",
  LOCAL_AXIOM: "LOCAL_AXIOM",
  IMPORTED_AXIOM: "IMPORTED_AXIOM",
  DEFINITION: "DEFINITION",
  UNKNOWN: "UNKNOWN"
});

export const PROOF_DEPENDENCY_STATUS = Object.freeze({
  CLEAN: "CLEAN",
  CONDITIONAL: "CONDITIONAL",
  LOCAL_AXIOM_DEPENDENCY: "LOCAL_AXIOM_DEPENDENCY",
  UNKNOWN: "UNKNOWN"
});

/** Wording that asserts a proof assistant established the proposition. */
export const LEAN_PROOF_LANGUAGE =
  /\b(?:lean\s+(?:ha\s+|has\s+)?(?:proved?|proves|verified|certified|dimostrat\w*|verificat\w*)|formally\s+(?:proved?|verified)|machine[-\s]?(?:checked|certified)|formalmente\s+(?:provat|verificat|dimostrat)\w*|(?:provat|verificat|dimostrat)\w*\s+formalmente)/iu;

const AXIOM_DECLARATION = /^\s*(?:@\[[^\]]*\]\s*)?(?:private\s+|protected\s+|noncomputable\s+)?(axiom|constant|opaque)\s+([A-Za-z_À-ɏ][^\s:{(\[]*)/;
const THEOREM_DECLARATION = /^\s*(?:@\[[^\]]*\]\s*)?(?:private\s+|protected\s+|noncomputable\s+)?(theorem|lemma|example)\s+([A-Za-z_À-ɏ][^\s:{(\[]*)?/;
const VARIABLE_DECLARATION = /^\s*variable[s]?\s+(.+)$/;
const SORRY = /(?<![A-Za-z_])(?:sorry|admit|sorryAx)(?![A-Za-z_])/;

/** A binder whose type reads as a proposition rather than as data. */
const PROP_BINDER = /[({\[]\s*[^:)}\]]*:\s*([^)}\]]+)[)}\]]/g;
const PROP_TYPE =
  /(?:^|[\s(])(?:Prop\b|[∀∃]|→|->|=|≠|<|>|≤|≥|∈|∧|∨|¬)/u;

function stripComments(source) {
  return String(source ?? "")
    .replace(/\/-[\s\S]*?-\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

/**
 * The binders of a declaration header: everything before its result type.
 *
 * The result colon is the first one outside every bracket — the colons inside
 * `(h : 0 < n)` belong to the binder, and cutting at those would hide exactly
 * the premises this audit exists to surface.
 */
function headerOf(line) {
  let depth = 0;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (char === ":" && depth === 0 && line[i + 1] !== "=") return line.slice(0, i);
  }
  return line;
}

function propositionalBinders(line) {
  const binders = [];
  for (const match of headerOf(line).matchAll(PROP_BINDER)) {
    const type = match[1].trim();
    if (PROP_TYPE.test(` ${type}`)) binders.push(type);
  }
  return binders;
}

/**
 * Audit the Lean source that was submitted for checking.
 *
 * @param {string} source - exactly what was passed to lean_check(code=...).
 * @returns {{status: string, localAxioms: object[], theoremPremises: object[], theoremNames: string[], sorries: boolean, details: string[]}}
 */
export function auditLeanSource(source) {
  const text = String(source ?? "");
  if (!text.trim()) {
    return Object.freeze({
      status: PROOF_DEPENDENCY_STATUS.UNKNOWN,
      localAxioms: Object.freeze([]),
      theoremPremises: Object.freeze([]),
      theoremNames: Object.freeze([]),
      sorries: false,
      details: Object.freeze(["no Lean source available to audit"])
    });
  }

  const clean = stripComments(text);
  const localAxioms = [];
  const theoremPremises = [];
  const theoremNames = [];
  const details = [];

  for (const line of clean.split(/\r?\n/)) {
    const axiom = AXIOM_DECLARATION.exec(line);
    if (axiom) {
      localAxioms.push({ name: axiom[2], keyword: axiom[1], origin: LEAN_ASSUMPTION_ORIGIN.LOCAL_AXIOM });
      details.push(`${axiom[1]} ${axiom[2]} is postulated, not proved`);
      continue;
    }

    const variable = VARIABLE_DECLARATION.exec(line);
    if (variable) {
      for (const type of propositionalBinders(`(${variable[1]})`)) {
        theoremPremises.push({ name: null, type, origin: LEAN_ASSUMPTION_ORIGIN.THEOREM_PARAMETER });
        details.push(`section variable assumes ${type}`);
      }
      continue;
    }

    const theorem = THEOREM_DECLARATION.exec(line);
    if (!theorem) continue;
    if (theorem[2]) theoremNames.push(theorem[2]);
    for (const type of propositionalBinders(line)) {
      theoremPremises.push({
        name: theorem[2] ?? null,
        type,
        origin: LEAN_ASSUMPTION_ORIGIN.THEOREM_PARAMETER
      });
      details.push(`${theorem[2] ?? "theorem"} holds only under ${type}`);
    }
  }

  const sorries = SORRY.test(clean);
  if (sorries) details.push("the proof contains sorry/admit and closes nothing");

  let status = PROOF_DEPENDENCY_STATUS.CLEAN;
  if (localAxioms.length > 0 || sorries) {
    status = PROOF_DEPENDENCY_STATUS.LOCAL_AXIOM_DEPENDENCY;
  } else if (theoremPremises.length > 0) {
    status = PROOF_DEPENDENCY_STATUS.CONDITIONAL;
  } else if (theoremNames.length === 0) {
    // Elaborated something, but nothing this scan recognises as a theorem. The
    // honest report is that the dependency question was not answered.
    status = PROOF_DEPENDENCY_STATUS.UNKNOWN;
    details.push("no theorem declaration recognised in the submitted source");
  }

  return Object.freeze({
    status,
    localAxioms: Object.freeze(localAxioms),
    theoremPremises: Object.freeze(theoremPremises),
    theoremNames: Object.freeze(theoremNames),
    sorries,
    details: Object.freeze(details)
  });
}

/**
 * The failure codes a candidate earns by claiming a proof the audit does not
 * support (§35, §36).
 *
 * @param {{status: string}} audit
 * @returns {string[]}
 */
export function proofClaimFailureCodes(audit) {
  switch (audit?.status) {
    case PROOF_DEPENDENCY_STATUS.CLEAN:
      return [];
    case PROOF_DEPENDENCY_STATUS.LOCAL_AXIOM_DEPENDENCY:
      return ["F35", "F40"];
    case PROOF_DEPENDENCY_STATUS.CONDITIONAL:
      return ["F31", "F40"];
    default:
      return ["F40"];
  }
}

/**
 * Words that carry no domain content, so their presence in a claim says
 * nothing about what a formalization covers.
 */
const SCOPE_STOPWORDS = new Set([
  "lean", "proved", "proves", "proof", "verified", "verifies", "formally", "machine", "checked",
  "certified", "theorem", "lemma", "that", "this", "with", "from", "have", "has", "the", "and",
  "for", "all", "any", "every", "some", "was", "were", "been", "into", "over", "under", "which",
  "ha", "dimostrato", "verificato", "formalmente", "che", "con", "per", "una", "uno", "del",
  "della", "sono", "tutti", "tutte", "questo", "questa"
]);

/**
 * §22/§23 — the declaration name and the comments are provenance, not meaning.
 * `theorem spectrum_discrete : Foo.mk n = Foo.mk m -> n = m` proves constructor
 * injectivity whatever it is called, and a docstring asserting more asserts
 * nothing. Both are removed before the source is compared with the claim, so a
 * well-chosen name can never launder a weaker theorem into a stronger scope.
 */
const DECLARATION_NAME =
  /(?<=^|\n)(\s*(?:@\[[^\]]*\]\s*)?(?:private\s+|protected\s+|noncomputable\s+|partial\s+)*(?:theorem|lemma|example|def|abbrev|instance|structure|inductive|class)\s+)[A-Za-z_\u00C0-\u024F][A-Za-z0-9_.'\u00C0-\u024F]*/gu;

export function stripFormalProvenance(source) {
  return stripComments(source).replace(DECLARATION_NAME, "$1");
}

function scopeTerms(text) {
  return [
    ...new Set(
      String(text ?? "")
        .toLowerCase()
        .split(/[^\p{L}\p{N}_]+/u)
        .filter((word) => word.length >= 3 && !SCOPE_STOPWORDS.has(word) && !/^\d+$/.test(word))
    )
  ];
}

/**
 * Whether the Lean source covers the subject the claim is about (§48, F27).
 *
 * `theorem t (n : Nat) : 0 < n.succ` proves a fact about naturals. Reporting it
 * as "Lean proves all QHO energy levels are positive" is a scope mismatch even
 * though the theorem is true and its dependencies are clean: no term the claim
 * is about appears anywhere in what was checked.
 *
 * @param {{claimText: string, source: string}} input
 * @returns {{mismatch: boolean, claimTerms: string[], failureCodes: string[], reason: string|null}}
 */
export function certificateScopeMismatch({ claimText, source } = {}) {
  const claimTerms = scopeTerms(claimText);
  const sourceTerms = scopeTerms(stripFormalProvenance(source));
  if (claimTerms.length === 0 || sourceTerms.length === 0) {
    return { mismatch: false, claimTerms, failureCodes: [], reason: null };
  }

  const covered = claimTerms.some((term) =>
    sourceTerms.some((known) => known.startsWith(term) || term.startsWith(known))
  );
  if (covered) return { mismatch: false, claimTerms, failureCodes: [], reason: null };

  return {
    mismatch: true,
    claimTerms,
    failureCodes: ["F27"],
    reason: `nothing in the checked source mentions ${claimTerms.slice(0, 4).join(", ")}`
  };
}

/** Whether text asserts that a proof assistant established the proposition. */
export function assertsLeanProof(text) {
  return LEAN_PROOF_LANGUAGE.test(String(text ?? ""));
}
