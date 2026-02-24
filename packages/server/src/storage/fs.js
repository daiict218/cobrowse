import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../utils/logger.js';

/**
 * Filesystem storage driver for session recordings.
 *
 * Writes gzipped recording files to a local directory.
 * Intended for development and single-server deployments.
 *
 * Interface: { put, get, del, exists }
 */

export function createFsStorage(config) {
  const dir = config.recording.fsPath;

  async function ensureDir() {
    await fs.mkdir(dir, { recursive: true });
  }

  function filePath(key) {
    // Prevent path traversal — strip any directory components from key
    const safeName = path.basename(key);
    return path.join(dir, safeName);
  }

  async function put(key, buffer) {
    await ensureDir();
    const dest = filePath(key);
    await fs.writeFile(dest, buffer);
    logger.debug({ key, size: buffer.length }, 'storage.fs: put');
  }

  async function get(key) {
    try {
      const data = await fs.readFile(filePath(key));
      return data;
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async function del(key) {
    try {
      await fs.unlink(filePath(key));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async function exists(key) {
    try {
      await fs.access(filePath(key));
      return true;
    } catch {
      return false;
    }
  }

  return { put, get, del, exists };
}
