// Resolve an omitted tool profile before sealing a proof, then pass that same
// profile to the executor. An explicit choice still reaches normal validation
// (and the tracker's profile-drift guard) unchanged.
export function resolveLeanToolProfile(args = {}, { defaultProfile = "core", lockedProfile = null } = {}) {
  if (args.profile) return args.profile;
  if (lockedProfile) return lockedProfile;
  return importsMathlib(args.code) ? "mathlib" : defaultProfile;
}

function importsMathlib(code) {
  if (typeof code !== "string" || !code.includes("Mathlib")) return false;
  // Mask comments (including nested Lean block comments) and string literals
  // while retaining line breaks, so examples cannot masquerade as imports.
  let source = "";
  let depth = 0;
  let lineComment = false;
  let string = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const pair = code.slice(i, i + 2);
    if (ch === "\n") {
      lineComment = false;
      source += "\n";
      continue;
    }
    if (lineComment) continue;
    if (depth) {
      if (pair === "/-") { depth++; i++; }
      else if (pair === "-/") { depth--; i++; }
      continue;
    }
    if (string) {
      if (ch === "\\") i++;
      else if (ch === '"') string = false;
      continue;
    }
    if (pair === "--") { lineComment = true; source += " "; i++; }
    else if (pair === "/-") { depth = 1; source += " "; i++; }
    else if (ch === '"') { string = true; source += '""'; }
    else source += ch;
  }
  for (const match of source.matchAll(/(?:^|\n)\s*(?:(?:public|meta)\s+)*import\s+([^\n]*)/g)) {
    if (match[1].split(/\s+/).some((module) => /^Mathlib(?:\.|$)/.test(module))) return true;
  }
  return false;
}
