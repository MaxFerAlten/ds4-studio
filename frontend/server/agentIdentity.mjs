// WP2 of piano.esecutivo.integrazione.opendots.v2.md (§6.1, §6.2): local owner
// identity, Origin policy and request hashing for the admission layer.
//
// Owner: an opaque id the server mints and signs (HMAC, per-process secret)
// and keeps in an HttpOnly SameSite=Strict cookie.  It is distinct from any
// ds4SessionKey: the owner scopes runs, threads and cancel authority, the
// session key only addresses AgentSessionStore and is never chosen by the
// browser for a server-owned thread.  A missing or forged cookie gets a fresh
// owner; the owner of another browser profile cannot be claimed.
//
// "Local owner" is a single-user, single-process notion (plan §10): it does
// not make the server multi-tenant.

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { AgentAdmissionError } from "./agentAdmission.mjs";

export const OWNER_COOKIE = "ds4_owner";

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    out[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return out;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function hashRequest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function createAgentIdentity({ secret = randomBytes(32), allowedOrigins = [] } = {}) {
  const key = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret));
  const extraOrigins = new Set(allowedOrigins.map((origin) => String(origin).toLowerCase()));

  const sign = (id) => createHmac("sha256", key).update(`owner:${id}`).digest("base64url");

  function verify(value) {
    const [id, mac] = String(value || "").split(".");
    if (!id || !mac || !/^[A-Za-z0-9-]{8,64}$/.test(id)) return null;
    const expected = Buffer.from(sign(id));
    const actual = Buffer.from(mac);
    return expected.length === actual.length && timingSafeEqual(expected, actual) ? id : null;
  }

  // Server-derived opaque ids: stable for the same input, unguessable without
  // the process secret, never a value the client supplied verbatim.
  function derive(kind, ...parts) {
    return `${kind}_${createHmac("sha256", key).update(JSON.stringify([kind, ...parts])).digest("base64url").slice(0, 32)}`;
  }

  // Owner of this request; mints and sets the cookie when absent/invalid.
  function ownerOf(req, res) {
    if (req.ds4Owner) return req.ds4Owner;
    const cookieValue = parseCookies(req.headers?.cookie)[OWNER_COOKIE];
    let ownerId = verify(cookieValue);
    if (!ownerId) {
      ownerId = randomUUID();
      if (res && !res.headersSent) {
        const cookie = `${OWNER_COOKIE}=${ownerId}.${sign(ownerId)}; Path=/; HttpOnly; SameSite=Strict`;
        const previous = res.getHeader?.("Set-Cookie");
        res.setHeader("Set-Cookie", previous ? [].concat(previous, cookie) : cookie);
      }
    }
    req.ds4Owner = `owner-${ownerId}`;
    return req.ds4Owner;
  }

  // Browser requests to mutating endpoints must come from this origin.  A
  // request without Origin and without cross-site Fetch metadata is a local
  // non-browser client (curl, tests, the runtime's own callbacks).
  function originAllowed(req) {
    const origin = req.headers?.origin;
    const site = req.headers?.["sec-fetch-site"];
    if (!origin) return !site || site === "same-origin" || site === "none";
    if (origin === "null") return false;
    const normalized = origin.toLowerCase();
    if (extraOrigins.has(normalized)) return true;
    const host = String(req.headers?.host || "").toLowerCase();
    return Boolean(host) && (normalized === `http://${host}` || normalized === `https://${host}`);
  }

  function requireOrigin(req) {
    if (!originAllowed(req)) throw new AgentAdmissionError("ORIGIN_REJECTED", "cross-origin request rejected", 403);
  }

  // A callback from the local runtime (native agent -> /api/sage/exec): no
  // browser metadata at all and a loopback peer.
  function isLocalRuntimeCallback(req) {
    if (req.headers?.origin || req.headers?.["sec-fetch-site"] || req.headers?.["sec-fetch-mode"]) return false;
    const address = String(req.socket?.remoteAddress || "");
    return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  }

  return Object.freeze({ ownerOf, originAllowed, requireOrigin, isLocalRuntimeCallback, derive });
}
