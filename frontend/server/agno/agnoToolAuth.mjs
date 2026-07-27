import crypto from "node:crypto";

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));

  if (left.length !== right.length) return false;

  return crypto.timingSafeEqual(left, right);
}

export class AgnoToolAuthenticator {
  constructor(expectedToken) {
    if (
      typeof expectedToken !== "string" ||
      expectedToken.length < 32
    ) {
      throw new Error(
        "tool bridge token must be at least 32 characters"
      );
    }
    this.expectedToken = expectedToken;
  }

  require(req) {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return {
        ok: false,
        status: 401,
        code: "MISSING_TOOL_BRIDGE_TOKEN"
      };
    }

    const supplied = header.slice(7).trim();

    if (!safeEqual(supplied, this.expectedToken)) {
      return {
        ok: false,
        status: 403,
        code: "INVALID_TOOL_BRIDGE_TOKEN"
      };
    }

    return { ok: true };
  }
}
