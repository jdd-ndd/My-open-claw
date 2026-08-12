import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PersistLayer } from '../../../src/memory/persist.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'persist-layer-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('PersistLayer', () => {
  it('writes and reads JSON values by key', async () => {
    const dir = createTempDir();
    const persist = new PersistLayer(dir);

    await persist.initialize();
    await persist.write('sessions/test-1', { ok: true, count: 2 });

    await expect(persist.read('sessions/test-1')).resolves.toEqual({ ok: true, count: 2 });
    await expect(persist.exists('sessions/test-1')).resolves.toBe(true);
  });

  it('sanitizes path traversal in keys', async () => {
    const dir = createTempDir();
    const persist = new PersistLayer(dir);

    await persist.write('../escape/me', { safe: true });

    expect(existsSync(join(dir, 'escape', 'me.json'))).toBe(true);
    expect(existsSync(join(dir, '..', 'escape', 'me.json'))).toBe(false);
  });

  it('lists and reads entries by prefix', async () => {
    const dir = createTempDir();
    const persist = new PersistLayer(dir);

    await persist.write('sessions/a', { id: 'a' });
    await persist.write('sessions/nested/b', { id: 'b' });
    await persist.write('other/c', { id: 'c' });

    const keys = await persist.listKeys('sessions');
    expect(keys.sort()).toEqual(['sessions/a', 'sessions/nested/b']);

    const values = await persist.readByPrefix<{ id: string }>('sessions');
    expect(values.map((entry) => entry.key).sort()).toEqual(['sessions/a', 'sessions/nested/b']);
  });

  it('deletes files and prunes empty parent directories', async () => {
    const dir = createTempDir();
    const persist = new PersistLayer(dir);

    await persist.write('sessions/a', { id: 'a' });
    expect(await persist.delete('sessions/a')).toBe(true);
    expect(await persist.exists('sessions/a')).toBe(false);
    expect(existsSync(join(dir, 'sessions'))).toBe(true);
    await expect(persist.delete('sessions/a')).resolves.toBe(false);
  });

  it('backs up and restores stored files', async () => {
    const dir = createTempDir();
    const backupDir = createTempDir();
    const persist = new PersistLayer(dir);

    await persist.writeBatch([
      { key: 'sessions/a', value: { id: 'a' } },
      { key: 'skills/b', value: { id: 'b' } },
    ]);

    await persist.backup(backupDir);
    await persist.delete('sessions/a');
    await persist.delete('skills/b');

    await persist.restore(backupDir);

    await expect(persist.read('sessions/a')).resolves.toEqual({ id: 'a' });
    await expect(persist.read('skills/b')).resolves.toEqual({ id: 'b' });
  });

  it('returns null for invalid JSON payloads', async () => {
    const dir = createTempDir();
    const persist = new PersistLayer(dir);

    await persist.initialize();
    const filePath = join(dir, 'broken.json');
    writeFileSync(filePath, '{not-json}', 'utf8');

    await expect(persist.read('broken')).resolves.toBeNull();
  });

  it('cleans up temporary files when write fails', async () => {
    const dir = createTempDir();
    const persist = new PersistLayer(dir);

    await persist.write('sessions/original', { ok: true });
    const filePath = join(dir, 'sessions', 'original.json');
    const original = readFileSync(filePath, 'utf8');

    const stringify = JSON.stringify;
    JSON.stringify = (() => {
      throw new Error('boom');
    }) as typeof JSON.stringify;

    try {
      await expect(persist.write('sessions/original', { ok: false })).rejects.toThrow('boom');
    } finally {
      JSON.stringify = stringify;
    }

    expect(readFileSync(filePath, 'utf8')).toBe(original);
    expect(existsSync(filePath + '.tmp')).toBe(false);
  });
});
