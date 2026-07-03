/**
 * Web Search Tool — headless browser integration for web searches in Chat Mode.
 * Uses puppeteer-core with the locally installed Chrome browser.
 *
 * Provides two tools, both direct ports of ds4-agent (ds4_web.c):
 *   - web_search: google_search — search Google, return compact Markdown links
 *   - web_read:   visit_page   — open a URL, scroll lazy content in, return Markdown
 *
 * Google bot-blocks headless traffic (sends it to a /sorry CAPTCHA wall), so
 * we run a *visible* browser with a persistent user profile and strip
 * puppeteer's automation tells — exactly what the C agent's raw CDP launch
 * does — which Google serves normally. The consent-click / scroll / extraction
 * JS below are copied from ds4_web.c (web_click_google_consent_js,
 * web_scroll_dynamic_page, web_extract_search_js, web_extract_page_js).
 *
 * Both tools produce output suitable for compression via toolOutputCompressor.
 */

import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const CHROME_PATH = "/usr/bin/google-chrome";
// Headful Chrome on a virtual X display: Google bot-blocks true headless, but a
// full Chrome rendering to Xvfb is indistinguishable from desktop — and there's
// no visible window. Falls back to the real $DISPLAY if Xvfb isn't installed.
const XVFB_DISPLAY = ":99";
// ponytail: own profile dir, not ds4-agent's ~/.ds4/browser — Chrome locks a
// user-data-dir to one process; sharing it clashes if the C agent runs too.
// add when a shared, already-consented profile is actually wanted.
// In test mode use a temp dir to avoid clashes with running instances.
const PROFILE_DIR = process.env.NODE_ENV === "test"
  ? path.join(os.tmpdir(), `ds4-browser-test-${process.pid}`)
  : path.join(os.homedir(), ".ds4", "browser-frontend");
const BROWSER_TIMEOUT = 30000;
const PAGE_TIMEOUT = 15000;

let browserSingleton = null;
let browserRefCount = 0;
let xvfbProc = null;

// Bring up an invisible Xvfb display (once) and return it; on any failure fall
// back to the real $DISPLAY so the offscreen-window flags still hide the window.
async function ensureDisplay() {
  const sock = `/tmp/.X11-unix/X${XVFB_DISPLAY.slice(1)}`;
  if (existsSync(sock)) return XVFB_DISPLAY; // already up (ours or external)
  if (spawnSync("which", ["Xvfb"]).status !== 0) return process.env.DISPLAY || ":0";
  xvfbProc = spawn("Xvfb", [XVFB_DISPLAY, "-screen", "0", "1280x1024x24", "-nolisten", "tcp"], {
    detached: true,
    stdio: "ignore"
  });
  xvfbProc.unref();
  for (let i = 0; i < 50; i++) {
    if (existsSync(sock)) return XVFB_DISPLAY;
    await new Promise((r) => setTimeout(r, 100));
  }
  return process.env.DISPLAY || ":0";
}

async function getBrowser() {
  if (browserSingleton && browserSingleton.connected) {
    browserRefCount++;
    return browserSingleton;
  }
  const display = await ensureDisplay();
  const puppeteer = await import("puppeteer-core");
  browserSingleton = await puppeteer.launch({
    executablePath: CHROME_PATH,
    // Headful + persistent profile, copied from ds4-agent (ds4_web.c:1023).
    // Headless Chrome gets sent to Google's /sorry CAPTCHA wall; a real Chrome
    // (here on a virtual Xvfb display) is served normally. env.DISPLAY points
    // Chrome at the invisible display so no window ever appears.
    // In test mode use Chrome 149+'s new headless mode (no display needed).
    headless: process.env.NODE_ENV === "test" ? "new" : false,
    env: { ...process.env, DISPLAY: display },
    userDataDir: PROFILE_DIR,
    // Strip puppeteer's bot tells so Chrome looks like ds4-agent's raw CDP
    // launch: --enable-automation + navigator.webdriver are what Google
    // fingerprints to send us to the /sorry CAPTCHA wall.
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      // Headful is required (Google /sorry-blocks headless even with the
      // automation flags stripped), but the window doesn't need to be seen:
      // park it far offscreen so the user never gets a flashing Chrome window.
      "--window-position=-32000,-32000",
      "--window-size=1280,1000",
      // ds4-agent's exact flag set (web_spawn_chrome):
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--password-store=basic",
      "--mute-audio"
    ],
    timeout: BROWSER_TIMEOUT
  });
  browserRefCount = 1;
  return browserSingleton;
}

async function releaseBrowser() {
  browserRefCount--;
  if (browserRefCount <= 0 && browserSingleton) {
    await browserSingleton.close().catch(() => {});
    browserSingleton = null;
    browserRefCount = 0;
    // Clean up temp profile dir in test mode
    if (process.env.NODE_ENV === "test") {
      try { rmSync(PROFILE_DIR, { recursive: true, force: true }); } catch {}
    }
  }
}

// Copied from ds4_web.c web_click_google_consent_js: dismiss Google's cookie
// consent interstitial so the real results render.
function clickGoogleConsent() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const pats = [/accept all/i, /i agree/i, /agree/i, /accetta tutto/i, /tout accepter/i, /aceptar todo/i, /alle akzeptieren/i];
  const els = [...document.querySelectorAll("button,[role=button],input[type=submit],a")];
  for (const el of els) {
    const t = clean(el.innerText || el.value || el.textContent);
    if (!t) continue;
    if (pats.some((p) => p.test(t))) { el.click(); return "clicked " + t; }
  }
  return "";
}

// Copied from ds4_web.c web_extract_search_js: build compact Markdown from the
// Google SERP — unwrap /url?q= redirects, drop google-owned hosts, dedup,
// cap at 20 links, then a 1200-char text snapshot.
function extractSearchResults() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const esc = (s) => clean(s).replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]").replace(/\n/g, " ");
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.display !== "none" && st.visibility !== "hidden" && st.opacity !== "0";
  };
  const bad = (h) => /(^|\.)google\./.test(h) || /(^|\.)gstatic\./.test(h) || /(^|\.)googleusercontent\./.test(h);
  const lines = ["# Google search results", "", `URL: ${location.href}`, "", "## Visible links"];
  const seen = new Set();
  for (const a of document.querySelectorAll("a[href]")) {
    if (!visible(a)) continue;
    let href = a.href || "";
    try { const u = new URL(href); if (u.pathname === "/url" && u.searchParams.get("q")) href = u.searchParams.get("q"); } catch { /* keep href */ }
    let u;
    try { u = new URL(href); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    if (bad(u.hostname)) continue;
    const text = esc(a.innerText || a.textContent);
    if (text.length < 3) continue;
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    lines.push(`- [${text.slice(0, 180)}](${u.href})`);
    if (seen.size >= 20) break;
  }
  lines.push("", "## Text snapshot", clean(document.body.innerText).slice(0, 1200));
  return lines.join("\n");
}

// Only news-intent queries want the Google News block. Applying it to every query
// poisoned ordinary searches: News RSS is "most recent first", so it changed on
// every call (the answer looked fabricated / "always different") and injected
// irrelevant recent news for non-news queries like "best sites to publish papers".
export function isNewsQuery(query = "") {
  return /\b(news|notizi[ae]|headline|breaking|cronaca)\b|\b(ultim[aeio]|latest|recent|today|oggi|stamani|stasera|aggiornament|updates?)\b/i.test(query);
}

/**
 * Real, dated news headlines from Google News RSS (plain fetch, no browser).
 * The Google SERP for a news query returns only news-site homepages, so the
 * model answers "go check these sites" instead of listing the news. RSS gives
 * actual titles + dates + sources + links, which is what a news query wants.
 * @returns {Promise<Array<{title:string,link:string,source:string,date:string}>>}
 */
async function fetchNewsHeadlines(query, max) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=it&gl=IT&ceid=IT:it`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(PAGE_TIMEOUT)
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const clean = (s) => (s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
    return [...xml.matchAll(/<item>(.*?)<\/item>/gs)]
      .slice(0, max)
      .map((m) => {
        const pick = (re) => clean(m[1].match(re)?.[1]);
        return {
          title: pick(/<title>(.*?)<\/title>/s),
          link: pick(/<link>(.*?)<\/link>/s),
          source: pick(/<source[^>]*>(.*?)<\/source>/s),
          date: pick(/<pubDate>(.*?)<\/pubDate>/s)
        };
      })
      .filter((n) => n.title);
  } catch {
    return [];
  }
}

// Clicking the Google consent button triggers a navigation, which detaches the
// frame mid-evaluate. Retry page-context evals on those transient races.
async function evalResilient(page, fn, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      return await page.evaluate(fn);
    } catch (err) {
      const transient = /detached|execution context was destroyed|cannot find context|target closed/i.test(err.message || "");
      if (!transient || i >= tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}

async function dismissGoogleConsent(page) {
  const clicked = await evalResilient(page, clickGoogleConsent);
  if (clicked) {
    // ds4-agent waits 1500ms then re-waits for the page to settle.
    await new Promise((r) => setTimeout(r, 1500));
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT }).catch(() => {});
  }
}

/**
 * Search Google and return compact Markdown links + a text snapshot.
 * Direct port of ds4_web_google_search (ds4_web.c:1353).
 * @param {string} query - Search query
 * @returns {Promise<string>} Formatted Markdown result string
 */
export async function webSearch(query) {
  const { validateSearchQuery } = await import("./searchQueryGuard.mjs");
  const validation = validateSearchQuery(query);

  if (!validation.ok) {
    return `web_search blocked: ${validation.reason}`;
  }

  query = validation.query;

  // News-intent queries only: dated headlines first (Google News RSS, plain fetch),
  // since the browser SERP for a news query just yields news-site homepages. For
  // ordinary queries the changing RSS feed is noise, so skip it.
  const news = isNewsQuery(query) ? await fetchNewsHeadlines(query, 10) : [];

  const browser = await getBrowser();
  const page = await browser.newPage();
  let serp = "";

  try {
    // Pre-seed Google's consent cookie so EU traffic skips the consent.google.com
    // interstitial entirely — clicking through it races a redirect chain that
    // detaches the frame mid-extract. dismissGoogleConsent stays as a fallback.
    await page.setCookie({ name: "CONSENT", value: "YES+", domain: ".google.com", path: "/" });
    await page.goto(
      `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT }
    );
    // Google self-redirects /search once on first load (consent-cookie bounce);
    // evaluating mid-redirect detaches the frame. Let the network settle first.
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => {});
    await dismissGoogleConsent(page);
    serp = await evalResilient(page, extractSearchResults);
  } catch (err) {
    serp = `web_search: failed to search "${query}": ${err.message}`;
  } finally {
    await page.close().catch(() => {});
    await releaseBrowser();
  }

  if (!news.length) return serp;
  const newsBlock = "# Recent news (Google News, most recent first)\n\n" +
    news.map((n, i) =>
      `${i + 1}. ${n.title}${n.date ? ` (${n.date})` : ""}\n   URL: ${n.link}\n   ${n.source}`
    ).join("\n\n");
  return `${newsBlock}\n\n${serp}`;
}

// Copied from ds4_web.c web_scroll_dynamic_page: scroll the page in steps so
// lazy/infinite content loads, stopping once it stops growing or hits bottom.
// Returns a short status string. Runs in page context, returns a Promise.
function scrollDynamicPage() {
  return new Promise((resolve) => {
    const root = () => document.scrollingElement || document.documentElement || document.body;
    const blockSel = 'h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,td,th,[id="content-text"],[class*="comment-body"],[class*="comment-content"],[data-testid*="comment-text"]';
    const lazySel = '[onscroll],[loading="lazy"],[data-src],[data-lazy],[class*="lazy"],[class*="infinite"],[class*="virtual"],[role="feed"],[id*="comment"],[class*="comment"],[data-testid*="comment"]';
    const hookCount = () => {
      let n = 0;
      try { if (window.onscroll) n++; if (document.onscroll) n++; if (document.body && document.body.onscroll) n++; } catch (e) { /* ignore */ }
      try { if (typeof getEventListeners === "function") { for (const o of [window, document, document.body]) { if (!o) continue; const ev = getEventListeners(o); if (ev && ev.scroll) n += ev.scroll.length; } } } catch (e) { /* ignore */ }
      try { n += document.querySelectorAll(lazySel).length; } catch (e) { /* ignore */ }
      return n;
    };
    const metrics = () => {
      const r = root();
      return {
        height: r ? r.scrollHeight : 0,
        view: innerHeight || 900,
        y: scrollY || (r && r.scrollTop) || 0,
        text: ((document.body && document.body.innerText) || "").length,
        links: document.links ? document.links.length : 0,
        blocks: document.body ? document.body.querySelectorAll(blockSel).length : 0,
        hooks: hookCount()
      };
    };
    const sig = (m) => [m.height, m.text, m.links, m.blocks].join("|");
    const grew = (a, b) => b.height > a.height + 20 || b.text > a.text + 200 || b.links > a.links + 2 || b.blocks > a.blocks + 2;
    const scrollOnce = () => {
      const r = root();
      if (!r) return;
      const h = Math.max(700, Math.floor((innerHeight || 900) * 0.85));
      window.scrollTo(0, Math.min(r.scrollHeight, (scrollY || r.scrollTop || 0) + h));
    };
    let last = metrics(), lastSig = sig(last), same = 0, steps = 0;
    const scrollable = last.height > last.view * 1.35;
    if (!scrollable || last.hooks === 0) { resolve("scroll skipped hooks=" + last.hooks + " text=" + last.text); return; }
    const tick = () => {
      if (steps >= 28) { resolve("scrolled " + steps + " text=" + last.text); return; }
      const before = last;
      scrollOnce(); steps++;
      setTimeout(() => {
        const now = metrics(), nowSig = sig(now);
        if (nowSig === lastSig) same++; else same = 0;
        const loaded = grew(before, now);
        last = now; lastSig = nowSig;
        if (steps === 1 && !loaded) { resolve("scroll probe unchanged text=" + now.text); return; }
        const atBottom = now.y + now.view + 20 >= now.height;
        if (same >= 4 || (atBottom && same >= 1)) { resolve("scrolled " + steps + " text=" + now.text); return; }
        tick();
      }, 900);
    };
    tick();
  });
}

// Copied from ds4_web.c web_extract_page_js: render the page as Markdown —
// title, content blocks (headings/paragraphs/lists/pre/quotes/cells/comments),
// then up to 80 visible links.
function extractPageContent() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const esc = (s) => clean(s).replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]").replace(/\n/g, " ");
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.display !== "none" && st.visibility !== "hidden" && st.opacity !== "0";
  };
  const inline = (n) => {
    if (!n) return "";
    if (n.nodeType === 3) return n.nodeValue;
    if (n.nodeType !== 1) return "";
    const el = n;
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "NOSCRIPT") return "";
    if (el.tagName === "A") { const t = esc(el.innerText || el.textContent); const h = el.href || ""; return t && h ? `[${t}](${h})` : t; }
    if (el.tagName === "CODE") return "`" + clean(el.innerText || el.textContent).replace(/`/g, "\\`") + "`";
    return [...el.childNodes].map(inline).join("");
  };
  const lines = [`# ${clean(document.title) || location.href}`, "", `URL: ${location.href}`, "", "## Content"];
  const blocks = [...document.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,td,th,[id="content-text"],[class*="comment-body"],[class*="comment-content"],[data-testid*="comment-text"]')];
  const seen = new Set();
  for (const el of blocks) {
    if (!visible(el)) continue;
    let s = ""; const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) { s = "#".repeat(Number(tag[1])) + " " + inline(el); }
    else if (tag === "LI") { s = "- " + inline(el); }
    else if (tag === "PRE") { s = "```\n" + (el.innerText || el.textContent || "").trimEnd() + "\n```"; }
    else if (tag === "BLOCKQUOTE") { s = "> " + clean(el.innerText || el.textContent); }
    else { s = inline(el); }
    s = s.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    lines.push("", s);
    if (lines.join("\n").length > 900000) { lines.push("", "[Content truncated by browser extractor.]"); break; }
  }
  lines.push("", "## Visible links");
  let n = 0; const linkSeen = new Set();
  for (const a of document.querySelectorAll("a[href]")) {
    if (!visible(a)) continue;
    const t = esc(a.innerText || a.textContent);
    if (t.length < 3) continue;
    let u;
    try { u = new URL(a.href); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || linkSeen.has(u.href)) continue;
    linkSeen.add(u.href);
    lines.push(`- [${t.slice(0, 160)}](${u.href})`);
    if (++n >= 80) break;
  }
  return lines.join("\n");
}

/**
 * Open a URL in the browser, scroll lazy content in, return Markdown.
 * Direct port of ds4_web_visit_page (ds4_web.c:1374, dynamic_scroll=true).
 * @param {string} url - URL to read
 * @returns {Promise<string>} Markdown page content
 */
export async function webReadPage(url) {
  if (!url || typeof url !== "string") return "web_read: url is required";

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => {});
    await dismissGoogleConsent(page);
    await evalResilient(page, scrollDynamicPage);
    const text = await evalResilient(page, extractPageContent);
    return text && text.trim() ? text : `web_read: no content extracted from ${url}`;
  } catch (err) {
    return `web_read: failed to read ${url}: ${err.message}`;
  } finally {
    await page.close().catch(() => {});
    await releaseBrowser();
  }
}
