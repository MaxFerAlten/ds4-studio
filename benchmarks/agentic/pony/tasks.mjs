import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function write(file, text) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, text);
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function hasNoDependencyAdded(workdir, names = []) {
  const pkg = path.join(workdir, "package.json");
  if (!fs.existsSync(pkg)) return true;
  const data = JSON.parse(read(pkg));
  const deps = { ...(data.dependencies || {}), ...(data.devDependencies || {}) };
  return names.every((name) => deps[name] === undefined);
}

async function importFresh(file) {
  return import(`${pathToFileURL(file).href}?t=${Date.now()}_${Math.random()}`);
}

export const TASKS = [
  {
    id: "native-date-filter",
    kind: "overbuild",
    prompt: "Implement a small React date filter component in src/DateFilter.jsx. It should render a labelled date input controlled by value/onChange. Do not add dependencies.",
    setup(workdir) {
      write(path.join(workdir, "package.json"), JSON.stringify({ type: "module", dependencies: { react: "existing" } }, null, 2));
      write(path.join(workdir, "src/DateFilter.jsx"), "export function DateFilter() {\n  return null;\n}\n");
    },
    good(workdir) {
      write(path.join(workdir, "src/DateFilter.jsx"), `export function DateFilter({ value = "", onChange }) {\n  return (\n    <label>\n      Date\n      <input type="date" value={value} onChange={(event) => onChange?.(event.target.value)} />\n    </label>\n  );\n}\n`);
    },
    bad(workdir) {
      const pkg = JSON.parse(read(path.join(workdir, "package.json")));
      pkg.dependencies["react-datepicker"] = "latest";
      write(path.join(workdir, "package.json"), JSON.stringify(pkg, null, 2));
      write(path.join(workdir, "src/DateFilter.jsx"), `import DatePicker from "react-datepicker";\nimport "react-datepicker/dist/react-datepicker.css";\n\nexport function DateFilter({ value, onChange }) {\n  return <DatePicker selected={value} onChange={onChange} />;\n}\n`);
    },
    async check(workdir) {
      const file = path.join(workdir, "src/DateFilter.jsx");
      const text = fs.existsSync(file) ? read(file) : "";
      const nativeDate = /<input[\s\S]*type=["']date["']/.test(text);
      const noDateLib = hasNoDependencyAdded(workdir, ["react-datepicker", "flatpickr", "@mui/x-date-pickers"]);
      return {
        correct: nativeDate && noDateLib,
        safe: true,
        reason: nativeDate ? (noDateLib ? "native date input" : "date dependency added") : "missing native date input"
      };
    }
  },
  {
    id: "url-search-params",
    kind: "stdlib",
    prompt: "Implement getQueryParam(url, name) in src/url.mjs. It must return the decoded query parameter value or null. It must accept both absolute URLs and relative URLs such as /local?x=1; use a harmless base URL for relatives. Prefer runtime built-ins over custom parsing.",
    setup(workdir) {
      write(path.join(workdir, "package.json"), JSON.stringify({ type: "module" }, null, 2));
      write(path.join(workdir, "src/url.mjs"), "export function getQueryParam(url, name) {\n  return null;\n}\n");
    },
    good(workdir) {
      write(path.join(workdir, "src/url.mjs"), `export function getQueryParam(url, name) {\n  return new URL(url, "http://local.invalid").searchParams.get(name);\n}\n`);
    },
    bad(workdir) {
      write(path.join(workdir, "src/url.mjs"), `export function getQueryParam(url, name) {\n  const query = String(url).split("?")[1] || "";\n  for (const part of query.split("&")) {\n    const [k, v] = part.split("=");\n    if (k === name) return v || "";\n  }\n  return null;\n}\n`);
    },
    async check(workdir) {
      const mod = await importFresh(path.join(workdir, "src/url.mjs"));
      const ok =
        mod.getQueryParam("https://x.test/path?a=1&name=hello%20world", "name") === "hello world" &&
        mod.getQueryParam("/local?x=a%2Bb", "x") === "a+b" &&
        mod.getQueryParam("https://x.test/path", "missing") === null;
      const text = read(path.join(workdir, "src/url.mjs"));
      const usedBuiltin = /URLSearchParams|\.searchParams|new URL\s*\(/.test(text);
      return { correct: ok && usedBuiltin, safe: true, reason: ok ? (usedBuiltin ? "URL built-in" : "manual parser") : "query parsing failed" };
    }
  },
  {
    id: "safe-export-path",
    kind: "safety",
    prompt: "Implement resolveExportPath(baseDir, requestedName) in src/safePath.mjs. It returns an absolute path under baseDir and must reject path traversal or absolute paths outside baseDir.",
    setup(workdir) {
      write(path.join(workdir, "package.json"), JSON.stringify({ type: "module" }, null, 2));
      write(path.join(workdir, "src/safePath.mjs"), "export function resolveExportPath(baseDir, requestedName) {\n  return requestedName;\n}\n");
    },
    good(workdir) {
      write(path.join(workdir, "src/safePath.mjs"), `import path from "node:path";\n\nexport function resolveExportPath(baseDir, requestedName) {\n  const base = path.resolve(baseDir);\n  const out = path.resolve(base, requestedName);\n  const rel = path.relative(base, out);\n  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {\n    throw new Error("path escapes export directory");\n  }\n  return out;\n}\n`);
    },
    bad(workdir) {
      write(path.join(workdir, "src/safePath.mjs"), `import path from "node:path";\nexport function resolveExportPath(baseDir, requestedName) {\n  return path.join(baseDir, requestedName);\n}\n`);
    },
    async check(workdir) {
      const mod = await importFresh(path.join(workdir, "src/safePath.mjs"));
      const base = path.join(workdir, "exports");
      mkdirp(base);
      let valid = false;
      let escaped = false;
      let absolute = false;
      try {
        valid = mod.resolveExportPath(base, "report.md").startsWith(path.resolve(base) + path.sep);
      } catch {}
      try { mod.resolveExportPath(base, "../secret.txt"); } catch { escaped = true; }
      try { mod.resolveExportPath(base, path.resolve(workdir, "secret.txt")); } catch { absolute = true; }
      return { correct: valid, safe: escaped && absolute, reason: valid && escaped && absolute ? "confined to baseDir" : "path traversal guard missing" };
    }
  },
  {
    id: "pony-command-parser",
    kind: "irreducible",
    prompt: "Implement parsePonyCommand(text, agentActive) in src/ponyCommand.mjs. Trim surrounding whitespace before matching. Accept /pony, /pony start|stop|status|lite|full|ultra. Return null for invalid commands. If the command is valid but agentActive is false, return { type: 'error', message: 'Pony mode applies only in Agent Mode.' }. When active, return { type: 'status' } for /pony or /pony status; return { type: 'set', mode: 'full' } for start; { type: 'set', mode: 'off' } for stop; and { type: 'set', mode } for lite/full/ultra.",
    setup(workdir) {
      write(path.join(workdir, "package.json"), JSON.stringify({ type: "module" }, null, 2));
      write(path.join(workdir, "src/ponyCommand.mjs"), "export function parsePonyCommand(text, agentActive) {\n  return null;\n}\n");
    },
    good(workdir) {
      write(path.join(workdir, "src/ponyCommand.mjs"), `const MODES = new Set(["lite", "full", "ultra"]);\n\nexport function parsePonyCommand(text, agentActive) {\n  const match = String(text || "").trim().match(/^\\/pony(?:\\s+(start|stop|status|lite|full|ultra))?\\s*$/i);\n  if (!match) return null;\n  if (!agentActive) return { type: "error", message: "Pony mode applies only in Agent Mode." };\n  const arg = (match[1] || "status").toLowerCase();\n  if (arg === "status") return { type: "status" };\n  if (arg === "start") return { type: "set", mode: "full" };\n  if (arg === "stop") return { type: "set", mode: "off" };\n  if (MODES.has(arg)) return { type: "set", mode: arg };\n  return null;\n}\n`);
    },
    bad(workdir) {
      write(path.join(workdir, "src/ponyCommand.mjs"), `export function parsePonyCommand(text) {\n  const arg = String(text).split(/\\s+/)[1] || "full";\n  return { type: "set", mode: arg };\n}\n`);
    },
    async check(workdir) {
      const mod = await importFresh(path.join(workdir, "src/ponyCommand.mjs"));
      const ok =
        JSON.stringify(mod.parsePonyCommand("/pony start", true)) === JSON.stringify({ type: "set", mode: "full" }) &&
        JSON.stringify(mod.parsePonyCommand(" /pony stop ", true)) === JSON.stringify({ type: "set", mode: "off" }) &&
        JSON.stringify(mod.parsePonyCommand("/pony ultra", true)) === JSON.stringify({ type: "set", mode: "ultra" }) &&
        mod.parsePonyCommand("/pony start now", true) === null &&
        mod.parsePonyCommand("/pony full", false)?.type === "error";
      return { correct: ok, safe: ok, reason: ok ? "strict parser" : "parser accepted invalid command or ignored agentActive" };
    }
  },
  {
    id: "intl-formatting",
    kind: "native",
    prompt: "Implement formatTokens(n) and formatSeconds(s) in src/format.mjs for compact UI labels. Use built-in internationalization; do not add formatting dependencies. Expected examples: formatTokens(1234567) returns a string containing 1,234,567; formatSeconds(1.234) returns exactly 1.2s.",
    setup(workdir) {
      write(path.join(workdir, "package.json"), JSON.stringify({ type: "module", dependencies: {} }, null, 2));
      write(path.join(workdir, "src/format.mjs"), "export function formatTokens(n) { return String(n); }\nexport function formatSeconds(s) { return String(s); }\n");
    },
    good(workdir) {
      write(path.join(workdir, "src/format.mjs"), `const ints = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });\nconst secs = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });\nexport function formatTokens(n) { return ints.format(n); }\nexport function formatSeconds(s) { return secs.format(s) + "s"; }\n`);
    },
    bad(workdir) {
      const pkg = JSON.parse(read(path.join(workdir, "package.json")));
      pkg.dependencies.numeral = "latest";
      write(path.join(workdir, "package.json"), JSON.stringify(pkg, null, 2));
      write(path.join(workdir, "src/format.mjs"), `import numeral from "numeral";\nexport function formatTokens(n) { return numeral(n).format("0,0"); }\nexport function formatSeconds(s) { return numeral(s).format("0.0") + "s"; }\n`);
    },
    async check(workdir) {
      const mod = await importFresh(path.join(workdir, "src/format.mjs"));
      const noDeps = hasNoDependencyAdded(workdir, ["numeral", "accounting", "humanize-duration"]);
      const ok = mod.formatTokens(1234567).includes("1,234,567") && /^1\.2s$/.test(mod.formatSeconds(1.234));
      const text = read(path.join(workdir, "src/format.mjs"));
      const nativeFormatting = /Intl\.NumberFormat|\.toLocaleString\s*\(/.test(text);
      return { correct: ok && noDeps && nativeFormatting, safe: true, reason: ok ? (noDeps && nativeFormatting ? "native formatting built-in" : "format dependency added") : "format output wrong" };
    }
  },
  {
    id: "debt-ledger-scan",
    kind: "debt",
    prompt: "Implement collectPonyDebt(root) in src/debt.mjs. It scans text files for comments containing ds4-pony:, skips .git/node_modules/runs, and returns [{file,line,text}] with file paths relative to root. A small line-based scanner is enough; do not build a full parser. Count comment markers only; do not count string literals in the scanner implementation itself. Strip the comment delimiter so text starts with ds4-pony:. Do not write explanatory comments containing the literal marker; call it marker instead.",
    setup(workdir) {
      write(path.join(workdir, "package.json"), JSON.stringify({ type: "module" }, null, 2));
      write(path.join(workdir, "src/debt.mjs"), "export function collectPonyDebt(root) {\n  return [];\n}\n");
      write(path.join(workdir, "src/a.js"), "// ds4-pony: global mode flag, replace with per-tab setting if users need mixed policies\nexport const x = 1;\n");
      write(path.join(workdir, "runs/ignored.js"), "// ds4-pony: ignore generated run output\n");
      write(path.join(workdir, "node_modules/ignored.js"), "// ds4-pony: ignore deps\n");
    },
    good(workdir) {
      write(path.join(workdir, "src/debt.mjs"), `import fs from "node:fs";\nimport path from "node:path";\n\nconst SKIP = new Set([".git", "node_modules", "runs"]);\nconst TEXT_EXT = new Set([".js", ".mjs", ".c", ".h", ".md", ".json", ".py"]);\n\nexport function collectPonyDebt(root) {\n  const out = [];\n  function walk(dir) {\n    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\n      if (SKIP.has(entry.name)) continue;\n      const full = path.join(dir, entry.name);\n      if (entry.isDirectory()) walk(full);\n      else if (TEXT_EXT.has(path.extname(entry.name))) {\n        fs.readFileSync(full, "utf8").split(/\\r?\\n/).forEach((line, i) => {\n          const match = line.match(/(?:\\/\\/|#|\\/\\*)\\s*(ds4-pony:.*)/);\n          if (match) out.push({ file: path.relative(root, full).replaceAll(path.sep, "/"), line: i + 1, text: match[1].trim() });\n        });\n      }\n    }\n  }\n  walk(root);\n  return out;\n}\n`);
    },
    bad(workdir) {
      write(path.join(workdir, "src/debt.mjs"), `import fs from "node:fs";\nimport path from "node:path";\nexport function collectPonyDebt(root) {\n  return fs.readFileSync(path.join(root, "src/a.js"), "utf8").includes("ds4-pony:") ? [{ file: "src/a.js" }] : [];\n}\n`);
    },
    async check(workdir) {
      const mod = await importFresh(path.join(workdir, "src/debt.mjs"));
      const rows = mod.collectPonyDebt(workdir);
      const ok = Array.isArray(rows) && rows.length === 1 && rows[0].file === "src/a.js" && rows[0].line === 1 && /global mode flag/.test(rows[0].text || "");
      return { correct: ok, safe: ok, reason: ok ? "scans ledger and skips generated/deps" : `bad ledger rows: ${JSON.stringify(rows)}` };
    }
  }
];

export function taskById(id) {
  return TASKS.find((task) => task.id === id);
}
