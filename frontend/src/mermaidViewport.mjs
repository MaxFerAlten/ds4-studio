export const MERMAID_MIN_SCALE = 0.25;
export const MERMAID_MAX_SCALE = 5;

function stableNumber(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function clampMermaidScale(scale) {
  const numericScale = Number.isFinite(scale) ? scale : 1;
  return Math.min(MERMAID_MAX_SCALE, Math.max(MERMAID_MIN_SCALE, numericScale));
}

export function zoomMermaidTransform(transform, targetScale, point) {
  const currentScale = clampMermaidScale(transform.scale);
  const nextScale = clampMermaidScale(targetScale);
  const ratio = nextScale / currentScale;

  return {
    scale: nextScale,
    x: point.x - (point.x - transform.x) * ratio,
    y: point.y - (point.y - transform.y) * ratio
  };
}

export function fitMermaidTransform(viewport, diagram, padding = 48) {
  const viewportWidth = Math.max(1, Number(viewport.width) || 0);
  const viewportHeight = Math.max(1, Number(viewport.height) || 0);
  const diagramWidth = Math.max(1, Number(diagram.width) || 0);
  const diagramHeight = Math.max(1, Number(diagram.height) || 0);
  const inset = Math.max(0, Number(padding) || 0);
  const availableWidth = Math.max(1, viewportWidth - inset * 2);
  const availableHeight = Math.max(1, viewportHeight - inset * 2);
  const scale = clampMermaidScale(
    Math.min(availableWidth / diagramWidth, availableHeight / diagramHeight)
  );

  return {
    scale: stableNumber(scale),
    x: stableNumber((viewportWidth - diagramWidth * scale) / 2),
    y: stableNumber((viewportHeight - diagramHeight * scale) / 2)
  };
}
