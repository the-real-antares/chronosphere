import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { QuarantineResult, QuarantineSummary, UndoResult } from '../../ipc.ts';
import { ensureDir, isDirectory, moveFile, readJsonFile, writeJsonFile } from './fsx.ts';

/**
 * Quarantine: files move into <userData>/quarantine/<timestamp>/ preserving
 * their names, with a journal.json recording every {from, to} so the batch
 * can be undone. Planning and journal validation are pure (unit-testable).
 */

export interface QuarantineEntry {
  from: string;
  to: string;
}

export interface QuarantineJournal {
  id: string;
  createdAt: string;
  entries: QuarantineEntry[];
}

/**
 * Pure: decide destination paths inside `destDir`, preserving base names and
 * de-duplicating collisions as name-2.ext, name-3.ext, …
 */
export function planQuarantine(paths: string[], destDir: string): QuarantineEntry[] {
  const used = new Set<string>();
  const entries: QuarantineEntry[] = [];
  for (const from of paths) {
    const base = path.basename(from);
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    let candidate = base;
    let n = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${stem}-${n}${ext}`;
      n += 1;
    }
    used.add(candidate.toLowerCase());
    entries.push({ from, to: path.join(destDir, candidate) });
  }
  return entries;
}

/** Pure: journal shape guard, used when reading journal.json back from disk. */
export function isQuarantineJournal(x: unknown): x is QuarantineJournal {
  if (typeof x !== 'object' || x === null) return false;
  const j = x as Record<string, unknown>;
  if (typeof j['id'] !== 'string' || typeof j['createdAt'] !== 'string') return false;
  if (!Array.isArray(j['entries'])) return false;
  return (j['entries'] as unknown[]).every((e) => {
    if (typeof e !== 'object' || e === null) return false;
    const entry = e as Record<string, unknown>;
    return typeof entry['from'] === 'string' && typeof entry['to'] === 'string';
  });
}

function timestampId(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

export async function quarantineFiles(
  quarantineRoot: string,
  paths: string[],
): Promise<QuarantineResult> {
  const now = new Date();
  let id = timestampId(now);
  let destDir = path.join(quarantineRoot, id);
  // Two batches in the same millisecond is unlikely, but stay collision-safe.
  for (let n = 2; await isDirectory(destDir); n += 1) {
    id = `${timestampId(now)}-${n}`;
    destDir = path.join(quarantineRoot, id);
  }
  await ensureDir(destDir);

  const planned = planQuarantine(paths, destDir);
  const moved: QuarantineEntry[] = [];
  const errors: string[] = [];
  for (const entry of planned) {
    try {
      await moveFile(entry.from, entry.to);
      moved.push(entry);
    } catch (err) {
      errors.push(`${entry.from}: ${(err as Error).message}`);
    }
  }

  const journal: QuarantineJournal = { id, createdAt: now.toISOString(), entries: moved };
  await writeJsonFile(path.join(destDir, 'journal.json'), journal);
  return { id, moved: moved.length, errors };
}

export async function undoQuarantine(quarantineRoot: string, id: string): Promise<UndoResult> {
  const dir = path.join(quarantineRoot, path.basename(id));
  const raw = await readJsonFile(path.join(dir, 'journal.json'));
  if (!isQuarantineJournal(raw)) {
    return { restored: 0, errors: [`no readable journal for quarantine "${id}"`] };
  }
  let restored = 0;
  const errors: string[] = [];
  const remaining: QuarantineEntry[] = [];
  for (const entry of raw.entries) {
    try {
      await moveFile(entry.to, entry.from);
      restored += 1;
    } catch (err) {
      errors.push(`${entry.to}: ${(err as Error).message}`);
      remaining.push(entry);
    }
  }
  if (remaining.length === 0) {
    await fs.rm(dir, { recursive: true, force: true });
  } else {
    await writeJsonFile(path.join(dir, 'journal.json'), { ...raw, entries: remaining });
  }
  return { restored, errors };
}

export async function listQuarantine(quarantineRoot: string): Promise<QuarantineSummary[]> {
  if (!(await isDirectory(quarantineRoot))) return [];
  const summaries: QuarantineSummary[] = [];
  const entries = await fs.readdir(quarantineRoot, { withFileTypes: true });
  for (const dirent of entries) {
    if (!dirent.isDirectory()) continue;
    const dir = path.join(quarantineRoot, dirent.name);
    const raw = await readJsonFile(path.join(dir, 'journal.json'));
    if (!isQuarantineJournal(raw)) continue;
    let bytes = 0;
    for (const entry of raw.entries) {
      try {
        bytes += (await fs.stat(entry.to)).size;
      } catch {
        // File may have been restored or removed out-of-band; still listed.
      }
    }
    summaries.push({ id: raw.id, createdAt: raw.createdAt, count: raw.entries.length, bytes });
  }
  summaries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return summaries;
}

export async function emptyQuarantine(quarantineRoot: string): Promise<void> {
  if (!(await isDirectory(quarantineRoot))) return;
  const entries = await fs.readdir(quarantineRoot, { withFileTypes: true });
  for (const dirent of entries) {
    await fs.rm(path.join(quarantineRoot, dirent.name), { recursive: true, force: true });
  }
}
