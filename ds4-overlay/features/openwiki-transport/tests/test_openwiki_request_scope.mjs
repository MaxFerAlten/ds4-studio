import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const [wrapperPath, runtimePath] = process.argv.slice(2);
assert.ok(wrapperPath && runtimePath, "expected composed wrapper/runtime source paths");
const wrapper = readFileSync(wrapperPath, "utf8");
const runtime = readFileSync(runtimePath, "utf8");

const start = wrapper.indexOf("bool openwiki_requested = ds4_ow_request_enabled(hr.body);");
assert.notEqual(start, -1, "native chat parses per-request opt-in");
const unavailable = wrapper.indexOf('"openwiki_unavailable"', start);
const sse = wrapper.indexOf('"HTTP/1.1 200 OK', start);
assert.ok(unavailable > start && sse > unavailable,
  "unavailable opt-in is returned before SSE headers");
assert.match(wrapper.slice(start, sse), /send_json_error\(fd, true, 503/);
assert.match(wrapper, /ds4_agent_ext_set_openwiki_enabled\(w->agent_ext, false\)/,
  "chat scope resets after the turn");
assert.match(runtime,
  /openwiki_enabled = enabled && available;[\s\S]*return !enabled \|\| available;/,
  "runtime refuses opt-in unless server capability is available");
assert.match(runtime, /openwiki_config_valid[\s\S]*openwiki_config\.mode == DS4_OW_ON/,
  "runtime requires valid ON config");
const capabilityLoad = runtime.indexOf("ds4_ow_config_from_env(");
const workerInit = runtime.indexOf("agent_worker_init(&rt->worker", capabilityLoad);
assert.ok(capabilityLoad >= 0 && workerInit > capabilityLoad,
  "server capability is loaded before the worker builds its base prompt");
assert.match(runtime.slice(capabilityLoad, workerInit),
  /openwiki_enabled = rt->cfg\.openwiki_config_valid[\s\S]*openwiki_config\.mode == DS4_OW_ON/,
  "base prompt receives OpenWiki schemas only for valid ON config");

console.log("openwiki request scope: PASS");
