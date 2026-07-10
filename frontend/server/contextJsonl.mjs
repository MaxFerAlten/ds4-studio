import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_MAX_EVENTS = 5000;

// Per-file counter so we don't re-read the whole file on every append. Trimming
// runs roughly every cap/5 appends, bounding the file to ~cap * 1.2 between
// process restarts. ponytail: in-memory counter; fine for a local diagnostic log.
const sinceCheck = new Map();

export async function trimJsonlToCap(file, cap) {
  if (!cap || cap <= 0) return;
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return;
  }
  const rows = text.split(/\r?\n/).filter(Boolean);
  if (rows.length <= cap) return;
  const kept = rows.slice(rows.length - cap);
  await fs.writeFile(file, `${kept.join("\n")}\n`, "utf8");
}

export async function appendJsonlCapped(file, obj, cap = DEFAULT_MAX_EVENTS) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(obj)}\n`, "utf8");
  if (!cap || cap <= 0) return obj;
  const checkEvery = Math.max(1, Math.floor(cap / 5));
  const n = (sinceCheck.get(file) || 0) + 1;
  if (n < checkEvery) {
    sinceCheck.set(file, n);
    return obj;
  }
  sinceCheck.set(file, 0);
  await trimJsonlToCap(file, cap);
  return obj;
}
