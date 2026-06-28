import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const AMD_SMI_TTL_MS = 5000;

function valueOf(x) {
  if (x == null || x === "N/A") return null;
  if (typeof x === "number") return x;
  if (typeof x === "object" && typeof x.value === "number") return x.value;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function percent(used, total) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return (used / total) * 100;
}

async function readGpuBusyFromSysfs() {
  const results = [];
  try {
    const drm = await readdir("/sys/class/drm");
    const cardDirs = drm.filter((e) => /^card\d+$/.test(e));
    for (const dir of cardDirs) {
      const path = `/sys/class/drm/${dir}/device/gpu_busy_percent`;
      try {
        const content = await readFile(path, "utf8");
        const index = parseInt(dir.replace("card", ""), 10);
        results.push({ index, gpuBusyPercent: Number(content.trim()) });
      } catch {
        // not available
      }
    }
  } catch {
    // no sysfs
  }
  return results;
}

export function parseAmdSmiMetricJson(raw) {
  const json = JSON.parse(raw);
  const gpuData = json.gpu_data ?? [];

  const gpus = gpuData.map((gpu, index) => {
    const mem = gpu.mem_usage ?? {};
    const temp = gpu.temperature ?? {};
    const clock = gpu.clock ?? {};
    const fan = gpu.fan ?? {};
    const power = gpu.power ?? {};

    const gttTotalMb = valueOf(mem.total_gtt);
    const gttUsedMb = valueOf(mem.used_gtt);
    const gttFreeMb = valueOf(mem.free_gtt);

    const visibleVramTotalMb = valueOf(mem.total_visible_vram ?? mem.total_vram);
    const visibleVramUsedMb = valueOf(mem.used_visible_vram ?? mem.used_vram);
    const visibleVramFreeMb = valueOf(mem.free_visible_vram ?? mem.free_vram);

    const gpuUsePercent = valueOf(gpu.usage);
    const temperatureC = valueOf(temp.edge);
    const powerW = valueOf(power.socket_power);
    const fanPercent = valueOf(fan.usage ?? fan.speed);
    const fanRpm = valueOf(fan.rpm);
    const fclkMhz = valueOf(clock.fclk_0?.clk);
    const perfLevel = gpu.perf_level === "N/A" ? null : gpu.perf_level;

    // Backward compat: populate vramUsePercent from visible VRAM if available
    const vramUsePercent = percent(visibleVramUsedMb, visibleVramTotalMb) ??
                           percent(gttUsedMb, gttTotalMb);

    return {
      id: `gpu${index}`,
      index,

      temperatureC,
      powerW,
      gpuUsePercent,
      vramUsePercent,
      vramTotalBytes: visibleVramTotalMb != null ? visibleVramTotalMb * 1024 * 1024 : null,
      vramUsedBytes: visibleVramUsedMb != null ? visibleVramUsedMb * 1024 * 1024 : null,
      fanPercent,
      sclk: fclkMhz != null ? `${fclkMhz}Mhz` : "",
      sclkLevel: "",
      mclk: "",
      memoryActivity: "N/A",

      gttTotalMb,
      gttUsedMb,
      gttFreeMb,
      gttUsePercent: percent(gttUsedMb, gttTotalMb),
      visibleVramTotalMb,
      visibleVramUsedMb,
      visibleVramFreeMb,
      visibleVramUsePercent: percent(visibleVramUsedMb, visibleVramTotalMb),
      fclkMhz,
      fanRpm,
      perfLevel,
    };
  });

  return {
    ok: true,
    source: "amd-smi",
    timestamp: new Date().toISOString(),
    gpus,
  };
}

export function createAmdSmiStatusReader({
  execFileAsync: run = execFileAsync,
  now = Date.now,
  ttlMs = AMD_SMI_TTL_MS,
} = {}) {
  let cachedStatus = null;
  let cachedAt = 0;
  let inflight = null;

  const AMD_SMI_ARGS = ["metric", "--json"];

  async function read() {
    const errors = [];

    try {
      const { stdout } = await run("amd-smi", AMD_SMI_ARGS, {
        timeout: 2500,
        maxBuffer: 1024 * 1024,
      });

      const status = parseAmdSmiMetricJson(stdout);

      if (status.gpus.some((g) => g.gpuUsePercent === null)) {
        try {
          const sysfsBusy = await readGpuBusyFromSysfs();
          for (const gpu of status.gpus) {
            const sys = sysfsBusy.find((s) => s.index === gpu.index);
            if (sys && sys.gpuBusyPercent != null) {
              gpu.gpuUsePercent = sys.gpuBusyPercent;
              gpu._gpuUseSource = "sysfs";
            }
          }
        } catch {
          // sysfs fallback failed
        }
      }

      return status;
    } catch (err) {
      errors.push(`amd-smi: ${err.message}`);
    }

    try {
      const { stdout } = await run(
        "rocm-smi",
        [
          "--showtemp", "--showpower", "--showuse", "--showmemuse",
          "--showfan", "--showclocks", "--showmeminfo", "vram", "--json",
        ],
        { timeout: 2500, maxBuffer: 1024 * 1024 },
      );
      const { parseRocmSmiJson } = await import("./rocmSmi.mjs");
      return parseRocmSmiJson(stdout);
    } catch {
      errors.push("rocm-smi fallback failed");
    }

    return {
      ok: false,
      source: "amd-smi",
      timestamp: new Date().toISOString(),
      error: errors.join("; "),
      gpus: [],
    };
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

const defaultReader = createAmdSmiStatusReader();

export function readAmdSmiStatus() {
  return defaultReader.read();
}

export function readAmdSmiStatusCached() {
  return defaultReader.readCached();
}
