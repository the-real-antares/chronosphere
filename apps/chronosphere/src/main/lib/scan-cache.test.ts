import { describe, expect, it } from 'vitest';
import type { HealthReport } from '@antares/shared/types.ts';
import { diffScanCache, type FileStat, type ScanCache, type ScanCacheEntry } from './scan-cache.ts';

const health: HealthReport = { verdict: 'verified', findings: [], mapkitVersion: '1.0.0' };

function entry(overrides: Partial<ScanCacheEntry> = {}): ScanCacheEntry {
  return {
    size: 1024,
    mtimeMs: 1_700_000_000_000,
    contentHash: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
    name: 'Test Map',
    theater: 'Temperate',
    width: 90,
    height: 90,
    maxPlayers: 4,
    health,
    previewAvailable: true,
    ...overrides,
  };
}

function stat(overrides: Partial<FileStat> = {}): FileStat {
  return { path: '/gf/Maps/Custom/test.map', size: 1024, mtimeMs: 1_700_000_000_000, ...overrides };
}

describe('diffScanCache', () => {
  it('reuses a cached entry when size and mtime are unchanged', () => {
    const cache: ScanCache = { [stat().path]: entry() };
    const diff = diffScanCache([stat()], cache);
    expect(diff.stale).toEqual([]);
    expect(diff.fresh).toHaveLength(1);
    expect(diff.fresh[0]?.entry.contentHash).toBe(entry().contentHash);
  });

  it('marks a file stale when its size changed', () => {
    const cache: ScanCache = { [stat().path]: entry({ size: 999 }) };
    const diff = diffScanCache([stat()], cache);
    expect(diff.fresh).toEqual([]);
    expect(diff.stale).toEqual([stat()]);
  });

  it('marks a file stale when its mtime changed', () => {
    const cache: ScanCache = { [stat().path]: entry() };
    const changed = stat({ mtimeMs: 1_700_000_000_001 });
    const diff = diffScanCache([changed], cache);
    expect(diff.fresh).toEqual([]);
    expect(diff.stale).toEqual([changed]);
  });

  it('marks a file stale when it is not in the cache at all', () => {
    const diff = diffScanCache([stat()], {});
    expect(diff.fresh).toEqual([]);
    expect(diff.stale).toEqual([stat()]);
  });

  it('splits a mixed batch and ignores cache entries for files that no longer exist', () => {
    const kept = stat();
    const added = stat({ path: '/gf/Maps/new.yrm' });
    const cache: ScanCache = {
      [kept.path]: entry(),
      '/gf/Maps/deleted.map': entry(), // no longer on disk; must not resurface
    };
    const diff = diffScanCache([kept, added], cache);
    expect(diff.fresh.map((f) => f.stat.path)).toEqual([kept.path]);
    expect(diff.stale.map((s) => s.path)).toEqual([added.path]);
  });
});
