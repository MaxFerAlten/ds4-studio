/* WP10 conformance: the Node evidence ledger replays the same .ops fixtures
 * as the C driver (tests/ds4_agent_evidence_cli.c) and, when
 * DS4_CONFORMANCE_SHADOW points at a composed tree where the driver is
 * built, the two outputs must be byte-identical.
 *
 * Build the driver with:
 *   python3 ds4-overlay/scripts/overlayctl.py compose &&
 *   (cd $SHADOW && make -f Makefile.studio tests/ds4_agent_evidence_cli)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as eg from "./evidenceGuard.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "..", "..");
const FIXTURES = join(REPO, "tests", "fixtures", "conformance", "evidence");
const SHADOW = process.env.DS4_CONFORMANCE_SHADOW || "";

/* The mini-interpreter: same tokenizer, same ops, same output protocol as
 * tests/ds4_agent_evidence_cli.c. */
function tokenize(line) {
  const tok = [];
  let p = 0;
  while (p < line.length) {
    while (p < line.length && (line[p] === " " || line[p] === "\t")) p++;
    if (p >= line.length) break;
    if (line[p] === '"') {
      p++;
      let out = "";
      while (p < line.length && line[p] !== '"') {
        if (line[p] === "\\" && p + 1 < line.length) {
          p++;
          out += line[p] === "n" ? "\n" : line[p] === "t" ? "\t" : line[p];
          p++;
        } else {
          out += line[p];
          p++;
        }
      }
      if (p < line.length) p++;
      tok.push(out);
    } else {
      const start = p;
      while (p < line.length && line[p] !== " " && line[p] !== "\t") p++;
      tok.push(line.slice(start, p));
    }
  }
  return tok;
}

export function runOps(text) {
  /* The C driver's globals are zero-initialized: enabled only turns true on
   * an explicit reset (or through the tool handler). */
  let st = eg.createEvidenceState();
  let turn = eg.createEvidenceTurn();
  let gMode = eg.MODE.BLOCK;
  let out = "";
  const rej = (r) => {
    out += r.allowed
      ? "OK\n"
      : `REJ ${r.reasonCode ?? "?"} ${r.findingId || "-"} ${(r.missingChecks >>> 0).toString(16)}\n`;
  };

  for (const raw of text.split("\n")) {
    const tok = tokenize(raw.replace(/\r$/, ""));
    if (!tok.length || tok[0][0] === "#") continue;
    const op = tok[0];
    const need = (n) => {
      if (tok.length >= n) return true;
      out += "ERR too few arguments\n";
      return false;
    };
    if (op === "reset") {
      st = eg.createEvidenceState();
      turn = eg.createEvidenceTurn();
      st.enabled = true;
      gMode = eg.MODE.BLOCK;
    } else if (op === "fill") {
      for (let i = 0; i < eg.EVIDENCE_MAX_FINDINGS; i++) {
        eg.evidenceOpen(st, `EFA-${String(i + 1).padStart(3, "0")}`, "c", eg.CATEGORY.GENERAL);
      }
      out += "OK\n";
    } else if (op === "open") {
      if (!need(3)) continue;
      const cat = eg.parseCategory(tok[2]);
      if (cat === null) {
        out += "ERR bad category\n";
        continue;
      }
      rej(eg.evidenceOpen(st, tok[1], tok.slice(3).join(" "), cat));
    } else if (op === "add") {
      if (!need(4)) continue;
      const side = tok[2] === "for" ? eg.SIDE.FOR : tok[2] === "against" ? eg.SIDE.AGAINST : null;
      if (side === null) {
        out += "ERR bad side\n";
        continue;
      }
      rej(eg.evidenceAdd(st, tok[1], side, tok[3] === "dynamic"));
    } else if (op === "mark" || op === "markbit") {
      if (!need(4)) continue;
      let bit;
      if (op === "mark") {
        bit = eg.parseCheck(tok[2]);
        if (bit === null) {
          out += "ERR bad check\n";
          continue;
        }
      } else {
        bit = parseInt(tok[2], 10) >>> 0;
      }
      const res = eg.parseCheckResult(tok[3]);
      if (res === null) {
        out += "ERR bad result\n";
        continue;
      }
      const note = tok.length >= 5 ? (tok[4] === "-" ? null : tok[4]) : null;
      rej(eg.evidenceMarkCheck(st, tok[1], bit, res, note));
    } else if (op === "reach") {
      if (!need(3)) continue;
      const reach = eg.parseReachability(tok[2]);
      if (reach === null) {
        out += "ERR bad reachability\n";
        continue;
      }
      rej(eg.evidenceSetReachability(st, tok[1], reach));
    } else if (op === "verdict") {
      if (!need(5)) continue;
      const verdict = eg.parseState(tok[2]);
      if (verdict === null) {
        out += "ERR bad state\n";
        continue;
      }
      const severity = eg.parseSeverity(tok[3]);
      if (severity === null) {
        out += "ERR bad severity\n";
        continue;
      }
      rej(eg.evidenceSetVerdict(st, tok[1], verdict, severity, tok[4] === "true"));
    } else if (op === "finalize") {
      rej(eg.evidenceFinalize(st));
    } else if (op === "publish") {
      rej(eg.evidenceCanPublish(st));
    } else if (op === "tool") {
      if (!need(2)) continue;
      eg.evidenceNoteToolCall(st, turn, tok[1] === "status");
      out += `TOOL ${turn.toolUsedAfterFinalize ? 1 : 0}\n`;
    } else if (op === "scan") {
      rej(eg.evidenceScanFinalText(st, tok.slice(1).join(" ")));
    } else if (op === "status") {
      out += eg.evidenceStatus(st, gMode, "-");
    } else if (op === "digest") {
      out += eg.evidenceDigest(st);
    } else if (op === "serialize") {
      out += eg.evidenceSerialize(st);
    } else if (op === "mode") {
      if (!need(3)) continue;
      const m = eg.modeResolve(tok[1] === "-" ? null : tok[1], tok[2] === "yes");
      if (m.ok) {
        gMode = m.mode;
        out += `MODE ${eg.modeName(m.mode)}\n`;
      } else {
        out += `ERR ${m.error}\n`;
      }
    } else {
      out += `ERR unknown op ${op}\n`;
    }
  }
  return out;
}

function fixtures() {
  return readdirSync(FIXTURES).filter((n) => n.endsWith(".ops")).sort();
}

test("the JS ledger replays every .ops fixture without crashing", () => {
  const files = fixtures();
  assert.ok(files.length >= 18, `expected at least 18 fixtures, got ${files.length}`);
  for (const f of files) {
    const out = runOps(readFileSync(join(FIXTURES, f), "utf8"));
    assert.equal(typeof out, "string", f);
  }
});

test("C and JS produce byte-identical conformance output", (t) => {
  const cli = SHADOW ? join(SHADOW, "tests", "ds4_agent_evidence_cli") : "";
  if (!SHADOW || !existsSync(cli)) {
    return t.skip(
      "DS4_CONFORMANCE_SHADOW is not set or tests/ds4_agent_evidence_cli is not built: " +
        "run overlayctl compose + make -f Makefile.studio tests/ds4_agent_evidence_cli",
    );
  }
  for (const f of fixtures()) {
    const cOut = execFileSync(cli, [join(FIXTURES, f)], { encoding: "utf8" });
    const jsOut = runOps(readFileSync(join(FIXTURES, f), "utf8"));
    assert.equal(jsOut, cOut, `output differs for ${f}`);
  }
  return undefined;
});
