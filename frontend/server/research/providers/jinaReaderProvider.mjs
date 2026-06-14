// Jina Reader (https://r.jina.ai) — not a search engine, a page reader. Given a
// URL it returns clean, LLM-ready text. API key optional (raises rate limits).
// SSRF guard applies to the TARGET url, not the r.jina.ai wrapper.

import { assertUrlSafe } from "../ssrfGuard.mjs";
import { timeoutSignal } from "./baseSearchProvider.mjs";

const DEFAULT_ENDPOINT = "https://r.jina.ai/";

export class JinaReaderProvider {
  constructor({ config = {}, fetchImpl = fetch, apiKey = null } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.apiKey = apiKey;
  }

  name() {
    return "jina";
  }

  // Read one URL, returning { url, content, contentSource } or throwing.
  async read(url, { signal, maxChars = 12000, timeoutMs } = {}) {
    assertUrlSafe(url);
    const endpoint = this.config.endpoint || DEFAULT_ENDPOINT;
    const headers = { Accept: "text/plain" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const res = await this.fetchImpl(`${endpoint}${url}`, {
      headers,
      signal: timeoutSignal(signal, timeoutMs)
    });
    if (!res.ok) throw new Error(`jina reader HTTP ${res.status}`);
    const text = (await res.text()).slice(0, maxChars);
    return { url, content: text, contentSource: "jina" };
  }
}
