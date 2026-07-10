# OpenWiki Draft Plan

## Intended Wiki Pages

1. **quickstart.md**
   - **Source evidence**: `README.md`, repository root files (`AGENTS.md`, `CLAUDE.md`), `Makefile`, directory layout (`frontend/`, `ds4/`, `crawl_service/`, `skills/`).
   - **Purpose**: Entry point explaining what the repository is, its primary domains, and high‑level navigation to other documentation.

2. **architecture.md** (under `openwiki/architecture/`)
   - **Source evidence**: Core source trees (`ds4/`, `frontend/server/`, `frontend/src/pageagent/`, `crawl_service/`), `ds4-wrapper`, `ds4_agent.c`, architecture‑related commits.
   - **Purpose**: High‑level overview of system components: ds4 engine, Agent Framework, PageAgent, Crawl Service, integration points.

3. **frontend-overview.md** (under `openwiki/frontend/`)
   - **Source evidence**: `frontend/src/App.jsx`, `frontend/src/chat/ChatPanel.jsx`, `frontend/src/pageagent/*`, `frontend/ds4-ui.config.json`, `frontend/vite.config.js`.
   - **Purpose**: Description of UI layers, panel components, configuration, and client‑side routing.

4. **backend-overview.md** (under `openwiki/backend/`)
   - **Source evidence**: `frontend/server/*.mjs` files (`agentAutonomy.mjs`, `agentCapabilities.mjs`, `agentSession.mjs`, `agentTools.mjs`), server entrypoints, Makefile scripts.
   - **Purpose**: Explanation of server‑side services, agent orchestration, tool negotiation, and runtime rules.

5. **testing-overview.md** (under `openwiki/testing/`)
   - **Source evidence**: Test files under `frontend/src/*test.mjs`, `frontend/server/*test.mjs`, `scripts/*test*.sh`, `AGENTS_BUILD.md`.
   - **Purpose**: Overview of testing strategy, test frameworks used, and how to run/exit tests.

6. **integration-and-api.md** (under `openwiki/integration/`)
   - **Source evidence**: Bridge modules (`frontend/server/pageAgentBridge.mjs`, `frontend/src/pageagent/*`), API definitions in server routes, `agentCommands.test.mjs`.
   - **Purpose**: Description of public APIs, message formats, and integration points for external tools.

7. **operations-and-deployment.md** (under `openwiki/operations/`)
   - **Source evidence**: `Makefile`, shell scripts (`scripts/rocm_settings.sh`, `srun.sh`, `certify_all.sh`), build configuration files.
   - **Purpose**: Build, runtime, and deployment workflow; required environment setup; scaling considerations.

8. **skills-and-knowledge.md** (under `openwiki/skills/`)
   - **Source evidence**: Files under `skills/` directory, `SKILL.md` examples, related documentation in `docs/superpowers/`.
   - **Purpose**: Catalog of skill modules, their purpose, and how they are invoked.

## Remaining Questions

- What are the exact entry points for launching the PageAgent UI?
- Which configuration files control the crawling pipeline?
- How are secrets or environment variables managed in `frontend/ds4-ui.config.json`?
- What is the release process documented in `AGENTS_BUILD.md`?

*This plan will be refined after the initial documentation is drafted and reviewed.*