import test from "node:test";
import assert from "node:assert/strict";
import { PrintingPressPrismResearchClient, parseCliResearchResult, latexToMarkdown } from "./prismResearchClient.mjs";

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
  const tex = "\\begin{document}\n\\begin{itemize}\n\\item First item\n\\item Second item\n\\end{itemize}\n\\end{document}";
  const md = latexToMarkdown(tex);
  assert.match(md, /- First item/);
  assert.match(md, /- Second item/);
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

test("parseCliResearchResult falls back to output_text when no codexDeltaFiles", () => {
  const out = parseCliResearchResult({
    status: "success",
    output_text: "Plain text answer",
    citations: []
  });
  assert.equal(out.outputText, "Plain text answer");
  assert.deepEqual(out.artifacts, []);
});
