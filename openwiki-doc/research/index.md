# Research: Deep Research System

The research subsystem provides multi-engine deep web research capabilities, integrated with the agentic loop and frontend UI.

---

## Architecture

Research sessions are managed by `ResearchRuntime` (`researchRuntime.mjs`), which orchestrates multiple research engines and search providers:

```
User Request → ResearchRuntime → Engine Selection → Search → Gather → Analyze → Synthesize → Response
                                    ↓
                              Engines: Local, Gemini, Prism
```

---

## Research Runtime

The runtime manages:
- Session state via `ResearchStateStore`
- Engine selection per session (configurable)
- Job tracking and cancellation
- Streaming results to the frontend via SSE events

### Engines

| Engine | Description | Backend |
|--------|-------------|---------|
| `LocalGraphEngine` | Local analysis/graph-based research | `localGraphEngine.mjs` |
| `GeminiResearchEngine` | Google Gemini API research | `geminiResearchEngine.mjs` + `geminiResearchClient.mjs` |
| `PrismResearchEngine` | Printing Press Prism research | `prismResearchEngine.mjs` + `prismResearchClient.mjs` |

---

## Search Service (`researchSearchService.mjs`)

Configures search providers from the research config section. Supports multiple backends:
- Tavily
- SerpAPI
- Google Custom Search
- Local search (fallback)

API keys come from the config file or `frontend/.env`.

---

## Crawl Integration

The research system integrates with the crawl service for deep page analysis:

- **CrawlClient** (`crawlClient.mjs`) — HTTP client for `ds4-crawl-service` Python service
- **CrawlSummarizer** (`crawlSummarizer.mjs`) — Summarizes crawled content into concise briefs
- **EvidenceStore** (`evidenceStore.mjs`) — Stores and retrieves evidence from crawl manifests

---

## Synthesis & Source Criticism

- **SynthesisEngine** (`synthesisEngine.mjs`) — Combines multiple sources into coherent briefs
- **SourceCritic** (`sourceCritic.mjs`) — Evaluates source quality, relevance, and authority
- **ResearchFormatter** (`researchFormatter.mjs`) — Formats research results for the agent context

---

## Frontend Integration

The `ResearchPanel.jsx` component provides the research UI:
- Session list and selection
- Streaming status indicators
- Source browsing
- Result preview

Research sessions can be exported via `researchExport.mjs`.

---

## Source Files

| File | Lines | Description |
|------|-------|-------------|
| `frontend/server/research/researchRuntime.mjs` | — | Research orchestrator |
| `frontend/server/research/researchSearchService.mjs` | — | Search provider configuration |
| `frontend/server/research/researchStateStore.mjs` | — | Research session state storage |
| `frontend/server/research/researchFormatter.mjs` | 2,432 | Research result formatting |
| `frontend/server/research/researchModelClient.mjs` | — | Model client for research |
| `frontend/server/research/researchExport.mjs` | — | Research session export |
| `frontend/server/research/localGraphEngine.mjs` | — | Local graph-based research engine |
| `frontend/server/research/geminiResearchEngine.mjs` | — | Gemini research engine |
| `frontend/server/research/geminiResearchClient.mjs` | — | Gemini API client |
| `frontend/server/research/prismResearchEngine.mjs` | — | Prism research engine |
| `frontend/server/research/prismResearchClient.mjs` | — | Prism API client |
| `frontend/server/research/orcidClient.mjs` | — | ORCID client for academic research |
| `frontend/server/research/researchEvents.mjs` | — | Research event types |
| `frontend/server/crawlClient.mjs` | 3,134 | Crawl service HTTP client |
| `frontend/server/crawlSummarizer.mjs` | 3,160 | Crawl content summarization |
| `frontend/server/evidenceStore.mjs` | 4,891 | Evidence storage and retrieval |
| `frontend/server/synthesisEngine.mjs` | 2,370 | Source synthesis into briefs |
| `frontend/server/sourceCritic.mjs` | 6,061 | Source quality evaluation |
| `frontend/src/research/ResearchPanel.jsx` | — | Research UI panel |
