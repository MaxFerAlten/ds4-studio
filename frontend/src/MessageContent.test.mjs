import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageContent } from "./MessageContent.mjs";

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
