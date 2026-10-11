import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package is a private ESM package', () => {
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
});

test('package pins the supported Node engine', () => {
  assert.equal(pkg.engines?.node, '>=22.22.0');
});

test('package depends only on the pinned MCP SDK', () => {
  assert.deepEqual(pkg.dependencies, { '@modelcontextprotocol/sdk': '1.31.0' });
  assert.equal(pkg.devDependencies, undefined);
});

test('npm test runs the built-in node test runner', () => {
  assert.equal(pkg.scripts?.test, 'node --test');
});
