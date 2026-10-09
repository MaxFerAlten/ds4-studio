// WP1 of piano.esecutivo.integrazione.opendots.v2.md (§5): the legacy SSE
// transport of POST /api/agent/chat on top of AgentRunService.
//
// Everything HTTP lives here and only here: request fields, SSE headers, the
// keepalive comment, client-disconnect wiring and response termination.  The
// wire contract is the one the legacy UI already parses (event: agent_*\n
// data: <json>\n\n), byte for byte; tests/fixtures/agent-run-parity holds the
// golden recorded on the route before the extraction.
//
// Client-abort wiring keeps the legacy timing: the JS turn starts observing
// the client at "run_started" (where the route used to write the SSE head),
// the native turn at "native_forward" (where it called
// abortOnClientDisconnect).
//
// WP2: `admissionIdentityOf(req, res)` builds the run identity server-side
// (owner cookie, opaque thread derived from the legacy session key, optional
// X-DS4-Run-Id idempotency key); refusals (Origin, reserved key) are answered
// as JSON before any stream.

import { AgentAdmissionError } from "../agentAdmission.mjs";
import { AGENT_RUN_OUTCOME } from "./runService.mjs";

export function createLegacyAgentChatHandler({
  service,
  sessionKeyOf,
  writeCommandSse,
  abortOnClientDisconnect,
  keepaliveMs,
  admissionIdentityOf = null
}) {
  return async function legacyAgentChat(req, res) {
    let admissionIdentity;
    try {
      admissionIdentity = admissionIdentityOf ? admissionIdentityOf(req, res) : undefined;
    } catch (error) {
      if (error instanceof AgentAdmissionError) return res.status(error.status).json({ error: error.message, code: error.code });
      throw error;
    }
    const cancel = new AbortController();
    const abort = () => cancel.abort();
    let nativeWiring = null;
    let aborting = false;

    const emit = (type, data) => {
      if (type === "run_started") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no"
        });
        aborting = true;
        req.on("aborted", abort);
        res.on("close", () => { if (!res.writableEnded) cancel.abort(); });
        // A withheld round (evidence/epistemic block) or a long prefill sends
        // no byte for minutes; clients and proxies with an idle timeout then
        // drop the stream and the server cancels the turn (WP16: undici gave
        // up at 300 s).  An SSE comment keeps the connection alive and is
        // ignored by EventSource.
        const keepalive = setInterval(() => {
          if (!res.writableEnded) res.write(": keepalive\n\n");
        }, keepaliveMs);
        const clearKeepalive = () => clearInterval(keepalive);
        res.once("finish", clearKeepalive);
        res.once("close", clearKeepalive);
        return;
      }
      if (type === "native_forward") {
        // It listens on req "aborted" (client disconnect) and res "close"
        // (socket gone while still writing), both guarded so they don't fire
        // after a normal res.end().
        nativeWiring = abortOnClientDisconnect(req, res);
        nativeWiring.signal.addEventListener(
          "abort",
          () => cancel.abort(nativeWiring.signal.reason),
          { once: true }
        );
        return;
      }
      if (type === "native_response") {
        res.status(data.status);
        data.headers.forEach((value, key) => res.setHeader(key, value));
        return;
      }
      if (type === "native_chunk") {
        res.write(data);
        return;
      }
      if (res.writableEnded) return;
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const outcome = await service.runAgentTurn({
        body: req.body,
        sessionKey: sessionKeyOf(req),
        // Opt-in per request (/debug start in the composer sets the header),
        // so a normal run pays nothing and no server-wide flag can be left on.
        debug: req.get("X-Agent-Debug") === "1",
        requestSignal: req.signal,
        admissionIdentity
      }, emit, cancel.signal);
      switch (outcome?.kind) {
        case AGENT_RUN_OUTCOME.REJECTED:
          return res.status(outcome.status).json(outcome.body);
        case AGENT_RUN_OUTCOME.COMMAND:
          return writeCommandSse(res, outcome.events);
        case AGENT_RUN_OUTCOME.STREAMED:
        case AGENT_RUN_OUTCOME.NATIVE_STREAMED:
          nativeWiring?.cleanup();
          nativeWiring = null;
          if (!res.writableEnded) res.end();
          return;
        default:
          throw new Error(`agent run returned an unknown outcome: ${JSON.stringify(outcome)}`);
      }
    } finally {
      if (aborting) req.off("aborted", abort);
      nativeWiring?.cleanup();
    }
  };
}
