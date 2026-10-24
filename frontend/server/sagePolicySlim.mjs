// Core vs full Sage policy (JS agent engine).
//
// skills/sage/SKILL.md is ~67 KB (~17k prompt tokens) and ~80% of it is the
// function-study quality gate (sign tables, asymptotes, plot package, PDF,
// 10/10 acceptance).  Sent on every agent turn it cost ~3 minutes of prefill
// even for "expand (x+y)^3".  The core keeps the rules every Sage task needs;
// the full text is used once the session is doing a function study.

// Top-level sections that only concern function studies.  Matched on the
// heading line, outside code fences.
const FUNCTION_STUDY_SECTIONS = [
  /^### 2\.4\b/,
  /^### 2\.5\b/,
  /^## 4\./,
  /^## 5\.4\b/,
  /^## 7\./,
  /^## 8\./,
  /^## 8\.1\b/,
  /^## 9\./
];
// Markdown heading level (2 or 3) of a line, or 0.
const headingLevel = (line) => (/^(#{2,3}) \S/.exec(line)?.[1].length ?? 0);

const CORE_NOTE =
  "> Policy ridotta: per uno studio di funzione il runtime carica le regole " +
  "complete (segno, asintoti, grafici, quality gate) prima del calcolo.";

export function sageCorePolicy(full) {
  const lines = String(full ?? "").split("\n");
  const out = [];
  let fenced = false;
  let droppedLevel = 0; // level of the dropped section; its subsections go too
  for (const line of lines) {
    if (/^```/.test(line)) fenced = !fenced;
    const level = fenced ? 0 : headingLevel(line);
    if (level && (!droppedLevel || level <= droppedLevel)) {
      droppedLevel = FUNCTION_STUDY_SECTIONS.some((pattern) => pattern.test(line)) ? level : 0;
    }
    if (!droppedLevel) out.push(line);
  }
  const core = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return core ? `${core}\n\n${CORE_NOTE}\n` : "";
}

const FUNCTION_STUDY_TEXT =
  /studi[oa]\s+(?:di\s+|la\s+|completo\s+(?:della\s+|di\s+)?)?(?:una\s+|la\s+)?funzion|function\s+stud|asintot|monoton|concavit|\bflessi\b|punti\s+di\s+flesso|tabella\s+(?:dei|di)\s+segn|grafico\s+della\s+funzion/i;

export function isFunctionStudyRequest(text) {
  return FUNCTION_STUDY_TEXT.test(String(text ?? ""));
}
