#!/usr/bin/env node
/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/acceptance-contract.md sections 24-29.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: DS4 offline agentic benchmark command pattern.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createCertificationBundle } from "../../../frontend/server/evolution/evolutionCertification.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function parseArguments(argv) {
  const result = { selftest: false, gate: false, live: false, level: "B", outputDir: null, runs: null, tasks: null, model: null, modelBaseUrl: null, token: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--selftest") result.selftest = true;
    else if (argument === "--gate") result.gate = true;
    else if (argument === "--live") result.live = true;
    else if (argument === "--level") {
      const level = argv[index + 1];
      if (!new Set(["B", "C", "D"]).has(level)) throw new Error(`INVALID_LEVEL:${level}`);
      result.level = level;
      index += 1;
    }
    else if (argument === "--artifacts-dir") {
      result.outputDir = argv[index + 1] ?? null;
      index += 1;
    } else if (argument === "--runs") {
      result.runs = Number(argv[index + 1]);
      if (!Number.isInteger(result.runs) || result.runs < 1) throw new Error(`INVALID_RUNS:${argv[index + 1]}`);
      index += 1;
    } else if (argument === "--tasks") {
      result.tasks = argv[index + 1] ?? null;
      index += 1;
    } else if (argument === "--model") {
      result.model = argv[index + 1] ?? null;
      index += 1;
    } else if (argument === "--model-base-url") {
      result.modelBaseUrl = argv[index + 1] ?? null;
      index += 1;
    } else if (argument === "--token") {
      result.token = argv[index + 1] ?? null;
      index += 1;
    }     else if (argument === "--help") result.help = true;
    else throw new Error(`UNKNOWN_ARGUMENT:${argument}`);
  }
  if (result.selftest && result.live) throw new Error("MUTUALLY_EXCLUSIVE: --selftest and --live cannot be used together.");
  return Object.freeze(result);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write("Usage: node benchmarks/agentic/evolution/run.mjs [--selftest | --live] [--gate] [--level B|C|D] [--artifacts-dir DIR] [--runs N] [--tasks FILE] [--model NAME] [--model-base-url URL] [--token TOKEN]\n");
    return 0;
  }
  if (options.live) {
    process.stderr.write("LIVE_EVOLUTION_NOT_AVAILABLE: Level C-E preview/live gates are intentionally disabled in the Level B kernel.\n");
    return 2;
  }
  if (!options.selftest) {
    process.stderr.write("SELFTEST_REQUIRED: use --selftest for the offline deterministic gate.\n");
    return 2;
  }
  const outputDir = options.outputDir ? path.resolve(REPOSITORY_ROOT, options.outputDir) : undefined;
  const bundleOptions = { repositoryRoot: REPOSITORY_ROOT, outputDir, level: options.level };
  if (options.live) {
    bundleOptions.live = true;
    bundleOptions.liveEvidence = null;
  }
  const result = await createCertificationBundle(bundleOptions);
  process.stdout.write(`${JSON.stringify({ outputDir: result.outputDir, ...result.decision })}\n`);
  return options.gate && result.decision.decision !== "PASS" ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
