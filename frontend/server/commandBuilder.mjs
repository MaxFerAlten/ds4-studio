function pushValue(args, flag, value) {
  if (value === "" || value === null || value === undefined) return;
  args.push(flag, String(value));
}

export function buildDs4Args(config) {
  const s = config.server;
  const args = [];
  pushValue(args, "--model", s.model);
  pushValue(args, "--mtp", s.mtp);
  pushValue(args, "--mtp-draft", s.mtpDraft);
  pushValue(args, "--mtp-margin", s.mtpMargin);
  pushValue(args, "--ctx", s.ctx);
  pushValue(args, "--tokens", s.tokens);
  if (Number(s.threads) > 0) pushValue(args, "--threads", s.threads);
  if (s.backend === "metal") args.push("--metal");
  if (s.backend === "cuda") args.push("--cuda");
  if (s.backend === "cpu") args.push("--cpu");
  if (s.quality) args.push("--quality");
  if (s.warmWeights) args.push("--warm-weights");
  pushValue(args, "--host", s.host);
  pushValue(args, "--port", s.port);
  pushValue(args, "--trace", s.trace);
  pushValue(args, "--dir-steering-file", s.dirSteeringFile);
  pushValue(args, "--dir-steering-ffn", s.dirSteeringFfn);
  pushValue(args, "--dir-steering-attn", s.dirSteeringAttn);
  pushValue(args, "--kv-disk-dir", s.kvDiskDir);
  pushValue(args, "--kv-disk-space-mb", s.kvDiskSpaceMb);
  pushValue(args, "--kv-cache-min-tokens", s.kvCacheMinTokens);
  pushValue(args, "--kv-cache-cold-max-tokens", s.kvCacheColdMaxTokens);
  pushValue(args, "--kv-cache-continued-interval-tokens", s.kvCacheContinuedIntervalTokens);
  pushValue(args, "--kv-cache-boundary-trim-tokens", s.kvCacheBoundaryTrimTokens);
  pushValue(args, "--kv-cache-boundary-align-tokens", s.kvCacheBoundaryAlignTokens);
  if (s.kvCacheRejectDifferentQuant) args.push("--kv-cache-reject-different-quant");
  if (s.disableExactDsmlToolReplay) args.push("--disable-exact-dsml-tool-replay");
  pushValue(args, "--tool-memory-max-ids", s.toolMemoryMaxIds);
  return { command: s.binary, args };
}

export function commandLineFromConfig(config) {
  const { command, args } = buildDs4Args(config);
  return [command, ...args].join(" ");
}

export function parseCommandLine(input) {
  if (typeof input !== "string") throw new Error("command must be a string");
  const text = input.replace(/\\\r?\n/g, " ");
  const argv = [];
  let cur = "";
  let quote = null;
  let escaped = false;
  let hasCur = false;
  for (const ch of text) {
    if (escaped) {
      cur += ch;
      hasCur = true;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      cur += ch;
      hasCur = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasCur = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasCur) {
        argv.push(cur);
        cur = "";
        hasCur = false;
      }
      continue;
    }
    cur += ch;
    hasCur = true;
  }
  if (quote) throw new Error(`unterminated ${quote} quote in command`);
  if (hasCur) argv.push(cur);
  if (!argv.length) throw new Error("command is empty");
  return argv;
}
