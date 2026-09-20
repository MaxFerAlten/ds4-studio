// The browser bundle must not reach a Node built-in.
//
// src/ imports a handful of modules out of server/ (commandBuilder,
// requestPayload, requestDefaults). vite externalizes node: built-ins for the
// browser and the stub throws on property access, so one Node-only import
// anywhere in that reachable graph blanks the page at load time — with a
// console error and an empty #root, not a build failure.
//
// This regressed once: defaultConfig.mjs started importing contextConfig.mjs,
// which reaches costLimits -> fileIngestion -> node:fs/promises. Every Node
// test still passed, because under Node the import works fine.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));
const FRONTEND_DIR = resolve(SRC_DIR, "..");

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g;
const NODE_BUILTIN_RE = /^(?:node:|fs$|path$|os$|url$|crypto$|child_process$|net$|http$|https$|zlib$|stream$|worker_threads$|readline$)/;

function listFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else if (/\.(mjs|jsx|js)$/.test(entry) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

function importsOf(file) {
  const source = readFileSync(file, "utf8");
  const specifiers = [];
  for (const match of source.matchAll(IMPORT_RE)) specifiers.push(match[1]);
  return specifiers;
}

function resolveRelative(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.mjs`, `${base}.js`, `${base}.jsx`]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // keep trying the next extension
    }
  }
  return null;
}

test("no module reachable from src/ imports a Node built-in", () => {
  const queue = listFiles(SRC_DIR);
  const seen = new Set(queue);
  const violations = [];
  const parents = new Map();

  while (queue.length) {
    const file = queue.shift();
    for (const specifier of importsOf(file)) {
      if (NODE_BUILTIN_RE.test(specifier)) {
        const chain = [];
        for (let node = file; node; node = parents.get(node)) {
          chain.unshift(node.replace(`${FRONTEND_DIR}/`, ""));
        }
        violations.push(`${chain.join(" -> ")} imports ${specifier}`);
        continue;
      }
      const target = resolveRelative(file, specifier);
      if (!target || seen.has(target)) continue;
      seen.add(target);
      parents.set(target, file);
      queue.push(target);
    }
  }

  assert.deepEqual(violations, [], `browser bundle reaches Node built-ins:\n${violations.join("\n")}`);
});
