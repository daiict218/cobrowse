import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createFsStorage } from '../../../src/storage/fs.js';

describe('FsStorage', () => {
  let storage;
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cobrowse-fs-test-'));
    storage = createFsStorage({
      recording: { fsPath: tmpDir },
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('put and get round-trip a buffer', async () => {
    const data = Buffer.from('hello recording');
    await storage.put('test.gz', data);

    const result = await storage.get('test.gz');
    expect(result).toEqual(data);
  });

  it('get returns null for non-existent key', async () => {
    const result = await storage.get('does-not-exist.gz');
    expect(result).toBeNull();
  });

  it('exists returns true for existing key', async () => {
    await storage.put('check.gz', Buffer.from('data'));
    expect(await storage.exists('check.gz')).toBe(true);
  });

  it('exists returns false for missing key', async () => {
    expect(await storage.exists('missing.gz')).toBe(false);
  });

  it('del removes a file', async () => {
    await storage.put('delete-me.gz', Buffer.from('data'));
    expect(await storage.exists('delete-me.gz')).toBe(true);

    await storage.del('delete-me.gz');
    expect(await storage.exists('delete-me.gz')).toBe(false);
  });

  it('del is safe for non-existent key', async () => {
    await expect(storage.del('not-here.gz')).resolves.not.toThrow();
  });
});
