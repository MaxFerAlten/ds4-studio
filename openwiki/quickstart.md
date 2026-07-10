# ds4-studio Documentation

## Overview

The ds4-studio repository houses the PageAgent framework, Crawl4AI integration, and agent tooling ecosystem. It enables:
- Dynamic page agent creation via WebSocket interfaces
- Crawl4AI-powered content grounding and research
- Agent capability management with governance controls
- Skill module execution in a sandboxed environment

## Core Components

1. **PageAgent**
   - Frontend UI in `frontend/src/pageagent/`
   - Server backend in `frontend/server/pageagent-*`
   - Security auditing in `frontend/server/pageAgentAudit.mjs`

2. **Crawl4AI Integration**
   - Grounding in `ds4_crawl_grounding.c`
   - Crawl service configuration in `crawl_service/settings.py`
   - Grounding workflows in `frontend/server/crawlClient.mjs`

3. **Agent Tooling**
   - Tool composition in `agentTools.mjs`
   - Output compression in `toolOutputCompressor.mjs`
   - Security guards in `claimGuard.mjs`

## Getting Started

1. Clone repository from `/mnt/samsung_ai/COPARATOR/ds4-studio`
2. Install dependencies: `npm install` in `frontend/` and `crawl_service/`
3. Configure environment variables in `ds4-ui.config.json`
4. Launch PageAgent UI via `./run.sh` or `npm start`

## Navigation

- [Architecture](openwiki/architecture.md)
- [Frontend](openwiki/frontend.md)
- [Backend](openwiki/backend.md)
- [Integration](openwiki/integration.md)
- [Testing](openwiki/testing.md)
- [Skills](openwiki/skills.md)
- [Operations](openwiki/operations.md)

*Last updated: 4c94219 (PageAgent UI tools update)*