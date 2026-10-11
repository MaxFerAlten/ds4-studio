// WP07 golden contract against the pinned OpenWiki MCP server.
//
// This test drives the REAL `openwiki mcp --host ds4-studio` server over stdio
// (SDK Client + StdioClientTransport -> node), not the fake server used by
// WP04. It certifies the upstream wire contract the gateway consumes:
//
//   * initialize negotiation (protocol version, server identity, capabilities);
//   * tools/list schema surface and the deterministic schema fingerprint that
//     src/mcp-supervisor.mjs enforces before READY;
//   * a successful openwiki_search -> ref -> openwiki_read round trip with
//     structuredContent;
//   * openwiki_list_workspaces scope output;
//   * no-wiki, malformed-argument and unknown-tool behavior.
//
// Provenance is cross-checked offline: the release manifest and pinned
// upstream-lock.json must identify commit 27b3c76cb9b28bc3bb31ccbeb4f0192b0802cf96.
// Release version and executable content hashes are informational. No network, no model/LLM call, no
// write to the committed fixture or to the OpenWiki release. The only writes
// are throwaway copies under the OS temp directory (fixture worktree, private
// OpenWiki config dir).
//
// Like the WP03/WP04 tests, a missing or mismatched pin FAILS (does not skip):
// WP07 is the gate that unblocks the supervisor, so an absent upstream must be
// visible as a failure.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import {
  canonicalJson,
  computeSchemaFingerprint,
  READ_ONLY_TOOLS,
  REQUIRED_TOOLS,
} from '../src/mcp-supervisor.mjs';
import { createWikiGenerationController } from '../src/wiki-generation-controller.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = dirname(HERE);
const FIXTURE_DIR = join(HERE, 'fixtures', 'openwiki-contract');
const FIXTURE_WIKI = join(FIXTURE_DIR, 'openwiki');
const GOLDEN_FILE = join(FIXTURE_DIR, 'tool-schemas.sha256');

const EXPECTED_COMMIT = '27b3c76cb9b28bc3bb31ccbeb4f0192b0802cf96';
const EXPECTED_RELEASE_ID = `${EXPECTED_COMMIT}-node${process.versions.modules}-${process.platform}-${process.arch}`;
const EXPECTED_EXE_REL = 'dist/cli/cli.js';
const MCP_HOST_ID = 'ds4-studio';

// The certified read-only surface; begin/plan/next/claims/submit/finish exist
// upstream but must never be reached by the gateway. REQUIRED_TOOLS and
// READ_ONLY_TOOLS are imported from src/mcp-supervisor.mjs so the artifact and
// the shipped gate can never drift apart.
//
// ALL_TOOLS is the expected tools/list surface, sorted by name.
const ALL_TOOLS = Object.freeze([
  'openwiki_begin',
  'openwiki_finish',
  'openwiki_inspect_page_claims',
  'openwiki_list_wikis',
  'openwiki_list_workspaces',
  'openwiki_next_page',
  'openwiki_read',
  'openwiki_search',
  'openwiki_submit_page',
  'openwiki_submit_plan',
]);

// OPENWIKI_RELEASE_DIR points at one release directory (the parent of
// package/ and manifest.json). OPENWIKI_HOME points at the OpenWiki install
// home whose releases/<id> layout WP02 produces.
const RELEASE_DIR =
  process.env.OPENWIKI_RELEASE_DIR ??
  join(process.env.OPENWIKI_HOME ?? '/tmp/openwiki-installed', 'releases', EXPECTED_RELEASE_ID);

const GIT_ENV = Object.freeze({
  PATH: '/usr/bin:/bin',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  LC_ALL: 'C',
});
const TEST = { timeout: 20_000 };

const state = {
  base: null,
  repoRoot: null,
  nowikiRoot: null,
  lifecycleRoot: null,
  controllerRoot: null,
  home: null,
  client: null,
  negotiated: null,
  tools: null,
  fingerprint: null,
  golden: null,
  compatibility: null,
};

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function initGitRepo(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  execFileSync('/usr/bin/git', ['init', '-q', dir], {
    env: { ...GIT_ENV, HOME: dir },
    stdio: 'ignore',
    timeout: 5_000,
  });
  return realpathSync(dir);
}

// Golden file: comment/blank lines ignored; each entry is
// "<64 hex>  <name>" (sha256sum-style two spaces).
function parseGolden(text) {
  const map = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
    assert.ok(match, `unparseable golden tool-schemas line: ${JSON.stringify(raw)}`);
    assert.ok(!map.has(match[2]), `duplicate golden entry for ${match[2]}`);
    map.set(match[2], match[1]);
  }
  return map;
}

before(async () => {
  // --- pin verification (offline provenance) --------------------------------
  const manifest = JSON.parse(readFileSync(join(RELEASE_DIR, 'manifest.json'), 'utf8'));
  assert.equal(manifest.openwikiCommit, EXPECTED_COMMIT, 'release commit does not match the pin');
  assert.equal(manifest.releaseId, EXPECTED_RELEASE_ID, 'release id does not match the pin');
  assert.equal(manifest.openwikiExecutable, EXPECTED_EXE_REL, 'release executable path changed');

  const lock = JSON.parse(
    readFileSync(join(PKG, '..', '..', 'docs', 'openwiki-integration', 'upstream-lock.json'), 'utf8'),
  );
  assert.equal(lock.git_commit, EXPECTED_COMMIT, 'upstream-lock.json is not pinned to the expected commit');

  const executable = join(RELEASE_DIR, 'package', EXPECTED_EXE_REL);
  assert.ok(readFileSync(executable).length > 0, 'release executable is empty');

  // --- fixture worktrees ----------------------------------------------------
  state.base = realpathSync(mkdtempSync(join(tmpdir(), 'ow-wp07-')));
  state.home = join(state.base, 'owhome');
  mkdirSync(state.home, { recursive: true, mode: 0o700 });

  assert.ok(readFileSync(join(FIXTURE_WIKI, 'architecture', 'retry-control.md'), 'utf8').length > 0);
  state.repoRoot = initGitRepo(join(state.base, 'contract-fixture'));
  cpSync(FIXTURE_WIKI, join(state.repoRoot, 'openwiki'), { recursive: true });
  state.nowikiRoot = initGitRepo(join(state.base, 'empty-fixture'));
  state.lifecycleRoot = initGitRepo(join(state.base, 'lifecycle-fixture'));
  state.controllerRoot = initGitRepo(join(state.base, 'controller-fixture'));

  state.golden = parseGolden(readFileSync(GOLDEN_FILE, 'utf8'));
  state.compatibility = JSON.parse(
    readFileSync(join(PKG, 'compatibility-v0.7.2.json'), 'utf8'),
  );

  // --- real MCP server ------------------------------------------------------
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [executable, 'mcp', '--host', MCP_HOST_ID],
    cwd: state.repoRoot,
    stderr: 'pipe',
    env: {
      PATH: '/usr/bin:/bin',
      HOME: state.home,
      OPENWIKI_CONFIG_DIR: state.home,
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      DO_NOT_TRACK: '1',
      OPENWIKI_TELEMETRY_DISABLED: '1',
    },
  });
  // Same hook the supervisor uses: the stdio transport reports the version the
  // server negotiated in the initialize response.
  const setTransportProtocolVersion = transport.setProtocolVersion?.bind(transport);
  transport.setProtocolVersion = (version) => {
    state.negotiated = version;
    return setTransportProtocolVersion?.(version);
  };
  // Drain stderr (node:sqlite prints an ExperimentalWarning) so it cannot fill
  // the pipe and stall the child.
  transport.stderr?.on('data', () => {});

  const client = new Client({ name: 'ds4-openwiki-gateway', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);
  state.client = client;

  const listed = await client.listTools();
  assert.equal(listed.nextCursor, undefined, 'pinned upstream must not paginate tools/list');
  state.tools = listed.tools;
  state.fingerprint = computeSchemaFingerprint(state.tools);
});

after(async () => {
  await state.client?.close().catch(() => {});
  if (state.base !== null) rmSync(state.base, { recursive: true, force: true });
});

// --- call helpers -----------------------------------------------------------

async function call(name, args) {
  return state.client.callTool({ name, arguments: args });
}

function successText(result) {
  assert.notEqual(result.isError, true, `expected success, got: ${result.content?.[0]?.text}`);
  assert.ok(Array.isArray(result.content) && result.content.length > 0, 'content must be a non-empty array');
  assert.equal(result.content[0].type, 'text');
  assert.equal(typeof result.content[0].text, 'string');
  assert.ok(result.structuredContent !== null && typeof result.structuredContent === 'object');
  // The text frame must be the exact JSON the gateway forwards sanitized.
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  return result.structuredContent;
}

function expectError(result, fragment) {
  assert.equal(result.isError, true, `expected a tool error: ${JSON.stringify(result)}`);
  assert.equal(result.structuredContent, undefined, 'error results must not carry structuredContent');
  const text = result.content?.[0]?.text ?? '';
  assert.match(text, fragment);
  return text;
}

// --- initialize -------------------------------------------------------------

test('initialize negotiates the gateway protocol and identifies OpenWiki', TEST, () => {
  assert.equal(state.negotiated, LATEST_PROTOCOL_VERSION, 'negotiated protocol version changed');
  assert.equal(state.client.getServerVersion()?.name, 'openwiki');
  assert.equal(typeof state.client.getServerVersion()?.version, 'string');
  assert.deepEqual(state.client.getServerCapabilities(), { tools: { listChanged: true } });
});

// --- tools/list schema surface ---------------------------------------------

test('tools/list exposes exactly the pinned ten-tool surface', TEST, () => {
  assert.equal(state.tools.length, 10);
  assert.deepEqual([...state.tools.map((t) => t.name)].sort(), [...ALL_TOOLS]);
  for (const required of REQUIRED_TOOLS) {
    assert.ok(state.tools.some((t) => t.name === required), `missing required tool ${required}`);
  }
});

test('pinned lifecycle creates a durable plan and resumes its pending page job', TEST, async () => {
  writeFileSync(join(state.lifecycleRoot, 'README.md'), '# Contract fixture\n\nThis fixture exercises the OpenWiki lifecycle.\n');
  const first = successText(await call('openwiki_begin', {
    root: state.lifecycleRoot,
    mode: 'init',
  }));
  assert.equal(first.resumed, false);
  assert.equal(typeof first.runId, 'string');
  assert.ok(first.runId.length > 0);

  const page = {
    path: '/openwiki/quickstart.md',
    title: 'Quickstart',
    purpose: 'Provide the required init quickstart for this lifecycle fixture.',
  };
  successText(await call('openwiki_submit_plan', { runId: first.runId, pages: [page] }));

  const pending = successText(await call('openwiki_next_page', { runId: first.runId }));
  assert.equal(pending.status, 'pending');
  assert.equal(pending.job.path, page.path);
  assert.equal(pending.job.title, page.title);

  const resumed = successText(await call('openwiki_begin', {
    root: state.lifecycleRoot,
    mode: 'init',
  }));
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.runId, first.runId);

  const afterResume = successText(await call('openwiki_next_page', { runId: first.runId }));
  assert.equal(afterResume.status, 'pending');
  assert.equal(afterResume.job.id, pending.job.id);
  assert.equal(afterResume.job.path, page.path);

  const controller = createWikiGenerationController({
    callAdmin: async (tool, args) => {
      const result = await call(tool, args);
      if (result.isError) throw new Error(`${tool}: ${result.content?.[0]?.text ?? 'MCP error'}`);
      return result;
    },
    generate: async ({ kind }) => {
      assert.equal(kind, 'page', 'resumed generating run must not request a new plan');
      return { value: {
        markdown: '# Quickstart\n\nGenerated by the OWG-06 contract test.',
        claims: [{ statement: 'The repository contains a README file.', evidence: [{ resource: 'repo://README.md' }] }],
        confirmedClaimIds: [], retractedClaimIds: [],
      } };
    },
    readContext: async () => ({ files: ['README.md'] }),
    writePage: async (job, markdown) => {
      assert.ok(job.path.startsWith('/openwiki/'));
      const destination = join(state.lifecycleRoot, job.path.slice(1));
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, markdown, { flag: 'wx' });
    },
  });
  const completed = await controller.run({ kind: 'init', root: state.lifecycleRoot, modelContext: { engine: 'mock-ds4' } });
  assert.equal(completed.runId, first.runId);
  assert.equal(completed.pageCount, 1);
  assert.match(readFileSync(join(state.lifecycleRoot, 'openwiki', 'quickstart.md'), 'utf8'),
    /# Quickstart\n\nGenerated by the OWG-06 contract test\./u);
});

test('OWG-06 controller completes a fresh run against the pinned OpenWiki lifecycle', TEST, async () => {
  writeFileSync(join(state.controllerRoot, 'README.md'), '# Controller fixture\n\nThe controller fixture has a README.\n');
  const controller = createWikiGenerationController({
    callAdmin: async (tool, args) => {
      const result = await call(tool, args);
      if (result.isError) throw new Error(`${tool}: ${result.content?.[0]?.text ?? 'MCP error'}`);
      return result;
    },
    generate: async ({ kind }) => kind === 'plan'
      ? { value: { pages: [{ path: '/openwiki/quickstart.md', title: 'Quickstart', purpose: 'Summarize the repository README.' }] } }
      : { value: {
        markdown: '# Quickstart\n\nThe repository contains a README.',
        claims: [{ statement: 'The repository contains a README file.', evidence: [{ resource: 'repo://README.md' }] }],
        confirmedClaimIds: [], retractedClaimIds: [],
      } },
    readContext: async () => ({ evidence: [{ resource: 'repo://README.md' }] }),
    writePage: async (job, markdown) => {
      assert.ok(job.path.startsWith('/openwiki/'));
      const destination = join(state.controllerRoot, job.path.slice(1));
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, markdown, { flag: 'wx' });
    },
  });

  const result = await controller.run({ kind: 'init', root: state.controllerRoot, modelContext: { engine: 'mock-ds4' } });
  assert.equal(result.pageCount, 1);
  assert.equal(controller.snapshot().state, 'completed');
  assert.match(readFileSync(join(state.controllerRoot, 'openwiki', 'quickstart.md'), 'utf8'),
    /# Quickstart\n\nThe repository contains a README\./u);
});

test('read-only schemas match the pinned contract', TEST, () => {
  const byName = new Map(state.tools.map((t) => [t.name, t]));
  for (const tool of state.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} must reject unknown keys`);
    assert.deepEqual(tool.execution, { taskSupport: 'forbidden' }, `${tool.name} execution changed`);
  }

  const search = byName.get('openwiki_search').inputSchema;
  assert.deepEqual(search.required, ['root', 'query']);
  assert.deepEqual(search.properties.limit, {
    description: 'Optional number of ranked results to return.',
    type: 'integer',
    minimum: 1,
    maximum: 20,
  });
  assert.equal(search.properties.query.maxLength, 2000);
  assert.equal(search.properties.paths.maxItems, 20);

  const read = byName.get('openwiki_read').inputSchema;
  assert.deepEqual(read.required, ['root', 'page', 'sections']);
  assert.equal(read.properties.sections.minItems, 1);
  assert.equal(read.properties.sections.maxItems, 20);
  assert.equal(read.properties.page.maxLength, 1000);

  const listWorkspaces = byName.get('openwiki_list_workspaces').inputSchema;
  assert.deepEqual(listWorkspaces.required, ['root']);
  assert.equal(listWorkspaces.properties.wiki.maxLength, 64);

  for (const name of READ_ONLY_TOOLS) {
    assert.ok(byName.has(name), `read-only tool ${name} is missing`);
  }
});

test('schema fingerprint and per-tool digests match the golden manifest', TEST, () => {
  assert.equal(state.fingerprint, state.golden.get('tools/list'));
  assert.equal(state.golden.size, state.tools.length + 1);
  for (const tool of state.tools) {
    const digest = sha256Hex(canonicalJson(tool));
    assert.equal(digest, state.golden.get(tool.name), `golden digest changed for ${tool.name}`);
  }
});

test('compatibility artifact matches the live contract', TEST, () => {
  const compat = state.compatibility;
  assert.equal(compat.schema, 1);
  assert.equal(compat.integration, 'ds4-openwiki-mcp-gateway');
  assert.equal(compat.artifact, 'compatibility');
  assert.equal(compat.upstream.name, 'openwiki');
  assert.equal(compat.upstream.commit, EXPECTED_COMMIT);
  assert.equal(compat.upstream.executable, EXPECTED_EXE_REL);
  assert.equal(compat.mcp.protocolVersion, state.negotiated);
  assert.equal(compat.mcp.serverInfo.name, 'openwiki');
  assert.deepEqual(compat.mcp.capabilities, { tools: { listChanged: true } });
  assert.deepEqual(compat.mcp.tools, [...ALL_TOOLS]);
  assert.deepEqual(compat.mcp.requiredTools, [...REQUIRED_TOOLS]);
  assert.deepEqual(compat.mcp.readOnlyTools, [...READ_ONLY_TOOLS]);
  assert.equal(compat.mcp.schemaFingerprint, state.fingerprint);
  assert.equal(compat.toolSchemas['tools/list'], state.fingerprint);
  assert.equal(typeof compat.toolSchemas.canonicalization, 'string');
  for (const tool of state.tools) {
    assert.equal(compat.toolSchemas.perTool[tool.name], state.golden.get(tool.name));
  }
  assert.equal(compat.gateway.runtime, 'unix-socket');
  assert.equal(compat.gateway.telemetryDisabled, true);
  assert.equal(compat.fixture, 'test/fixtures/openwiki-contract');
});

// --- search -> ref -> read --------------------------------------------------

test('openwiki_search returns structured sections and a usable ref', TEST, () => {
  return call('openwiki_search', {
    root: state.repoRoot,
    query: 'exponential backoff jitter',
  }).then((result) => {
    const body = successText(result);
    assert.ok(Array.isArray(body.results));
    assert.equal(body.results.length, 1);
    const hit = body.results[0];
    assert.equal(hit.kind, 'section');
    assert.deepEqual(hit.ref, ['openwiki/architecture/retry-control.md#backoff-schedule']);
    assert.equal(typeof hit.content, 'string');
    assert.match(hit.content, /Backoff Schedule/);
    // Unregistered repository: no linked-wiki identity is attached.
    assert.equal(hit.wiki, undefined);
  });
});

test('openwiki_read returns the exact sections from a search ref in order', TEST, async () => {
  // A distinctive query that resolves to exactly one section, so the search ref
  // is unambiguous before the read round trip.
  const search = await call('openwiki_search', { root: state.repoRoot, query: 'exponential backoff jitter' });
  const body = successText(search);
  assert.equal(body.results.length, 1);
  const first = body.results[0];
  assert.equal(first.kind, 'section');
  assert.equal(first.ref.length, 1);
  assert.ok(first.ref[0].startsWith('openwiki/'));
  assert.equal(first.ref[0].split('#').length, 2, `ref must be page#anchor: ${first.ref[0]}`);
  assert.ok(!first.ref[0].includes('index.md'), 'reserved pages must not be searchable');
  const [page, anchor] = first.ref[0].split('#');

  const read = await call('openwiki_read', {
    root: state.repoRoot,
    page,
    sections: [anchor, 'cancellation'],
  });
  const readBody = successText(read);
  assert.equal(readBody.page, 'openwiki/architecture/retry-control.md');
  assert.deepEqual(readBody.sections.map((s) => s.section), [anchor, 'cancellation']);
  assert.match(readBody.sections[0].content, /Backoff Schedule/);
  assert.match(readBody.sections[1].content, /Cancellation/);
  assert.equal(readBody.wiki, undefined);
});

test('openwiki_search honours limit and never invents results', TEST, async () => {
  const all = await call('openwiki_search', { root: state.repoRoot, query: 'retry' });
  const allBody = successText(all);
  assert.ok(allBody.results.length >= 2, 'retry must hit several sections');
  for (const hit of allBody.results) {
    assert.equal(hit.kind, 'section');
    assert.equal(hit.ref.length, 1);
    assert.ok(hit.ref[0].startsWith('openwiki/'));
    assert.equal(hit.ref[0].split('#').length, 2, `ref must be page#anchor: ${hit.ref[0]}`);
    assert.ok(!hit.ref[0].includes('index.md'), 'reserved pages must not be searchable');
  }
  const one = await call('openwiki_search', { root: state.repoRoot, query: 'retry', limit: 1 });
  assert.equal(successText(one).results.length, 1);
  // A token absent from the fixture must yield zero results, never a fallback.
  const empty = await call('openwiki_search', { root: state.repoRoot, query: 'zzzznosuchterm' });
  assert.deepEqual(successText(empty), { results: [] });
});

// --- list scopes ------------------------------------------------------------

test('openwiki_list_workspaces reports the unregistered local wiki', TEST, async () => {
  const body = successText(await call('openwiki_list_workspaces', { root: state.repoRoot }));
  assert.equal(body.wiki.id, 'contract-fixture');
  assert.equal(body.wiki.name, 'contract-fixture');
  assert.deepEqual(body.workspaces, []);
});

test('linked-workspace operations are rejected without a registry', TEST, async () => {
  const byWiki = await call('openwiki_list_workspaces', { root: state.repoRoot, wiki: 'other' });
  expectError(byWiki, /^invalid_state: /);
  const wikis = await call('openwiki_list_wikis', { root: state.repoRoot, workspace: 'ws' });
  expectError(wikis, /^invalid_state: /);
  const scoped = await call('openwiki_search', { root: state.repoRoot, query: 'retry', workspace: 'ws' });
  expectError(scoped, /^invalid_state: /);
});

// --- no wiki ----------------------------------------------------------------

test('a Git repository without openwiki/ yields empty results, not an error', TEST, async () => {
  const search = await call('openwiki_search', { root: state.nowikiRoot, query: 'retry' });
  assert.deepEqual(successText(search), { results: [] });
  const read = await call('openwiki_read', {
    root: state.nowikiRoot,
    page: 'openwiki/architecture/retry-control.md',
    sections: ['backoff-schedule'],
  });
  expectError(read, /^invalid_input: The requested OpenWiki page does not exist\.$/);
});

// --- malformed / unknown ----------------------------------------------------

test('input-schema violations fail closed as tool errors, never success', TEST, async () => {
  const missingQuery = await call('openwiki_search', { root: state.repoRoot });
  expectError(missingQuery, /-32602: Input validation error/);
  assert.match(missingQuery.content[0].text, /query/);

  const unknownKey = await call('openwiki_search', { root: state.repoRoot, query: 'retry', bogus: 1 });
  expectError(unknownKey, /Unrecognized key: "bogus"/);

  const blankQuery = await call('openwiki_search', { root: state.repoRoot, query: '   ' });
  expectError(blankQuery, /Too small/);

  const oversizeQuery = await call('openwiki_search', { root: state.repoRoot, query: 'a'.repeat(2001) });
  expectError(oversizeQuery, /Too big/);

  const lowLimit = await call('openwiki_search', { root: state.repoRoot, query: 'retry', limit: 0 });
  expectError(lowLimit, /-32602: Input validation error/);
  const highLimit = await call('openwiki_search', { root: state.repoRoot, query: 'retry', limit: 21 });
  expectError(highLimit, /-32602: Input validation error/);

  const emptySections = await call('openwiki_read', {
    root: state.repoRoot,
    page: 'openwiki/architecture/retry-control.md',
    sections: [],
  });
  expectError(emptySections, /Too small/);
});

test('domain errors are bounded and content-free', TEST, async () => {
  const relativeRoot = await call('openwiki_search', { root: 'relative/path', query: 'retry' });
  expectError(relativeRoot, /^invalid_input: The OpenWiki root must be an absolute path inside a Git repository\.$/);

  const traversal = await call('openwiki_read', {
    root: state.repoRoot,
    page: 'openwiki/../secrets.md',
    sections: ['x'],
  });
  expectError(traversal, /^invalid_input: Page must be a non-structural Markdown path below openwiki\/\.$/);

  const reserved = await call('openwiki_read', {
    root: state.repoRoot,
    page: 'openwiki/index.md',
    sections: ['pages'],
  });
  expectError(reserved, /^invalid_input: Page must be a non-structural Markdown path below openwiki\/\.$/);

  const unknownSection = await call('openwiki_read', {
    root: state.repoRoot,
    page: 'openwiki/architecture/retry-control.md',
    sections: ['no-such-anchor'],
  });
  expectError(unknownSection, /^invalid_input: Unknown section: no-such-anchor$/);
});

test('an unknown tool is reported, not silently dispatched', TEST, async () => {
  const unknown = await call('openwiki_does_not_exist', { root: state.repoRoot });
  expectError(unknown, /-32602: Tool openwiki_does_not_exist not found/);
});
