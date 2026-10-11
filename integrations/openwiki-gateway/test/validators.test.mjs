import test from 'node:test';
import assert from 'node:assert/strict';
import { requireReadRequest, requireSearchRequest } from '../src/validators.mjs';

const search = (overrides = {}) => ({ protocol: 'ds4-openwiki.v1', workspaceId: 'repo-a', query: '  cache reuse  ', ...overrides });
const read = (overrides = {}) => ({ protocol: 'ds4-openwiki.v1', workspaceId: 'repo-a', page: 'docs/cache.md', sections: ['Cache reuse'], ...overrides });

test('search request is normalized into an explicit immutable upstream shape', () => {
  const parsed = requireSearchRequest(search({ paths: ['src/agent.c'], limit: 5, requestId: 'req-1' }));
  assert.deepEqual(parsed, { protocol: 'ds4-openwiki.v1', workspaceId: 'repo-a', requestId: 'req-1', query: 'cache reuse', paths: ['src/agent.c'], limit: 5 });
  assert.ok(Object.isFrozen(parsed));
  assert.throws(() => requireSearchRequest(search({ root: '/etc' })), { code: 'unknown_key' });
});

test('search rejects invalid protocol, workspace, query and limits', () => {
  for (const value of [null, [], 'x']) assert.throws(() => requireSearchRequest(value));
  for (const x of [search({ protocol: 'other' }), search({ workspaceId: '../repo' }), search({ query: '  ' }), search({ query: 'bad\u0000query' }), search({ query: 'line\nbreak' }), search({ query: 'x'.repeat(1201) }), search({ limit: 0 }), search({ limit: 6 }), search({ limit: 1.5 })]) {
    assert.throws(() => requireSearchRequest(x));
  }
  assert.equal(requireSearchRequest(search({ query: '🧠'.repeat(1200) })).query.length, 2400, 'query cap counts Unicode code points');
});

test('search path hints are bounded and repository relative', () => {
  assert.throws(() => requireSearchRequest(search({ paths: Array(9).fill('src/a.c') })));
  for (const path of ['../secret', '/etc/passwd', 'C:/repo', 'src\\file', 'src//file', './src/file', 'src/..', `x${'a'.repeat(250)}`]) {
    assert.throws(() => requireSearchRequest(search({ paths: [path] })), `reject path ${path}`);
  }
  assert.deepEqual(requireSearchRequest(search({ paths: ['src/a.c', 'docs/index.md'] })).paths, ['src/a.c', 'docs/index.md']);
});

test('read requires a safe page and one to three unique bounded anchors', () => {
  assert.deepEqual(requireReadRequest(read()).sections, ['Cache reuse']);
  for (const x of [read({ page: '../secrets' }), read({ page: 'x#heading' }), read({ sections: [] }), read({ sections: ['a', 'b', 'c', 'd'] }), read({ sections: ['a', 'a'] }), read({ sections: ['x'.repeat(201)] }), read({ command: 'cat /etc/passwd' })]) {
    assert.throws(() => requireReadRequest(x));
  }
});
