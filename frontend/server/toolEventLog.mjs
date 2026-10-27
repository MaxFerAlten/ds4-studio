// P1 of the Proof-to-Claim plan (§12): one event per tool call of the turn,
// written by the dispatcher after the call returns. Text the model writes can
// never add an event, so "<tool> ran" is evidence only when an event says so.
// Digests, not contents (§12.5): an event identifies what ran and what came
// back without keeping either, and lives only as long as the turn.

import { createHash } from "node:crypto";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// Keys sorted at every level: the same arguments always hash the same.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

// A runtime code is the result's own label (LEAN_GOAL_NOT_DISCRIMINATING,
// SAGE_WALL_CLOCK_EXHAUSTED): structure the runtime writes, not prose.
function resultCode(result) {
  const declared = result?.code || result?.verificationFailureCode;
  if (declared) return String(declared);
  const content = String(result?.content || "");
  // A "code=" line names the failure; a leading label may only name the report.
  const field = content.match(/^code=([A-Z][A-Z0-9_]+)$/m)?.[1];
  if (field) return field;
  const first = content.trimStart().split(/\s/, 1)[0];
  return /^[A-Z][A-Z0-9_]{3,}$/.test(first) ? first : null;
}

/**
 * @returns {"success"|"blocked"|"cancelled"|"timeout"|"unavailable"|"error"}
 */
export function toolOutcome(result, { aborted = false } = {}) {
  if (result?.guarded) return "blocked";
  if (aborted) return "cancelled";
  if (!result?.isError) return "success";
  const code = resultCode(result) || "";
  if (/TIMEOUT|WALL_CLOCK/.test(code)) return "timeout";
  if (/UNAVAILABLE|DISABLED|NOT_PREPARED|NOT_INSTALLED/.test(code)) return "unavailable";
  return "error";
}

export class ToolEventLog {
  #events = [];
  #now;

  constructor({ now = Date.now } = {}) {
    this.#now = now;
  }

  /** Records one finished call and returns its event. */
  record({ call, result, startedAt, aborted = false }) {
    const completedAt = this.#now();
    const status = toolOutcome(result, { aborted });
    const event = {
      sequence: this.#events.length + 1,
      callId: String(call?.id ?? ""),
      tool: String(call?.name ?? ""),
      status,
      // The field the attestation check reads (claimGuard.checkToolAttestations).
      ok: status === "success",
      // A success has no code: its leading label only names the report.
      code: status === "success" ? null : resultCode(result),
      durationMs: Math.max(0, completedAt - startedAt),
      inputSha256: sha256(canonicalJson(call?.arguments ?? {})),
      outputSha256: sha256(String(result?.content ?? ""))
    };
    this.#events.push(event);
    return event;
  }

  get events() {
    return this.#events.map((event) => ({ ...event }));
  }

  get length() {
    return this.#events.length;
  }

  /** The event in the shape the client and the export show. */
  static receipt(event) {
    const { sequence, status, code, durationMs, inputSha256, outputSha256 } = event;
    return { sequence, status, code, durationMs, inputSha256, outputSha256 };
  }
}
