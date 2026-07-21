/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/behavioral-specification.md.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: Node.js atomic filesystem primitives.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function canonicalValue(value, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON requires finite numbers");
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`canonical JSON cannot encode ${typeof value}`);
  }
  if (seen.has(value)) throw new TypeError("canonical JSON cannot encode cycles");
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalValue(item, seen));
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError("canonical JSON requires plain objects");
    }
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new TypeError(`canonical JSON cannot encode undefined at ${key}`);
      normalized[key] = canonicalValue(value[key], seen);
    }
    return normalized;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value, new Set()));
}

export function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function hashJson(value) {
  return sha256(canonicalJson(value));
}

export async function hashFile(file) {
  const handle = await fs.open(file, "r");
  const digest = crypto.createHash("sha256");
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk);
  } finally {
    await handle.close();
  }
  return digest.digest("hex");
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (!new Set(["EINVAL", "ENOTSUP", "EISDIR", "EPERM"]).has(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

export async function atomicWriteFile(file, data, options = {}) {
  const target = path.resolve(file);
  const directory = path.dirname(target);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  let handle;
  try {
    handle = await fs.open(temporary, "wx", options.mode ?? 0o600);
    await handle.writeFile(data, options.encoding ?? "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, target);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return target;
}

export async function atomicWriteJson(file, value, options = {}) {
  const text = `${options.pretty === false ? canonicalJson(value) : JSON.stringify(value, null, 2)}\n`;
  return atomicWriteFile(file, text, options);
}

export function timingSafeHexEqual(left, right) {
  if (!/^[a-f0-9]{64}$/.test(String(left)) || !/^[a-f0-9]{64}$/.test(String(right))) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
