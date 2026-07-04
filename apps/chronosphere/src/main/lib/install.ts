import { promises as fs } from 'node:fs';
import path from 'node:path';
import { MAP_FILE_EXTENSIONS } from '@antares/shared/taxonomy.ts';
import type { InstallMapRequest, InstallMapResult } from '../../ipc.ts';
import { ensureDir, isDirectory, writeFileAtomic } from './fsx.ts';
import { extractMapFacts } from './map-facts.ts';

const DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * Chronoshift a map into <targetFolder>/Maps/Custom/: download, write
 * atomically (tmp + rename), then RE-VERIFY by reading the written file back
 * from disk — hash + health come from what actually landed, never assumed
 * (spec §10: no hardcoded success health).
 */
export async function installMap(request: InstallMapRequest): Promise<InstallMapResult> {
  const fileName = path.basename(request.fileName.trim());
  if (fileName.length === 0 || fileName === '.' || fileName === '..') {
    throw new Error('invalid file name');
  }
  const ext = path.extname(fileName).toLowerCase();
  if (!(MAP_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error(`unsupported map extension: ${ext === '' ? '(none)' : ext}`);
  }
  if (!(await isDirectory(request.targetFolder))) {
    throw new Error(`target folder does not exist: ${request.targetFolder}`);
  }

  const res = await fetch(request.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`map download failed: HTTP ${res.status}`);
  const data = new Uint8Array(await res.arrayBuffer());

  const destDir = path.join(request.targetFolder, 'Maps', 'Custom');
  await ensureDir(destDir);
  const dest = path.join(destDir, fileName);
  await writeFileAtomic(dest, data);

  // Re-verify from disk, not from the in-memory download buffer.
  const written = await fs.readFile(dest);
  const facts = extractMapFacts(written);
  return { path: dest, contentHash: facts.contentHash, health: facts.health };
}
