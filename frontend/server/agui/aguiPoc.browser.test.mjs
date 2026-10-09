import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import puppeteer from "puppeteer-core";
import { test } from "node:test";
import { createAgentAdmission } from "../agentAdmission.mjs";
import { createAgentIdentity } from "../agentIdentity.mjs";
import { createAgentRunService, AGENT_RUN_OUTCOME } from "../agent/runService.mjs";
import { createRunIngress } from "../agent/runIngress.mjs";
import { createThreadStore } from "../agent/threadStore.mjs";
import { openLocalThreadStorage } from "../agent/localThreadStorage.mjs";
import { createServer as createViteServer } from "vite";
import { loadAguiSdk } from "./sdk.mjs";
import { createAguiGateway, mountAguiRoutes } from "./route.mjs";
import { createAguiRecorder } from "./recorder.mjs";

const sdk = await loadAguiSdk();

async function startPoc(runJsTurn, { durable = false } = {}) {
  const admission = createAgentAdmission();
  const dataDir = durable ? mkdtempSync(join(tmpdir(), "ds4-agui-browser-db-")) : null;
  const storage = durable ? await openLocalThreadStorage({ databasePath: join(dataDir, "threads.sqlite") }) : null;
  const store = storage?.store ?? createThreadStore();
  const identity = createAgentIdentity({ secret: storage?.store.getOrCreateOwnerSecret() ?? "wp3-browser-test-secret" });
  const service = createAgentRunService({
    resolveEngine: () => "js", runJsTurn,
    runNativeTurn: async () => { throw new Error("native disabled"); }, admission
  });
  const ingress = createRunIngress({ admission, store, service, resolveEngine: () => "js" });
  const app = express();
  app.use((req, res, next) => {
    const write = res.write.bind(res);
    res.write = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      for (let offset = 0; offset < bytes.length; offset += 3) write(bytes.subarray(offset, offset + 3));
      return true;
    };
    next();
  });
  app.use(express.json());
  mountAguiRoutes(app, createAguiGateway({
    flags: { aguiEnabled: true, localThreads: durable, nativeMultiThread: false, durableHistory: durable },
    sdk, ingress, store, identity, recorder: createAguiRecorder(), engine: () => "js", keepaliveMs: 1000
  }));
  const vite = await createViteServer({ configFile: join(process.cwd(), "vite.config.js"), server: { middlewareMode: true, ws: false, hmr: false }, appType: "spa", root: process.cwd() });
  app.use(vite.middlewares);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    async close() { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); await vite.close(); storage?.close(); if (dataDir) rmSync(dataDir, { recursive: true, force: true }); }
  };
}

async function withBrowser(runJsTurn, fn, options = {}) {
  const profile = mkdtempSync(join(tmpdir(), "ds4-agui-poc-chrome-"));
  const app = await startPoc(runJsTurn, options);
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: "/usr/bin/google-chrome", headless: true,
      args: ["--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", `--user-data-dir=${profile}`]
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(7000);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.__errors = pageErrors;
    await page.goto(`${app.base}/agui-poc.html`, { waitUntil: "domcontentloaded" });
    await fn(page);
    assert.deepEqual(pageErrors.filter((message) => message !== "WebSocket closed without opened."), []);
  } finally {
    await browser?.close();
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

async function waitForText(page, selector, text) {
  await page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent?.includes(text), {}, { selector, text });
}

test("assistant-ui POC sends a local run, renders a tool card, and preserves UTF-8", { timeout: 60000 }, async () => {
  let calls = 0;
  await withBrowser(async (_input, emit) => {
    calls += 1;
    emit("run_started", {});
    emit("agent_text", { content: "Risposta perché " });
    emit("agent_tool_call", { id: "tool-1", name: "ds4.read_file", arguments: { path: "note/è.md" } });
    emit("agent_tool_result", { id: "tool-1", name: "ds4.read_file", content: "contenuto ✓" });
    emit("agent_done", { finish_reason: "stop", iterations: 1 });
    return { kind: AGENT_RUN_OUTCOME.STREAMED };
  }, async (page) => {
    await waitForText(page, '[data-testid="status"]', "Connesso");
    await page.locator("textarea").fill("Leggi il file");
    await page.locator(".agui-composer button").click();
    await page.waitForSelector('[data-tool="ds4.read_file"]', { timeout: 7000 }).catch(async (cause) => {
      throw new Error(`${cause.message}; page=${await page.$eval("body", (body) => body.innerText)}`);
    });
    await waitForText(page, '[data-testid="status"]', "completato");
    const text = await page.$eval("body", (body) => body.innerText);
    assert.match(text, /Risposta perché/);
    assert.match(text, /contenuto ✓/);
    assert.ok(!text.includes("�"));
    assert.equal(calls, 1);
  });
});

test("durable assistant-ui manages local threads, pages history, imports legacy text, and stays loopback-only", { timeout: 60000 }, async () => {
  let calls = 0;
  await withBrowser(async (_input, emit) => {
    calls += 1;
    emit("run_started", {});
    emit("agent_text", { content: "Risposta persistita" });
    emit("agent_done", { finish_reason: "stop", iterations: 1 });
    return { kind: AGENT_RUN_OUTCOME.STREAMED };
  }, async (page) => {
    page.on("dialog", (dialog) => dialog.accept());
    const externalRequests = [];
    page.on("request", (request) => {
      if (new URL(request.url()).hostname !== "127.0.0.1") externalRequests.push(request.url());
    });
    await waitForText(page, '[data-testid="status"]', "Cronologia locale pronta");
    await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent.trim().includes("Nuova conversazione")).click());
    await waitForText(page, '[data-testid="status"]', "Nuovo thread locale");
    await page.locator(".agui-settings summary").click();
    await page.locator('aside[aria-label="Dots locali"] input').fill("Browser Dot");
    await page.locator('aside[aria-label="Dots locali"] textarea[aria-label="Preset Dot JSON"]').fill(JSON.stringify({ instructions: "Rispondi in modo sintetico", skills: [], profile: { model: "browser-model" } }));
    await page.locator('aside[aria-label="Dots locali"] input[aria-label="Tool read"]').click();
    assert.equal(await page.$('aside[aria-label="Dots locali"] input[aria-label="Tool sage"]'), null);
    await page.evaluate(() => [...document.querySelectorAll('aside[aria-label="Dots locali"] button')].find((button) => button.textContent.trim() === "Crea Dot").click());
    await waitForText(page, "body", "Dot creato");
    assert.equal(await page.$eval('aside[aria-label="Dots locali"] input[aria-label="Tool read"]', (input) => input.checked), true);
    await page.$eval('aside[aria-label="Dots locali"] select', (select) => {
      select.value = [...select.options].find((option) => option.textContent === "Browser Dot · r1").value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.evaluate(() => [...document.querySelectorAll('aside[aria-label="Dots locali"] button')].find((button) => button.textContent.trim() === "Applica preset selezionato").click());
    await waitForText(page, "body", "Browser Dot r1 assegnato");
    await page.locator(".agui-composer textarea").fill("Domanda locale");
    await page.locator(".agui-composer button").click();
    await waitForText(page, "body", "Risposta persistita");
    assert.equal(calls, 1);

    await page.evaluate(() => localStorage.setItem("ds4.session", JSON.stringify({
      fileName: "storico.md",
      messages: [{ id: "legacy-user", role: "user", content: [{ type: "text", text: "Testo storico" }] }]
    })));
    await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Importa ds4.session").click());
    await waitForText(page, '[data-testid="status"]', "Sessione legacy importata");
    await waitForText(page, "body", "Testo storico");
    const exported = new Promise((resolve) => page.on("response", async (response) => {
      if (response.url().includes("/export")) resolve(await response.json());
    }));
    await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Esporta JSON").click());
    assert.equal((await exported).format, "ds4-thread-v1");

    await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Nuova pagina").click());
    await page.locator('aside[aria-label="Pages locali"] .agui-page-form label:nth-of-type(1) input').fill("guida-locale");
    await page.locator('aside[aria-label="Pages locali"] .agui-page-form label:nth-of-type(2) input').fill("Guida locale");
    await page.locator('aside[aria-label="Pages locali"] .agui-page-form textarea').fill("Contenuto da approvare");
    await page.evaluate(() => [...document.querySelectorAll('aside[aria-label="Pages locali"] .agui-page-form button')].at(-1).click());
    await waitForText(page, "body", "Bozza pagina pronta per revisione");
    assert.doesNotMatch(await page.$eval('aside[aria-label="Pages locali"] .agui-page-list', (node) => node.innerText), /Guida locale/);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Approva e applica").click());
    await waitForText(page, "body", "Pagina applicata una volta");
    assert.match(await page.$eval('aside[aria-label="Pages locali"] .agui-page-list', (node) => node.innerText), /Guida locale/);
    await page.evaluate(() => [...document.querySelectorAll('aside[aria-label="Dots locali"] .agui-page-list button')].find((button) => button.textContent.includes("Browser Dot")).click());
    await page.locator('aside[aria-label="Dots locali"] input[aria-label="Page guida-locale"]').click();
    await page.evaluate(() => [...document.querySelectorAll('aside[aria-label="Dots locali"] button')].find((button) => button.textContent.trim() === "Salva nuova revisione").click());
    await waitForText(page, "body", "Dot versionato");
    assert.equal(await page.$eval('aside[aria-label="Dots locali"] input[aria-label="Page guida-locale"]', (input) => input.checked), true);
    assert.deepEqual(externalRequests, []);
    await page.locator(".agui-top-actions .agui-danger").click();
    await waitForText(page, '[data-testid="status"]', "Conversazione eliminata");
    assert.doesNotMatch(await page.$eval("body", (body) => body.innerText), /Testo storico/);
  }, { durable: true });
});

test("assistant-ui Stop aborts the DS4 turn and displays the cancellation state", { timeout: 60000 }, async () => {
  let abortResolve;
  const aborted = new Promise((resolve) => { abortResolve = resolve; });
  await withBrowser(async (_input, emit, signal) => {
    emit("run_started", {});
    emit("agent_text", { content: "Lavoro in corso" });
    if (!signal.aborted) await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    abortResolve();
    return { kind: AGENT_RUN_OUTCOME.STREAMED };
  }, async (page) => {
    await waitForText(page, '[data-testid="status"]', "Connesso");
    await page.locator("textarea").fill("Aspetta");
    await page.locator(".agui-composer button").click();
    await waitForText(page, '[data-testid="status"]', "Richiesta al loop");
    await page.waitForFunction(() => document.querySelector(".agui-composer button")?.textContent?.trim() === "Stop");
    await page.locator(".agui-composer button").click();
    await Promise.race([aborted, new Promise((_, reject) => setTimeout(() => reject(new Error("DS4 turn did not receive abort")), 5000))]);
    await page.waitForFunction(() => document.body.innerText.includes("Esito: cancelled"))
      .catch(async (cause) => { throw new Error(`${cause.message}; body=${await page.$eval("body", (body) => body.innerText)}; meta=${await page.$eval(".agui-meta", (meta) => meta.outerHTML).catch(() => "missing")}`); });
  });
});
