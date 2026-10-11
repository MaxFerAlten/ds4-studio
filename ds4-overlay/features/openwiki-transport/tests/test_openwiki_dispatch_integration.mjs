import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sourcePath = process.argv[2];
assert.ok(sourcePath, 'expected composed studio/ds4_agent.c path');
const source = readFileSync(sourcePath, 'utf8');
assert.match(source, /c\.openwiki_config_valid = ds4_ow_config_from_env/);
assert.match(source, /c\.openwiki_enabled = c\.openwiki_config_valid/);

const telemetryStart = source.indexOf('static atomic_uint_fast64_t agent_openwiki_calls');
const adapterStart = source.indexOf('static char *agent_tool_openwiki(');
const dispatchStart = source.indexOf('static char *agent_execute_tool_call(', adapterStart);
assert.ok(telemetryStart >= 0 && adapterStart > telemetryStart && dispatchStart > adapterStart,
  'OpenWiki adapter must precede the native dispatcher');
const telemetry = source.slice(telemetryStart, adapterStart);
const adapter = source.slice(adapterStart, dispatchStart);
const dispatchEnd = source.indexOf('static char *agent_execute_tool_calls(', dispatchStart);
assert.ok(dispatchEnd > dispatchStart, 'native tool-call loop must exist');
const dispatcher = source.slice(dispatchStart, dispatchEnd);
const loop = source.slice(dispatchEnd, source.indexOf('static ', dispatchEnd + 8));

assert.match(adapter, /openwiki_config_valid/);
assert.match(adapter, /openwiki_config\.mode != DS4_OW_ON/);
assert.doesNotMatch(adapter, /ds4_ow_config_from_env/,
  'workspace selection must be frozen in the session config, not re-read per call');
assert.match(adapter, /ds4_ow_search\(/);
assert.match(adapter, /ds4_ow_read\(/);
assert.match(adapter, /worker_cancel_session_cb, w/);
assert.match(source, /static void agent_sigint_handler\(int sig\)[\s\S]{0,100}agent_sigint\s*=\s*1/,
  'SIGINT handler must latch an event for the UI loop');
assert.match(source, /if \(agent_sigint\)\s*\{\s*agent_sigint\s*=\s*0;[\s\S]{0,220}worker_interrupt\(&worker\)/,
  'UI loop must turn the SIGINT event into a worker interrupt');
assert.match(source, /static bool worker_cancel_session_cb\(void \*ud\)\s*\{\s*return worker_should_interrupt\(ud\);/,
  'OpenWiki transport cancellation must observe the worker interrupt');
assert.match(source, /static void worker_interrupt\(agent_worker \*w\)[\s\S]{0,120}w->interrupt\s*=\s*true/);
assert.match(adapter, /openwiki_search requires query/);
assert.match(adapter, /openwiki_read requires page/);
assert.match(adapter, /openwiki_read requires section/);
assert.match(adapter, /parsed < 1 \|\| parsed > 5/);
assert.doesNotMatch(adapter, /agent_worker_append_tool_result|agent_tool_observation_commit|agent_publish_system_status/,
  'adapter must return ordinary tool text without creating a sideband or transcript entry');
assert.match(telemetry, /atomic_fetch_add_explicit/);
assert.match(telemetry, /openwiki\.metrics route=/);
assert.doesNotMatch(telemetry, /openwiki\.metrics[^\n]*(query|page|section|workspace)/i,
  'metrics must never include private search or page content');
assert.match(dispatcher, /!strcmp\(call->name, "openwiki_search"\)[\s\S]{0,120}agent_tool_openwiki\(w, call, false\)/);
assert.match(dispatcher, /!strcmp\(call->name, "openwiki_read"\)[\s\S]{0,120}agent_tool_openwiki\(w, call, true\)/);
assert.match(loop, /agent_execute_tool_call\(w, &calls->v\[i\]\)/,
  'the tool loop must invoke the adapter only for an actual parsed call');

console.log('OpenWiki dispatcher integration structure: PASS');
