// WP15 turno C helper: build 05-long-markdown-report.json from real docs.
// Rejects text whose normalized 5-grams recur >= 4 times (STOP_REPEATED_TEXT_ECHO)
// or that trips a file-echo cluster (STOP_REPEATED_FILE_ECHO).
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const docs = [
  "docs/EVIDENCE_FIRST.md",
  ...readdirSync("docs/convergenza").filter((f) => /^WP\d+.*\.md$/.test(f)).sort().map((f) => "docs/convergenza/" + f),
  ...readdirSync("docs").filter((f) => f.endsWith(".md") && f !== "EVIDENCE_FIRST.md").sort().map((f) => "docs/" + f),
  "docs/convergenza/README.md", "AGENT.md", "CONTRIBUTING.md"
];
const norm = (s) => s.toLowerCase().replace(/\d+/g, "n").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
const grams = (s) => {
  const w = norm(s).split(" ");
  const g = [];
  for (let i = 0; i + 5 <= w.length; i++) g.push(w.slice(i, i + 5).join(" "));
  return g;
};
const fileRe = () => /[\w./-]+\.(?:c|h|mjs|md|json|txt|py|sh|lua|lea[n]|js|ts)\b/g;
const toks = (s) => new Set(norm(s).split(" ").filter(Boolean));
function jac(a, b) { let i = 0; for (const t of b) if (a.has(t)) i++; return i / Math.max(1, Math.min(a.size, b.size)); }
function fileEchoOk(text) {
  const clusters = [];
  const re = fileRe();
  let m;
  while ((m = re.exec(text))) {
    const win = text.slice(m.index, Math.min(text.length, m.index + 160));
    let c = clusters.find((c) => c.file === m[0] && jac(c.key, toks(win)) >= 0.6);
    if (c) { c.count++; if (c.count > 3) return false; }
    else clusters.push({ file: m[0], key: toks(win), count: 1 });
  }
  return true;
}
const counts = new Map();
const seenLines = new Set();
let body = "# Audit report on the convergence work packages\n\n";
const used = [];
const re2 = fileRe();
const lineOk = (t) => {
  if (!t) return true;
  if (seenLines.has(t)) return false;
  const fm = t.match(re2);
  return !fm; // STOP_FILE_LIST_ECHO counts every file token in the text
};
for (const d of docs) {
  // fenced code blocks are the main source of repeated normalized n-grams
  const raw = readFileSync(d, "utf8").replace(/```[\s\S]*?```/g, "");
  const head = `## Notes, part ${used.length + 1}\n\n`;
  // paragraph by paragraph: boilerplate paragraphs shared across docs are
  // dropped instead of rejecting the whole document
  const paras = raw.split(/\n\s*\n/)
    .map((p) => p
      .split("\n")
      .filter((l) => !/^\s*\|/.test(l)) // table skeletons repeat verbatim across WP docs
      .map((l) => l.replace(/^#{2,} /, "")) // heading level varies per doc
      .filter((l) => lineOk(l.trim()))
      .join("\n")
      .trim())
    .filter((p) => p.length > 40);
  // only lines actually kept become "seen" (boilerplate shared with later
  // docs must not blacklist the later docs wholesale)
  for (const p of paras) for (const l of p.split("\n")) if (l.trim()) seenLines.add(l.trim());
  let added = 0;
  for (const p of paras) {
    const piece = (added === 0 ? head : "") + p + "\n\n";
    // only the NEW grams may not exceed the threshold: grams already in the
    // body at <=3 must not block every future paragraph (global-count bug)
    const pc = new Map();
    for (const x of grams(piece)) pc.set(x, (pc.get(x) || 0) + 1);
    for (const [x, v] of pc) pc.set(x, v + (counts.get(x) || 0));
    let bad = false;
    for (const [, v] of pc) if (v > 3) { bad = true; break; }
    if (bad || !fileEchoOk(body + piece)) continue;
    body += piece;
    for (const [x, v] of pc) counts.set(x, v);
    added += p.length;
    if (body.length >= 17000) break;
  }
  if (added > 0) used.push(d);
  if (body.length >= 17000) break;
}
body += "\nEnd of audit report, marker zulu-foxtrot-7.\n";
const fc = new Map();
for (const x of grams(body)) fc.set(x, (fc.get(x) || 0) + 1);
let max = 0, worst = "";
for (const [k, v] of fc) if (v > max) { max = v; worst = k; }
console.log("docs used:", used.length, "chars:", body.length, "max5gram:", max, JSON.stringify(worst));
console.log("fileEchoOk:", fileEchoOk(body));
if (max > 3 || !fileEchoOk(body)) { console.error("REFUSED"); process.exit(1); }
const fx = {
  name: "05-long-markdown-report",
  backend: { propsNctx: 32768, tokenCounts: [100], turns: [{ content: body, finish: "stop" }] },
  requests: ["Write a long audit report about the convergence work."],
  expect: [
    { event: "agent_text", dataContains: { content: "zulu-foxtrot-7" } },
    { event: "agent_done", data: { finish_reason: "stop" } }
  ],
  expectAbsent: [
    { event: "agent_error" },
    { event: "agent_warning", dataContains: { type: "STOP_UNSTRUCTURED_LONG_OUTPUT" } }
  ]
};
writeFileSync("tests/fixtures/conformance/scenarios/05-long-markdown-report.json", JSON.stringify(fx, null, 2) + "\n");
console.log("fixture written");
