import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as messageContentModule from "./MessageContent.mjs";

const { MessageContent } = messageContentModule;

test("renders inline and display LaTeX with KaTeX markup", () => {
  const html = renderToStaticMarkup(
    createElement(MessageContent, {
      content: "Inline $e^{i\\pi}+1=0$.\n\n$$\\int_0^1 x^2 dx = \\frac{1}{3}$$"
    })
  );

  assert.match(html, /class="[^"]*katex/);
  assert.match(html, /katex-display/);
  assert.doesNotMatch(html, /\$e\^\{i\\pi\}/);
});

test("keeps dollar signs inside code blocks as code text", () => {
  const html = renderToStaticMarkup(createElement(MessageContent, { content: "```sh\necho \"$HOME\"\n```" }));

  assert.match(html, /<pre><code/);
  assert.match(html, /\$HOME/);
  assert.doesNotMatch(html, /katex/);
});

test("renders Mermaid fenced blocks as diagram placeholders", () => {
  const html = renderToStaticMarkup(
    createElement(MessageContent, {
      content: "```mermaid\nflowchart LR\n  A[Prompt] --> B[Decode]\n```"
    })
  );

  assert.match(html, /class="mermaid-diagram"/);
  assert.match(html, /data-state="pending"/);
  assert.match(html, /Diagramma Mermaid/);
  assert.match(html, /class="mermaid-diagram-toggle"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /aria-label="Mostra sorgente Mermaid"/);
  assert.match(html, />Testo<\/button>/);
  assert.doesNotMatch(html, /mermaid-diagram-fullscreen-trigger/);
  assert.doesNotMatch(html, /<pre><code class="language-mermaid"/);
});

test("keeps an unfinished Mermaid fence in a stable generating state", () => {
  const html = renderToStaticMarkup(
    createElement(MessageContent, {
      content: "Introduzione.\n\n```mermaid\nflowchart LR\n  A[Prompt] --> B[Decode]"
    })
  );

  assert.match(html, /Introduzione\./);
  assert.match(html, /class="mermaid-diagram"/);
  assert.match(html, /data-state="generating"/);
  assert.match(html, /Diagramma in generazione\.\.\./);
  assert.doesNotMatch(html, /Rendering diagramma Mermaid/);
  assert.doesNotMatch(html, /flowchart LR/);
  assert.doesNotMatch(html, /mermaid-diagram-toggle/);
  assert.doesNotMatch(html, /mermaid-diagram-fullscreen-trigger/);
});

test("keeps Markdown after a closed Mermaid fence visible", () => {
  const html = renderToStaticMarkup(
    createElement(MessageContent, {
      content: [
        "Prima.",
        "",
        "```mermaid",
        "flowchart LR",
        "  A --> B",
        "```",
        "",
        "Dopo."
      ].join("\n")
    })
  );

  assert.match(html, /Prima\./);
  assert.match(html, /data-state="pending"/);
  assert.match(html, /Dopo\./);
  assert.doesNotMatch(html, /Diagramma in generazione/);
});

test("renders LaTeX backslash delimiters", () => {
  const html = renderToStaticMarkup(
    createElement(MessageContent, {
      content: "Inline \\(a^2+b^2=c^2\\).\n\n\\[\\sum_{n=1}^{3} n = 6\\]"
    })
  );

  assert.match(html, /class="[^"]*katex/);
  assert.match(html, /katex-display/);
  assert.doesNotMatch(html, /\\\(a\^2/);
  assert.doesNotMatch(html, /\\\[\\sum/);
});

test("unwraps latex fenced code so KaTeX renders the math", () => {
  const html = renderToStaticMarkup(
    createElement(MessageContent, {
      content: "```latex\n\\[\ne^{i\\pi} + 1 = 0\n\\]\n```"
    })
  );

  assert.match(html, /class="[^"]*katex/);
  assert.match(html, /katex-display/);
  assert.doesNotMatch(html, /<pre><code[^>]*>\\\[/);
});

test("unwraps math fenced code", () => {
  const html = renderToStaticMarkup(
    createElement(MessageContent, {
      content: "```math\nE = mc^2\n```"
    })
  );

  assert.match(html, /class="[^"]*katex/);
  assert.doesNotMatch(html, /<pre><code/);
});

test("renders portable KaTeX for bare inequalities and row spacing", () => {
  const html = renderToStaticMarkup(
    createElement(MessageContent, {
      content: [
        "$$",
        "f(x)=\\begin{cases}",
        "x-20, & 0\\le x<3,\\\\[2mm]",
        "2x-24, & 7<x\\le 10.",
        "\\end{cases}",
        "$$",
        "",
        "Inline $f''(2)=7>0$."
      ].join("\n")
    })
  );

  assert.match(html, /class="[^"]*katex/);
  assert.match(html, /katex-display/);
  assert.doesNotMatch(html, /ParseError/);
  assert.doesNotMatch(html, /\\\[2mm\]/);
});

test("renders display-math array environments with literal column pipes", () => {
  // Regression: a $$\begin{array}{c|c|c}...\end{array}$$ block was being
  // rewritten to \begin{array}{c\vert c\vert c}, which is not a valid KaTeX
  // column specifier, so the block fell back to red unparsed source.
  const html = renderToStaticMarkup(
    createElement(MessageContent, {
      content: [
        "$$",
        "\\begin{array}{c|c|c}",
        "\\text{Punto} & x & f(x)\\\\",
        "\\hline",
        "H_1 & 3.6098 & -15.8947\\\\",
        "\\end{array}",
        "$$"
      ].join("\n")
    })
  );

  assert.match(html, /class="[^"]*katex/);
  assert.match(html, /katex-display/);
  assert.doesNotMatch(html, /\\begin\{array\}\{c\\vert/);
  assert.doesNotMatch(html, /ParseError/);
});

test("renders GFM tables with math that contains vertical bars", () => {
  const html = renderToStaticMarkup(
    createElement(MessageContent, {
      content: [
        "| Proprietà | Oscillatore Classico | Oscillatore Quantistico |",
        "| :--- | :--- | :--- |",
        "| Posizione | Moto sinusoidale deterministico. | Distribuzione di probabilità $\\rho(x) = |\\psi(x)|^2$. |"
      ].join("\n")
    })
  );

  assert.match(html, /<table>/);
  assert.match(html, /<thead>/);
  assert.match(html, /<tbody>/);
  assert.match(html, /class="[^"]*katex/);
  assert.doesNotMatch(html, /\$\\rho\(x\) =/);
  assert.doesNotMatch(html, /<td>\^2\$\.<\/td>/);
});

test("renders complete LaTeX documents as Markdown and KaTeX", () => {
  const html = renderToStaticMarkup(
    createElement(MessageContent, {
      content: [
        "Ecco la spiegazione richiesta.",
        "",
        "\\documentclass{article}",
        "\\usepackage{amsmath}",
        "\\title{Oscillatori armonici negli LLM}",
        "\\author{}",
        "\\date{}",
        "\\begin{document}",
        "\\maketitle",
        "\\section{Introduzione}",
        "Un oscillatore segue \\(x(t)=A\\cos(\\omega t+\\phi)\\).",
        "\\begin{equation}",
        "\\ddot{x} + \\omega^2 x = 0",
        "\\end{equation}",
        "\\end{document}"
      ].join("\n")
    })
  );

  assert.match(html, /<h1>Oscillatori armonici negli LLM<\/h1>/);
  assert.match(html, /<h2>Introduzione<\/h2>/);
  assert.match(html, /class="[^"]*katex/);
  assert.match(html, /katex-display/);
  assert.doesNotMatch(html, /\\documentclass|\\usepackage|\\begin\{document\}|\\maketitle/);
});

test("converts LaTeX lstlisting environments to fenced code in document previews", () => {
  const html = renderToStaticMarkup(
    createElement(MessageContent, {
      content: [
        "\\documentclass{article}",
        "\\usepackage{listings}",
        "\\begin{document}",
        "\\section{Codice}",
        "Il codice segue.",
        "\\begin{lstlisting}[style=pythonstyle]",
        "import torch",
        "print(torch.__version__)",
        "\\end{lstlisting}",
        "\\end{document}"
      ].join("\n")
    })
  );

  assert.match(html, /<h2>Codice<\/h2>/);
  assert.match(html, /<pre><code class="language-python">import torch/);
  assert.match(html, /print\(torch\.__version__\)/);
  assert.doesNotMatch(html, /style=pythonstyle|lstlisting/);
});

test("keeps complete LaTeX documents inside ordinary code fences", () => {
  const html = renderToStaticMarkup(
    createElement(MessageContent, {
      content: [
        "```text",
        "\\documentclass{article}",
        "\\begin{document}",
        "\\section{Example}",
        "\\end{document}",
        "```"
      ].join("\n")
    })
  );

  assert.match(html, /<pre><code/);
  assert.match(html, /\\documentclass\{article\}/);
  assert.doesNotMatch(html, /<h2>Example<\/h2>/);
});

test("converts LaTeX prose formatting, lists, references, and trailing Markdown", () => {
  const html = renderToStaticMarkup(
    createElement(MessageContent, {
      content: [
        "\\documentclass{article}",
        "\\begin{document}",
        "\\section{Definizione}",
        "La \\textbf{risonanza semantica} usa \\emph{frequenze affini}.",
        "\\begin{equation}",
        "A = \\frac{F_0}{\\omega_0}",
        "\\label{eq:ampiezza}",
        "\\end{equation}",
        "Come mostrato nell'equazione \\ref{eq:ampiezza}:",
        "\\begin{itemize}",
        "\\item \\textbf{Caso risonante}: risposta elevata.",
        "\\item Caso smorzato: risposta debole.",
        "\\end{itemize}",
        "\\begin{enumerate}",
        "\\item Primo effetto.",
        "\\item Secondo effetto.",
        "\\end{enumerate}",
        "\\end{document}",
        "",
        "## Nota finale",
        "Il testo successivo deve rimanere visibile."
      ].join("\n")
    })
  );

  assert.match(html, /<strong>risonanza semantica<\/strong>/);
  assert.match(html, /<em>frequenze affini<\/em>/);
  assert.match(html, /equazione 1/);
  assert.match(html, /<ul>/);
  assert.match(html, /<ol>/);
  assert.match(html, /<strong>Caso risonante<\/strong>/);
  assert.match(html, /<h2>Nota finale<\/h2>/);
  assert.match(html, /Il testo successivo deve rimanere visibile/);
  assert.doesNotMatch(html, /\\(?:textbf|emph|ref|item|begin\{itemize\}|begin\{enumerate\})/);
});
