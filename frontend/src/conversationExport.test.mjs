import assert from "node:assert/strict";
import test from "node:test";
import {
  exportConversationMarkdown,
  markdownFileName,
  parseConversationMarkdown,
  parseConversationMetadata
} from "./conversationExport.mjs";

test("exports user and assistant turns as markdown", () => {
  const markdown = exportConversationMarkdown([
    { role: "user", content: "Spiega $x^2$" },
    { role: "assistant", content: "Certo.\n\n$$\nx^2\n$$" }
  ]);

  assert.match(markdown, /^# DS4 Conversation/);
  assert.match(markdown, /## User\n\nSpiega \$x\^2\$/);
  assert.match(markdown, /## Assistant\n\nCerto\.\n\n\$\$\nx\^2\n\$\$/);
});

test("includes reasoning only when requested", () => {
  const messages = [
    { role: "assistant", reasoning: "passo interno", content: "risposta finale" }
  ];

  assert.doesNotMatch(exportConversationMarkdown(messages, { includeReasoning: false }), /passo interno/);
  assert.match(exportConversationMarkdown(messages, { includeReasoning: true }), /### Reasoning\n\npasso interno/);
});

test("exports assistant tool calls and tool results", () => {
  const markdown = exportConversationMarkdown([
    { role: "user", content: "leggi ds4.h" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call_1",
          name: "read",
          arguments: JSON.stringify({ path: "ds4.h" }, null, 2)
        }
      ]
    },
    {
      role: "tool",
      name: "read",
      tool_call_id: "call_1",
      content: "1: #ifndef DS4_H"
    },
    { role: "assistant", content: "Ho letto il file." }
  ]);

  assert.match(markdown, /## Assistant/);
  assert.match(markdown, /### Tool Call: read/);
  assert.match(markdown, /"path": "ds4\.h"/);
  assert.match(markdown, /## Tool: read/);
  assert.match(markdown, /tool_call_id: `call_1`/);
  assert.match(markdown, /1: #ifndef DS4_H/);
});

test("parses exported markdown back into chat messages", () => {
  const markdown = exportConversationMarkdown([
    { role: "user", content: "Spiega $x^2$" },
    { role: "assistant", reasoning: "passo interno", content: "Risposta finale" }
  ], { includeReasoning: true });

  assert.deepEqual(parseConversationMarkdown(markdown), [
    { role: "user", content: "Spiega $x^2$", reasoning: "" },
    { role: "assistant", content: "Risposta finale", reasoning: "passo interno" }
  ]);
});

test("normalizes backslash math delimiters for Obsidian outside code fences", () => {
  const markdown = exportConversationMarkdown([
    {
      role: "assistant",
      content: [
        "Inline \\(a+b\\).",
        "",
        "\\[\\int_0^1 x dx\\]",
        "",
        "```txt",
        "\\(not math\\)",
        "```"
      ].join("\n")
    }
  ]);

  assert.match(markdown, /Inline \$a\+b\$\./);
  assert.match(markdown, /\$\$\n\\int_0\^1 x dx\n\$\$/);
  assert.match(markdown, /```txt\n\\\(not math\\\)\n```/);
});

test("trims whitespace inside dollar math delimiters for Obsidian", () => {
  const markdown = exportConversationMarkdown([
    {
      role: "assistant",
      content: [
        "- $ e^\\alpha_\\mu $ è il campo di tetrade.",
        "- $ \\omega_\\mu $ è la connessione di spin.",
        "",
        "$$ \\int_0^1 x dx $$",
        "",
        "```txt",
        "$ not math $",
        "```"
      ].join("\n")
    }
  ]);

  assert.match(markdown, /- \$e\^\\alpha_\\mu\$ è il campo di tetrade\./);
  assert.match(markdown, /- \$\\omega_\\mu\$ è la connessione di spin\./);
  assert.match(markdown, /\$\$\n\\int_0\^1 x dx\n\$\$/);
  assert.match(markdown, /```txt\n\$ not math \$\n```/);
});

test("normalizes vertical bars inside table math for Obsidian", () => {
  const markdown = exportConversationMarkdown([
    {
      role: "assistant",
      content: [
        "| Proprietà | Oscillatore Classico | Oscillatore Quantistico |",
        "| :--- | :--- | :--- |",
        "| Posizione | Moto sinusoidale deterministico. | Distribuzione $\\rho(x) = |\\psi(x)|^2$. |"
      ].join("\n")
    }
  ]);

  assert.match(markdown, /Distribuzione \$\\rho\(x\) = \\vert \\psi\(x\)\\vert \^2\$\./);
  assert.doesNotMatch(markdown, /\$\\rho\(x\) = \|\\psi/);
});

test("unwraps latex/math fenced blocks into Obsidian $$ math", () => {
  const markdown = exportConversationMarkdown([
    {
      role: "assistant",
      content: "Formula:\n\n```latex\n\\[\ne^{i\\pi} + 1 = 0\n\\]\n```"
    }
  ]);

  assert.match(markdown, /\$\$\ne\^\{i\\pi\} \+ 1 = 0\n\$\$/);
  assert.doesNotMatch(markdown, /```latex/);
});

test("wraps bare math fence body into $$ display math", () => {
  const markdown = exportConversationMarkdown([
    {
      role: "assistant",
      content: "```math\nE = mc^2\n```"
    }
  ]);

  assert.match(markdown, /\$\$\nE = mc\^2\n\$\$/);
  assert.doesNotMatch(markdown, /```math/);
});

test("generates stable markdown file names", () => {
  assert.equal(markdownFileName(new Date("2026-05-24T12:34:56Z")), "ds4-conversation-2026-05-24-12-34-56.md");
});

test("agent-mode client notices are not serialised as assistant turns", () => {
  const markdown = exportConversationMarkdown([
    { role: "user", content: "hi" },
    { role: "assistant", content: "Agent mode started.", agentNotice: true },
    { role: "assistant", content: "real answer" },
    { role: "assistant", content: "Agent mode stopped.", agentNotice: true }
  ]);

  assert.doesNotMatch(markdown, /Agent mode started/);
  assert.doesNotMatch(markdown, /Agent mode stopped/);
  assert.match(markdown, /real answer/);
});

test("appends metadata marker when metadata provided and parses it back", () => {
  const markdown = exportConversationMarkdown(
    [{ role: "user", content: "ciao" }, { role: "assistant", content: "hi" }],
    { metadata: { agentMode: true } }
  );
  assert.match(markdown, /<!-- ds4-meta: \{"agentMode":true\} -->/);
  assert.deepEqual(parseConversationMetadata(markdown), { agentMode: true });
});

test("metadata marker is stripped before block parsing", () => {
  const markdown = exportConversationMarkdown(
    [{ role: "user", content: "ciao" }],
    { metadata: { agentMode: true } }
  );
  const messages = parseConversationMarkdown(markdown);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[0].content, "ciao");
});

test("parseConversationMetadata returns null when no marker present", () => {
  const markdown = exportConversationMarkdown([{ role: "user", content: "ciao" }]);
  assert.equal(parseConversationMetadata(markdown), null);
});
