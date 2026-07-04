import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";

const CHROME_PATH = "/usr/bin/google-chrome";
let _browser = null;
let _profileDir = null;

export function getChromePath() {
  return existsSync(CHROME_PATH) ? CHROME_PATH : null;
}

export async function launchBrowser(headless = "new") {
  if (_browser) return _browser;
  const chromePath = getChromePath();
  if (!chromePath) throw new Error(`Chrome not found at ${CHROME_PATH}`);

  _profileDir = mkdtempSync("/tmp/ds4-pa-fixture-");

  const { launch } = await import("puppeteer-core");
  _browser = await launch({
    executablePath: chromePath,
    headless,
    args: [
      `--user-data-dir=${_profileDir}`,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-debugging-port=0"
    ]
  });
  return _browser;
}

export async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch {}
    _browser = null;
  }
  if (_profileDir) {
    try { rmSync(_profileDir, { recursive: true, force: true }); } catch {}
    _profileDir = null;
  }
}

export async function withPage(url, fn) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

export async function takeSnapshot(page, includeControls = false) {
  const title = await page.title().catch(() => "");
  const url = page.url();
  const visibleText = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) || "").catch(() => "");
  const controls = includeControls
    ? await page.evaluate(() => {
        const tags = "button, input, select, textarea, a, [role=button], [role=tab], [data-agent-id]";
        return Array.from(document.querySelectorAll(tags))
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .map((el, i) => ({
            index: i + 1,
            tag: el.tagName.toLowerCase(),
            type: el.type || "",
            text: el.textContent?.trim()?.slice(0, 80) || "",
            id: el.id || "",
            agentId: el.getAttribute("data-agent-id") || "",
            enabled: !el.disabled
          }));
      }).catch(() => [])
    : [];

  const lines = [`URL: ${url}`];
  if (title) lines.push(`Title: ${title}`);
  lines.push("");

  if (controls.length > 0) {
    lines.push("Visible controls:");
    for (const c of controls) {
      const label = c.agentId || c.id || c.text || `${c.tag}[${c.type}]`;
      const enabled = c.enabled ? `enabled=true` : `enabled=false`;
      lines.push(`[${c.index}] ${c.tag} data-agent-id="${c.agentId}" text="${c.text.slice(0, 60)}" ${enabled}`);
    }
  } else {
    lines.push("(none requested)");
  }

  if (visibleText) {
    lines.push("");
    lines.push("Visible text:");
    lines.push(visibleText.slice(0, 2000));
  }

  return lines.join("\n");
}

export async function executeAction(page, action, target, value) {
  switch (action) {
    case "click": {
      const els = await findElements(page, target);
      if (!els.length) return { ok: false, error: `Target not found: ${target}` };
      await els[0].click();
      await new Promise((r) => setTimeout(r, 300));
      return { ok: true };
    }
    case "input": {
      const els = await findElements(page, target, "input, textarea, [contenteditable]");
      if (!els.length) return { ok: false, error: `Input target not found: ${target}` };
      await els[0].click();
      await els[0].fill(value || "");
      return { ok: true };
    }
    case "select": {
      const els = await findElements(page, target, "select");
      if (!els.length) return { ok: false, error: `Select target not found: ${target}` };
      await els[0].select(value || "");
      return { ok: true };
    }
    case "scroll": {
      await page.evaluate((t) => {
        const el = t ? document.querySelector(t) : null;
        if (el) el.scrollIntoView({ behavior: "instant", block: "center" });
        else window.scrollBy(0, 500);
      }, target);
      return { ok: true };
    }
    case "wait":
      await new Promise((r) => setTimeout(r, parseInt(value) || 1000));
      return { ok: true };
    default:
      return { ok: false, error: `Unknown action: ${action}` };
  }
}

async function findElements(page, target, scope) {
  const selectors = [
    `[data-agent-id="${target}"]`,
    `[data-agent-id*="${target}"]`,
    `#${target}`,
    `[name="${target}"]`,
    `[aria-label="${target}"]`,
    `button:has-text("${target}")`,
    `a:has-text("${target}")`,
    target
  ];
  for (const sel of selectors) {
    try {
      const els = await page.$$(sel);
      if (els.length) return els;
    } catch {}
  }
  return [];
}
