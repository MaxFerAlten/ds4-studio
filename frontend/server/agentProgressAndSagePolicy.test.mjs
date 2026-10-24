// The three "nothing on screen for minutes" fixes:
//  - backend prefill lines become agent_prefill progress events;
//  - a non-function-study Sage turn gets the ~2k-token core policy instead of
//    the ~17k-token SKILL.md, and the full text once a function study starts.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parsePrefillProgress, relayPrefillProgress } from "./agent/backendPrefillProgress.mjs";
import { isFunctionStudyRequest, sageCorePolicy } from "./sagePolicySlim.mjs";

const LINE = "1024 17:14:14 ds4-server: chat ctx=29696..37677:7981 TOOLS prefill chunk 2048/7981 (25.7%) chunk=98.04 t/s avg=98.99 t/s 20.688s";

test("a ds4-server prefill line parses into progress with an ETA", () => {
  assert.deepEqual(parsePrefillProgress(LINE), {
    doneTokens: 2048, totalTokens: 7981, percent: 25.7,
    tokensPerSecond: 98.99, elapsedSeconds: 20.688, etaSeconds: 60
  });
  assert.equal(parsePrefillProgress("1024 17:14:14 ds4-server: chat ... decoding chunk=13.1 t/s"), null);
});

test("prefill relay forwards only progress lines and unsubscribes", () => {
  const manager = new EventEmitter();
  const seen = [];
  const stop = relayPrefillProgress(manager, (p) => seen.push(p.percent));
  manager.emit("log", { message: "kv cache hit" });
  manager.emit("log", { message: LINE });
  stop();
  manager.emit("log", { message: LINE });
  assert.deepEqual(seen, [25.7]);
  assert.equal(manager.listenerCount("log"), 0);
});

test("the core Sage policy drops the function-study gate and stays well-formed", () => {
  const full = readFileSync(new URL("../../skills/sage/SKILL.md", import.meta.url), "utf8");
  const core = sageCorePolicy(full);
  assert.ok(core.length < full.length / 4, `core ${core.length} vs full ${full.length}`);
  assert.equal((core.match(/^```/gm) || []).length % 2, 0, "balanced code fences");
  for (const kept of ["### 2.3", "## 2.10", "## 3. Disciplina", "## 6. Struttura"]) assert.ok(core.includes(kept), kept);
  for (const dropped of ["### 2.5", "## 4. Workflow", "### Passo 5", "## 8. Quality gate", "## 9. Criterio"]) {
    assert.ok(!core.includes(dropped), dropped);
  }
});

test("function-study requests are recognized, plain computations are not", () => {
  for (const text of ["studio di funzione di f(x)=x/(x^2-1)", "studia la funzione e trova gli asintoti", "full function study of x^3"]) {
    assert.equal(isFunctionStudyRequest(text), true, text);
  }
  for (const text of ["usa sagemath per dimostrare il termine generale", "espandi (x+y)^3", "calcola il limite"]) {
    assert.equal(isFunctionStudyRequest(text), false, text);
  }
});

test("the agent loop selects the policy per turn and upgrades on a function_study call", () => {
  const index = readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
  assert.match(index, /if \(isFunctionStudyRequest\(userMessage\)\) agentSession\.sageFullPolicy = true;/);
  assert.match(index, /prompt: sagePolicyPromptFor\(\{ fullPolicy: agentSession\.sageFullPolicy === true \}\)/);
  assert.match(index, /tc\.arguments\?\.task_type === "function_study" && agentSession\.sageFullPolicy !== true/);
  assert.match(index, /relayPrefillProgress\(manager, \(progress\) => writeAgentSse\("agent_prefill", progress\)\)/);
  assert.match(index, /stopPrefillRelay\(\);/);
});
