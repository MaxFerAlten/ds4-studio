// Author credibility enrichment: after the report is written, verify the primary
// author of each CITED source against ORCID and attach the result to the source.
// Bounded (only cited sources, capped) and cached, so it adds little latency to
// the pipeline. Failures degrade silently — verification never breaks a run.

import { citedSourceIds } from "./researchSources.mjs";

export async function verifyCitedAuthors(state, { client, maxAuthors = 10, signal } = {}) {
  if (!client || !state?.finalReport || !Array.isArray(state.sources)) {
    return { checked: 0, verified: 0 };
  }
  const cited = new Set(citedSourceIds(state.finalReport));
  const targets = state.sources.filter(
    (s) => cited.has(s.id) && Array.isArray(s.authors) && s.authors.length
  );
  const cache = new Map();
  let checked = 0;
  let verified = 0;
  for (const source of targets) {
    if (checked >= maxAuthors) break;
    const author = source.authors[0];
    if (!cache.has(author)) {
      cache.set(author, await client.verifyAuthor(author, { signal }));
      checked += 1;
    }
    const result = cache.get(author);
    source.authorVerification = {
      author: result.name || author,
      found: result.found,
      orcidId: result.orcidId,
      institutions: result.institutions,
      numFound: result.numFound
    };
    if (result.found) verified += 1;
  }
  return { checked, verified };
}
