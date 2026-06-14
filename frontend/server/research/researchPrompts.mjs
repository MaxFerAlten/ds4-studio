import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROMPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "prompts");
const cache = new Map();

export async function loadPrompt(name) {
  if (!/^[a-z_]+$/.test(name)) throw new Error(`invalid prompt name: ${name}`);
  if (cache.has(name)) return cache.get(name);
  const text = await fs.readFile(path.join(PROMPTS_DIR, `${name}.md`), "utf8");
  cache.set(name, text);
  return text;
}

export function renderTemplate(template, vars = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) =>
    vars[key] === undefined || vars[key] === null ? "" : String(vars[key])
  );
}

export async function renderPrompt(name, vars = {}) {
  return renderTemplate(await loadPrompt(name), vars);
}
