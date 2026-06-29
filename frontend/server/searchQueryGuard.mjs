const META_REASONING_PATTERNS = [
  /\bwe need to\b/i,
  /\bi need to\b/i,
  /\bthe user (asks|wants|said|wrote|requested)\b/i,
  /\bgiven the ambiguity\b/i,
  /\bi think the user\b/i,
  /\bl'utente (chiede|vuole|ha scritto|richiede)\b/i,
  /\butente (chiede|vuole|ha scritto|richiede)\b/i,
  /\brispondi solo\b/i,
  /\bquery finale\b/i,
  /\bchain of thought\b/i,
  /\bdevo capire\b/i,
  /\bdobbiamo capire\b/i,
  /\bsembra che\b/i,
  /\buna volta autorizzato\b/i,
  /\btuttavia,?\s+il sistema\b/i,
  /\bla query migliore potrebbe essere\b/i,
  /\bi should respond\b/i
];

const QUOTE_EDGE = /^["'`]+|["'`]+$/g;

export function normalizeSearchQuery(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(QUOTE_EDGE, "")
    .trim();
}

export function validateSearchQuery(value, options = {}) {
  const {
    maxLength = 220,
    allowLongExplicit = false
  } = options;

  const query = normalizeSearchQuery(value);

  if (!query) {
    return { ok: false, query, reason: "empty query" };
  }

  if (!/[A-Za-zÀ-ÿ0-9]/.test(query)) {
    return { ok: false, query, reason: "query has no searchable terms" };
  }

  if (!allowLongExplicit && query.length > maxLength) {
    return { ok: false, query, reason: "query too long; likely prose or reasoning" };
  }

  for (const pattern of META_REASONING_PATTERNS) {
    if (pattern.test(query)) {
      return {
        ok: false,
        query,
        reason: "query contains model reasoning or assistant metatext"
      };
    }
  }

  return { ok: true, query };
}
