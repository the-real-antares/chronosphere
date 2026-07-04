import { promises as fs } from 'node:fs';
import path from 'node:path';
import { MAP_FILE_EXTENSIONS } from '@antares/shared/taxonomy.ts';
import type { FolderScanResult, ScannedFile, ScanProgress } from '../../ipc.ts';
import { isDirectory, walkFiles } from './fsx.ts';
import { extractMapFacts } from './map-facts.ts';
import {
  diffScanCache,
  type FileStat,
  type ScanCache,
  type ScanCacheDiff,
  type ScanCacheEntry,
} from './scan-cache.ts';

/**
 * Folder scanning: walk Maps/ (which covers Maps/Custom/) for map files,
 * falling back to the game-folder root when no Maps/ directory exists.
 * Incremental via the scan cache — unchanged files are never re-hashed.
 */

export interface ScanRoots {
  /** Directories to actually walk (deduplicated). */
  roots: string[];
  /** Directories to report/watch: Maps/ and Maps/Custom/ when present, else the folder root. */
  dirs: string[];
}

export async function resolveScanRoots(folder: string): Promise<ScanRoots> {
  const mapsDir = path.join(folder, 'Maps');
  const customDir = path.join(mapsDir, 'Custom');
  if (await isDirectory(mapsDir)) {
    const dirs = [mapsDir];
    if (await isDirectory(customDir)) dirs.push(customDir);
    // Walking Maps/ recursively already covers Maps/Custom/.
    return { roots: [mapsDir], dirs };
  }
  return { roots: [folder], dirs: [folder] };
}

export async function scanGameFolder(
  folder: string,
  prevCache: ScanCache,
  nextCache: ScanCache,
  onProgress?: (progress: ScanProgress) => void,
): Promise<FolderScanResult> {
  if (!(await isDirectory(folder))) {
    return { folder, ok: false, error: 'folder does not exist', scannedDirs: [], files: [] };
  }

  const { roots, dirs } = await resolveScanRoots(folder);
  const filePaths = new Set<string>();
  for (const root of roots) {
    for (const file of await walkFiles(root, MAP_FILE_EXTENSIONS)) filePaths.add(file);
  }

  const stats: FileStat[] = [];
  for (const filePath of filePaths) {
    try {
      const stat = await fs.stat(filePath);
      stats.push({ path: filePath, size: stat.size, mtimeMs: stat.mtimeMs });
    } catch {
      // Raced deletion — skip.
    }
  }

  const diff: ScanCacheDiff = diffScanCache(stats, prevCache);
  const total = stats.length;
  let done = 0;
  onProgress?.({ folder, done, total, file: null });

  const files: ScannedFile[] = [];

  for (const { stat, entry } of diff.fresh) {
    nextCache[stat.path] = entry;
    files.push(toScannedFile(folder, stat, entry));
    done += 1;
  }
  if (diff.fresh.length > 0) {
    onProgress?.({ folder, done, total, file: null });
  }

  for (const stat of diff.stale) {
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(stat.path);
    } catch {
      done += 1;
      continue; // Raced deletion — skip.
    }
    const facts = extractMapFacts(bytes);
    const entry: ScanCacheEntry = {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      contentHash: facts.contentHash,
      name: facts.name,
      theater: facts.theater,
      width: facts.width,
      height: facts.height,
      maxPlayers: facts.maxPlayers,
      health: facts.health,
      previewAvailable: facts.previewAvailable,
    };
    nextCache[stat.path] = entry;
    files.push(toScannedFile(folder, stat, entry));
    done += 1;
    onProgress?.({ folder, done, total, file: stat.path });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { folder, ok: true, error: null, scannedDirs: dirs, files };
}

function toScannedFile(folder: string, stat: FileStat, entry: ScanCacheEntry): ScannedFile {
  return {
    path: stat.path,
    folder,
    fileName: path.basename(stat.path),
    bytes: stat.size,
    mtime: stat.mtimeMs,
    contentHash: entry.contentHash,
    name: entry.name,
    theater: entry.theater,
    width: entry.width,
    height: entry.height,
    maxPlayers: entry.maxPlayers,
    health: entry.health,
    previewAvailable: entry.previewAvailable,
  };
}
