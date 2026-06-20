import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PrintingPressPrismResearchClient,
  parseCliResearchResult,
  latexToMarkdown,
  prepareTexForCompile,
  relaxTexForCompat,
  resolvePrintingPressPrismCliPath
} from "./prismResearchClient.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("parseCliResearchResult maps workflow ask JSON to research output", () => {
  const out = parseCliResearchResult({
    status: "success",
    output_text: "Final answer",
    conversation_id: "conv_123",
    citations: [
      { url: "https://a.example", title: "A", snippet: "aa" },
      { url: "" },
      { url: "https://b.example" }
    ]
  });
  assert.equal(out.status, "completed");
  assert.equal(out.outputText, "Final answer");
  assert.equal(out.conversationId, "conv_123");
  assert.deepEqual(out.citations, [
    { url: "https://a.example", title: "A", snippet: "aa" },
    { url: "https://b.example", title: "https://b.example", snippet: "" }
  ]);
});

test("runResearch invokes prism-pp-cli workflow ask with stdin and JSON output", async () => {
  let captured = null;
  const client = new PrintingPressPrismResearchClient({
    cliPath: "/tmp/prism-pp-cli",
    env: { PRISM_COOKIES: "session=abc" },
    execImpl: async (call) => {
      captured = call;
      return JSON.stringify({
        status: "success",
        output_text: "pong",
        conversation_id: "conv_1",
        citations: []
      });
    },
    pollIntervalMs: 2500,
    reasoningEffort: "high"
  });

  const out = await client.runResearch({ input: "Reply with exactly: pong" });
  assert.equal(out.status, "completed");
  assert.equal(out.outputText, "pong");
  assert.equal(captured.cliPath, "/tmp/prism-pp-cli");
  assert.deepEqual(captured.args.slice(0, 4), ["workflow", "ask", "--stdin", "--json"]);
  assert.ok(captured.args.includes("--select"));
  assert.ok(captured.args.includes("status,output_text,citations,conversation_id,response"));
  assert.ok(captured.args.includes("--poll-interval"));
  assert.ok(captured.args.includes("2500ms"));
  assert.ok(captured.args.includes("--poll-timeout"));
  assert.ok(captured.args.includes("3600000ms"));
  assert.ok(captured.args.includes("--reasoning-effort"));
  assert.ok(captured.args.includes("high"));
  assert.equal(captured.input, "Reply with exactly: pong");
  assert.equal(captured.env.PRISM_COOKIES, "session=abc");
});

test("runResearch maps a configured cookie env var to PRISM_COOKIES for the generated CLI", async () => {
  let captured = null;
  const client = new PrintingPressPrismResearchClient({
    cliPath: "prism-pp-cli",
    cookiesEnv: "DS4_PRISM_COOKIE_HEADER",
    env: { DS4_PRISM_COOKIE_HEADER: "custom=secret", PRISM_COOKIES: "old=stale" },
    execImpl: async (call) => {
      captured = call;
      return JSON.stringify({ status: "success", output_text: "ok" });
    }
  });

  await client.runResearch({ input: "q" });
  assert.equal(captured.env.PRISM_COOKIES, "custom=secret");
});

test("runResearch forwards project and user ids when configured", async () => {
  let args = null;
  const client = new PrintingPressPrismResearchClient({
    cliPath: "prism-pp-cli",
    projectId: "project-1",
    userId: "user-1",
    execImpl: async (call) => {
      args = call.args;
      return JSON.stringify({ status: "success", output_text: "ok" });
    }
  });

  await client.runResearch({ input: "q" });
  assert.equal(args[args.indexOf("--project-id") + 1], "project-1");
  assert.equal(args[args.indexOf("--user-id") + 1], "user-1");
});

test("runResearch rejects invalid JSON from the CLI", async () => {
  const client = new PrintingPressPrismResearchClient({
    cliPath: "prism-pp-cli",
    execImpl: async () => "not json"
  });
  await assert.rejects(() => client.runResearch({ input: "q" }), /invalid JSON/);
});

test("isConfigured reflects cliPath presence", () => {
  assert.equal(new PrintingPressPrismResearchClient({ cliPath: "" }).isConfigured(), false);
  assert.equal(new PrintingPressPrismResearchClient({ cliPath: "prism-pp-cli" }).isConfigured(), true);
});

test("runResearch auto-refreshes auth on 401 and retries once on success", async () => {
  let callCount = 0;
  let refreshCalled = false;
  const client = new PrintingPressPrismResearchClient({
    cliPath: "prism-pp-cli",
    execImpl: async () => {
      callCount++;
      if (callCount === 1) throw new Error("prism cli exited 1: GET /api/projects returned HTTP 401");
      return JSON.stringify({ status: "success", output_text: "retried ok" });
    },
    refreshImpl: async () => { refreshCalled = true; }
  });

  const out = await client.runResearch({ input: "q" });
  assert.equal(out.outputText, "retried ok");
  assert.equal(callCount, 2);
  assert.equal(refreshCalled, true);
});

test("runResearch retries with freshly refreshed config cookies instead of stale PRISM_COOKIES", async (t) => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "prism-refresh-config-"));
  t.after(() => rm(tempHome, { recursive: true, force: true }));
  const configPath = path.join(tempHome, "config.toml");
  const calls = [];
  const client = new PrintingPressPrismResearchClient({
    cliPath: "prism-pp-cli",
    env: { PRISM_COOKIES: "stale=bad" },
    configPath,
    execImpl: async (call) => {
      calls.push(call);
      if (calls.length === 1) throw new Error("prism cli exited 1: GET /api/projects returned HTTP 401");
      return JSON.stringify({ status: "success", output_text: "retried ok", citations: [] });
    },
    refreshImpl: async () => {
      await writeFile(configPath, "cookies = \"fresh=ok\"\n");
    }
  });

  const out = await client.runResearch({ input: "q" });

  assert.equal(out.outputText, "retried ok");
  assert.equal(calls[0].env.PRISM_COOKIES, "stale=bad");
  assert.equal(calls[1].env.PRISM_COOKIES, "fresh=ok");
});

test("runResearch does not retry on non-401 errors", async () => {
  let callCount = 0;
  const client = new PrintingPressPrismResearchClient({
    cliPath: "prism-pp-cli",
    execImpl: async () => {
      callCount++;
      throw new Error("prism cli exited 1: some other error");
    },
    refreshImpl: async () => { throw new Error("should not be called"); }
  });

  await assert.rejects(() => client.runResearch({ input: "q" }), /some other error/);
  assert.equal(callCount, 1);
});

test("runResearch reports refresh failure clearly", async () => {
  const client = new PrintingPressPrismResearchClient({
    cliPath: "prism-pp-cli",
    execImpl: async () => { throw new Error("prism cli exited 1: HTTP 401"); },
    refreshImpl: async () => { throw new Error("cookie tool missing"); }
  });

  await assert.rejects(
    () => client.runResearch({ input: "q" }),
    /prism auth expired and refresh failed: cookie tool missing/
  );
});

test("resolvePrintingPressPrismCliPath resolves the Prism CLI from cli-printing-press library", () => {
  const cliPath = resolvePrintingPressPrismCliPath({
    cliPath: "prism-pp-cli",
    printingPressPath: "cli-printing-press",
    spawnSyncImpl: () => ({
      status: 0,
      stdout: JSON.stringify([
        {
          api_name: "prism",
          cli_name: "prism-pp-cli",
          dir: "/home/user/printing-press/library/prism"
        }
      ])
    }),
    existsSyncImpl: (candidate) => candidate === "/home/user/printing-press/library/prism/prism-pp-cli"
  });

  assert.equal(cliPath, "/home/user/printing-press/library/prism/prism-pp-cli");
});

test("reauth script resolves Python from override or PATH instead of ephemeral tmp venv", async () => {
  const scriptPath = path.join(__dirname, "..", "..", "scripts", "reauth-prism.sh");
  const script = await readFile(scriptPath, "utf8");

  assert.doesNotMatch(script, /^PYTHON=\/tmp\/pyenve\/bin\/python3$/m);
  assert.match(script, /PRISM_REAUTH_PYTHON/);
  assert.match(script, /command -v python3/);
});

test("reauth extractor writes parseable TOML and skips binary-looking cookie values", async (t) => {
  const scriptPath = path.join(__dirname, "..", "..", "scripts", "reauth-prism.sh");
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "prism-reauth-home-"));
  t.after(() => rm(tempHome, { recursive: true, force: true }));
  const tempDb = path.join(tempHome, "cookies.db");

  const harness = String.raw`
import os
import re
import sqlite3
import tomllib
from pathlib import Path

script_path = Path(os.environ["SCRIPT_PATH"])
script = script_path.read_text()
match = re.search(r"cat << 'EOF' > \"\$TMP_PY\"\n(.*?)\nEOF\n", script, re.S)
if not match:
    raise AssertionError("embedded Python extractor not found")

code = match.group(1).replace(
    "TMP_DB = '/tmp/reauth-prism-cookies.db'",
    f"TMP_DB = {os.environ['TMP_DB']!r}",
)

tmp_db = Path(os.environ["TMP_DB"])
if tmp_db.exists():
    tmp_db.unlink()

conn = sqlite3.connect(tmp_db)
conn.execute("CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB)")
conn.executemany(
    "INSERT INTO cookies (host_key, name, value, encrypted_value) VALUES (?, ?, ?, ?)",
    [
        (".prism.openai.com", "ok", "", b"alpha'beta"),
        (".prism.openai.com", "bad", "", b"bad\x06value"),
    ],
)
conn.commit()
conn.close()

try:
    os.environ["HOME"] = os.environ["TMP_HOME"]
    os.environ["PRISM_REAUTH_SKIP_VALIDATE"] = "1"
    exec(compile(code, f"{script_path}:embedded-python", "exec"), {"__name__": "__main__"})
    config_path = Path(os.environ["TMP_HOME"]) / ".config/prism-pp-cli/config.toml"
    parsed = tomllib.loads(config_path.read_text())
    cookies = parsed["cookies"]
    assert "ok=alpha'beta" in cookies
    assert "bad=" not in cookies
finally:
    tmp_db.unlink(missing_ok=True)
`;

  const run = spawnSync("python3", ["-c", harness], {
    encoding: "utf8",
    env: {
      ...process.env,
      SCRIPT_PATH: scriptPath,
      TMP_DB: tempDb,
      TMP_HOME: tempHome
    }
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test("reauth extractor treats HTTP 401 validation as missing usable cookies", async (t) => {
  const scriptPath = path.join(__dirname, "..", "..", "scripts", "reauth-prism.sh");
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "prism-reauth-validate-"));
  t.after(() => rm(tempHome, { recursive: true, force: true }));
  const tempDb = path.join(tempHome, "cookies.db");

  const harness = String.raw`
import os
import re
import sqlite3
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(401)
        self.end_headers()
        self.wfile.write(b'{"error":"Unauthorized"}')

    def log_message(self, *_args):
        pass

server = HTTPServer(("127.0.0.1", 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()

script_path = Path(os.environ["SCRIPT_PATH"])
script = script_path.read_text()
match = re.search(r"cat << 'EOF' > \"\$TMP_PY\"\n(.*?)\nEOF\n", script, re.S)
if not match:
    raise AssertionError("embedded Python extractor not found")

code = match.group(1).replace(
    "TMP_DB = '/tmp/reauth-prism-cookies.db'",
    f"TMP_DB = {os.environ['TMP_DB']!r}",
)

tmp_db = Path(os.environ["TMP_DB"])
conn = sqlite3.connect(tmp_db)
conn.execute("CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB)")
conn.execute(
    "INSERT INTO cookies (host_key, name, value, encrypted_value) VALUES (?, ?, ?, ?)",
    (".prism.openai.com", "session", "stale-cookie", b""),
)
conn.commit()
conn.close()

try:
    os.environ["HOME"] = os.environ["TMP_HOME"]
    os.environ["PRISM_REAUTH_VALIDATE_URL"] = f"http://127.0.0.1:{server.server_port}/api/projects"
    try:
        exec(compile(code, f"{script_path}:embedded-python", "exec"), {"__name__": "__main__"})
    except SystemExit as exc:
        raise SystemExit(exc.code)
    raise AssertionError("extractor should reject 401 cookies")
finally:
    server.shutdown()
`;

  const run = spawnSync("python3", ["-c", harness], {
    encoding: "utf8",
    env: {
      ...process.env,
      SCRIPT_PATH: scriptPath,
      TMP_DB: tempDb,
      TMP_HOME: tempHome
    }
  });

  assert.equal(run.status, 2, run.stderr || run.stdout);
  assert.match(run.stderr, /HTTP 401|Unauthorized/);
});

test("reauth script opens Prism and retries extraction when no cookies exist yet", async (t) => {
  const scriptPath = path.join(__dirname, "..", "..", "scripts", "reauth-prism.sh");
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "prism-reauth-open-"));
  t.after(() => rm(tempHome, { recursive: true, force: true }));
  const profileDir = path.join(tempHome, ".config", "google-chrome", "Profile 1");
  const binDir = path.join(tempHome, "bin");
  await mkdir(profileDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await writeFile(path.join(profileDir, "Cookies"), "");
  await writeFile(path.join(binDir, "sqlite3"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });

  const statePath = path.join(tempHome, "python-count");
  const fakePython = path.join(binDir, "fake-python");
  await writeFile(fakePython, `#!/usr/bin/env bash
count=0
if [[ -f "${statePath}" ]]; then count=$(cat "${statePath}"); fi
count=$((count + 1))
printf '%s' "$count" > "${statePath}"
if [[ "$count" -eq 1 ]]; then
  echo "ERROR: no prism cookies found in Chrome profile" >&2
  exit 2
fi
echo "OK: cookies extracted"
exit 0
`, { mode: 0o755 });
  await chmod(fakePython, 0o755);

  const browserLog = path.join(tempHome, "browser.log");
  const fakeBrowser = path.join(binDir, "fake-browser");
  await writeFile(fakeBrowser, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${browserLog}"
exit 0
`, { mode: 0o755 });
  await chmod(fakeBrowser, 0o755);

  const run = spawnSync("bash", [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: tempHome,
      PATH: `${binDir}:${process.env.PATH}`,
      PRISM_REAUTH_BROWSER: fakeBrowser,
      PRISM_REAUTH_PYTHON: fakePython,
      PRISM_REAUTH_POLL_SECONDS: "0",
      PRISM_REAUTH_WAIT_SECONDS: "1"
    }
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(await readFile(statePath, "utf8"), "2");
  assert.match(await readFile(browserLog, "utf8"), /https:\/\/prism\.openai\.com/);
});

test("latexToMarkdown strips preamble and converts sections to headings", () => {
  const tex = "\\documentclass{article}\n\\begin{document}\n\\section{Introduction}\nHello world.\n\\subsection{Background}\nSome text.\n\\end{document}";
  const md = latexToMarkdown(tex);
  assert.match(md, /## Introduction/);
  assert.match(md, /### Background/);
  assert.match(md, /Hello world\./);
  assert.doesNotMatch(md, /\\documentclass/);
  assert.doesNotMatch(md, /\\begin\{document\}/);
});

test("latexToMarkdown converts text formatting commands", () => {
  const tex = "\\begin{document}\n\\textbf{bold} and \\textit{italic} and \\texttt{code}.\n\\end{document}";
  const md = latexToMarkdown(tex);
  assert.match(md, /\*\*bold\*\*/);
  assert.match(md, /\*italic\*/);
  assert.match(md, /`code`/);
});

test("latexToMarkdown converts abstract environment to blockquote", () => {
  const tex = "\\begin{document}\n\\begin{abstract}\nThis is the abstract.\n\\end{abstract}\n\\end{document}";
  const md = latexToMarkdown(tex);
  assert.match(md, /> \*\*Abstract\*\*/);
  assert.match(md, /This is the abstract\./);
});

test("latexToMarkdown converts itemize to markdown list", () => {
  const tex = "\\begin{document}\n\\begin{itemize}\n  \\item First item\n  \\item Second item\n\\end{itemize}\n\\end{document}";
  const md = latexToMarkdown(tex);
  assert.match(md, /^- First item/m);
  assert.match(md, /^- Second item/m);
});

test("latexToMarkdown preserves display equations as Obsidian math blocks", () => {
  const tex = [
    "\\begin{document}",
    "\\begin{equation}",
    "E_n = \\hbar\\omega\\left(n + \\frac{1}{2}\\right)",
    "\\end{equation}",
    "\\end{document}"
  ].join("\n");

  const md = latexToMarkdown(tex);

  assert.match(md, /\$\$\nE_n = \\hbar\\omega/);
  assert.doesNotMatch(md, /```/);
});

test("latexToMarkdown preserves inline dollar math commands", () => {
  const tex = [
    "\\begin{document}",
    "Sia $h_t \\in \\mathbb{R}^d$ lo stato nascosto e $\\omega_i$ una frequenza.",
    "\\end{document}"
  ].join("\n");

  const md = latexToMarkdown(tex);

  assert.match(md, /Sia \$h_t \\in \\mathbb\{R\}\^d\$/);
  assert.match(md, /\$\\omega_i\$/);
});

test("latexToMarkdown inlines lstinputlisting artifacts as fenced code", () => {
  const tex = [
    "\\begin{document}",
    "\\section{Code}",
    "\\lstinputlisting[style=pythonstyle]{experiment_harmonic_llm.py}",
    "\\end{document}"
  ].join("\n");

  const md = latexToMarkdown(tex, {
    artifacts: [{ filePath: "experiment_harmonic_llm.py", content: "print('energy')\n" }]
  });

  assert.match(md, /```python\nprint\('energy'\)\n```/);
  assert.doesNotMatch(md, /experiment_harmonic_llm\.py\s*$/);
});

test("latexToMarkdown preserves bibliography-style itemized links", () => {
  const tex = [
    "\\begin{document}",
    "\\section*{Linkografia}",
    "\\begin{itemize}",
    "\\item Transformer architecture: \\url{https://arxiv.org/abs/1706.03762}",
    "\\item DistilGPT-2 model card: \\url{https://huggingface.co/distilgpt2}",
    "\\end{itemize}",
    "\\end{document}"
  ].join("\n");

  const md = latexToMarkdown(tex);

  assert.match(md, /## Linkografia/);
  assert.match(md, /- Transformer architecture: https:\/\/arxiv\.org\/abs\/1706\.03762/);
  assert.match(md, /- DistilGPT-2 model card: https:\/\/huggingface\.co\/distilgpt2/);
});

test("latexToMarkdown inlines a shipped code file referenced before a stub listing", () => {
  const tex = [
    "\\begin{document}",
    "Il codice è disponibile nel file \\path{experiments/skeleton.py}.",
    "\\begin{lstlisting}[style=pythonstyle]",
    "import torch",
    "    main()",
    "\\end{lstlisting}",
    "\\end{document}"
  ].join("\n");
  const artifacts = [
    {
      filePath: "experiments/skeleton.py",
      content: "import torch\n\ndef main():\n    print('hi')\n\n\nmain()\n"
    }
  ];

  const md = latexToMarkdown(tex, { artifacts });

  assert.match(md, /```python/);
  assert.match(md, /def main\(\):/);
  assert.match(md, /print\('hi'\)/);
});

test("prepareTexForCompile replaces a stub listing with the referenced artifact", () => {
  const tex = [
    "\\path{a/skeleton.py}",
    "\\begin{lstlisting}[style=pythonstyle]",
    "import torch",
    "    main()",
    "\\end{lstlisting}"
  ].join("\n");
  const artifacts = [
    { filePath: "a/skeleton.py", content: "import torch\n\ndef main():\n    pass\n" }
  ];

  const out = prepareTexForCompile(tex, artifacts);

  assert.match(out, /def main\(\):/);
  assert.match(out, /\\begin\{lstlisting\}/);
  assert.doesNotMatch(out, /^ {4}main\(\)$/m);
});

test("prepareTexForCompile defines pythonstyle when referenced but missing", () => {
  const tex = [
    "\\documentclass{article}",
    "\\usepackage{listings}",
    "\\begin{document}",
    "\\begin{lstlisting}[style=pythonstyle]",
    "x = 1",
    "\\end{lstlisting}",
    "\\end{document}"
  ].join("\n");

  const out = prepareTexForCompile(tex, []);

  assert.match(out, /\\lstdefinestyle\{pythonstyle\}/);
  assert.ok(out.indexOf("\\lstdefinestyle{pythonstyle}") < out.indexOf("\\begin{document}"));
});

test("prepareTexForCompile appends a missing end-document", () => {
  const tex = "\\documentclass{article}\n\\begin{document}\nHi\n\\section*{Linkografia}";
  const out = prepareTexForCompile(tex, []);
  assert.match(out, /\\end\{document\}\s*$/);
  assert.equal((out.match(/\\end\{document\}/g) || []).length, 1);
});

test("prepareTexForCompile leaves an existing end-document untouched", () => {
  const tex = "\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}";
  const out = prepareTexForCompile(tex, []);
  assert.equal((out.match(/\\end\{document\}/g) || []).length, 1);
});

test("relaxTexForCompat drops babel so a missing language pack can't abort the build", () => {
  const tex = [
    "\\documentclass{article}",
    "\\usepackage[italian]{babel}",
    "\\begin{document}",
    "Ciao mondo",
    "\\end{document}"
  ].join("\n");

  const out = relaxTexForCompat(tex);

  assert.doesNotMatch(out, /\\usepackage(?:\[[^\]]*\])?\{babel\}/);
  assert.match(out, /Ciao mondo/);
});

test("prepareTexForCompile balances an orphan end-equation", () => {
  const tex = [
    "\\begin{equation}",
    "a = b",
    "\\end{equation}",
    "    c \\leq d",
    "\\end{equation}"
  ].join("\n");

  const out = prepareTexForCompile(tex, []);

  const begins = (out.match(/\\begin\{equation\}/g) || []).length;
  const ends = (out.match(/\\end\{equation\}/g) || []).length;
  assert.equal(begins, ends);
  assert.match(out, /\\begin\{equation\}\n {4}c \\leq d/);
});

test("parseCliResearchResult extracts .tex from codexDeltaFiles and converts to Markdown", () => {
  const diffLines = [
    "--- /dev/null",
    "+++ b/main.tex",
    "@@ -0,0 +1,8 @@",
    "+\\documentclass{article}",
    "+\\begin{document}",
    "+\\section{Introduction}",
    "+Hello world.",
    "+\\subsection{Background}",
    "+Some background.",
    "+\\end{document}",
    ""
  ];
  const diff = diffLines.join("\n");

  const out = parseCliResearchResult({
    status: "success",
    output_text: "Fatto: ho prodotto il paper scientifico completo in main.tex",
    citations: [],
    response: {
      payload: {
        codexDeltaFiles: [{ file_path: "main.tex", diff, status: "added" }]
      }
    }
  });

  assert.equal(out.status, "completed");
  assert.doesNotMatch(out.outputText, /Fatto:/);
  assert.match(out.outputText, /## Introduction/);
  assert.match(out.outputText, /Hello world\./);
  assert.equal(out.artifacts.length, 1);
  assert.equal(out.artifacts[0].filePath, "main.tex");
  assert.ok(out.artifacts[0].content.includes("\\documentclass{article}"));
  assert.ok(out.artifacts[0].content.includes("\\section{Introduction}"));
  assert.ok(out.artifacts[0].content.includes("\\subsection{Background}"));
});

test("parseCliResearchResult preserves multiple codex artifacts", () => {
  const docDiff = [
    "--- /dev/null",
    "+++ b/doc.txt",
    "@@ -0,0 +1,3 @@",
    "+\\section{Introduction}",
    "+Tex body",
    "+\\end{document}"
  ].join("\n");

  const pyDiff = "--- /dev/null\n+++ b/script.py\n@@ -0,0 +1,2 @@\n+print('hi')\n";

  const out = parseCliResearchResult({
    status: "success",
    output_text: "Artifacts",
    citations: [],
    response: {
      payload: {
        codexDeltaFiles: [
          { file_path: "doc.txt", diff: docDiff, status: "added" },
          { file_path: "script.py", diff: pyDiff, status: "added" }
        ]
      }
    }
  });

  assert.match(out.outputText, /## doc\.txt/);
  assert.match(out.outputText, /## script\.py/);
  assert.equal(out.artifacts.length, 2);
  assert.equal(out.artifacts[0].filePath, "doc.txt");
  assert.equal(out.artifacts[0].content, "\\section{Introduction}\nTex body\n\\end{document}");
  assert.equal(out.artifacts[1].filePath, "script.py");
  assert.equal(out.artifacts[1].content, "print('hi')\n");
});

test("parseCliResearchResult converts LaTeX with included code artifacts", () => {
  const texDiff = [
    "--- /dev/null",
    "+++ b/main.tex",
    "@@ -0,0 +1,8 @@",
    "+\\begin{document}",
    "+\\section{Esperimento}",
    "+\\begin{equation}",
    "+E = \\frac{1}{2}q^\\top Kq",
    "+\\end{equation}",
    "+\\lstinputlisting[style=pythonstyle]{experiment_harmonic_llm.py}",
    "+\\section*{Linkografia}",
    "+\\begin{itemize}",
    "+\\item PCA: \\url{https://scikit-learn.org/}",
    "+\\end{itemize}",
    "+\\end{document}"
  ].join("\n");
  const pyDiff = "--- /dev/null\n+++ b/experiment_harmonic_llm.py\n@@ -0,0 +1,1 @@\n+print('energy')\n";

  const out = parseCliResearchResult({
    status: "success",
    output_text: "done",
    citations: [],
    response: {
      payload: {
        codexDeltaFiles: [
          { file_path: "main.tex", diff: texDiff, status: "added" },
          { file_path: "experiment_harmonic_llm.py", diff: pyDiff, status: "added" }
        ]
      }
    }
  });

  assert.match(out.outputText, /\$\$\nE = \\frac/);
  assert.match(out.outputText, /```python\nprint\('energy'\)\n```/);
  assert.match(out.outputText, /## Linkografia/);
  assert.match(out.outputText, /https:\/\/scikit-learn\.org\//);
});

test("parseCliResearchResult falls back to output_text when no codexDeltaFiles", () => {
  const out = parseCliResearchResult({
    status: "success",
    output_text: "Plain text answer",
    citations: []
  });
  assert.equal(out.outputText, "Plain text answer");
  assert.deepEqual(out.artifacts, []);
});
