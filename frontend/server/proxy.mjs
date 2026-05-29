const MAX_PROXY_BODY_BYTES = 64 * 1024 * 1024;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

export async function readRequestBody(req, maxBytes = MAX_PROXY_BODY_BYTES) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > maxBytes) {
      const err = new Error("request body too large");
      err.status = 413;
      throw err;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, length);
}

export function requestHeadersForProxy(req, body) {
  const headers = { ...req.headers };
  for (const header of HOP_BY_HOP_HEADERS) delete headers[header];
  for (const header of String(req.headers.connection || "").split(",")) {
    const key = header.trim().toLowerCase();
    if (key) delete headers[key];
  }
  if (body) headers["content-length"] = String(body.length);
  return headers;
}
