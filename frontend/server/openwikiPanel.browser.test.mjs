import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

const FRONTEND_ROOT = resolve(import.meta.dirname, "..");

test("OpenWiki panel provisions its config, sends the Agent session key, and allows stop during generation", { timeout: 30000 }, async () => {
  const profile = mkdtempSync(join(tmpdir(), "ds4-openwiki-panel-chrome-"));
  const vite = await createServer({
    root: FRONTEND_ROOT,
    configFile: resolve(FRONTEND_ROOT, "vite.config.js"),
    server: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  let browser;
  try {
    await vite.listen();
    const port = vite.httpServer.address().port;
    browser = await puppeteer.launch({
      executablePath: "/usr/bin/google-chrome",
      headless: true,
      args: [
        "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run",
        "--no-default-browser-check", "--disable-background-networking", `--user-data-dir=${profile}`,
      ],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(7000);
    await page.goto(`http://127.0.0.1:${port}/test-fixtures/openwiki-panel.html`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      const calls = [];
      let status = { state: "stopped", enabled: false, pageCount: 0 };
      let finishInit;
      const reply = (body, ok = true, responseStatus = 200) => ({
        ok, status: responseStatus, json: async () => body,
      });
      window.openwikiCalls = calls;
      window.fetch = async (url, options = {}) => {
        const method = options.method || "GET";
        if (url === "/api/openwiki/config" && method === "GET") return reply({
          configured: false, sourcePath: "/tmp/openwiki-source-fixture", workspacePath: "/tmp/openwiki-ui-fixture",
        });
        if (url === "/api/openwiki/status" && method === "GET") return reply({ status: structuredClone(status) });
        if (url === "/api/openwiki/config" && method === "PUT") {
          calls.push({ method, url, body: JSON.parse(options.body) });
          return reply({ sourcePath: JSON.parse(options.body).sourcePath, workspacePath: JSON.parse(options.body).workspacePath, commit: "fixture" });
        }
        if (url === "/api/openwiki/control" && method === "POST") {
          const body = JSON.parse(options.body);
          calls.push({ method, url, body, headers: options.headers });
          if (body.action === "start") {
            status = { state: "ready", enabled: true, pageCount: 0 };
            return reply({ message: "started" });
          }
          if (body.action === "init") {
            status = { state: "running", enabled: true, pageCount: 0, generation: { state: "running", pageCount: 0, totalTextBytes: 0 } };
            return new Promise((resolve) => { finishInit = resolve; });
          }
          if (body.action === "stop") {
            status = { state: "stopped", enabled: false, pageCount: 0 };
            finishInit?.(reply({ ok: false, message: "generation cancelled" }, false, 409));
            return reply({ message: "stopped" });
          }
          return reply({ message: "unexpected action" }, false, 400);
        }
        throw new Error(`Unexpected OpenWiki request: ${method} ${url}`);
      };
      window.mountOpenWikiPanel();
    });

    await page.waitForSelector('[data-agent-id="openwiki-workspace-path"]');
    await page.locator('[data-agent-id="openwiki-workspace-path"]').fill("/tmp/another-fixture");
    await page.locator('[data-agent-id="openwiki-workspace-save"]').click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.includes("Release fixture preparata"));
    assert.deepEqual(await page.evaluate(() => window.openwikiCalls.map((call) => call.body?.action ?? call.method)), ["PUT"]);

    await page.locator('[data-agent-id="openwiki-start"]').click();
    await page.waitForFunction(() => window.openwikiEnabled === true);
    await page.waitForFunction(() => !document.querySelector('[data-agent-id="openwiki-init"]').disabled);
    await page.locator('[data-agent-id="openwiki-init"]').click();
    await page.waitForFunction(() => document.querySelector('[data-agent-id="openwiki-lifecycle"]')?.textContent?.includes("Generazione: running"));
    assert.equal(await page.$eval('[data-agent-id="openwiki-stop"]', (button) => !button.disabled), true);
    await page.locator('[data-agent-id="openwiki-stop"]').click();
    await page.waitForFunction(() => window.openwikiEnabled === false);
    const actions = await page.evaluate(() => window.openwikiCalls.filter((call) => call.url === "/api/openwiki/control").map((call) => call.body.action));
    assert.deepEqual(actions, ["start", "init", "stop"]);
    assert.ok(await page.evaluate(() => window.openwikiCalls.filter((call) => call.url === "/api/openwiki/control")
      .every((call) => call.headers["X-Agent-Session-Key"] === "ui-test-session")));
  } finally {
    await browser?.close();
    await vite.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
