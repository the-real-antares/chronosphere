import type { HealthReport } from '@antares/shared/types.ts';
import { readJsonFile, writeJsonFile } from './fsx.ts';

/**
 * Incremental scan cache: keyed by absolute file path, an entry is reusable
 * when size and mtime both match — only changed files get re-hashed/re-parsed.
 * The diffing itself is pure so it can be unit-tested without electron.
 */

export interface FileStat {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface ScanCacheEntry {
  size: number;
  mtimeMs: number;
  contentHash: string;
  name: string | null;
  theater: string | null;
  width: number | null;
  height: number | null;
  maxPlayers: number | null;
  health: HealthReport;
  previewAvailable: boolean;
}

export type ScanCache = Record<string, ScanCacheEntry>;

export interface ScanCacheDiff {
  /** Files whose cached entry is still valid (size + mtime unchanged). */
  fresh: Array<{ stat: FileStat; entry: ScanCacheEntry }>;
  /** Files that must be re-read, re-hashed and re-analyzed. */
  stale: FileStat[];
}

export function diffScanCache(stats: FileStat[], cache: ScanCache): ScanCacheDiff {
  const fresh: ScanCacheDiff['fresh'] = [];
  const stale: FileStat[] = [];
  for (const stat of stats) {
    const entry = cache[stat.path];
    if (entry && entry.size === stat.size && entry.mtimeMs === stat.mtimeMs) {
      fresh.push({ stat, entry });
    } else {
      stale.push(stat);
    }
  }
  return { fresh, stale };
}

function isScanCacheEntry(x: unknown): x is ScanCacheEntry {
  if (typeof x !== 'object' || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e['size'] === 'number' &&
    typeof e['mtimeMs'] === 'number' &&
    typeof e['contentHash'] === 'string' &&
    typeof e['previewAvailable'] === 'boolean' &&
    typeof e['health'] === 'object' &&
    e['health'] !== null
  );
}

/** Load the cache file, tolerating a missing or corrupt file (fresh cache). */
export async function loadScanCache(file: string): Promise<ScanCache> {
  const raw = await readJsonFile(file);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const cache: ScanCache = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isScanCacheEntry(value)) cache[key] = value;
  }
  return cache;
}

export async function saveScanCache(file: string, cache: ScanCache): Promise<void> {
  await writeJsonFile(file, cache);
}
