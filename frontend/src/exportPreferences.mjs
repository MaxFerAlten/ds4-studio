export const EXPORT_INCLUDE_REASONING_KEY = "ds4.export.includeReasoning";
export const EXPORT_DIR_KEY = "ds4.export.dir";

function safeStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function readStoredExportIncludeReasoning(storage) {
  const store = safeStorage(storage);
  if (!store) return null;
  const value = store.getItem(EXPORT_INCLUDE_REASONING_KEY);
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function writeStoredExportIncludeReasoning(includeReasoning, storage) {
  const store = safeStorage(storage);
  if (!store) return;
  store.setItem(EXPORT_INCLUDE_REASONING_KEY, includeReasoning ? "true" : "false");
}

export function clearStoredExportIncludeReasoning(storage) {
  const store = safeStorage(storage);
  if (!store) return;
  store.removeItem(EXPORT_INCLUDE_REASONING_KEY);
}

export function readStoredExportDir(storage) {
  const store = safeStorage(storage);
  if (!store) return "";
  return store.getItem(EXPORT_DIR_KEY) || "";
}

export function writeStoredExportDir(dir, storage) {
  const store = safeStorage(storage);
  if (!store) return;
  const value = String(dir || "").trim();
  if (!value) {
    store.removeItem(EXPORT_DIR_KEY);
    return;
  }
  store.setItem(EXPORT_DIR_KEY, value);
}
