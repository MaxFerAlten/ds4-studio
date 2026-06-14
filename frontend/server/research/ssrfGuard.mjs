// SSRF guard for outbound web fetches. Rejects non-http(s) schemes and URLs
// that resolve to loopback/private/link-local/cloud-metadata targets by literal
// host inspection. This is a defense-in-depth check on the URL string; it does
// not perform DNS resolution (a hostname pointing at a private IP would pass the
// literal check) — the page reader additionally enforces byte/MIME limits.

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data"
]);

function isPrivateIPv4(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (m.slice(1).some((o) => Number(o) > 255)) return true; // malformed → treat as blocked
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local / cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  return false;
}

function isPrivateIPv6(host) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true; // loopback / unspecified
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique local fc00::/7
  if (h.startsWith("fe80")) return true; // link-local
  if (h.startsWith("::ffff:")) return isPrivateIPv4(h.slice(7)); // IPv4-mapped
  return false;
}

// Returns { ok, reason }. ok=true means the URL is safe to fetch.
export function checkUrlSafe(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `blocked scheme: ${url.protocol}` };
  }
  const host = url.hostname.toLowerCase();
  if (!host) return { ok: false, reason: "empty host" };
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, reason: `blocked host: ${host}` };
  if (host.endsWith(".localhost")) return { ok: false, reason: "blocked host: .localhost" };
  if (isPrivateIPv4(host)) return { ok: false, reason: `private IPv4: ${host}` };
  if (host.includes(":") || host.startsWith("[")) {
    if (isPrivateIPv6(host)) return { ok: false, reason: `private IPv6: ${host}` };
  }
  return { ok: true, reason: "" };
}

export function assertUrlSafe(rawUrl) {
  const { ok, reason } = checkUrlSafe(rawUrl);
  if (!ok) throw Object.assign(new Error(`SSRF blocked: ${reason} (${rawUrl})`), { status: 400 });
}
