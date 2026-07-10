import fs from "node:fs/promises";
import path from "node:path";
import { sessionCapsuleMetaPath } from "./contextPaths.mjs";

export async function readCapsuleMeta(sessionKey) {
  const file = sessionCapsuleMetaPath(sessionKey);
  try {
    const text = await fs.readFile(file, "utf8");
    return JSON.parse(text);
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    // invalid JSON or unreadable → treat as absent, never throw
    return null;
  }
}

export async function writeCapsuleMeta(sessionKey, meta) {
  const file = sessionCapsuleMetaPath(sessionKey);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(meta ?? {}), "utf8");
  return meta;
}

export async function clearCapsuleMeta(sessionKey) {
  await fs.rm(sessionCapsuleMetaPath(sessionKey), { force: true });
}
