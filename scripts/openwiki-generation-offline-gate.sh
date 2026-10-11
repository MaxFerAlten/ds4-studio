#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

node --check frontend/server/index.mjs
node --check frontend/server/openwikiGenerationService.mjs
node --check frontend/server/openwikiModelAdapter.mjs

node --test frontend/server/openwikiAgentCommand.test.mjs
node --test frontend/server/openwikiAgentTools.test.mjs
node --test frontend/server/openwikiRoutes.test.mjs
node --test frontend/server/openwikiGenerationService.test.mjs
node --test frontend/server/openwikiModelAdapter.test.mjs
node --test frontend/server/openwikiRepositoryContext.test.mjs
node --test frontend/server/openwikiRunMetadata.test.mjs
node --test frontend/src/App.test.mjs
node --test frontend/server/openwikiPanel.browser.test.mjs

node --test integrations/openwiki-gateway/test/admin-page-writer.test.mjs
node --test integrations/openwiki-gateway/test/wiki-generation-controller.test.mjs
node --test integrations/openwiki-gateway/test/wiki-generation-runtime.test.mjs
(
  cd integrations/openwiki-gateway
  node --test test/contract-openwiki.test.mjs test/security-negative.test.mjs
)

node --test tests/openwiki/openwiki-provisioning.test.mjs
