// WP3: the pinned AG-UI SDK for the gateway (ADR-001: @ag-ui/core 1.0.2 for
// EventType and the zod schemas, @ag-ui/encoder 1.0.2 for SSE).  Loaded only
// when the feature flag is on, so a project without the packages keeps
// running its legacy UI; a missing or different version disables the gateway
// with an explicit reason instead of mapping against an unproven schema.
//
// `root` resolves the packages from another install (tests use the WP0 spike,
// same versions and integrity); without it they come from frontend/.

import { createRequire } from "node:module";
import { join } from "node:path";

export const AGUI_PINS = Object.freeze({
  "@ag-ui/core": "1.0.2",
  "@ag-ui/encoder": "1.0.2"
});

export class AguiSdkError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AguiSdkError";
    this.code = code;
  }
}

export async function loadAguiSdk({ root = null } = {}) {
  const fromRoot = root ? createRequire(join(root, "package.json")) : null;
  const load = async (specifier) => (fromRoot ? fromRoot(specifier) : import(specifier));
  const versionOf = async (name) => {
    const manifest = fromRoot
      ? fromRoot(`${name}/package.json`)
      : (await import(`${name}/package.json`, { with: { type: "json" } })).default;
    return manifest.version;
  };

  let core;
  let schemas;
  let encoder;
  try {
    for (const [name, pinned] of Object.entries(AGUI_PINS)) {
      const version = await versionOf(name);
      if (version !== pinned) throw new AguiSdkError("AGUI_SDK_VERSION_MISMATCH", `${name} ${version} is installed, ${pinned} is pinned`);
    }
    core = await load("@ag-ui/core");
    schemas = await load("@ag-ui/core/schemas");
    encoder = await load("@ag-ui/encoder");
  } catch (error) {
    if (error instanceof AguiSdkError) throw error;
    throw new AguiSdkError("AGUI_SDK_MISSING", `AG-UI SDK not available: ${error.message}`);
  }
  return Object.freeze({
    EventType: core.EventType,
    EventSchemas: schemas.EventSchemas,
    RunAgentInputSchema: schemas.RunAgentInputSchema,
    EventEncoder: encoder.EventEncoder
  });
}
