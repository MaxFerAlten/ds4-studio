/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/behavioral-specification.md Level C/D model boundary.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: StructuredModelClient transport contract.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hashJson, sha256 } from "./evolutionIntegrity.mjs";

const DEFAULT_PROMPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "prompts");
const ROLE_OPTIONS = Object.freeze({
  critic: Object.freeze({ maxTokens: 4096 }),
  proposer: Object.freeze({ maxTokens: 4096 }),
  patcher: Object.freeze({ maxTokens: 8192 })
});

export class EvolutionModelError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "EvolutionModelError";
    this.code = code;
    this.details = details;
  }
}

function normalizeUsage(usage) {
  const promptTokens = usage?.prompt_tokens;
  const completionTokens = usage?.completion_tokens;
  const totalTokens = usage?.total_tokens;
  if (![promptTokens, completionTokens, totalTokens].every(Number.isSafeInteger)) {
    throw new EvolutionModelError("MODEL_USAGE_MISSING", "model response must include complete token usage");
  }
  return Object.freeze({ promptTokens, completionTokens, totalTokens });
}

function addUsage(left, right) {
  return Object.freeze({
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    totalTokens: left.totalTokens + right.totalTokens
  });
}

function validationMessage(error) {
  if (Array.isArray(error?.issues)) {
    return error.issues.slice(0, 16).map((issue) => `${issue.path || "$"}: ${issue.code}`).join("; ");
  }
  return String(error?.code ?? error?.message ?? "schema validation failed").slice(0, 2_000);
}

export class EvolutionModelClient {
  constructor({ client, promptsDir = DEFAULT_PROMPTS_DIR } = {}) {
    if (!client || typeof client.completeRole !== "function") throw new TypeError("client is required");
    this.client = client;
    this.promptsDir = path.resolve(promptsDir);
  }

  async completeStructured({ role, userInput, validator, signal, maxRepairs = 1 }) {
    if (!Object.hasOwn(ROLE_OPTIONS, role)) throw new EvolutionModelError("UNKNOWN_MODEL_ROLE", role);
    if (typeof validator !== "function") throw new TypeError("validator is required");
    const systemPrompt = await fs.readFile(path.join(this.promptsDir, `${role}.md`), "utf8");
    const userPrompt = typeof userInput === "string" ? userInput : JSON.stringify(userInput);
    const repairLimit = maxRepairs > 0 ? 1 : 0;
    let semanticCalls = 0;
    let transportCalls = 0;
    let repairs = 0;
    let usage = Object.freeze({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    let response;
    let value;
    let lastError;
    while (semanticCalls <= repairLimit) {
      semanticCalls += 1;
      const prompt = lastError
        ? `${userPrompt}\n\nSchema validation failed: ${validationMessage(lastError)}. Return one corrected JSON object only.`
        : userPrompt;
      response = await this.client.completeRole({
        roleName: role,
        systemPrompt,
        userPrompt: prompt,
        json: true,
        stream: false,
        temperature: 0,
        think: false,
        maxTokens: ROLE_OPTIONS[role].maxTokens,
        signal
      });
      transportCalls += Number.isSafeInteger(response.attempts) && response.attempts > 0 ? response.attempts : 1;
      usage = addUsage(usage, normalizeUsage(response.usage));
      try {
        value = await validator(response.json);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (semanticCalls > repairLimit) break;
        repairs += 1;
      }
    }
    if (lastError) {
      throw new EvolutionModelError("MODEL_SCHEMA_INVALID", validationMessage(lastError), { role, calls: transportCalls, repairs });
    }
    return Object.freeze({
      value,
      evidence: Object.freeze({
        schema: "ds4_evolution_model_evidence_v1",
        role,
        model: this.client.model ?? "unknown",
        promptHash: sha256(`${systemPrompt}\n${userPrompt}`),
        responseHash: hashJson(response.json),
        usage,
        calls: transportCalls,
        repairs
      })
    });
  }
}
