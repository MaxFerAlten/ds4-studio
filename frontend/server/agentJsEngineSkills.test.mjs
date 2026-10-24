// Regression: engine "js" with the wrapper enabled (the live DS4 Studio
// setup).  /agent start keeps the wrapper in server mode, so every skill
// control must be served by Node; anything forwarded to the wrapper's C agent
// came back as 409 "wrong mode: active=server required=agent".
//   - /sage start, then /lean start, then both status, in one agent session;
//   - the fake wrapper enforces its mode like the real one, and must never
//     see a native-agent command.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startFakeBackend, startServerChild } from "./agent/agentRunParityHarness.mjs";

const SESSION = "js-engine-skills";
const headers = { "Content-Type": "application/json", "X-Agent-Session-Key": SESSION };

async function post(base, path, body = {}) {
  const res = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = text; }
  return { status: res.status, payload, text };
}

const command = (base, cmd) => post(base, "/api/native-agent/command", { command: cmd });

function fakeSageBin() {
  const bin = mkdtempSync(join(tmpdir(), "fake-sage-"));
  writeFileSync(join(bin, "sage"), "#!/bin/sh\necho 'LaTeX: \\pi'\n");
  chmodSync(join(bin, "sage"), 0o755);
  return bin;
}

async function skillsActive(base) {
  const lean = await command(base, "/lean status");
  const sage = await (await fetch(`${base}/api/sage/status`, { headers })).json();
  return { lean: lean.payload.data?.loaded === true, sage: sage.policyActive === true };
}

test("js engine + wrapper: /sage start then /lean start both succeed in agent mode", async () => {
  // A stub sage keeps the test independent of a local SageMath install.
  const bin = mkdtempSync(join(tmpdir(), "fake-sage-"));
  const sage = join(bin, "sage");
  writeFileSync(sage, "#!/bin/sh\necho 'LaTeX: \\pi'\n");
  chmodSync(sage, 0o755);

  const backend = await startFakeBackend({ enforceMode: true });
  const server = await startServerChild(backend, {
    wrapper: true,
    env: { PATH: `${bin}:${process.env.PATH}` }
  });
  try {
    const start = await post(server.base, "/api/agent/start");
    assert.equal(start.status, 200, start.text);
    assert.equal(start.payload.active, true);
    assert.equal(start.payload.native, false);

    const sageStart = await post(server.base, "/api/sage/start");
    assert.equal(sageStart.status, 200, sageStart.text);
    assert.equal(sageStart.payload.active, true);

    const leanStart = await command(server.base, "/lean start");
    assert.equal(leanStart.status, 200, leanStart.text);
    assert.doesNotMatch(leanStart.text, /wrong mode/);

    const leanStatus = await command(server.base, "/lean status");
    assert.equal(leanStatus.status, 200, leanStatus.text);
    assert.equal(leanStatus.payload.data?.loaded, true, leanStatus.text);

    const sageStatus = await fetch(`${server.base}/api/sage/status`, { headers });
    const sageStatusBody = await sageStatus.json();
    assert.equal(sageStatus.status, 200);
    assert.equal(sageStatusBody.policyActive, true, JSON.stringify(sageStatusBody));

    const forwarded = backend.log.filter((entry) => entry.path === "POST /api/native-agent/command");
    assert.deepEqual(forwarded, [], "js engine must not forward skill commands to the C agent");
  } finally {
    server.stop();
    await backend.close();
    rmSync(bin, { recursive: true, force: true });
  }
});

// Regression: sage (process-wide) and lean (per session) survived
// /agent stop -> /agent start, so a "plain" agent turn still carried ~33k
// prompt tokens.  Leaving agent mode and /new both drop them.
test("js engine: /agent stop and /new drop sage and lean", async () => {
  const bin = fakeSageBin();
  const backend = await startFakeBackend({ enforceMode: true });
  const server = await startServerChild(backend, { wrapper: true, env: { PATH: `${bin}:${process.env.PATH}` } });
  const enableBoth = async () => {
    assert.equal((await post(server.base, "/api/sage/start")).status, 200);
    assert.equal((await command(server.base, "/lean start")).status, 200);
    assert.deepEqual(await skillsActive(server.base), { lean: true, sage: true });
  };
  try {
    assert.equal((await post(server.base, "/api/agent/start")).status, 200);
    await enableBoth();
    assert.equal((await post(server.base, "/api/agent/stop")).status, 200);
    assert.equal((await post(server.base, "/api/agent/start")).status, 200);
    assert.deepEqual(await skillsActive(server.base), { lean: false, sage: false }, "after /agent stop + start");

    await enableBoth();
    const fresh = await post(server.base, "/api/agent/chat", { message: "/new" });
    assert.equal(fresh.status, 200, fresh.text);
    assert.match(fresh.text, /New session started/);
    assert.deepEqual(await skillsActive(server.base), { lean: false, sage: false }, "after /new");
  } finally {
    server.stop();
    await backend.close();
    rmSync(bin, { recursive: true, force: true });
  }
});
