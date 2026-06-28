import assert from "node:assert/strict";
import { test } from "node:test";
import { createAmdSmiStatusReader, parseAmdSmiMetricJson } from "./amdSmi.mjs";

const SAMPLE_METRICS = {
  gpu_data: [
    {
      gpu: 0,
      usage: "N/A",
      power: {
        socket_power: "N/A",
        gfx_voltage: "N/A",
        soc_voltage: "N/A",
        mem_voltage: "N/A",
        throttle_status: "N/A",
        power_management: "N/A",
      },
      clock: {
        fclk_0: { clk: { value: 2000, unit: "MHz" }, min_clk: "N/A", max_clk: "N/A", clk_locked: "N/A", deep_sleep: "N/A" },
      },
      temperature: {
        edge: { value: 77, unit: "C" },
        hotspot: "N/A",
        mem: "N/A",
      },
      fan: { speed: "N/A", max: "N/A", rpm: "N/A", usage: "N/A" },
      perf_level: "AMDSMI_DEV_PERF_LEVEL_HIGH",
      mem_usage: {
        total_vram: { value: 512, unit: "MB" },
        used_vram: { value: 446, unit: "MB" },
        free_vram: { value: 66, unit: "MB" },
        total_visible_vram: { value: 512, unit: "MB" },
        used_visible_vram: { value: 446, unit: "MB" },
        free_visible_vram: { value: 66, unit: "MB" },
        total_gtt: { value: 126976, unit: "MB" },
        used_gtt: { value: 111739, unit: "MB" },
        free_gtt: { value: 15237, unit: "MB" },
      },
    },
  ],
};

test("parseAmdSmiMetricJson extracts Strix Halo fields", () => {
  const status = parseAmdSmiMetricJson(JSON.stringify(SAMPLE_METRICS));

  assert.equal(status.ok, true);
  assert.equal(status.source, "amd-smi");
  assert.equal(status.gpus.length, 1);

  const gpu = status.gpus[0];
  assert.equal(gpu.index, 0);
  assert.equal(gpu.temperatureC, 77);
  assert.equal(gpu.fclkMhz, 2000);
  assert.equal(gpu.fanPercent, null);
  assert.equal(gpu.gpuUsePercent, null);
  assert.equal(gpu.powerW, null);
  assert.equal(gpu.perfLevel, "AMDSMI_DEV_PERF_LEVEL_HIGH");

  assert.equal(gpu.gttTotalMb, 126976);
  assert.equal(gpu.gttUsedMb, 111739);
  assert.equal(gpu.gttFreeMb, 15237);
  assert.equal(Math.round(gpu.gttUsePercent), 88);

  assert.equal(gpu.visibleVramTotalMb, 512);
  assert.equal(gpu.visibleVramUsedMb, 446);
  assert.equal(gpu.visibleVramFreeMb, 66);
  assert.equal(Math.round(gpu.visibleVramUsePercent), 87);

  // backward compat
  assert.equal(gpu.vramTotalBytes, 512 * 1024 * 1024);
  assert.equal(gpu.vramUsedBytes, 446 * 1024 * 1024);
  assert.equal(gpu.sclk, "2000Mhz");
  assert.equal(gpu.mclk, "");
});

test("parseAmdSmiMetricJson handles N/A fields", () => {
  const status = parseAmdSmiMetricJson(JSON.stringify({
    gpu_data: [
      {
        gpu: 0,
        usage: "N/A",
        power: { socket_power: "N/A", gfx_voltage: "N/A", soc_voltage: "N/A", mem_voltage: "N/A", throttle_status: "N/A", power_management: "N/A" },
        clock: {},
        temperature: { edge: "N/A", hotspot: "N/A", mem: "N/A" },
        fan: { speed: "N/A", max: "N/A", rpm: "N/A", usage: "N/A" },
        perf_level: "N/A",
        mem_usage: {},
      },
    ],
  }));

  const gpu = status.gpus[0];
  assert.equal(gpu.temperatureC, null);
  assert.equal(gpu.fclkMhz, null);
  assert.equal(gpu.gpuUsePercent, null);
  assert.equal(gpu.vramUsePercent, null);
  assert.equal(gpu.gttTotalMb, null);
  assert.equal(gpu.perfLevel, null);
  assert.equal(gpu.sclk, "");
});

test("cached amd-smi reader deduplicates in-flight calls and respects TTL", async () => {
  let calls = 0;
  let now = 1000;
  const reader = createAmdSmiStatusReader({
    execFileAsync: async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { stdout: JSON.stringify(SAMPLE_METRICS) };
    },
    now: () => now,
    ttlMs: 5000,
  });

  const [first, second] = await Promise.all([
    reader.readCached(),
    reader.readCached(),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.gpus[0].gttUsedMb, 111739);
  assert.deepEqual(second.gpus, first.gpus);

  await reader.readCached();
  assert.equal(calls, 1);

  now += 5001;
  await reader.readCached();
  assert.equal(calls, 2);
});

test("parseAmdSmiMetricJson falls back to total_vram when visible fields missing", () => {
  const data = {
    gpu_data: [
      {
        gpu: 0,
        usage: "N/A",
        power: { socket_power: "N/A" },
        temperature: { edge: "N/A" },
        fan: { speed: "N/A" },
        mem_usage: {
          total_vram: { value: 8192, unit: "MB" },
          used_vram: { value: 4096, unit: "MB" },
          free_vram: { value: 4096, unit: "MB" },
        },
      },
    ],
  };
  const status = parseAmdSmiMetricJson(JSON.stringify(data));
  const gpu = status.gpus[0];
  assert.equal(gpu.visibleVramTotalMb, 8192);
  assert.equal(gpu.visibleVramUsedMb, 4096);
  assert.equal(gpu.vramUsePercent, 50);
  assert.equal(gpu.vramTotalBytes, 8192 * 1024 * 1024);
});
