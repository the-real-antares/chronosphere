import { DEFAULT_SETTINGS, type ChronoSettings, type GameFolder } from '../../ipc.ts';
import { readJsonFile, writeJsonFile } from './fsx.ts';

/** Settings persistence: JSON at <userData>/settings.json, merged over defaults. */

function sanitizeGameFolders(value: unknown): GameFolder[] {
  if (!Array.isArray(value)) return [];
  const out: GameFolder[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const f = item as Record<string, unknown>;
    if (typeof f['path'] !== 'string' || f['path'].length === 0) continue;
    out.push({ path: f['path'], isDefault: f['isDefault'] === true });
  }
  return out;
}

/** Pure merge of a partial patch over a base — unknown keys dropped, values coerced. */
export function mergeSettings(base: ChronoSettings, patch: Partial<ChronoSettings>): ChronoSettings {
  const next: ChronoSettings = { ...base, gameFolders: base.gameFolders.map((f) => ({ ...f })) };
  if (patch.gameFolders !== undefined) next.gameFolders = sanitizeGameFolders(patch.gameFolders);
  if (typeof patch.apiBase === 'string' && patch.apiBase.length > 0) next.apiBase = patch.apiBase;
  if (typeof patch.easterEggs === 'boolean') next.easterEggs = patch.easterEggs;
  if (typeof patch.reducedMotion === 'boolean') next.reducedMotion = patch.reducedMotion;
  if (patch.authToken === null || typeof patch.authToken === 'string') next.authToken = patch.authToken;
  if (typeof patch.onboarded === 'boolean') next.onboarded = patch.onboarded;
  return next;
}

export async function readSettings(file: string): Promise<ChronoSettings> {
  const raw = await readJsonFile(file);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return mergeSettings(DEFAULT_SETTINGS, {});
  }
  return mergeSettings(DEFAULT_SETTINGS, raw as Partial<ChronoSettings>);
}

export async function writeSettings(file: string, settings: ChronoSettings): Promise<void> {
  await writeJsonFile(file, settings);
}
