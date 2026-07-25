/**
 * HTTP client for the Agno AgentOS service.
 * All requests go through the DS4 Node proxy to maintain auth and lifecycle control.
 */

const DEFAULT_TIMEOUTS = {
  health: 2000,
  catalog: 5000,
  createRun: 30_000,
  getRun: 5000,
  cancelRun: 5000,
};

export class AgnoClient {
  #baseUrl;
  #serviceToken;
  #ownerId;
  #fetchImpl;
  #timeouts;

  constructor({ baseUrl, serviceToken, ownerId, fetchImpl = fetch, timeouts = DEFAULT_TIMEOUTS }) {
    this.#baseUrl = baseUrl;
    this.#serviceToken = serviceToken;
    this.#ownerId = ownerId;
    this.#fetchImpl = fetchImpl;
    this.#timeouts = timeouts;
  }

  #headers() {
    return {
      Authorization: `Bearer ${this.#serviceToken}`,
      "X-DS4-Agno-Owner": this.#ownerId,
      "Content-Type": "application/json",
    };
  }

  async health() {
    const resp = await this.#fetchImpl(`${this.#baseUrl}/ds4/health`, {
      signal: AbortSignal.timeout(this.#timeouts.health),
    });
    if (!resp.ok) throw new Error(`health check failed: ${resp.status}`);
    return resp.json();
  }

  async catalog() {
    const resp = await this.#fetchImpl(`${this.#baseUrl}/ds4/catalog`, {
      headers: this.#headers(),
      signal: AbortSignal.timeout(this.#timeouts.catalog),
    });
    if (!resp.ok) throw new Error(`catalog fetch failed: ${resp.status}`);
    return resp.json();
  }

  async createRun(payload, { signal } = {}) {
    const resp = await this.#fetchImpl(`${this.#baseUrl}/ds4/runs`, {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify(payload),
      signal: signal || AbortSignal.timeout(this.#timeouts.createRun),
    });
    if (!resp.ok) throw new Error(`create run failed: ${resp.status}`);
    return resp.json();
  }

  async listRuns({ signal } = {}) {
    const resp = await this.#fetchImpl(`${this.#baseUrl}/ds4/runs`, {
      headers: this.#headers(),
      signal: signal || AbortSignal.timeout(this.#timeouts.getRun),
    });
    if (!resp.ok) throw new Error(`list runs failed: ${resp.status}`);
    return resp.json();
  }

  async getRun(runId, { signal } = {}) {
    const resp = await this.#fetchImpl(`${this.#baseUrl}/ds4/runs/${runId}`, {
      headers: this.#headers(),
      signal: signal || AbortSignal.timeout(this.#timeouts.getRun),
    });
    if (!resp.ok) throw new Error(`get run failed: ${resp.status}`);
    return resp.json();
  }

  async openRunEvents(runId, { signal } = {}) {
    const resp = await this.#fetchImpl(`${this.#baseUrl}/ds4/runs/${runId}/events`, {
      headers: this.#headers(),
      signal,
    });
    if (!resp.ok) throw new Error(`open run events failed: ${resp.status}`);
    return resp;
  }

  async cancelRun(runId, { signal } = {}) {
    const resp = await this.#fetchImpl(`${this.#baseUrl}/ds4/runs/${runId}/cancel`, {
      method: "POST",
      headers: this.#headers(),
      signal: signal || AbortSignal.timeout(this.#timeouts.cancelRun),
    });
    if (!resp.ok) throw new Error(`cancel run failed: ${resp.status}`);
    return resp.json();
  }

  async traces({ signal } = {}) {
    const resp = await this.#fetchImpl(`${this.#baseUrl}/ds4/traces`, {
      headers: this.#headers(),
      signal: signal || AbortSignal.timeout(5000),
    });
    if (!resp.ok) throw new Error(`traces fetch failed: ${resp.status}`);
    return resp.json();
  }
}
