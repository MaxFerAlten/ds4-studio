export function documentIsVisible(doc = globalThis.document) {
  return !doc || doc.hidden !== true;
}
