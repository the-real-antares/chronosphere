import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Small fs helpers shared by the main-process services. No electron imports. */

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

/** Write via a temp file in the same directory, then rename — atomic on POSIX and NTFS. */
export async function writeFileAtomic(file: string, data: Uint8Array | string): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, data);
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Move a file; falls back to copy+unlink when crossing devices (EXDEV). */
export async function moveFile(from: string, to: string): Promise<void> {
  await ensureDir(path.dirname(to));
  try {
    await fs.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await fs.copyFile(from, to);
      await fs.unlink(from);
    } else {
      throw err;
    }
  }
}

export async function readJsonFile(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await writeFileAtomic(file, JSON.stringify(value, null, 2));
}

/**
 * Recursively collect files under `dir` whose lowercased extension is in
 * `extensions`. Hidden directories are skipped; depth is capped so a
 * misconfigured game folder never walks a whole drive.
 */
export async function walkFiles(
  dir: string,
  extensions: readonly string[],
  maxDepth = 4,
): Promise<string[]> {
  const out: string[] = [];
  await walkInto(dir, extensions, maxDepth, out);
  return out;
}

async function walkInto(
  dir: string,
  extensions: readonly string[],
  depth: number,
  out: string[],
): Promise<void> {
  if (depth < 0) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkInto(full, extensions, depth - 1, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) out.push(full);
    }
  }
}
