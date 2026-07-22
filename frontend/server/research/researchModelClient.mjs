import { StructuredModelClient, extractStructuredJson } from "../structuredModelClient.mjs";

export const RESEARCH_ROLE_OPTIONS = Object.freeze({
  coordinator: Object.freeze({ think: false, maxTokens: 1024 }),
  query_rewriter: Object.freeze({ think: false, maxTokens: 1024 }),
  planner: Object.freeze({ think: false, maxTokens: 2048 }),
  researcher: Object.freeze({ think: false, maxTokens: 1536 }),
  research_team: Object.freeze({ think: false, maxTokens: 1024 })
});

export const extractJson = extractStructuredJson;

export class ResearchModelClient extends StructuredModelClient {
  constructor(options = {}) {
    super({ ...options, errorPrefix: "research model" });
  }
}
