// Abort an upstream fetch when the CLIENT actually goes away.
//
// Bind to res "close" (fires only on a real disconnect, or after res.end)
// and req "aborted" — NOT req "close". In Node 18+ the request
// IncomingMessage emits "close" the instant its body is fully read, long
// before the client leaves; binding the abort there kills a healthy in-flight
// upstream during a slow prefill and surfaces to the client as
// 500 {"error":"This operation was aborted"} (regression seen on large
// "redo entire session" agent requests). res "close" + the !writableEnded
// guard fire only on genuine disconnect and no-op after a normal response.
//
// The wall-clock timeout is a hard backstop for an upstream that never
// responds (e.g. a prefill stall that never yields a first byte). It also
// bounds long native-agent streams; 1h is comfortably above any real turn.
// It is unref'd so the backstop timer never keeps the process alive on its own.
export const PROXY_TIMEOUT_MS = 60 * 60 * 1000;

export function abortOnClientDisconnect(req, res) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("upstream request timed out")), PROXY_TIMEOUT_MS);
  timeout.unref?.();
  const abort = () => controller.abort();
  const abortIfOpen = () => {
    if (!res.writableEnded) abort();
  };
  req.on("aborted", abort);
  res.on("close", abortIfOpen);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      req.off("aborted", abort);
      res.off("close", abortIfOpen);
    }
  };
}
