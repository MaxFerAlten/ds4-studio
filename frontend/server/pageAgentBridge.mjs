const pending = new Map();
let nextId = 1;
let _clientConnected = false;
let _serverEnabled = false;

const CLIENT_TIMEOUT_MS = 15000;

export function markClientConnected() {
  _clientConnected = true;
}

export function isClientConnected() {
  return _clientConnected;
}

export function resetClientConnection() {
  _clientConnected = false;
}

export function isServerEnabled() {
  return _serverEnabled;
}

export function setServerEnabled(v) {
  _serverEnabled = v;
}

export function enqueuePageAgentTool(name, args) {
  return new Promise((resolve) => {
    const id = nextId++;
    const timeout = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, CLIENT_TIMEOUT_MS);
    pending.set(id, { resolve, timeout, name, args, ts: Date.now() });
  });
}

export function resolvePageAgentTool(id, result) {
  const item = pending.get(id);
  if (!item) return false;
  clearTimeout(item.timeout);
  item.resolve(result);
  pending.delete(id);
  return true;
}

export function getPendingTools() {
  return Array.from(pending.entries()).map(([id, item]) => ({
    id, name: item.name, args: item.args, ts: item.ts
  }));
}

export function hasPendingTools() {
  return pending.size > 0;
}
