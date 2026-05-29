import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ROOT = path.resolve(FRONTEND_ROOT, "..");
export const PROFILES_DIR = path.join(PROJECT_ROOT, "profiles");
export const DEFAULT_PROFILE_NAME = "ds4-profile-p1-strict-quality";

function nullable(value) {
  if (value === null || value === undefined) return "";
  return value;
}

export function mapProfileToServerConfig(profile) {
  const s = profile.server || {};
  const runtime = s.runtime || {};
  const quality = s.quality || {};
  const http = s.http || {};
  const kv = s.kv_cache || {};
  const tool = s.tool_replay || {};
  const steering = s.steering || {};
  return {
    binary: s.binary ?? "./ds4-server",
    model: s.model ?? "ds4flash.gguf",
    mtp: nullable(s.mtp_model),
    mtpDraft: runtime.mtp_draft ?? s.mtp_draft ?? 1,
    mtpMargin: runtime.mtp_margin ?? s.mtp_margin ?? 3,
    ctx: runtime.context ?? 65536,
    tokens: runtime.default_tokens ?? 8192,
    threads: runtime.threads ?? 0,
    backend: runtime.backend ?? "auto",
    quality: false,
    warmWeights: Boolean(quality.warm_weights),
    host: http.host ?? "127.0.0.1",
    port: http.port ?? 8002,
    trace: nullable(http.trace_file),
    dirSteeringFile: nullable(steering.direction_file),
    dirSteeringFfn: steering.steer_ffn ?? "",
    dirSteeringAttn: steering.steer_attention ?? "",
    kvDiskDir: nullable(kv.kv_disk_dir),
    kvDiskSpaceMb: kv.kv_disk_mb ?? 4096,
    kvCacheMinTokens: kv.kv_min_tokens ?? 512,
    kvCacheColdMaxTokens: kv.kv_cold_max ?? 30000,
    kvCacheContinuedIntervalTokens: kv.kv_interval ?? 10000,
    kvCacheBoundaryTrimTokens: kv.kv_trim ?? 32,
    kvCacheBoundaryAlignTokens: kv.kv_align ?? 2048,
    kvCacheRejectDifferentQuant: Boolean(kv.reject_quant_mismatch),
    disableExactDsmlToolReplay: Boolean(tool.disable_exact_dsml_replay),
    toolMemoryMaxIds: tool.tool_memory_ids ?? 100000
  };
}

export function mapProfileToRequestDefaults(profile) {
  const r = profile.request_defaults || {};
  const thinkingType = r.thinking?.type;
  return {
    max_tokens: r.max_tokens ?? 4096,
    temperature: r.temperature ?? 0,
    top_p: r.top_p ?? 1,
    top_k: r.top_k ?? 0,
    min_p: r.min_p ?? 0,
    seed: r.seed ?? 42,
    stream: r.stream ?? true,
    thinking: thinkingType === "enabled",
    reasoning_effort: r.reasoning_effort && r.reasoning_effort !== "disabled" ? r.reasoning_effort : "high",
    stop: Array.isArray(r.stop) ? r.stop.join(",") : (r.stop ?? "")
  };
}

export async function listProfiles() {
  let entries;
  try {
    entries = await fs.readdir(PROFILES_DIR);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const name = entry.replace(/\.json$/, "");
    const file = path.join(PROFILES_DIR, entry);
    try {
      const raw = await fs.readFile(file, "utf8");
      const profile = JSON.parse(raw);
      out.push({
        name,
        file,
        label: profile.profile || name,
        description: profile.description || "",
        profile
      });
    } catch (err) {
      out.push({ name, file, label: name, description: "", error: err.message });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function loadProfileByName(name) {
  const list = await listProfiles();
  return list.find((p) => p.name === name) || null;
}

export async function loadProfileOrDefault(name) {
  const wanted = name && typeof name === "string" ? name : DEFAULT_PROFILE_NAME;
  const exact = await loadProfileByName(wanted);
  if (exact && !exact.error) return exact;
  if (wanted !== DEFAULT_PROFILE_NAME) {
    const fallback = await loadProfileByName(DEFAULT_PROFILE_NAME);
    if (fallback && !fallback.error) return fallback;
  }
  return null;
}
