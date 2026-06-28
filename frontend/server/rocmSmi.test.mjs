import assert from "node:assert/strict";
import { test } from "node:test";
import { createRocmStatusReader, parseRocmSmiJson } from "./rocmSmi.mjs";

test("parseRocmSmiJson extracts essential ROCm SMI fields", () => {
  const status = parseRocmSmiJson(JSON.stringify({
    card0: {
      "Temperature (Sensor edge) (C)": "37.0",
      "sclk clock speed:": "(637Mhz)",
      "sclk clock level:": "1",
      "Current Socket Graphics Package Power (W)": "20.088",
      "GPU use (%)": "7",
      "GPU Memory Allocated (VRAM%)": "99",
      "Fan speed (%)": "0",
      "Memory Activity": "N/A"
    }
  }));

  assert.equal(status.ok, true);
  assert.equal(status.gpus.length, 1);
  assert.deepEqual(status.gpus[0], {
    id: "card0",
    index: 0,
    temperatureC: 37,
    powerW: 20.088,
    gpuUsePercent: 7,
    vramUsePercent: 99,
    vramTotalBytes: null,
    vramUsedBytes: null,
    fanPercent: 0,
    sclk: "637Mhz",
    sclkLevel: "1",
    mclk: "",
    memoryActivity: "N/A"
  });
});

test("parseRocmSmiJson handles missing or N/A fields", () => {
  const status = parseRocmSmiJson(JSON.stringify({
    card3: {
      "Temperature (Sensor edge) (C)": "N/A",
      "GPU use (%)": "N/A"
    }
  }));

  assert.equal(status.ok, true);
  assert.equal(status.gpus[0].index, 3);
  assert.equal(status.gpus[0].temperatureC, null);
  assert.equal(status.gpus[0].gpuUsePercent, null);
  assert.equal(status.gpus[0].powerW, null);
  assert.equal(status.gpus[0].vramTotalBytes, null);
  assert.equal(status.gpus[0].vramUsedBytes, null);
  assert.equal(status.gpus[0].fanPercent, null);
});

test("cached ROCm status reader deduplicates in-flight calls and respects TTL", async () => {
  let calls = 0;
  let now = 1000;
  const sample = JSON.stringify({
    card0: {
      "GPU use (%)": "9",
      "VRAM Total Memory (B)": "536870912",
      "VRAM Total Used Memory (B)": "468783104"
    }
  });
  const reader = createRocmStatusReader({
    execFileAsync: async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { stdout: sample };
    },
    now: () => now,
    ttlMs: 5000
  });

  const [first, second] = await Promise.all([
    reader.readCached(),
    reader.readCached()
  ]);
  assert.equal(calls, 1);
  assert.equal(first.gpus[0].gpuUsePercent, 9);
  assert.deepEqual(second.gpus, first.gpus);

  await reader.readCached();
  assert.equal(calls, 1);

  now += 5001;
  await reader.readCached();
  assert.equal(calls, 2);
});
