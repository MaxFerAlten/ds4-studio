function failStatus(error) {
  return { ok: false, error: error?.message || String(error || "unknown error") };
}

async function fetchJson(fetchImpl, url, init = {}) {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  return { ok: res.ok, status: res.status, body };
}

export async function crawlPreflight({
  fetchImpl,
  crawlBaseUrl,
  token,
  expectedOwner,
  wrapperBaseUrl,
  wrapperEnabled = false,
  timeoutMs = 2000
}) {
  const signal = AbortSignal.timeout(timeoutMs);
  const tokenPresent = typeof token === "string" && token.length > 0;
  const tokenLengthOk = tokenPresent && token.length >= 43;
  const result = {
    ok: false,
    crawl: {
      baseUrl: crawlBaseUrl,
      health: { ok: false },
      token: { present: tokenPresent, lengthOk: tokenLengthOk, authOk: false },
      owner: { expected: expectedOwner || null, actual: null, matches: null, status: "unknown" }
    },
    wrapper: { enabled: Boolean(wrapperEnabled), ok: true, activeMode: null, state: null }
  };

  try {
    const health = await fetchJson(fetchImpl, `${crawlBaseUrl}/health`, { signal });
    result.crawl.health = {
      ok: health.ok,
      status: health.status,
      service: health.body?.service || null,
      pid: Number.isInteger(health.body?.pid) ? health.body.pid : null
    };
    const actualOwner = typeof health.body?.owner === "string" ? health.body.owner : null;
    result.crawl.owner.actual = actualOwner;
    result.crawl.owner.matches = expectedOwner ? actualOwner === expectedOwner : null;
    result.crawl.owner.status = !actualOwner || actualOwner === "unknown"
      ? "unknown"
      : actualOwner === expectedOwner
        ? "owned"
        : "external";
  } catch (err) {
    result.crawl.health = failStatus(err);
  }

  if (tokenPresent) {
    try {
      const auth = await fetchJson(fetchImpl, `${crawlBaseUrl}/auth/check`, {
        headers: { Authorization: `Bearer ${token}` },
        signal
      });
      result.crawl.token.authOk = auth.ok;
      result.crawl.token.status = auth.status;
    } catch (err) {
      result.crawl.token.authOk = false;
      result.crawl.token.error = err?.message || String(err);
    }
  }

  if (wrapperEnabled) {
    try {
      const status = await fetchJson(fetchImpl, `${wrapperBaseUrl}/api/wrapper/status`, { signal });
      result.wrapper.ok = status.ok;
      result.wrapper.status = status.status;
      result.wrapper.activeMode = status.body?.active_mode || status.body?.active_session?.mode || null;
      result.wrapper.state = status.body?.state || null;
      result.wrapper.busy = Boolean(status.body?.busy);
      result.wrapper.serverReady = result.wrapper.activeMode === "server" &&
        result.wrapper.state !== "switching" &&
        !result.wrapper.busy;
    } catch (err) {
      result.wrapper = { ...result.wrapper, ...failStatus(err) };
    }
  }

  result.ok = Boolean(
    result.crawl.health.ok &&
    result.crawl.token.authOk &&
    (!expectedOwner || result.crawl.owner.matches === true) &&
    (!wrapperEnabled || result.wrapper.ok)
  );
  return result;
}
