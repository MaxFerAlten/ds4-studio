/**
 * DS4 Studio evolution playground fixture.
 *
 * This module is intentionally small and inert. It exists so the Evolution
 * playground has a real mutable target file for demo runs and tests.
 */

export const shippingExample = Object.freeze({
  service: "shipping",
  supportedZones: ["IT", "EU"],
  extraFees: Object.freeze({
    IT: 0,
    EU: 0
  })
});

export function getShippingFee(zone) {
  return shippingExample.extraFees[zone] ?? null;
}

function normalizedHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return null;
  const normalized = Object.create(null);
  for (const [name, value] of Object.entries(headers)) {
    if (typeof name !== "string" || typeof value !== "string") continue;
    normalized[name.toLowerCase()] = value.trim();
  }
  return normalized;
}

/**
 * Validate the minimal security contract used by the Evolution fixture.
 * This function is deterministic and has no import-time or network side effects.
 * @param {Record<string, string>|null|undefined} headers
 * @returns {{valid: boolean, reason: string}}
 */
export function validateRequest(headers = {}) {
  const normalized = normalizedHeaders(headers);
  if (!normalized) return Object.freeze({ valid: false, reason: "headers must be an object" });

  const contentType = normalized["content-type"] ?? "";
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return Object.freeze({ valid: false, reason: "Content-Type must be application/json" });
  }

  const authorization = normalized.authorization ?? "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return Object.freeze({ valid: false, reason: "Authorization must use a non-empty Bearer token" });
  }

  return Object.freeze({ valid: true, reason: "" });
}
