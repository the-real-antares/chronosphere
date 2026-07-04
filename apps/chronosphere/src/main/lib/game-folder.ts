import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GameFolderValidation } from '../../ipc.ts';
import { isDirectory } from './fsx.ts';

/**
 * Game-folder heuristics. Deliberately permissive: anything that carries the
 * game's core files, a CnCNet spawner, or even just a Maps/ directory counts.
 */

const MARKER_FILES = ['ra2md.mix', 'gamemd.exe'];

export async function validateGameFolder(folder: string): Promise<GameFolderValidation> {
  if (typeof folder !== 'string' || folder.trim().length === 0) {
    return { ok: false, reason: 'no folder given' };
  }
  if (!(await isDirectory(folder))) {
    return { ok: false, reason: 'folder does not exist' };
  }

  let names: string[];
  try {
    names = (await fs.readdir(folder)).map((n) => n.toLowerCase());
  } catch {
    return { ok: false, reason: 'folder is not readable' };
  }

  for (const marker of MARKER_FILES) {
    if (names.includes(marker)) return { ok: true, reason: `found ${marker}` };
  }
  if (names.some((n) => n.includes('spawner'))) {
    return { ok: true, reason: 'found a CnCNet spawner' };
  }
  if (await isDirectory(path.join(folder, 'Maps'))) {
    return { ok: true, reason: 'found a Maps/ directory' };
  }
  return {
    ok: false,
    reason: "does not look like a Yuri's Revenge install (no game files, spawner, or Maps/ directory)",
  };
}

export interface AutoDetectContext {
  platform: NodeJS.Platform;
  home: string;
  env: NodeJS.ProcessEnv;
  /** Extra dev-time candidates, e.g. the repo's demo game folder. */
  extraCandidates?: string[];
}

/** Pure candidate list — existence is checked separately in autoDetectGameFolders. */
export function autoDetectCandidates(ctx: AutoDetectContext): string[] {
  const candidates: string[] = [];
  if (ctx.platform === 'win32') {
    const pf86 = ctx.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const pf = ctx.env['ProgramFiles'] ?? 'C:\\Program Files';
    candidates.push(
      path.join(pf86, 'CnCNet', "Yuri's Revenge"),
      path.join(pf86, 'Origin Games', 'Command and Conquer Red Alert II'),
      path.join(pf86, 'EA Games', 'Command & Conquer Red Alert II'),
      path.join(pf86, 'Steam', 'steamapps', 'common', 'Command & Conquer Red Alert II'),
      path.join(pf, 'Steam', 'steamapps', 'common', 'Command & Conquer Red Alert II'),
      path.join(ctx.home, 'CnCNet'),
      path.join(ctx.home, 'Documents', 'CnCNet'),
    );
  } else {
    candidates.push(path.join(ctx.home, 'CnCNet'));
    if (ctx.platform === 'linux') {
      candidates.push(
        path.join(ctx.home, '.wine', 'drive_c', 'Program Files (x86)', 'CnCNet', "Yuri's Revenge"),
      );
    }
  }
  candidates.push(...(ctx.extraCandidates ?? []));
  // De-duplicate, preserving order.
  return [...new Set(candidates)];
}

/** Only paths that actually exist as directories are returned. */
export async function autoDetectGameFolders(ctx: AutoDetectContext): Promise<string[]> {
  const found: string[] = [];
  for (const candidate of autoDetectCandidates(ctx)) {
    if (await isDirectory(candidate)) found.push(candidate);
  }
  return found;
}

/**
 * Dev-time candidates for the seeded demo game folder
 * (apps/web/.data/demo-game-folder), located relative to the app — never a
 * hard-coded machine path.
 */
export function demoFolderCandidates(appPath: string, cwd: string): string[] {
  const tail = ['web', '.data', 'demo-game-folder'];
  return [
    path.resolve(appPath, '..', ...tail),
    path.resolve(cwd, 'apps', ...tail),
    path.resolve(cwd, '..', ...tail),
  ];
}
