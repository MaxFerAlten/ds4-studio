// WP2 of convergenza.loop.md (decision D4): every text the two agent loops
// share has exactly one source of truth on disk, config/agent-text/<name>.txt.
//
// The C side keeps its own literals; this module *extracts* them so the .txt
// files are copied byte for byte from the sources instead of retyped, and so a
// text changed on one side only makes the parity test fail.
//
// Two sources are understood:
//   - a C translation unit (studio/ds4_agent.c of the composed shadow, or a
//     module in the repository root);
//   - a unified diff (ds4-overlay/patches/studio/studio__ds4_agent.c.patch),
//     where the new-file text is rebuilt from the '+' and context lines.
import { readFileSync } from "fs";

const ESCAPES = {
  n: "\n",
  t: "\t",
  r: "\r",
  '"': '"',
  "\\": "\\",
  "'": "'",
  "0": "\0",
  "a": "\x07",
  "b": "\b",
  "v": "\v",
  f: "\f"
};

export function decodeCString(body) {
  let out = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) break;
    if (Object.prototype.hasOwnProperty.call(ESCAPES, next)) {
      out += ESCAPES[next];
      i += 1;
      continue;
    }
    // Unknown escape: keep both characters, which is what the C compiler does
    // with anything this extractor does not model.
    out += ch + next;
    i += 1;
  }
  return out;
}

// Concatenated value of every C string literal in `text[start, end)`.
export function literalsBetween(text, start, end) {
  let out = "";
  let i = start;
  while (i < end) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "/") {
      i = text.indexOf("\n", i) === -1 ? end : text.indexOf("\n", i);
      continue;
    }
    if (ch !== '"') {
      i += 1;
      continue;
    }
    let body = "";
    i += 1;
    while (i < end) {
      if (text[i] === "\\") {
        body += text[i] + (text[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (text[i] === '"') break;
      body += text[i];
      i += 1;
    }
    i += 1; // closing quote
    out += decodeCString(body);
  }
  return out;
}

// New-file text of a region of a unified diff, from the line matching `anchor`
// for `lines` lines.  '+' and context lines are kept, '-' lines and @@ headers
// dropped, which reconstructs the composed file for that region.
export function patchRegion(patchText, anchor, lines = 80) {
  const patchLines = patchText.split("\n");
  const idx = patchLines.findIndex((line) => line.includes(anchor));
  if (idx === -1) throw new Error(`patch anchor not found: ${anchor}`);
  const kept = [];
  for (let i = idx; i < Math.min(patchLines.length, idx + lines); i += 1) {
    const line = patchLines[i];
    if (line.startsWith("@@")) continue;
    if (line.startsWith("-")) {
      if (kept.length) break;
      continue;
    }
    if (line.startsWith("+")) kept.push(line.slice(1));
    else if (line.startsWith(" ")) kept.push(line.slice(1));
    else if (line === "") kept.push("");
    else kept.push(line);
    // Stop once a statement that actually carried literals is complete; a
    // declaration like `agent_buf b = {0};` must not end the region.
    if (kept.length > 1 && /;\s*$/.test(kept.at(-1)) && kept.join("\n").includes('"')) break;
  }
  return kept.join("\n");
}

function regionOf(text, anchor, maxLines) {
  const lines = text.split("\n");
  const idx = lines.findIndex((line) => line.includes(anchor));
  if (idx === -1) throw new Error(`anchor not found: ${anchor}`);
  const kept = [];
  for (let i = idx; i < Math.min(lines.length, idx + maxLines); i += 1) {
    kept.push(lines[i]);
    if (kept.length > 1 && /;\s*$/.test(lines[i]) && kept.join("\n").includes('"')) break;
  }
  return kept.join("\n");
}

// One entry per shared text: how to reach the C literal and where it lands.
// `from.patch` means the anchor lives in the studio patch, otherwise in the C
// file given by `from.file`.
export const SHARED_TEXTS = [
  {
    name: "evidence-core-contract",
    from: { file: "ds4_agent_evidence_guard.c" },
    anchor: "const char ds4_agent_evidence_core_contract[] ="
  },
  {
    name: "evidence-open-guidance",
    from: { file: "ds4_agent_evidence_guard.c" },
    anchor: "const char ds4_agent_evidence_open_guidance[] ="
  },
  {
    name: "evidence-runtime-prompt",
    from: { patch: "studio__ds4_agent.c.patch" },
    anchor: "static const char agent_evidence_runtime_prompt[] =",
    shadow: { anchor: "static const char agent_evidence_runtime_prompt[] =" }
  },
  // The compaction base prompt is upstream code (the patch only changes the
  // signature and adds the Evidence clause), and a diff cannot be used to
  // rebuild it: the hunk that adds the clause skips the unchanged literal
  // lines.  Upstream is the source, and verify_upstream_clean.sh guarantees it
  // stays pristine, so this text cannot drift silently.
  {
    name: "compact-prompt",
    from: { file: "ds4_agent.c" },
    anchor: "static char *agent_compact_make_prompt(const char *reason) {",
    // Only the first agent_buf_puts: the Evidence clause is a separate text.
    stopBefore: "if (evidence_active)",
    maxLines: 40,
    shadow: {
      anchor: "static char *agent_compact_make_prompt(const char *reason, bool evidence_active) {",
      stopBefore: "if (evidence_active)",
      maxLines: 40
    }
  },
  {
    name: "compact-evidence-clause",
    from: { patch: "studio__ds4_agent.c.patch" },
    anchor: "if (evidence_active) {",
    maxLines: 12,
    shadow: { anchor: "if (evidence_active) {", maxLines: 12 }
  },
  // The two wrapper strings are upstream code (ds4_agent.c, never patched),
  // and they are taken as agent_worker_compact_transcript uses them, i.e. with
  // the surrounding newlines.  The anchors below match only that call site, not
  // the shorter const arrays declared near the top of the file.
  {
    name: "compact-summary-wrapper-begin",
    from: { file: "ds4_agent.c" },
    anchor: "\\n\\n[ds4-agent compacted earlier conversation",
    maxLines: 4,
    shadow: { anchor: "\\n\\n[ds4-agent compacted earlier conversation", maxLines: 4 }
  },
  {
    name: "compact-summary-wrapper-end",
    from: { file: "ds4_agent.c" },
    anchor: "verbatim below.]\\n\\n",
    maxLines: 4,
    shadow: { anchor: "verbatim below.]\\n\\n", maxLines: 4 }
  }
];

export function extractSharedText(spec, { repoRoot, shadowStudioFile, patchDir }) {
  let region;
  if (spec.from.patch) {
    const text = readFileSync(`${patchDir}/${spec.from.patch}`, "utf8");
    region = patchRegion(text, spec.anchor, spec.maxLines ?? 80);
  } else if (spec.from.shadow) {
    const text = readFileSync(shadowStudioFile, "utf8");
    region = regionOf(text, spec.anchor, spec.maxLines ?? 80);
  } else {
    const text = readFileSync(`${repoRoot}/${spec.from.file}`, "utf8");
    region = regionOf(text, spec.anchor, spec.maxLines ?? 80);
  }
  if (spec.stopBefore) {
    const cut = region.indexOf(spec.stopBefore);
    if (cut !== -1) region = region.slice(0, cut);
  }
  const value = literalsBetween(region, 0, region.length);
  if (!value) throw new Error(`no C literal extracted for ${spec.name}`);
  return value;
}

// Reads the same text out of the *composed* studio/ds4_agent.c, i.e. upstream
// plus the applied patch.  Used by the parity test to prove that the text the
// C loop actually sends and the text config/agent-text/ publishes are one text.
export function extractFromShadow(spec, shadowRoot) {
  const shadow = spec.shadow;
  if (!shadow) throw new Error(`${spec.name} has no shadow anchor`);
  const text = readFileSync(`${shadowRoot}/studio/ds4_agent.c`, "utf8");
  let region = regionOf(text, shadow.anchor, shadow.maxLines ?? 80);
  if (shadow.stopBefore) {
    const cut = region.indexOf(shadow.stopBefore);
    if (cut !== -1) region = region.slice(0, cut);
  }
  const value = literalsBetween(region, 0, region.length);
  if (!value) throw new Error(`no shadow literal for ${spec.name}`);
  return value;
}
