import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { prefillStatusText, tagLastAssistant } from "./appLogic.mjs";

test("prefill status text: percent, tokens, ETA, then generation", () => {
  assert.equal(
    prefillStatusText({ percent: 25.7, doneTokens: 2048, totalTokens: 7981, etaSeconds: 60 }),
    "Elaborazione prompt 25% (2048/7981 token) · ~60 s rimanenti"
  );
  assert.match(prefillStatusText({ percent: 40, doneTokens: 1, totalTokens: 2, etaSeconds: 200 }), /~3 min rimanenti/);
  assert.match(prefillStatusText({ percent: 100 }), /sta generando/);
  assert.equal(prefillStatusText({}), "");
});

test("tagLastAssistant patches only the trailing assistant reply", () => {
  const messages = [
    { role: "assistant", content: "old" },
    { role: "user", content: "q" },
    { role: "assistant", content: "" }
  ];
  const out = tagLastAssistant(messages, { sageRunId: "run-1" });
  assert.equal(out[2].sageRunId, "run-1");
  assert.equal(out[0].sageRunId, undefined);
  assert.equal(messages[2].sageRunId, undefined, "input untouched");
  assert.equal(tagLastAssistant([{ role: "user", content: "x" }], { a: 1 })[0].a, undefined);
});

// Regression: the Sage activity card renders only for a message with
// sageRunId, which nothing set, so Sage attempts never appeared.
test("the agent stream tags the reply with the Sage run and shows prefill", () => {
  const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(app, /setMessages\(\(prev\) => tagLastAssistant\(prev, \{ sageRunId: data\.runId \}\)\)/);
  assert.match(app, /event === "agent_prefill"/);
  const panel = readFileSync(new URL("./chat/ChatPanel.jsx", import.meta.url), "utf8");
  assert.match(panel, /message\.pendingStatus && !message\.content/);
});
