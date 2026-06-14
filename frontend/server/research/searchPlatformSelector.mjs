// Deterministic platform selector — the Node port of DeepResearch's
// SmartAgentSelectionHelperService. Classifies a query into an agent type, then
// picks the best AVAILABLE provider for it, with an ordered fallback chain.
// (An LLM-based classifier can be layered on later.)

const RULES = [
  {
    agentType: "ACADEMIC_RESEARCH",
    terms: ["paper", "papers", "arxiv", "doi", "study", "studies", "studio", "studi", "ricerca scientifica", "peer-reviewed", "citation", "preprint"],
    providers: ["openalex", "googlescholar", "tavily", "serpapi"]
  },
  {
    agentType: "ENCYCLOPEDIA",
    terms: ["cos'è", "cos e", "definizione", "definition", "history", "storia", "biografia", "biography", "what is", "who is", "chi è"],
    providers: ["wikipedia", "tavily"]
  },
  {
    agentType: "DATA_ANALYSIS",
    terms: ["gdp", "pil", "population", "popolazione", "inflation", "inflazione", "world bank", "indicator", "indicatori", "statistics", "statistiche"],
    providers: ["worldbank", "serpapi", "tavily"]
  },
  {
    agentType: "LIFESTYLE_TRAVEL",
    terms: ["travel", "viaggio", "hotel", "attractions", "attrazioni", "restaurants", "ristoranti", "tourism", "turismo"],
    providers: ["opentripmap", "tripadvisor", "tavily"]
  }
];

const GENERAL = {
  agentType: "GENERAL_RESEARCH",
  providers: ["tavily", "serpapi", "wikipedia", "openalex", "aliyun", "baidu"]
};

function containsAny(text, terms) {
  const q = ` ${text.toLowerCase()} `;
  return terms.some((t) => q.includes(` ${t} `) || q.includes(t));
}

export function classifyQuery(query) {
  const q = String(query || "");
  for (const rule of RULES) {
    if (containsAny(q, rule.terms)) {
      return { agentType: rule.agentType, providerPreference: rule.providers };
    }
  }
  return { agentType: GENERAL.agentType, providerPreference: GENERAL.providers };
}

// Pick the first preferred provider that is available; fall back across the
// chain, then to any available provider. Returns { agentType, provider,
// fallbackProvider, reason }.
export function selectPlatform(query, { availableProviders = [] } = {}) {
  const available = new Set(availableProviders);
  const { agentType, providerPreference } = classifyQuery(query);
  const chain = providerPreference.filter((p) => available.has(p));
  // Append any remaining available providers as last-resort fallbacks.
  for (const p of availableProviders) if (!chain.includes(p)) chain.push(p);

  if (!chain.length) {
    return { agentType, provider: null, fallbackProvider: null, reason: "no provider available" };
  }
  return {
    agentType,
    provider: chain[0],
    fallbackProvider: chain[1] || null,
    chain,
    reason: `classified as ${agentType}; chose ${chain[0]}`
  };
}
