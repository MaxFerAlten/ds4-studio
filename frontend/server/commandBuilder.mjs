function pushValue(args, flag, value) {
  if (value === "" || value === null || value === undefined) return;
  args.push(flag, String(value));
}

export function buildDs4Args(config) {
  const s = config.server;
  const args = [];
  pushValue(args, "--model", s.model);
  pushValue(args, "--vision", s.vision);
  pushValue(args, "--mtp", s.mtp);
  pushValue(args, "--mtp-draft", s.mtpDraft);
  pushValue(args, "--mtp-margin", s.mtpMargin);
  if (s.dspark) args.push("--dspark");
  if (s.dsparkStrict) args.push("--dspark-strict");
  pushValue(args, "--dspark-confidence", s.dsparkConfidence);
  if (s.mtpExactSampling) args.push("--mtp-exact-sampling");
  pushValue(args, "--ctx", s.ctx);
  pushValue(args, "--tokens", s.tokens);
  if (Number(s.threads) > 0) pushValue(args, "--threads", s.threads);
  if (s.backend === "metal") args.push("--metal");
  if (s.backend === "cuda") args.push("--cuda");
  if (s.backend === "cpu") args.push("--cpu");
  if (s.quality) args.push("--quality");
  if (s.warmWeights) args.push("--warm-weights");
  // DeepSeek V4.1 does not fit resident at a large context: without SSD
  // streaming the engine refuses to start ("needs 167.26 GiB before the expert
  // cache; safe budget 106.31 GiB"). Only emitted when configured, so existing
  // profiles are unaffected.
  if (s.ssdStreaming) args.push("--ssd-streaming");
  if (s.ssdStreamingCold) args.push("--ssd-streaming-cold");
  pushValue(args, "--ssd-streaming-cache-experts", s.ssdStreamingCacheExperts);
  if (Number(s.ssdStreamingFullLayers) > 0)
    pushValue(args, "--ssd-streaming-full-layers", s.ssdStreamingFullLayers);
  if (Number(s.ssdStreamingPreloadExperts) > 0)
    pushValue(args, "--ssd-streaming-preload-experts", s.ssdStreamingPreloadExperts);
  pushValue(args, "--power", s.power);
  pushValue(args, "--host", s.host);
  pushValue(args, "--port", s.port);
  pushValue(args, "--max-queued-jobs", s.maxQueuedJobs);
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

export function buildDs4WrapperArgs(config) {
  const s = config.server;
  const w = config.wrapper;
  const args = [];
  // Server-like options
  pushValue(args, "--model", s.model);
  pushValue(args, "--vision", s.vision);
  pushValue(args, "--mtp", s.mtp);
  pushValue(args, "--mtp-draft", s.mtpDraft);
  pushValue(args, "--mtp-margin", s.mtpMargin);
  if (s.dspark) args.push("--dspark");
  if (s.dsparkStrict) args.push("--dspark-strict");
  pushValue(args, "--dspark-confidence", s.dsparkConfidence);
  if (s.mtpExactSampling) args.push("--mtp-exact-sampling");
  pushValue(args, "--ctx", s.ctx);
  pushValue(args, "--tokens", s.tokens);
  if (Number(s.threads) > 0) pushValue(args, "--threads", s.threads);
  if (s.backend === "metal") args.push("--metal");
  if (s.backend === "cuda") args.push("--cuda");
  if (s.backend === "cpu") args.push("--cpu");
  if (s.quality) args.push("--quality");
  if (s.warmWeights) args.push("--warm-weights");
  // Same SSD-streaming passthrough as buildDs4Args: V4.1 refuses to start at a
  // large context without it ("needs 167.26 GiB ... Use --ssd-streaming").
  if (s.ssdStreaming) args.push("--ssd-streaming");
  if (s.ssdStreamingCold) args.push("--ssd-streaming-cold");
  pushValue(args, "--ssd-streaming-cache-experts", s.ssdStreamingCacheExperts);
  if (Number(s.ssdStreamingFullLayers) > 0)
    pushValue(args, "--ssd-streaming-full-layers", s.ssdStreamingFullLayers);
  if (Number(s.ssdStreamingPreloadExperts) > 0)
    pushValue(args, "--ssd-streaming-preload-experts", s.ssdStreamingPreloadExperts);
  pushValue(args, "--power", s.power);
  pushValue(args, "--host", s.host);
  pushValue(args, "--port", s.port);
  pushValue(args, "--max-queued-jobs", "1"); // wrapper mutual-exclusive mode
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
  pushValue(args, "--tool-memory-max-ids", s.toolMemoryMaxIds);
  // Wrapper-specific options
  pushValue(args, "--startup-mode", w.startupMode);
  if (w.freezeOnSwitch) args.push("--freeze-on-switch");
  if (w.freeInactiveSession) args.push("--free-inactive-session");
  pushValue(args, "--ram-freeze-max-mb", w.ramFreezeMaxMb);
  // Without this the agent's google_search/visit_page block: ds4_web.c asks for
  // consent to start a visible Chrome, ds4_agent_runtime answers with
  // opt.allow_browser, and the wrapper defaults it to false. The tool then
  // fails with no way for the UI to grant it, which reads as "search is broken".
  if (w.agentAllowBrowser) args.push("--agent-allow-browser");
  return { command: w.binary, args };
}

export function commandLineFromConfig(config) {
  const { command, args } = config?.wrapper?.enabled
    ? buildDs4WrapperArgs(config)
    : buildDs4Args(config);
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
