// WP3 of convergenza.loop.md: the Node loop must load, frame and revise skills
// exactly like the C registry (ds4_agent_skill_registry.c), so the same
// skills/ directory produces the same prompt bytes and the same aggregate
// revision on both engines.  Every rule below mirrors a named C function; the
// conformance test runs the C registry over the same fixtures.
import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";

export const SKILL_NAME_MAX = 64;
export const SKILL_FILE_MAX = 256 * 1024;
export const SKILL_ACTIVE_MAX = 32;
export const SKILL_TOTAL_MAX = 1024 * 1024;
export const SKILL_REVISION_HEX = 40;

// ds4_agent_skill_registry.c: SKILL_REGISTRY_MAGIC.  sizeof(magic) in C
// includes the terminating NUL, and the NUL is part of the hashed bytes.
const REGISTRY_MAGIC = "DS4_AGENT_SKILL_REGISTRY_V1";
const BEGIN_MARKER = "[BEGIN DS4 ACTIVE SKILL";
const END_MARKER = "[END DS4 ACTIVE SKILL";
const SKILL_FILE_NAME = "SKILL.md";

// Mirrors the ds4_agent_skill_kind enum, in order.
export const SKILL_KIND = Object.freeze({
  DYNAMIC: 0,
  BUILTIN_METACOGNITION: 1,
  BUILTIN_SOUL: 2,
  BUILTIN_ETHIC: 3,
  BUILTIN_STRUCTURE: 4,
  BUILTIN_SAGE_POLICY: 5,
  BUILTIN_LEAN_POLICY: 6
});

export function skillKindIndex(kind) {
  if (typeof kind === "number") return kind;
  if (typeof kind === "string") {
    const key = kind.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(SKILL_KIND, key)) return SKILL_KIND[key];
    const byName = Object.entries(SKILL_KIND).find(([, value]) => String(value) === kind);
    if (byName) return byName[1];
  }
  return -1;
}

// ds4_agent_skill_kind_name(): every builtin shares the "builtin" label.
export function skillKindName(kind) {
  const index = skillKindIndex(kind);
  if (index === 0) return "dynamic";
  if (index >= 1 && index <= 6) return "builtin";
  return "unknown";
}

export class SkillError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "SkillError";
    this.code = code;
    this.detail = message;
  }
}

function fail(code, message) {
  throw new SkillError(code, message);
}

// ds4_agent_skill_name_valid()
export function skillNameValid(name) {
  if (name === undefined || name === null || name === "") {
    fail("SKILL_NAME_INVALID", "skill name is missing");
  }
  if (typeof name !== "string") fail("SKILL_NAME_INVALID", "skill name is missing");
  const bytes = Buffer.byteLength(name, "utf8");
  if (bytes === 0 || bytes > SKILL_NAME_MAX) {
    fail("SKILL_NAME_INVALID", "skill name must contain 1..64 bytes");
  }
  const first = name.charCodeAt(0);
  const firstOk = (first >= 97 && first <= 122) || (first >= 48 && first <= 57);
  if (!firstOk) {
    fail("SKILL_NAME_INVALID", "skill name must start with lowercase ASCII or a digit");
  }
  for (let i = 1; i < name.length; i += 1) {
    const c = name.charCodeAt(i);
    const ok = (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 /* _ */ || c === 45 /* - */;
    if (!ok) fail("SKILL_NAME_INVALID", "skill name contains a forbidden byte");
  }
  return true;
}

// skill_utf8_valid(): strict UTF-8, rejecting overlong forms, surrogates and
// anything past U+10FFFF.  Node's TextDecoder({fatal:true}) is close but not
// byte-identical to the C scanner, so the scan is spelled out.
export function skillUtf8Valid(buf) {
  let i = 0;
  const len = buf.length;
  while (i < len) {
    const c = buf[i];
    i += 1;
    if (c <= 0x7f) continue;
    if (c >= 0xc2 && c <= 0xdf) {
      if (i >= len || (buf[i] & 0xc0) !== 0x80) return false;
      i += 1;
      continue;
    }
    if (c >= 0xe0 && c <= 0xef) {
      if (i + 1 >= len) return false;
      const c1 = buf[i];
      const c2 = buf[i + 1];
      i += 2;
      if ((c2 & 0xc0) !== 0x80) return false;
      if (c === 0xe0) {
        if (c1 < 0xa0 || c1 > 0xbf) return false;
      } else if (c === 0xed) {
        if (c1 < 0x80 || c1 > 0x9f) return false;
      } else if ((c1 & 0xc0) !== 0x80) {
        return false;
      }
      continue;
    }
    if (c >= 0xf0 && c <= 0xf4) {
      if (i + 2 >= len) return false;
      const c1 = buf[i];
      const c2 = buf[i + 1];
      const c3 = buf[i + 2];
      i += 3;
      if ((c2 & 0xc0) !== 0x80 || (c3 & 0xc0) !== 0x80) return false;
      if (c === 0xf0) {
        if (c1 < 0x90 || c1 > 0xbf) return false;
      } else if (c === 0xf4) {
        if (c1 > 0x8f) return false;
      } else if (c1 < 0x80 || c1 > 0xbf) {
        return false;
      }
      continue;
    }
    return false;
  }
  return true;
}

// skill_content_nonempty(): a byte >= 0x80 counts as content, so pure-ASCII
// whitespace is the only way a non-empty file is still "empty".
function skillContentNonempty(buf) {
  for (let i = 0; i < buf.length; i += 1) {
    const c = buf[i];
    const space = c === 0x20 || (c >= 0x09 && c <= 0x0d);
    if (c >= 0x80 || !space) return true;
  }
  return false;
}

// skill_has_reserved_marker(): the marker is reserved only at the start of a
// line, which is what lets prose mention it harmlessly.
export function skillHasReservedMarker(buf) {
  let pos = 0;
  const len = buf.length;
  while (pos < len) {
    let lineEnd = pos;
    while (lineEnd < len && buf[lineEnd] !== 0x0a) lineEnd += 1;
    const line = buf.subarray(pos, lineEnd);
    if (line.length >= BEGIN_MARKER.length && line.subarray(0, BEGIN_MARKER.length).toString("latin1") === BEGIN_MARKER) return true;
    if (line.length >= END_MARKER.length && line.subarray(0, END_MARKER.length).toString("latin1") === END_MARKER) return true;
    pos = lineEnd < len ? lineEnd + 1 : len;
  }
  return false;
}

// ds4_kvstore_sha1_bytes_hex()
export function skillSha1Hex(buf) {
  return createHash("sha1").update(buf).digest("hex");
}

function readWholeFile(fd, size) {
  const buf = Buffer.allocUnsafe(size);
  let used = 0;
  while (used < size) {
    const got = readSync(fd, buf, used, size - used, null);
    if (got === 0) fail("SKILL_CHANGED_DURING_READ", "early EOF");
    used += got;
  }
  return buf;
}

// skill_stage_base_from_disk(), order of checks included.
export function stageSkill(skillsDir, name, kind = SKILL_KIND.DYNAMIC) {
  const kindIndex = skillKindIndex(kind);
  skillNameValid(name);
  let dirInfo;
  try {
    dirInfo = lstatSync(skillsDir);
  } catch {
    fail("SKILL_NOT_FOUND", "invalid skills root");
  }
  if (!dirInfo.isDirectory()) fail("SKILL_NOT_FOUND", "invalid skills root");

  const skillDir = join(skillsDir, name);
  let dirStat;
  try {
    dirStat = lstatSync(skillDir);
  } catch {
    fail("SKILL_NOT_FOUND", "skill directory is unavailable");
  }
  if (dirStat.isSymbolicLink()) fail("SKILL_SYMLINK_REJECTED", "skill directory is a symlink");
  if (!dirStat.isDirectory()) fail("SKILL_NOT_FOUND", "skill directory is unavailable");

  const skillFile = join(skillDir, SKILL_FILE_NAME);
  let fileStat;
  try {
    fileStat = lstatSync(skillFile);
  } catch {
    fail("SKILL_NOT_FOUND", "skill file is unavailable");
  }
  if (fileStat.isSymbolicLink()) fail("SKILL_SYMLINK_REJECTED", `${SKILL_FILE_NAME} is a symlink`);
  if (!fileStat.isFile()) fail("SKILL_FILE_INVALID", `${SKILL_FILE_NAME} must be a regular file`);
  if (fileStat.size <= 0) fail("SKILL_EMPTY", `${SKILL_FILE_NAME} is empty`);
  if (fileStat.size > SKILL_FILE_MAX) {
    fail("SKILL_FILE_TOO_LARGE", `${SKILL_FILE_NAME} exceeds 256 KiB`);
  }

  const fd = openSync(skillFile, "r");
  let content;
  try {
    content = readWholeFile(fd, fileStat.size);
    const after = fstatSync(fd);
    if (after.size !== fileStat.size || Number(after.mtimeMs) !== Number(fileStat.mtimeMs)) {
      fail("SKILL_CHANGED_DURING_READ", `${SKILL_FILE_NAME} changed while reading`);
    }
  } finally {
    closeSync(fd);
  }

  if (content.includes(0)) fail("SKILL_NUL_BYTE", `${SKILL_FILE_NAME} contains NUL`);
  if (!skillUtf8Valid(content)) fail("SKILL_UTF8_INVALID", `${SKILL_FILE_NAME} is not valid UTF-8`);
  if (!skillContentNonempty(content)) fail("SKILL_EMPTY", `${SKILL_FILE_NAME} contains only whitespace`);
  if (skillHasReservedMarker(content)) {
    fail("SKILL_RESERVED_MARKER", `${SKILL_FILE_NAME} contains a reserved marker`);
  }

  return {
    name,
    kind: kindIndex,
    content,
    contentLen: content.length,
    revision: skillSha1Hex(content)
  };
}

// skill_registry_lower_bound(): the registry is kept sorted by name, and names
// are validated ASCII, so a JS comparison is strcmp-equivalent.
function lowerBound(items, name) {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (items[mid].name < name) lo = mid + 1;
    else hi = mid;
  }
  const found = lo < items.length && items[lo].name === name;
  return { pos: lo, found };
}

// skill_registry_revise(): magic + NUL, then per entry name/kind/bytes/revision
// each NUL-terminated, all hashed with SHA-1.
export function aggregateRevisionOf(entries) {
  const parts = [Buffer.from(`${REGISTRY_MAGIC}\0`, "utf8")];
  for (const entry of entries) {
    parts.push(Buffer.from(`${entry.name}\0`, "utf8"));
    parts.push(Buffer.from(`${entry.kind}\0`, "utf8"));
    parts.push(Buffer.from(`${entry.contentLen}\0`, "utf8"));
    parts.push(Buffer.from(`${entry.revision}\0`, "utf8"));
  }
  const hash = createHash("sha1");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

export class SkillRegistry {
  constructor({ skillsDir } = {}) {
    this.skillsDir = skillsDir || null;
    this.items = [];
  }

  get totalBytes() {
    return this.items.reduce((sum, entry) => sum + entry.contentLen, 0);
  }

  get len() {
    return this.items.length;
  }

  list() {
    return this.items.map((entry) => ({
      name: entry.name,
      kind: skillKindName(entry.kind),
      revision: entry.revision,
      bytes: entry.contentLen
    }));
  }

  find(name) {
    const { pos, found } = lowerBound(this.items, name);
    return found ? this.items[pos] : null;
  }

  stage(name, kind = SKILL_KIND.DYNAMIC) {
    if (!this.skillsDir) fail("SKILL_NOT_FOUND", "invalid skills root");
    return stageSkill(this.skillsDir, name, kind);
  }

  // ds4_agent_skill_registry_upsert()
  upsert(staged) {
    if (!staged || !staged.content) fail("SKILL_IO_FAILED", "staged entry has no content");
    skillNameValid(staged.name);
    const kind = skillKindIndex(staged.kind === undefined ? SKILL_KIND.DYNAMIC : staged.kind);
    const content = Buffer.isBuffer(staged.content) ? staged.content : Buffer.from(staged.content);
    const entry = {
      name: staged.name,
      kind,
      content,
      contentLen: staged.contentLen ?? content.length,
      revision: staged.revision || skillSha1Hex(content)
    };

    const { pos, found } = lowerBound(this.items, entry.name);
    const existing = found ? this.items[pos] : null;
    if (
      existing &&
      existing.kind === entry.kind &&
      existing.contentLen === entry.contentLen &&
      existing.revision === entry.revision
    ) {
      return { changed: false, entry: existing };
    }

    const oldBytes = existing ? existing.contentLen : 0;
    if (!found && this.items.length >= SKILL_ACTIVE_MAX) {
      fail("SKILL_ACTIVE_LIMIT", "at most 32 skills may be active");
    }
    if (entry.contentLen > SKILL_TOTAL_MAX || this.totalBytes - oldBytes > SKILL_TOTAL_MAX - entry.contentLen) {
      fail("SKILL_TOTAL_TOO_LARGE", "active skills exceed 1 MiB");
    }

    if (existing) this.items[pos] = entry;
    else this.items.splice(pos, 0, entry);
    return { changed: true, entry };
  }

  // ds4_agent_skill_registry_remove()
  remove(name) {
    const { pos, found } = lowerBound(this.items, name);
    if (!found) return { changed: false };
    this.items.splice(pos, 1);
    return { changed: true };
  }

  // ds4_agent_skill_registry_render(): "\n\n" between blocks, header with the
  // revision, content, a newline only when the content lacked one, footer with
  // no trailing newline.
  render() {
    const blocks = this.items.map((entry) => {
      const header = `[BEGIN DS4 ACTIVE SKILL name=${entry.name} revision=${entry.revision}]\n`;
      const footer = `[END DS4 ACTIVE SKILL name=${entry.name}]`;
      const body = entry.content.toString("utf8");
      const separator = body.length > 0 && !body.endsWith("\n") ? "\n" : "";
      return `${header}${body}${separator}${footer}`;
    });
    return blocks.join("\n\n");
  }

  aggregateRevision() {
    return aggregateRevisionOf(this.items);
  }

  toJSON() {
    return {
      version: 1,
      aggregateRevision: this.aggregateRevision(),
      skills: this.items.map((entry) => ({
        name: entry.name,
        kind: entry.kind,
        revision: entry.revision,
        bytes: entry.contentLen,
        content: entry.content.toString("base64")
      }))
    };
  }

  static fromJSON(obj, { skillsDir } = {}) {
    const registry = new SkillRegistry({ skillsDir });
    for (const item of obj?.skills || []) {
      const content = Buffer.from(item.content || "", "base64");
      registry.items.push({
        name: item.name,
        kind: skillKindIndex(item.kind),
        content,
        contentLen: item.bytes ?? content.length,
        revision: item.revision
      });
    }
    registry.items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return registry;
  }
}
