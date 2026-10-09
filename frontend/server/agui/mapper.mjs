// WP3 of piano.esecutivo.integrazione.opendots.v2.md (§8.1, ADR-002): DS4
// public events -> AG-UI 1.0 events, for one run.
//
// Pure: no I/O, no clock, no randomness.  The same DS4 event sequence always
// yields the same AG-UI sequence and the same ids, so a duplicate request that
// the admission replays maps to exactly what the first request saw.
//
//   agent_text                 TEXT_MESSAGE_START/CONTENT (boundary synthesized;
//                              a tool call closes the message, the next text
//                              opens a new one with its own messageId)
//   agent_tool_call            TOOL_CALL_START/ARGS/END, args as one canonical
//                              JSON delta (DS4 has complete args, no fake
//                              incremental deltas)
//   agent_tool_result          TOOL_CALL_RESULT + CUSTOM ds4.tool.result
//                              (isError/guarded: a tool error is not a run error)
//   agent_status/usage/...     CUSTOM ds4.* with a versioned, bounded value
//   agent_error                CUSTOM ds4.error, never terminal by itself
//   agent_done                 CUSTOM ds4.finish, never terminal by itself
//   agent_reasoning/debug      dropped (raw reasoning is not public, §8.1)
//   anything else              CUSTOM ds4.unknown (UI fallback)
//
// finish() emits the one terminal (ADR-002.3): every open text message is
// closed first (ADR-002.2), then RUN_FINISHED cancelled | RUN_ERROR |
// RUN_FINISHED success.  Legacy SSE can carry several done/error signals; they
// stay diagnostics and the terminal is decided once, at the end of the turn.

import { canonicalJson } from "../agentIdentity.mjs";

export const AGUI_MAPPER_VERSION = 1;

export const AGUI_LIMITS = Object.freeze({
  customValueBytes: 16 * 1024,
  toolResultBytes: 64 * 1024,
  errorMessageBytes: 2048
});

const CUSTOM_NAMES = Object.freeze({
  agent_status: "ds4.status",
  agent_usage: "ds4.usage",
  agent_warning: "ds4.warning",
  agent_tool_progress: "ds4.tool.progress",
  agent_lean_status: "ds4.verification",
  agent_sage_status: "ds4.verification",
  agent_sage_artifact: "ds4.artifact"
});

// Transport or private signals, never published.
const DROPPED = new Set(["run_started", "agent_reasoning", "agent_debug", "native_forward", "native_response", "native_chunk"]);

function truncateUtf8(text, maxBytes) {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return { text, truncated: false };
  // Cut on a character boundary: never leave half a code point.
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return { text: bytes.subarray(0, end).toString("utf8"), truncated: true };
}

function asText(value) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return canonicalJson(value);
}

function boundedValue(source, data) {
  const value = { v: AGUI_MAPPER_VERSION, source, data: data ?? null };
  const bytes = Buffer.byteLength(JSON.stringify(value));
  if (bytes <= AGUI_LIMITS.customValueBytes) return value;
  return { v: AGUI_MAPPER_VERSION, source, truncated: true, bytes };
}

export function createAguiMapper({ EventType, threadId, runId }) {
  if (!EventType?.RUN_STARTED) throw new TypeError("createAguiMapper: EventType is required");
  let started = false;
  let finished = false;
  let openText = null;
  let textCount = 0;
  let resultCount = 0;
  let firstError = null;
  let done = null;
  const assistant = [];
  const toolIds = new Map();

  const custom = (name, value) => ({ type: EventType.CUSTOM, name, value });

  function closeText() {
    if (!openText) return [];
    const id = openText.id;
    openText = null;
    return [{ type: EventType.TEXT_MESSAGE_END, messageId: id }];
  }

  // DS4 tool ids are per turn ("call_1", ...): scoped by run they stay stable
  // across replay and unique within the thread.  A repeated DS4 id gets the
  // next suffix so two cards never share an id.
  function newToolCallId(ds4Id) {
    const base = `${runId}.t.${String(ds4Id ?? "call").replace(/[^A-Za-z0-9._:@~-]/g, "_")}`;
    let id = base;
    for (let n = 2; [...toolIds.values()].includes(id); n++) id = `${base}.${n}`;
    toolIds.set(ds4Id, id);
    return id;
  }

  function map(type, data) {
    if (finished || DROPPED.has(type)) return [];
    switch (type) {
      case "agent_text": {
        const delta = typeof data?.content === "string" ? data.content : "";
        if (!delta) return [];
        const out = [];
        if (!openText) {
          openText = { id: `${runId}.a${++textCount}`, content: "" };
          assistant.push(openText);
          out.push({ type: EventType.TEXT_MESSAGE_START, messageId: openText.id, role: "assistant" });
        }
        openText.content += delta;
        out.push({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: openText.id, delta });
        return out;
      }
      case "agent_tool_call": {
        const toolCallId = newToolCallId(data?.id);
        const args = asText(data?.arguments) || "{}";
        return [
          ...closeText(),
          { type: EventType.TOOL_CALL_START, toolCallId, toolCallName: String(data?.name || "tool") },
          { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: args },
          { type: EventType.TOOL_CALL_END, toolCallId }
        ];
      }
      case "agent_tool_result": {
        const toolCallId = toolIds.get(data?.id);
        if (!toolCallId) {
          return [custom("ds4.warning", boundedValue(type, { code: "ORPHAN_TOOL_RESULT", name: data?.name ?? null }))];
        }
        const { text, truncated } = truncateUtf8(asText(data?.content), AGUI_LIMITS.toolResultBytes);
        return [
          { type: EventType.TOOL_CALL_RESULT, messageId: `${runId}.r${++resultCount}`, toolCallId, content: text, role: "tool" },
          custom("ds4.tool.result", {
            v: AGUI_MAPPER_VERSION, toolCallId, isError: data?.isError === true, guarded: data?.guarded === true, truncated
          })
        ];
      }
      case "agent_error": {
        const message = truncateUtf8(asText(data?.error) || "agent error", AGUI_LIMITS.errorMessageBytes).text;
        firstError ??= message;
        return [custom("ds4.error", { v: AGUI_MAPPER_VERSION, message })];
      }
      case "agent_done": {
        done ??= { finishReason: data?.finish_reason ?? null };
        return [custom("ds4.finish", {
          v: AGUI_MAPPER_VERSION, finishReason: data?.finish_reason ?? null, iterations: data?.iterations ?? null
        })];
      }
      default:
        if (CUSTOM_NAMES[type]) return [custom(CUSTOM_NAMES[type], boundedValue(type, data))];
        return [custom("ds4.unknown", { v: AGUI_MAPPER_VERSION, source: String(type) })];
    }
  }

  return Object.freeze({
    start() {
      if (started) return [];
      started = true;
      return [{ type: EventType.RUN_STARTED, threadId, runId }];
    },
    map,
    // Assistant text published by this run, in order: the public projection
    // the gateway appends to the thread.
    messages() {
      return assistant.map((m) => Object.freeze({ id: m.id, content: m.content }));
    },
    get finished() {
      return finished;
    },
    // `before` are extra events placed after the closing ones and before the
    // terminal (the thread revision).  Idempotent: a second call returns [].
    finish({ cancelled = false, failure = null, commandOk = null } = {}, before = []) {
      if (finished) return [];
      finished = true;
      const out = [...closeText(), ...before];
      if (cancelled) {
        out.push({ type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: "cancelled" } });
      } else if (failure) {
        out.push({ type: EventType.RUN_ERROR, message: truncateUtf8(String(failure.message || failure), AGUI_LIMITS.errorMessageBytes).text, code: failure.code || "DS4_INTERNAL_ERROR" });
      } else if (commandOk === false) {
        out.push({ type: EventType.RUN_ERROR, message: firstError ?? "DS4 command failed", code: "DS4_COMMAND_FAILED" });
      } else if (done || (commandOk === true && !firstError)) {
        out.push({ type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: "success" }, result: { ds4: { finishReason: done?.finishReason ?? "command" } } });
      } else if (firstError) {
        out.push({ type: EventType.RUN_ERROR, message: firstError, code: "DS4_AGENT_ERROR" });
      } else {
        out.push({ type: EventType.RUN_ERROR, message: "the DS4 turn ended without a terminal signal", code: "DS4_NO_TERMINAL" });
      }
      return out;
    }
  });
}
