// Controlled web page fetch + text extraction. Never uses a shell; enforces an
// SSRF guard, a MIME allowlist, a byte cap, and a character cap. HTML is reduced
// to readable text (script/style/nav stripped, tags removed, entities decoded).

import { assertUrlSafe } from "./ssrfGuard.mjs";

const ALLOWED_MIME = [
  "text/html",
  "text/plain",
  "application/json",
  "application/xml",
  "text/xml",
  "application/xhtml+xml"
];
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const DEFAULT_MAX_CHARS = 12000;

const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " "
};

export function decodeEntities(text) {
  return String(text)
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] || m)
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = Number(code);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    });
}

// Strip HTML to readable text: drop script/style/head/nav/footer blocks, convert
// block tags to newlines, remove remaining tags, decode entities, collapse space.
export function htmlToText(html) {
  let s = String(html || "");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|head|nav|footer|svg|noscript)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)\s*>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t\f\v]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function mimeAllowed(contentType) {
  const base = String(contentType || "").split(";")[0].trim().toLowerCase();
  return ALLOWED_MIME.includes(base);
}

// Fetch one URL and return { url, content, contentType, truncated } or throw.
export async function readPage(url, {
  fetchImpl = fetch,
  signal,
  maxBytes = DEFAULT_MAX_BYTES,
  maxChars = DEFAULT_MAX_CHARS,
  timeoutMs = 12000
} = {}) {
  assertUrlSafe(url);
  const res = await fetchImpl(url, {
    redirect: "follow",
    signal: signal ?? AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "ds4-studio-research/1.0", Accept: ALLOWED_MIME.join(",") }
  });
  if (!res.ok) {
    throw Object.assign(new Error(`page fetch HTTP ${res.status}`), { status: 502 });
  }
  const contentType = res.headers.get("content-type") || "";
  if (!mimeAllowed(contentType)) {
    throw Object.assign(new Error(`blocked content-type: ${contentType || "unknown"}`), { status: 415 });
  }
  // Read the body with a hard byte cap.
  const raw = await res.text();
  let truncated = false;
  let body = raw;
  if (Buffer.byteLength(body, "utf8") > maxBytes) {
    body = body.slice(0, maxBytes);
    truncated = true;
  }
  const base = contentType.split(";")[0].trim().toLowerCase();
  let text = base === "text/html" || base === "application/xhtml+xml" ? htmlToText(body) : body.trim();
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    truncated = true;
  }
  return { url, content: text, contentType: base, truncated };
}

// Read a page, returning null on any failure (used as best-effort enrichment).
export async function tryReadPage(url, options = {}) {
  try {
    return await readPage(url, options);
  } catch {
    return null;
  }
}
