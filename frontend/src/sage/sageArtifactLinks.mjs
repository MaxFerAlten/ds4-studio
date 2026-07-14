const SAGE_IMAGE_EXTENSION_RE = /\.(?:png|svg)(?:[?#].*)?$/i;
const EXTERNAL_SCHEME_RE = /^(?:https?:|data:|blob:)/i;

function decodedBaseName(value) {
  const withoutSuffix = String(value || "").split(/[?#]/, 1)[0];
  const normalized = withoutSuffix.replaceAll("\\", "/");
  const encodedName = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (!encodedName) return "";
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return encodedName;
  }
}

export function resolveSageMarkdownImageTarget(target) {
  const raw = String(target || "").trim();
  if (!raw || raw.startsWith("/api/sage/artifacts/") || EXTERNAL_SCHEME_RE.test(raw)) {
    return raw;
  }
  if (raw.startsWith("/") && !/^\/(?:home|mnt|tmp|var\/tmp)\//.test(raw)) return raw;

  let candidate = raw;
  if (/^file:/i.test(candidate)) {
    try {
      candidate = new URL(candidate).pathname;
    } catch {
      candidate = candidate.replace(/^file:\/\/*/i, "/");
    }
  }
  if (!SAGE_IMAGE_EXTENSION_RE.test(candidate)) return raw;

  const name = decodedBaseName(candidate);
  if (!name || name === "." || name === "..") return raw;
  return `/api/sage/artifacts/by-name/${encodeURIComponent(name)}`;
}

export function resolveSageMarkdownImageLinks(markdown) {
  return String(markdown || "").replace(
    /(!\[[^\]]*\]\()([^\s)]+)(\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?(\))/g,
    (match, prefix, target, title = "", suffix) => {
      const resolved = resolveSageMarkdownImageTarget(target);
      return `${prefix}${resolved}${title}${suffix}`;
    }
  );
}
