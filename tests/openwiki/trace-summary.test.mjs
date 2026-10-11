import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { consumeTraceLine, createSummary } from '../../scripts/openwiki-trace-summary.mjs';

const analyzerPath = fileURLToPath(new URL('../../scripts/openwiki-trace-summary.mjs', import.meta.url));

function syntheticTrace(rounds) {
  const lines = [];
  for (let i = 0; i < rounds; i++) {
    let cached = 90;
    let suffix = 10;
    if (i === 0) {
      lines.push('kv.sync_cause reason=session_start');
      cached = 0;
      suffix = 100;
    } else if (i % 10 === 0) {
      lines.push('kv.sync_cause reason=compaction');
      cached = 0;
      suffix = 120;
    }
    lines.push(`prefill sync done tool_round=${i} prompt=${cached + suffix} cached=${cached} suffix=${suffix} rc=0 12.500 ms`);
    lines.push(`openwiki.metrics route=${i % 2 ? 'read' : 'search'} status=ok latency_ms=7 calls=${i + 1} errors=0 query=private-query`);
  }
  return lines;
}

for (const rounds of [10, 50, 100]) {
  test(`summarizes ${rounds} synthetic rounds without retaining request content`, () => {
    const summary = createSummary();
    const state = { nextCause: 'unclassified' };
    const lines = syntheticTrace(rounds);
    for (const line of lines) consumeTraceLine(summary, line, state);
    const expectedCompactions = Math.floor((rounds - 1) / 10);
    assert.equal(summary.syncs.count, rounds);
    assert.equal(summary.openwiki.calls, rounds);
    assert.equal(summary.syncs.rc_failures, 0);
    assert.equal(summary.syncs.full_prefills, 1 + expectedCompactions);
    assert.equal(summary.syncs.full_prefills_by_cause.session_start, 1);
    assert.equal(summary.syncs.full_prefills_by_cause.compaction, expectedCompactions);
    assert.equal(summary.compactions, expectedCompactions);
    assert.equal(summary.malformed_records, 0);
    assert.equal(JSON.stringify(summary).includes('private-query'), false);
  });
}

test('counts malformed metadata and non-compaction full prefill as unclassified', () => {
  const summary = createSummary();
  const state = { nextCause: 'unclassified' };
  consumeTraceLine(summary, 'prefill sync done prompt=broken', state);
  consumeTraceLine(summary, 'prefill sync done prompt=64 cached=0 suffix=64 rc=0 1.000 ms', state);
  consumeTraceLine(summary, 'openwiki.metrics route=search status=timeout latency_ms=2000 calls=1 errors=1', state);
  assert.equal(summary.malformed_records, 1);
  assert.equal(summary.syncs.full_prefills_by_cause.unclassified, 1);
  assert.equal(summary.openwiki.errors, 1);
});

test('CLI streams a trace file and emits counters without raw content', () => {
  const dir = mkdtempSync(join(os.tmpdir(), 'ds4-openwiki-trace-'));
  const trace = join(dir, 'trace.log');
  try {
    writeFileSync(trace, [
      'kv.sync_cause reason=session_start',
      'prefill sync done prompt=100 cached=0 suffix=100 rc=0 2.000 ms',
      'openwiki.metrics route=search status=ok latency_ms=9 calls=1 errors=0 query=secret-value',
    ].join('\n'));
    const output = execFileSync(process.execPath, [analyzerPath, trace], { encoding: 'utf8' });
    const summary = JSON.parse(output);
    assert.equal(summary.syncs.count, 1);
    assert.equal(summary.openwiki.calls, 1);
    assert.equal(output.includes('secret-value'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('malformed sync clears its pending cause before the next valid sync', () => {
  const summary = createSummary();
  const state = { nextCause: 'unclassified' };
  consumeTraceLine(summary, 'kv.sync_cause reason=compaction', state);
  consumeTraceLine(summary, 'prefill sync done prompt=broken', state);
  consumeTraceLine(summary, 'prefill sync done tool_round=2 prompt=64 cached=0 suffix=64 rc=0 1.000 ms', state);
  assert.equal(summary.malformed_records, 1);
  assert.equal(summary.syncs.full_prefills_by_cause.compaction, 0);
  assert.equal(summary.syncs.full_prefills_by_cause.unclassified, 1);
});

test('counts malformed sync cause metadata and safely classifies following sync', () => {
  const summary = createSummary();
  const state = { nextCause: 'unclassified' };
  consumeTraceLine(summary, 'kv.sync_cause reason=unknown_value', state);
  consumeTraceLine(summary, 'prefill sync done tool_round=3 prompt=64 cached=0 suffix=64 rc=0 1.000 ms', state);
  assert.equal(summary.malformed_records, 1);
  assert.equal(summary.syncs.full_prefills_by_cause.unclassified, 1);
});
