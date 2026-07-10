import fs from "node:fs/promises";
import path from "node:path";
import { projectContextDir } from "./contextPaths.mjs";
import { appendJsonlCapped, DEFAULT_MAX_EVENTS } from "./contextJsonl.mjs";

// Project-level persistent memory (§5): cross-session ledger + surgical markdown
// docs. Clean-room pattern only: raw/synth separation, local persistence,
// surgical (no-op-when-unchanged) update, and a last-updated metadata line.
export const PROJECT_DOCS = Object.freeze({
  decisions: "decisions.md",
  openQuestions: "open-questions.md",
  activeFiles: "active-files.md",
  hazards: "hazards.md",
  sourceMap: "source-map.md"
});

function projectLedgerPath(workspace) {
  return path.join(projectContextDir(workspace), "project-ledger.jsonl");
}
function docPath(workspace, docName) {
  return path.join(projectContextDir(workspace), docName);
}
function oneLine(value, max = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export async function appendProjectEvent(workspace, event, { maxEvents = DEFAULT_MAX_EVENTS } = {}) {
  const record = { at: new Date().toISOString(), ...event };
  await appendJsonlCapped(projectLedgerPath(workspace), record, maxEvents);
  return record;
}

export async function readProjectDoc(workspace, docName) {
  let text = "";
  try {
    text = await fs.readFile(docPath(workspace, docName), "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  return text.split(/\r?\n/).filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
}

/**
 * Surgical upsert of one bullet into a project doc. No-op (returns changed:false)
 * when the item already exists — §1.1(7). Refreshes the last-updated header only
 * when content actually changes. Caps to the most recent `max` bullets.
 */
export async function upsertProjectListItem(workspace, docName, item, { max = 200 } = {}) {
  const value = oneLine(item);
  if (!value) return { changed: false, count: (await readProjectDoc(workspace, docName)).length };
  const existing = await readProjectDoc(workspace, docName);
  if (existing.includes(value)) return { changed: false, count: existing.length };

  const bullets = [...existing, value].slice(-max);
  const file = docPath(workspace, docName);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const header = `<!-- updated: ${new Date().toISOString()} -->`;
  await fs.writeFile(file, `${header}\n${bullets.map((b) => `- ${b}`).join("\n")}\n`, "utf8");
  return { changed: true, count: bullets.length };
}

export const recordProjectDecision = (ws, text) => upsertProjectListItem(ws, PROJECT_DOCS.decisions, text, { max: 200 });
export const recordProjectOpenQuestion = (ws, text) => upsertProjectListItem(ws, PROJECT_DOCS.openQuestions, text, { max: 100 });
export const recordProjectActiveFile = (ws, file) => upsertProjectListItem(ws, PROJECT_DOCS.activeFiles, file, { max: 100 });
export const recordProjectHazard = (ws, text) => upsertProjectListItem(ws, PROJECT_DOCS.hazards, text, { max: 100 });
export const recordProjectSourceMapEntry = (ws, entry) => upsertProjectListItem(ws, PROJECT_DOCS.sourceMap, entry, { max: 300 });
