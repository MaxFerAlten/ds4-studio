// Loaded only in the sandboxed ADMIN Node process. DS4 owns repository setup
// and creates the empty wiki mount before launching OpenWiki. Keep the upstream
// release untouched; adapt the two standalone-CLI side effects in memory.
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const release = process.env.DS4_OPENWIKI_RELEASE_DIR;
if (!release?.startsWith('/')) throw new Error('Missing DS4 OpenWiki release directory');
const prefix = pathToFileURL(`${release}/dist/`).href;

function replaceOnce(source, anchor, replacement) {
  const at = source.indexOf(anchor);
  if (at < 0 || source.indexOf(anchor, at + anchor.length) >= 0) {
    throw new Error('Unsupported OpenWiki host setup implementation');
  }
  return source.slice(0, at) + replacement + source.slice(at + anchor.length);
}

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url !== `${prefix}ingestion/code-mode.js` && url !== `${prefix}agent/wiki-replacement.js`) return result;
    let source = Buffer.isBuffer(result.source) ? result.source.toString('utf8') : result.source;
    if (typeof source !== 'string') throw new Error('OpenWiki host adapter requires JavaScript source');
    if (url === `${prefix}ingestion/code-mode.js`) {
      // Host-generated docs need no scheduled standalone workflow or edits to
      // AGENTS.md/CLAUDE.md. All remaining ingestion exports stay unchanged.
      const signature = 'export async function ensureCodeModeRepoSetup(cwd, options = {}) {';
      source = replaceOnce(source, signature, `${signature}\n    return; // Repository setup is owned by DS4 Studio.\n`);
    } else {
      // An empty, pre-created mount is a first init, not an existing wiki to
      // back up and remove. Preserve upstream replacement for nonempty wikis.
      source = 'import { readdir as ds4ReadWikiEntries } from "node:fs/promises";\n' + source;
      source = replaceOnce(source, '    const backupParent = await mkdtemp(path.join(tmpdir(), "openwiki-init-"));',
        '    if ((await ds4ReadWikiEntries(wikiDir)).length === 0) return createNoopReplacement();\n    const backupParent = await mkdtemp(path.join(tmpdir(), "openwiki-init-"));');
    }
    return { ...result, source };
  },
});
