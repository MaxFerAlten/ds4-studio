import { test } from "node:test";
import assert from "node:assert/strict";
import { getAgentCapabilities, capabilitiesPromptSection } from "./agentCapabilities.mjs";

test("getAgentCapabilities reflects config", () => {
  const caps = getAgentCapabilities({ crawl: { host: "127.0.0.1", port: 8800 }, research: { search: { enabled: true } } });
  assert.deepEqual(caps, { webSearch: true, crawl: true, sage: true, history: true, researchSearch: true, pageAgent: false, pageAgentMcp: false });
});

test("crawl false without a configured host; research false when disabled", () => {
  const caps = getAgentCapabilities({});
  assert.equal(caps.crawl, false);
  assert.equal(caps.researchSearch, false);
  assert.equal(caps.webSearch, true);
  assert.equal(caps.pageAgent, false);
  assert.equal(caps.pageAgentMcp, false);
});

test("pageAgent capabilities appear when enabled", () => {
  const caps = getAgentCapabilities({ pageAgent: { enabled: true, mcpEnabled: true } });
  assert.equal(caps.pageAgent, true);
  assert.equal(caps.pageAgentMcp, true);
});

test("pageAgent capability absent when disabled", () => {
  const caps = getAgentCapabilities({ pageAgent: { enabled: false } });
  assert.equal(caps.pageAgent, false);
});

test("prompt section lists only enabled tools and tells the model to act", () => {
  const section = capabilitiesPromptSection({ webSearch: true, crawl: true, researchSearch: false, history: true, sage: false, pageAgent: false });
  assert.match(section, /Available runtime tools/);
  assert.match(section, /do not ask the user to run them/);
  assert.match(section, /crawl —/);
  assert.match(section, /chat_history_search/);
  assert.ok(!section.includes("research_discover"), "disabled tool must be omitted");
  assert.ok(!section.includes("sage —"), "disabled tool must be omitted");
  assert.ok(!section.includes("page_snapshot"), "disabled tool must be omitted");
});

test("prompt section includes pageAgent when enabled", () => {
  const section = capabilitiesPromptSection({ webSearch: true, pageAgent: true });
  assert.match(section, /page_snapshot/);
});

test("empty capabilities yields an empty section", () => {
  assert.equal(capabilitiesPromptSection({}), "");
});
