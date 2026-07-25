import assert from "node:assert";
import { describe, it } from "node:test";
import { mergeConfig, validateConfig } from "../config.mjs";

describe("Agno config integration with mergeConfig and validateConfig", () => {
  it("legacy config without agno block gets defaults", () => {
    const merged = mergeConfig({});
    assert(merged.agno.enabled === false, "agno.enabled should default to false");
    assert(merged.agno.port === 7777, "agno.port should default to 7777");
    assert(merged.agno.host === "127.0.0.1");
    assert(merged.agno.maxInflightModelCalls === 1);
  });

  it("user can override agno config", () => {
    const merged = mergeConfig({ agno: { enabled: true, port: 7778 } });
    assert(merged.agno.enabled === true);
    assert(merged.agno.port === 7778);
  });

  it("validateConfig rejects non-loopback host", () => {
    const merged = mergeConfig({ agno: { host: "0.0.0.0" } });
    const result = validateConfig(merged);
    assert(result.ok === false);
    assert(result.errors.agno.host.match(/loopback/), `expected loopback error, got ${result.errors.agno.host}`);
  });

  it("validateConfig rejects port collision with control", () => {
    const merged = mergeConfig({ agno: { port: 5173 } });
    const result = validateConfig(merged);
    assert(result.ok === false);
    assert(result.errors.agno.port.match(/control/), `expected control port error, got ${result.errors.agno.port}`);
  });

  it("validateConfig rejects maxInflightModelCalls !== 1", () => {
    const merged = mergeConfig({ agno: { maxInflightModelCalls: 2 } });
    const result = validateConfig(merged);
    assert(result.ok === false);
    assert(result.errors.agno.maxInflightModelCalls.match(/exactly 1/));
  });

  it("validateConfig rejects telemetry true", () => {
    const merged = mergeConfig({ agno: { telemetry: true } });
    const result = validateConfig(merged);
    assert(result.ok === false);
    assert(result.errors.agno.telemetry.match(/false/));
  });

  it("validateConfig rejects tracing true", () => {
    const merged = mergeConfig({ agno: { tracing: true } });
    const result = validateConfig(merged);
    assert(result.ok === false);
    assert(result.errors.agno.tracing.match(/false/));
  });

  it("disabled config does not prevent DS4 startup", () => {
    const merged = mergeConfig({ agno: { enabled: false } });
    const result = validateConfig(merged);
    assert(result.ok === true, "disabled agno should not cause validation errors");
  });
});
