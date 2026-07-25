export function workspaceFromPath(pathname) {
  if (pathname === "/agno" || pathname.startsWith("/agno/")) return "agno";
  return "chat";
}

export function pathForWorkspace(mode) {
  if (mode === "agno") return "/agno";
  return "/";
}
