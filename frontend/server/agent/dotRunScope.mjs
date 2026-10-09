export function dotToolName(schema) {
  return schema?.function?.name ?? schema?.name ?? "";
}

export function toolsForDot(tools, dot) {
  if (!dot) return tools;
  const allowed = new Set(dot.allowedTools ?? []);
  return tools.filter((tool) => allowed.has(dotToolName(tool)));
}

export function allowedToolsForDot(sessionScope, dot) {
  if (!dot) return sessionScope ?? null;
  const allowed = new Set(dot.allowedTools ?? []);
  if (!Array.isArray(sessionScope)) return [...allowed];
  return sessionScope.filter((name) => allowed.has(name));
}

export function dotContextText(dot) {
  if (!dot) return "";
  const parts = [];
  if (dot.instructions) parts.push(`[Istruzioni Dot: ${dot.name}]\n${dot.instructions}`);
  if (dot.pages?.length) {
    parts.push(`[Pages autorizzate dal Dot: ${dot.name}]\n${dot.pages.map((page) => `## ${page.title}\n${page.content}`).join("\n\n")}`);
  }
  return parts.join("\n\n");
}
