export const SELF_CHALLENGE_EXTRACTION_STATUS = Object.freeze({
  COMPLETE: "SELF_CHALLENGE_EXTRACTION_COMPLETE",
  PARTIAL: "SELF_CHALLENGE_EXTRACTION_PARTIAL"
});

export const SELF_CHALLENGE_CLASS = Object.freeze({
  MODEL_INADEQUACY: "MODEL_INADEQUACY",
  MATH_ERROR: "MATH_ERROR",
  ASSUMPTION_GAP: "ASSUMPTION_GAP",
  SCOPE_MISMATCH: "SCOPE_MISMATCH",
  TOOL_FAILURE: "TOOL_FAILURE",
  SOURCE_MISMATCH: "SOURCE_MISMATCH"
});

// R01-PATCH-05: a self challenge is a bounded summary, never a raw dump of the
// candidate (which, since R01, may include observable assistant reasoning).
const MAX_CHALLENGE_TEXT_CHARS = 512;

const VALID_CLASSES = new Set(Object.values(SELF_CHALLENGE_CLASS));

export const SELF_CHALLENGE_PROMPT = `Identify explicit material objections the assistant raises against claims already proposed in this turn.
A challenge is not automatically true. Its purpose is to create verification debt.
Bind each challenge to the most specific prior claim.
Ignore stylistic uncertainty and capture only objections that change whether a claim may be asserted.
Return JSON only as {"challenges":[{"targetClaimId":"...","text":"...","challengeClass":"MODEL_INADEQUACY|MATH_ERROR|ASSUMPTION_GAP|SCOPE_MISMATCH|TOOL_FAILURE|SOURCE_MISMATCH","severity":0,"confidenceForRoutingOnly":0.0}]}.
Confidence is routing metadata only and never authorizes epistemic state.`;

const B = String.raw`(?<![\p{L}\p{N}_])`;
const E = String.raw`(?![\p{L}\p{N}_])`;

export const SELF_CHALLENGE_TRIGGER = new RegExp(
  `${B}(this is wrong|the theorem statement is (?:wrong|incorrect)|this (?:does not|doesn't) match|we are missing|cannot represent|conflated|not equivalent|the model is insufficient|i need to fix|my previous claim was wrong|the tool (?:failed|errored)|the source (?:does not|doesn't) support|questo è (?:sbagliato|errato|falso)|l'enunciato (?:è )?(?:sbagliato|errato)|manca(?:no)?|non (?:può|possiamo) rappresentare|ho confuso|non è equivalente|il modello è insufficiente|devo correggere|la mia affermazione precedente era sbagliata|il tool (?:è fallito|ha fallito)|la fonte non supporta)${E}`,
  "iu"
);

function normalizedSeverity(value, fallback = 4) {
  const severity = Number(value);
  return Number.isInteger(severity) && severity >= 0 && severity <= 5 ? severity : fallback;
}

function normalizedConfidence(value) {
  const confidence = Number(value);
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0;
}

function fallbackClass(text) {
  if (/tool|errore|error|failed|fallito/iu.test(text)) return SELF_CHALLENGE_CLASS.TOOL_FAILURE;
  if (/source|fonte/iu.test(text)) return SELF_CHALLENGE_CLASS.SOURCE_MISMATCH;
  if (/assum|premise|ipotes|assunz/iu.test(text)) return SELF_CHALLENGE_CLASS.ASSUMPTION_GAP;
  if (/match|equivalent|scope|equivalent|corrispond/iu.test(text)) {
    return SELF_CHALLENGE_CLASS.SCOPE_MISMATCH;
  }
  if (/missing|manca|represent|rappresent|model|modello|conflat|confus/iu.test(text)) {
    return SELF_CHALLENGE_CLASS.MODEL_INADEQUACY;
  }
  return SELF_CHALLENGE_CLASS.MATH_ERROR;
}

function mappedChallenge(raw, knownClaimIds) {
  const targetClaimId = String(raw?.targetClaimId ?? "").trim();
  const text = String(raw?.text ?? raw?.challengeText ?? "").trim();
  if (!knownClaimIds.has(targetClaimId) || !text) return null;
  const challengeClass = VALID_CLASSES.has(raw?.challengeClass)
    ? raw.challengeClass
    : fallbackClass(text);
  return Object.freeze({
    targetClaimId,
    text,
    challengeClass,
    severity: normalizedSeverity(raw?.severity),
    confidenceForRoutingOnly: normalizedConfidence(raw?.confidenceForRoutingOnly)
  });
}

function lexicalChallenges(text, knownClaims, reason) {
  const summary = String(text ?? "").trim().slice(0, MAX_CHALLENGE_TEXT_CHARS);
  return {
    status: SELF_CHALLENGE_EXTRACTION_STATUS.PARTIAL,
    challenges: knownClaims.map((claim) =>
      Object.freeze({
        targetClaimId: claim.id,
        text: summary,
        challengeClass: fallbackClass(text),
        severity: 4,
        confidenceForRoutingOnly: 0
      })
    ),
    source: "lexical",
    reason
  };
}

export function isExplicitSelfChallenge(text) {
  return SELF_CHALLENGE_TRIGGER.test(String(text ?? ""));
}

export async function extractSelfChallenges({ text, knownClaims = [], client = null, signal } = {}) {
  const candidateText = String(text ?? "").trim();
  const claims = knownClaims.filter(
    (claim) => typeof claim?.id === "string" && claim.id && typeof claim?.text === "string"
  );
  if (!candidateText || claims.length === 0 || !isExplicitSelfChallenge(candidateText)) {
    return {
      status: SELF_CHALLENGE_EXTRACTION_STATUS.COMPLETE,
      challenges: [],
      source: "none"
    };
  }

  if (!client || typeof client.completeRole !== "function") {
    return lexicalChallenges(
      candidateText,
      claims,
      "no structured model client available; explicit objection conservatively bound to claims in scope"
    );
  }

  try {
    const response = await client.completeRole({
      roleName: "epistemic_self_challenge_extractor",
      systemPrompt: SELF_CHALLENGE_PROMPT,
      userPrompt: JSON.stringify({
        candidateText,
        priorClaims: claims.map(({ id, text: claimText }) => ({ id, text: claimText }))
      }),
      json: true,
      signal
    });
    const raw = Array.isArray(response?.json?.challenges) ? response.json.challenges : null;
    if (!raw) return lexicalChallenges(candidateText, claims, "model response had no challenges array");
    const knownClaimIds = new Set(claims.map((claim) => claim.id));
    if (raw.length === 0) {
      // R01-PATCH-09: a well-formed model verdict of "no challenges" is
      // respected. Forcing a lexical objection here would punish an honest
      // correction (reasoning flags a limitation; content states it plainly).
      // The verification/scope/finalizer layers remain the real backstop for
      // a model that misses a genuine objection.
      return {
        status: SELF_CHALLENGE_EXTRACTION_STATUS.COMPLETE,
        challenges: [],
        source: "model"
      };
    }
    const challenges = raw.map((item) => mappedChallenge(item, knownClaimIds)).filter(Boolean);
    if (challenges.length === 0) {
      return lexicalChallenges(candidateText, claims, "model returned no challenge bound to a known claim");
    }
    return {
      status: SELF_CHALLENGE_EXTRACTION_STATUS.COMPLETE,
      challenges,
      source: "model"
    };
  } catch (error) {
    return lexicalChallenges(
      candidateText,
      claims,
      `self-challenge extraction failed: ${String(error?.message ?? error)}`
    );
  }
}
