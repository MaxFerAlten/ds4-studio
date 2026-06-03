export function createDeltaBatcher(
  flush,
  {
    delayMs = 40,
    setTimeoutFn = globalThis.setTimeout,
    clearTimeoutFn = globalThis.clearTimeout
  } = {}
) {
  let content = "";
  let reasoning = "";
  let timer = null;

  function hasPending() {
    return Boolean(content || reasoning);
  }

  function clearTimer() {
    if (!timer) return;
    clearTimeoutFn(timer);
    timer = null;
  }

  function flushNow() {
    clearTimer();
    if (!hasPending()) return false;
    const nextContent = content;
    const nextReasoning = reasoning;
    content = "";
    reasoning = "";
    flush(nextContent, nextReasoning);
    return true;
  }

  function schedule() {
    if (timer) return;
    timer = setTimeoutFn(() => {
      timer = null;
      flushNow();
    }, delayMs);
  }

  return {
    push(nextContent = "", nextReasoning = "") {
      if (!nextContent && !nextReasoning) return false;
      content += nextContent;
      reasoning += nextReasoning;
      schedule();
      return true;
    },
    flush: flushNow,
    cancel() {
      clearTimer();
      content = "";
      reasoning = "";
    },
    hasPending
  };
}
