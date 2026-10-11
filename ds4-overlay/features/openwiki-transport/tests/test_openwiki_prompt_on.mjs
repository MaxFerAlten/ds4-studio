import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = process.argv[2];
assert.ok(dir, 'expected prompt output directory');

function parseJsonObjects(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') quoted = false;
        continue;
      }
      if (ch === '"') quoted = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try { out.push(JSON.parse(text.slice(i, j + 1))); } catch {}
        i = j;
        break;
      }
    }
  }
  return out;
}

function checkSchema(schema) {
  const tool = schema.function ?? schema;
  if (schema.function) assert.equal(schema.type, 'function');
  assert.ok(['openwiki_search', 'openwiki_read'].includes(tool.name));
  const params = tool.parameters;
  assert.equal(params.type, 'object');
  assert.equal(params.additionalProperties, false);
  if (tool.name === 'openwiki_search') {
    assert.deepEqual(params.required, ['query']);
    assert.equal(params.properties.query.type, 'string');
    assert.equal(params.properties.limit.type, 'integer');
    assert.equal(params.properties.limit.minimum, 1);
    assert.equal(params.properties.limit.maximum, 5);
    assert.deepEqual(Object.keys(params.properties).sort(), ['limit', 'query']);
  } else {
    assert.deepEqual(params.required, ['page', 'section']);
    assert.equal(params.properties.page.type, 'string');
    assert.equal(params.properties.section.type, 'string');
    assert.deepEqual(Object.keys(params.properties).sort(), ['page', 'section']);
  }
}

const glmSchemas = (await readFile(join(dir, 'openwiki-schemas.jsonl'), 'utf8'))
  .trim().split('\n').map((line) => JSON.parse(line));
const dsmlSchemas = parseJsonObjects(await readFile(join(dir, 'openwiki-dsml-schemas.txt'), 'utf8'));
assert.equal(glmSchemas.length, 2);
assert.equal(dsmlSchemas.length, 2);
for (const schema of [...glmSchemas, ...dsmlSchemas]) checkSchema(schema);

for (const family of ['deepseek', 'glm', 'qwen', 'dsml41']) {
  const prompt = await readFile(join(dir, `${family}.on`), 'utf8');
  const repeatedPrompt = await readFile(join(dir, `${family}.on.repeat`), 'utf8');
  assert.equal((prompt.match(/openwiki_search/g) ?? []).length, 1, `${family}: search schema once`);
  assert.equal((prompt.match(/openwiki_read/g) ?? []).length, 1, `${family}: read schema once`);
  const parsed = parseJsonObjects(prompt).filter((item) =>
    ['openwiki_search', 'openwiki_read'].includes(item.function?.name ?? item.name));
  assert.equal(parsed.length, 2, `${family}: OpenWiki schemas parse from rendered prompt`);
  for (const schema of parsed) checkSchema(schema);
  const repeatedSchemas = parseJsonObjects(repeatedPrompt).filter((item) =>
    ['openwiki_search', 'openwiki_read'].includes(item.function?.name ?? item.name));
  assert.deepEqual(repeatedSchemas, parsed, `${family}: repeated ON schemas are identical`);
  const schemaHash = (schemas) => createHash('sha256')
    .update(JSON.stringify(schemas)).digest('hex');
  assert.equal(schemaHash(repeatedSchemas), schemaHash(parsed),
    `${family}: ON schema SHA-256 is deterministic`);
}

const reminderBaseline = await readFile(join(dir, 'reminder.baseline'), 'utf8');
for (const family of ['deepseek', 'glm', 'qwen', 'dsml41']) {
  const offReminder = await readFile(join(dir, `${family}.reminder.off`), 'utf8');
  const onReminder = await readFile(join(dir, `${family}.reminder.on`), 'utf8');
  const repeatedOnReminder = await readFile(join(dir, `${family}.reminder.on.repeat`), 'utf8');
  assert.equal(offReminder, reminderBaseline, `${family}: OFF reminder matches legacy baseline`);
  assert.ok(!offReminder.includes('openwiki_'), `${family}: OFF reminder has no OpenWiki tools`);
  assert.ok(onReminder.includes('OpenWiki is enabled:') &&
    onReminder.includes('openwiki_search') && onReminder.includes('openwiki_read'),
  `${family}: ON reminder includes both OpenWiki tools`);
  assert.equal(repeatedOnReminder, onReminder, `${family}: ON reminder is deterministic`);
}

console.log('PASS: system prompt OFF matches byte goldens; OFF reminders match legacy baseline; ON schemas/reminders are deterministic and all four parsers accept search/read.');
