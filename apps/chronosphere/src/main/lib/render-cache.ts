import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureDir, isDirectory, isFile, writeFileAtomic } from './fsx.ts';

/**
 * Persistent offline render cache: full-res render PNGs downloaded once into
 * <userData>/render-cache/<key>.png and served back as file:// URLs.
 */

const DOWNLOAD_TIMEOUT_MS = 60_000;

/** Keys become file names — restrict to a safe charset and forbid traversal. */
function safeKey(key: string): string {
  const cleaned = path.basename(key.trim()).replace(/[^A-Za-z0-9._-]/g, '-');
  if (cleaned.length === 0 || cleaned === '.' || cleaned === '..' || /^\.+$/.test(cleaned)) {
    throw new Error(`invalid render-cache key: ${JSON.stringify(key)}`);
  }
  return cleaned;
}

function fileFor(cacheDir: string, key: string): string {
  return path.join(cacheDir, `${safeKey(key)}.png`);
}

export async function cacheRender(cacheDir: string, url: string, key: string): Promise<string> {
  const file = fileFor(cacheDir, key);
  if (await isFile(file)) return pathToFileURL(file).href;
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`render download failed: HTTP ${res.status} for ${url}`);
  const data = new Uint8Array(await res.arrayBuffer());
  await ensureDir(cacheDir);
  await writeFileAtomic(file, data);
  return pathToFileURL(file).href;
}

export async function getCachedRender(cacheDir: string, key: string): Promise<string | null> {
  const file = fileFor(cacheDir, key);
  return (await isFile(file)) ? pathToFileURL(file).href : null;
}

export async function renderCacheSize(cacheDir: string): Promise<number> {
  if (!(await isDirectory(cacheDir))) return 0;
  let total = 0;
  for (const name of await fs.readdir(cacheDir)) {
    try {
      const stat = await fs.stat(path.join(cacheDir, name));
      if (stat.isFile()) total += stat.size;
    } catch {
      // Raced deletion — ignore.
    }
  }
  return total;
}

export async function clearRenderCache(cacheDir: string): Promise<void> {
  if (!(await isDirectory(cacheDir))) return;
  for (const name of await fs.readdir(cacheDir)) {
    await fs.rm(path.join(cacheDir, name), { force: true, recursive: true });
  }
}
