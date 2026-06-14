// Common contract for all web search providers. A provider takes a query and
// returns a uniform { provider, query, results, warnings } shape, where each
// result is a raw item later normalized by webSources.toWebSource.

export class BaseSearchProvider {
  constructor({ config = {}, fetchImpl = fetch, apiKey = null } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.apiKey = apiKey;
  }

  name() {
    throw new Error("not implemented");
  }

  // AgentType platforms this provider can serve.
  supports() {
    return [];
  }

  requiresApiKey() {
    return false;
  }

  isConfigured() {
    return !this.requiresApiKey() || Boolean(this.apiKey);
  }

  // Returns { provider, query, results: [rawItem], warnings: [] }.
  async search() {
    throw new Error("not implemented");
  }
}

// Shared timeout helper: returns an AbortSignal unless a caller signal is given.
export function timeoutSignal(signal, timeoutMs) {
  return signal ?? AbortSignal.timeout(timeoutMs ?? 12000);
}
