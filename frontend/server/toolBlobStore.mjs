import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const BLOB_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MAX_READ_LENGTH = 200_000;

export class ToolBlobStore {
  /**
   * @param {string} baseDir - Absolute or relative path to the blob storage root.
   *   Blobs are stored under baseDir/sha256/<hex>.txt
   */
  constructor(baseDir) {
    if (!baseDir || typeof baseDir !== "string") {
      throw new Error("ToolBlobStore: baseDir is required");
    }
    this.baseDir = path.resolve(baseDir);
  }

  /**
   * Store a text blob content-addressed by SHA-256.
   * Returns the blob id (sha256:<hex>) and metadata.
   *
   * @param {string} text - The text to store
   * @returns {Promise<{id: string, bytes: number}>}
   */
  async put(text) {
    if (typeof text !== "string") {
      throw new Error("ToolBlobStore.put: text must be a string");
    }
    const hash = crypto.createHash("sha256").update(text).digest("hex");
    const id = `sha256:${hash}`;
    const dirPath = path.join(this.baseDir, "sha256");
    const filePath = path.join(dirPath, `${hash}.txt`);

    // Atomic write: check if exists first to avoid redundant writes
    let created = false;
    try {
      await fs.mkdir(dirPath, { recursive: true });
      // Use open with O_CREAT | O_EXCL to atomically create if missing
      const fd = await fs.open(filePath, "wx");
      await fd.write(text, 0, "utf8");
      await fd.close();
      created = true;
    } catch (err) {
      if (err.code === "EEXIST") {
        // File already exists — blob is deduplicated
        created = false;
      } else {
        throw err;
      }
    }

    return {
      id,
      bytes: Buffer.byteLength(text, "utf8"),
      created
    };
  }

  /**
   * Read a byte range from a stored blob.
   *
   * @param {string} id - Blob id (sha256:<hex>)
   * @param {number} offset - Starting byte offset (0 = beginning)
   * @param {number} length - Number of bytes to read (max 200_000)
   * @returns {Promise<string|null>} The requested text range, or null if the
   *   blob does not exist or the id is invalid.
   */
  async get(id, offset = 0, length = 20_000) {
    if (!ToolBlobStore.isValidId(id)) return null;
    if (offset < 0 || length <= 0 || length > MAX_READ_LENGTH) return null;

    const hex = id.slice("sha256:".length);
    const filePath = path.join(this.baseDir, "sha256", `${hex}.txt`);

    try {
      const { size } = await fs.stat(filePath);
      if (offset >= size) return ""; // offset past EOF
      const actualLength = Math.min(length, size - offset);
      const fd = await fs.open(filePath, "r");
      const buf = Buffer.alloc(actualLength);
      await fd.read(buf, 0, actualLength, offset);
      await fd.close();
      return buf.toString("utf8", 0, actualLength);
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }

  /**
   * Validate a blob id format.
   * @param {string} id
   * @returns {boolean}
   */
  static isValidId(id) {
    return typeof id === "string" && BLOB_ID_PATTERN.test(id);
  }
}
