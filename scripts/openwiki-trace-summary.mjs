#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const syncPattern = /prefill sync done (?:tool_round=\d+ )?prompt=(\d+) cached=(\d+) suffix=(\d+) rc=(-?\d+) (\d+(?:\.\d+)?) ms/;
const metricsPattern = /openwiki\.metrics route=(search|read) status=([a-z_]+) latency_ms=(\d+) calls=(\d+) errors=(\d+)/;
const causes = new Set(['session_start', 'compaction']);
const resultNames = new Set([
  'ok', 'disabled', 'bad_argument', 'access_denied', 'timeout', 'cancelled',
  'unavailable', 'protocol_error', 'oversize', 'no_memory', 'unknown',
]);

export function createSummary() {
  return {
    schema: 'ds4-openwiki-trace-summary-v1',
    syncs: { count: 0, cached_total: 0, suffix_total: 0, rc_failures: 0,
      latency_ms_total: 0, latency_ms_max: 0, full_prefills: 0,
      full_prefills_by_cause: { session_start: 0, compaction: 0, unclassified: 0 },
      syncs_by_cause: { session_start: 0, compaction: 0, unclassified: 0 } },
    openwiki: { calls: 0, errors: 0, latency_ms_total: 0,
      by_route: { search: 0, read: 0 }, by_status: {} },
    compactions: 0,
    malformed_records: 0,
  };
}

export function consumeTraceLine(summary, line, state = { nextCause: 'unclassified' }) {
  if (line.includes('kv.sync_cause')) {
    const causeMatch = line.match(/kv\.sync_cause reason=([a-z_]+)/);
    if (!causeMatch || !causes.has(causeMatch[1])) summary.malformed_records++;
    state.nextCause = causeMatch && causes.has(causeMatch[1]) ? causeMatch[1] : 'unclassified';
    if (causeMatch?.[1] === 'compaction') summary.compactions++;
  }

  if (line.includes('prefill sync done')) {
    const match = line.match(syncPattern);
    if (!match) summary.malformed_records++;
    else {
      const cached = Number(match[2]);
      const suffix = Number(match[3]);
      const rc = Number(match[4]);
      const latency = Number(match[5]);
      const cause = state.nextCause;
      summary.syncs.count++;
      summary.syncs.cached_total += cached;
      summary.syncs.suffix_total += suffix;
      summary.syncs.rc_failures += rc === 0 ? 0 : 1;
      summary.syncs.latency_ms_total += latency;
      summary.syncs.latency_ms_max = Math.max(summary.syncs.latency_ms_max, latency);
      summary.syncs.syncs_by_cause[cause]++;
      if (cached === 0 && suffix > 0) {
        summary.syncs.full_prefills++;
        summary.syncs.full_prefills_by_cause[cause]++;
      }
    }
    state.nextCause = 'unclassified';
  }

  if (line.includes('openwiki.metrics')) {
    const match = line.match(metricsPattern);
    if (!match || !resultNames.has(match[2])) summary.malformed_records++;
    else {
      const [, route, status, latency] = match;
      summary.openwiki.calls++;
      summary.openwiki.errors += status === 'ok' ? 0 : 1;
      summary.openwiki.latency_ms_total += Number(latency);
      summary.openwiki.by_route[route]++;
      summary.openwiki.by_status[status] = (summary.openwiki.by_status[status] ?? 0) + 1;
    }
  }
  return state;
}

export async function summarizeTrace(input) {
  const summary = createSummary();
  const state = { nextCause: 'unclassified' };
  const lines = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
  for await (const line of lines) consumeTraceLine(summary, line, state);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = process.argv[2];
  if (!input || process.argv.length !== 3) {
    process.stderr.write('Usage: openwiki-trace-summary.mjs TRACE_FILE\n');
    process.exitCode = 2;
  } else {
    try {
      process.stdout.write(`${JSON.stringify(await summarizeTrace(input), null, 2)}\n`);
    } catch {
      process.stderr.write('Unable to read trace file\n');
      process.exitCode = 1;
    }
  }
}
