import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRocmSmiJson } from "./rocmSmi.mjs";

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
});
