import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSageMarkdownImageLinks,
  resolveSageMarkdownImageTarget
} from "./sageArtifactLinks.mjs";

test("resolves relative Sage image links through the artifact endpoint", () => {
  assert.equal(
    resolveSageMarkdownImageLinks("![Grafico](function_plot.png)"),
    "![Grafico](/api/sage/artifacts/by-name/function_plot.png)"
  );
  assert.equal(
    resolveSageMarkdownImageLinks("![Derivata](./grafici/first%20derivative.svg \"figura\")"),
    "![Derivata](/api/sage/artifacts/by-name/first%20derivative.svg \"figura\")"
  );
});

test("resolves local file image links without exposing the local path", () => {
  assert.equal(
    resolveSageMarkdownImageTarget("file:///tmp/second_derivative_plot.png"),
    "/api/sage/artifacts/by-name/second_derivative_plot.png"
  );
  assert.equal(
    resolveSageMarkdownImageTarget("/home/user/work/function_plot.png"),
    "/api/sage/artifacts/by-name/function_plot.png"
  );
});

test("preserves stable, external, embedded, and non-image targets", () => {
  const targets = [
    "/api/sage/artifacts/session/plot.png",
    "https://example.test/plot.png",
    "data:image/png;base64,UE5H",
    "blob:https://example.test/id",
    "/assets/plot.png",
    "notes.md",
    "results.csv"
  ];
  for (const target of targets) {
    assert.equal(resolveSageMarkdownImageTarget(target), target);
  }
});
