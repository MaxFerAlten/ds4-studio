import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROCM_STATUS_TTL_MS = 5000;
const ROCM_SMI_ARGS = [
  "--showtemp",
  "--showpower",
  "--showuse",
  "--showmemuse",
  "--showfan",
  "--showclocks",
  "--json"
];

function numberOrNull(value) {
  const text = String(value ?? "").trim();
  if (!text || /^N\/A$/i.test(text)) return null;
  const match = text.match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function clockOrEmpty(value) {
  const text = String(value ?? "").trim();
  if (!text || /^N\/A$/i.test(text)) return "";
  return text.replace(/^\((.*)\)$/, "$1");
}

function firstMatchingValue(values, patterns) {
  for (const [key, value] of Object.entries(values)) {
    if (patterns.some((pattern) => pattern.test(key))) return value;
  }
  return undefined;
}

function cardIndex(id) {
  const match = String(id).match(/\d+/);
  return match ? Number(match[0]) : 0;
}

export function parseRocmSmiJson(raw) {
  const parsed = JSON.parse(raw);
  const gpus = Object.entries(parsed)
    .filter(([, values]) => values && typeof values === "object")
    .map(([id, values]) => ({
      id,
      index: cardIndex(id),
      temperatureC: numberOrNull(firstMatchingValue(values, [/temperature.*\(c\)/i, /temp/i])),
      powerW: numberOrNull(firstMatchingValue(values, [/power.*\(w\)/i, /power/i])),
      gpuUsePercent: numberOrNull(firstMatchingValue(values, [/gpu use/i])),
      vramUsePercent: numberOrNull(firstMatchingValue(values, [/vram/i, /memory.*allocated/i])),
      fanPercent: numberOrNull(firstMatchingValue(values, [/fan.*%/i, /fan speed/i])),
      sclk: clockOrEmpty(firstMatchingValue(values, [/sclk.*speed/i])),
      sclkLevel: String(firstMatchingValue(values, [/sclk.*level/i]) ?? ""),
      mclk: clockOrEmpty(firstMatchingValue(values, [/mclk.*speed/i])),
      memoryActivity: String(firstMatchingValue(values, [/memory activity/i]) ?? "")
    }))
    .sort((a, b) => a.index - b.index);

  return {
    ok: true,
    source: "rocm-smi",
    timestamp: new Date().toISOString(),
    gpus
  };
}

export function createRocmStatusReader({
  execFileAsync: run = execFileAsync,
  now = Date.now,
  ttlMs = ROCM_STATUS_TTL_MS
} = {}) {
  let cachedStatus = null;
  let cachedAt = 0;
  let inflight = null;

  async function read() {
    try {
      const { stdout } = await run("rocm-smi", ROCM_SMI_ARGS, {
        timeout: 2500,
        maxBuffer: 1024 * 1024
      });
      return parseRocmSmiJson(stdout);
    } catch (err) {
      return {
        ok: false,
        source: "rocm-smi",
        timestamp: new Date().toISOString(),
        error: err.message,
        gpus: []
      };
    }
  }

  async function readCached() {
    const nowMs = now();
    if (cachedStatus && nowMs - cachedAt < ttlMs) return cachedStatus;
    if (inflight) return inflight;

    inflight = read()
      .then((status) => {
        cachedStatus = status;
        cachedAt = now();
        return status;
      })
      .finally(() => {
        inflight = null;
      });

    return inflight;
  }

  return { read, readCached };
}

const defaultReader = createRocmStatusReader();

export function readRocmStatus() {
  return defaultReader.read();
}

export function readRocmStatusCached() {
  return defaultReader.readCached();
}
