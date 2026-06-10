import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  canShowMermaidFullscreen,
  MermaidFullscreen
} from "./MermaidFullscreen.mjs";

test("shows fullscreen only for a ready rendered diagram", () => {
  assert.equal(canShowMermaidFullscreen("ready", false), true);
  assert.equal(canShowMermaidFullscreen("ready", true), false);
  assert.equal(canShowMermaidFullscreen("pending", false), false);
  assert.equal(canShowMermaidFullscreen("generating", false), false);
  assert.equal(canShowMermaidFullscreen("error", false), false);
});

test("renders an accessible fullscreen trigger without mounting the viewer", () => {
  const html = renderToStaticMarkup(
    createElement(MermaidFullscreen, {
      svg: '<svg viewBox="0 0 100 50"><rect width="100" height="50"/></svg>'
    })
  );

  assert.match(html, /class="mermaid-diagram-fullscreen-trigger"/);
  assert.match(html, /aria-label="Apri diagramma Mermaid a schermo intero"/);
  assert.match(html, />Fullscreen<\/button>/);
  assert.doesNotMatch(html, /mermaid-fullscreen-viewer/);
  assert.doesNotMatch(html, /<svg/);
});
