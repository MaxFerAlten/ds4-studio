// Request defaults, kept in a dependency-free leaf module on purpose.
//
// src/App.jsx and src/panels/RightRailPanels.jsx import these through
// requestPayload.mjs, so this file is part of the *browser* bundle. Anything it
// imported would be pulled into the client too: defaultConfig.mjs reaches
// contextConfig -> costLimits -> fileIngestion -> node:fs/promises, which vite
// externalizes and which throws at import time, blanking the page.
//
// Keep this module free of imports.

export const REQUEST_DEFAULTS = Object.freeze({
  endpoint: "/v1/chat/completions",
  model: "deepseek-v4-flash",
  system: "",
  // "auto" is resolved by the DS4-Studio proxy to:
  // min(context room - context_margin, max_tokens_safety_cap).
  max_tokens: "auto",
  max_tokens_safety_cap: 32768,
  context_margin: 1024,
  temperature: 0,
  top_p: 1,
  top_k: 0,
  min_p: 0,
  seed: 42,
  stream: true,
  thinking: false,
  reasoning_effort: "high",
  stop: ""
});
