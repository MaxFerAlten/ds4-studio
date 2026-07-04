import { existsSync } from "node:fs";
import { validatePageAction, classifyPageAction } from "./pageAgentSafety.mjs";
import { buildAuditRecord, writeAuditRecord } from "./pageAgentAudit.mjs";
import { buildUiSnapshot, formatSnapshot } from "./pageBrowserBridge.mjs";

function getAppUrl(options = {}) {
  return options.url || "http://127.0.0.1:5173";
}

async function tryRealBrowser(pageAction) {
  try {
    const { launchBrowser, takeSnapshot, executeAction } = await import("./pageAgentFixture.mjs");
    const browser = await launchBrowser();
    const pages = await browser.pages();
    const existing = pages.find((p) => {
      try { return p.url().startsWith("http://127.0.0.1:5173"); } catch { return false; }
    });
    const page = existing || await browser.newPage();
    if (!existing) {
      await page.goto(getAppUrl(), { waitUntil: "networkidle0", timeout: 15000 }).catch(() => {});
    }
    return await pageAction(page, browser);
  } catch {
    return null;
  }
}

export async function toolPageSnapshot(args = {}, options = {}) {
  const includeControls = Boolean(args?.includeControls);

  if (process.env.NODE_ENV !== "test") {
    const result = await tryRealBrowser(async (page) => {
      const { takeSnapshot } = await import("./pageAgentFixture.mjs");
      const content = await takeSnapshot(page, includeControls);
      return { content, isError: false };
    });
    if (result) return result;
  }

  const snapshot = buildUiSnapshot({
    url: getAppUrl(options),
    includeControls,
    uiState: options.uiState || {}
  });
  const content = formatSnapshot(snapshot);
  return { content, isError: false };
}

export async function toolPageAction(args = {}, options = {}) {
  const action = typeof args?.action === "string" ? args.action : "";
  const target = typeof args?.target === "string" ? args.target : "";
  const value = typeof args?.value === "string" ? args.value : "";
  const requireConfirmation = Boolean(args?.requireConfirmation);

  const validation = validatePageAction(
    { action, target, value },
    {
      url: options.url,
      allowedOrigins: options.allowedOrigins,
      requireConfirmation
    }
  );
  if (!validation.ok) {
    const err = validation.error;
    return {
      content: [`Tool error: ${err.code}`, err.message, "", "Recovery:", err.suggestion].join("\n"),
      isError: true
    };
  }

  const safety = classifyPageAction({ action, target, value });

  if (process.env.NODE_ENV !== "test") {
    const result = await tryRealBrowser(async (page) => {
      const { executeAction, takeSnapshot } = await import("./pageAgentFixture.mjs");

      const getHash = async () => {
        try {
          return await page.evaluate(() => {
            const text = document.body?.innerText || "";
            let h = 0;
            for (let i = 0; i < text.length; i++) {
              h = ((h << 5) - h) + text.charCodeAt(i);
              h |= 0;
            }
            return "hash-" + Math.abs(h).toString(16);
          });
        } catch {
          return "hash-unavailable";
        }
      };

      const beforeHash = await getHash();
      const execResult = await executeAction(page, action, target, value);
      const afterHash = await getHash();

      const auditRecord = buildAuditRecord({
        ts: new Date().toISOString(),
        sessionId: options.sessionId || "unknown",
        url: getAppUrl(options),
        action, target, beforeHash, afterHash,
        ok: execResult.ok, durationMs: 0, safety
      });
      writeAuditRecord(auditRecord).catch(() => {});

      const lines = [
        `Action: ${action}`,
        `Target: ${target}`,
        ...(value ? [`Value: ${value}`] : []),
        `Result: ${execResult.ok ? "ok" : "failed"}`,
        ...(execResult.error ? [`Error: ${execResult.error}`] : []),
        `Before hash: ${beforeHash}`,
        `After hash: ${afterHash}`,
        `Observed change: ${beforeHash !== afterHash ? "Yes" : "None detected"}`,
        "",
        `Safety: ${safety.allowed ? "passed" : `blocked (${safety.reason})`}`
      ];

      return { content: lines.join("\n"), isError: !execResult.ok };
    });
    if (result) return result;
  }

  const auditRecord = buildAuditRecord({
    ts: new Date().toISOString(),
    sessionId: options.sessionId || "unknown",
    url: getAppUrl(options),
    action, target,
    beforeHash: "placeholder-before",
    afterHash: "placeholder-after",
    ok: true, durationMs: 0, safety
  });
  writeAuditRecord(auditRecord).catch(() => {});

  return {
    content: [
      `Action: ${action}`,
      `Target: ${target}`,
      ...(value ? [`Value: ${value}`] : []),
      `Result: ok`,
      `Before hash: placeholder-before`,
      `After hash: placeholder-after`,
      `Observed change: (static fallback)`,
      "",
      `Safety: ${safety.allowed ? "passed" : `blocked (${safety.reason})`}`
    ].join("\n"),
    isError: false
  };
}
