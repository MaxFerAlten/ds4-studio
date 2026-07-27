import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Ensure Agno service, model gateway, and tool-bridge tokens exist.
 *
 * Creates ~/.config/ds4-studio/agno/ with 0700 and token files with 0600.
 * Generates 32-byte base64url tokens if missing.
 * Rejects symlinks and world-readable files.
 * Ensures all three tokens are distinct.
 *
 * @param {object} options
 * @param {string} options.homeDir - user's home directory (os.homedir())
 * @param {object} options.fsImpl - fs module (for testing)
 * @returns {Promise<{ serviceToken: string, modelGatewayToken: string, toolBridgeToken: string, serviceTokenPath: string, modelGatewayTokenPath: string, toolBridgeTokenPath: string }>}
 */
export async function ensureAgnoTokens({ homeDir, fsImpl = fs }) {
  const agnoDir = path.join(homeDir, ".config", "ds4-studio", "agno");
  const serviceFile = path.join(agnoDir, "service.token");
  const modelGatewayFile = path.join(agnoDir, "model-gateway.token");
  const toolBridgeFile = path.join(agnoDir, "tool-bridge.token");

  // Ensure directory exists with 0700
  await fsImpl.mkdir(agnoDir, { recursive: true, mode: 0o700 });
  await setDirMode(agnoDir, fsImpl);

  // Ensure tokens
  const serviceToken = await ensureTokenFile(serviceFile, fsImpl);
  const modelGatewayToken = await ensureTokenFile(modelGatewayFile, fsImpl);
  const toolBridgeToken = await ensureTokenFile(toolBridgeFile, fsImpl);

  // Verify all three tokens are distinct
  if (
    new Set([
      serviceToken,
      modelGatewayToken,
      toolBridgeToken
    ]).size !== 3
  ) {
    throw new Error(
      "Agno internal tokens must be distinct"
    );
  }

  return {
    serviceToken,
    modelGatewayToken,
    toolBridgeToken,
    serviceTokenPath: serviceFile,
    modelGatewayTokenPath: modelGatewayFile,
    toolBridgeTokenPath: toolBridgeFile
  };
}

async function setDirMode(dir, fsImpl) {
  const stat = await fsImpl.stat(dir);
  if (stat.mode & 0o007) {
    // World-readable or world-executable — tighten to 0700
    await fsImpl.chmod(dir, 0o700);
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`agno config dir is a symlink: ${dir}`);
  }
}

async function ensureTokenFile(filePath, fsImpl) {
  // Check if exists and valid
  try {
    const stat = await fsImpl.stat(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`token file is a symlink: ${filePath}`);
    }
    if (stat.mode & 0o007) {
      // World-readable — tighten to 0600
      await fsImpl.chmod(filePath, 0o600);
    }
    const content = await fsImpl.readFile(filePath, "utf8");
    const trimmed = content.trim();
    if (trimmed.length >= 32) return trimmed;
    // Token too short — regenerate
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  // Generate new token
  const token = crypto.randomBytes(32).toString("base64url");
  const tmp = filePath + ".tmp";
  await fsImpl.writeFile(tmp, token + "\n", { mode: 0o600 });
  await fsImpl.rename(tmp, filePath);
  await fsImpl.chmod(filePath, 0o600);
  return token;
}
