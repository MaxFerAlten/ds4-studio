import { StructuredModelClient, extractStructuredJson } from "../structuredModelClient.mjs";

export const RESEARCH_ROLE_OPTIONS = Object.freeze({
  coordinator: Object.freeze({ think: false, maxTokens: 1024 }),
  query_rewriter: Object.freeze({ think: false, maxTokens: 1024 }),
  planner: Object.freeze({ think: false, maxTokens: 2048 }),
  researcher: Object.freeze({ think: false, maxTokens: 1536 }),
  research_team: Object.freeze({ think: false, maxTokens: 1024 }),
  // The one role that writes a long document, and the only one that had no
  // entry here at all: it fell back to research.model.max_tokens (8192) with
  // thinking left at the server default. Reasoning is charged to the same
  // budget, so a full report with formulas was cut mid-KaTeX:
  //     \hat{a} + \frac{   ## Fonti
  // Thinking stays ON -- the reporter is the role that most needs it -- so the
  // budget has to hold both. Halogen caps max_tokens at 65536.
  reporter: Object.freeze({ maxTokens: 16384 })
});

export const extractJson = extractStructuredJson;

export class ResearchModelClient extends StructuredModelClient {
  constructor(options = {}) {
    super({ ...options, errorPrefix: "research model" });
  }
}
