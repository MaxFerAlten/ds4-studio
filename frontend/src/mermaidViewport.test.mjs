import assert from "node:assert/strict";
import test from "node:test";
import {
  clampMermaidScale,
  fitMermaidTransform,
  zoomMermaidTransform
} from "./mermaidViewport.mjs";

test("clamps Mermaid zoom between 25% and 500%", () => {
  assert.equal(clampMermaidScale(0.1), 0.25);
  assert.equal(clampMermaidScale(1.5), 1.5);
  assert.equal(clampMermaidScale(8), 5);
});

test("keeps the point under the cursor fixed while zooming", () => {
  const next = zoomMermaidTransform(
    { scale: 1, x: 10, y: 20 },
    2,
    { x: 110, y: 120 }
  );

  assert.deepEqual(next, { scale: 2, x: -90, y: -80 });
});

test("fits and centers a Mermaid diagram inside the viewport", () => {
  const transform = fitMermaidTransform(
    { width: 1000, height: 800 },
    { width: 1600, height: 400 },
    40
  );

  assert.deepEqual(transform, { scale: 0.575, x: 40, y: 285 });
});

test("fit respects the maximum zoom for small diagrams", () => {
  const transform = fitMermaidTransform(
    { width: 1000, height: 800 },
    { width: 100, height: 100 },
    40
  );

  assert.deepEqual(transform, { scale: 5, x: 250, y: 150 });
});
