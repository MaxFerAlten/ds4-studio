import { randomUUID } from 'node:crypto';
import { lstat, rename } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createHttpServer, listenUnix, unlinkOwnedSocket } from './http-server.mjs';
import { createTelemetry } from './telemetry.mjs';

async function quarantineSocketReplacement(identity) {
  let current;
  try { current = await lstat(identity.socketPath); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  if (current.isSocket() && current.uid === process.getuid() &&
      current.dev === identity.dev && current.ino === identity.ino) return null;

  const quarantine = join(dirname(identity.socketPath), `.${basename(identity.socketPath)}.retarget-${randomUUID()}`);
  await rename(identity.socketPath, quarantine);
  return quarantine;
}

async function restoreSocketReplacement(socketPath, quarantine) {
  if (!quarantine) return;
  try {
    await lstat(socketPath);
    const error = new Error(`socket path changed again during shutdown; replacement preserved at ${quarantine}`);
    error.code = 'SOCKET_PATH_RACED';
    throw error;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  await rename(quarantine, socketPath);
}

/** Start one gateway instance. MCP lifecycle is explicit and teardown is idempotent. */
export async function startGateway({ config, mcp, telemetry = createTelemetry() }) {
  await mcp.start();
  const server = createHttpServer({ config, mcp, telemetry });
  let socket;
  try { socket = await listenUnix(server, config.listen.socketPath); }
  catch (err) { await mcp.stop().catch(() => {}); throw err; }
  let closing = null;
  return Object.freeze({
    server, telemetry,
    close() {
      if (closing) return closing;
      closing = (async () => {
        const failures = [];
        let quarantine = null;
        let quarantineFailed = false;
        try { quarantine = await quarantineSocketReplacement(socket); }
        catch (error) { failures.push(error); quarantineFailed = true; }
        if (quarantineFailed) {
          // Node/libuv unlinks the configured pathname from server.close(). If
          // it could not be quarantined, closing here could delete a replacement.
          server.closeAllConnections?.();
          server.closeIdleConnections?.();
        } else {
          try {
            await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
          } catch (error) { failures.push(error); }
        }
        try { await restoreSocketReplacement(socket.socketPath, quarantine); }
        catch (error) { failures.push(error); }
        try { await unlinkOwnedSocket(socket); }
        catch (error) { failures.push(error); }
        try { await mcp.stop(); }
        catch (error) { failures.push(error); }
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) throw new AggregateError(failures, 'gateway shutdown had multiple failures');
      })();
      return closing;
    },
  });
}
