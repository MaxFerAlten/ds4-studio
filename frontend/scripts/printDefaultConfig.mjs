// Canonical default config, serialised for non-JavaScript consumers.
//
// scripts/srun_tuning_gui.py runs this instead of keeping its own copy of the
// defaults. One responsibility only: print valid JSON on stdout. No arguments,
// no logging, no network.

import { DEFAULT_CONFIG, REQUEST_DEFAULTS } from "../server/defaultConfig.mjs";

const output = {
  ...DEFAULT_CONFIG,
  requestDefaults: REQUEST_DEFAULTS
};

process.stdout.write(`${JSON.stringify(output)}\n`);
