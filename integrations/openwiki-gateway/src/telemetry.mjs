/** Content-free process counters. Never pass request data, paths or MCP output. */
export function createTelemetry() {
  const counters = { requests: 0, success: 0, rejected: 0, upstreamFailure: 0, cancelled: 0 };
  return Object.freeze({
    record(name) {
      if (Object.hasOwn(counters, name)) counters[name] += 1;
    },
    snapshot() { return Object.freeze({ ...counters }); },
  });
}
