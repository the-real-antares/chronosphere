import { promises as fs } from 'node:fs';
import path from 'node:path';
import { MAP_FILE_EXTENSIONS, MAX_SUBMISSION_BYTES } from '@antares/shared/taxonomy.ts';

/**
 * Contribute-upload primitive: read a scanned map file's bytes as base64.
 * Hard rules — the renderer may only read files that (a) live inside one of
 * the configured game folders, (b) carry a map extension, and (c) are small
 * enough to ever be a submission. Anything else is refused.
 */

/** True when `child` is `parent` or lives underneath it (after resolution). */
export function isInsideFolder(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export async function readFileBase64Within(
  gameFolders: readonly string[],
  filePath: string,
): Promise<string> {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new Error('no file path given');
  }
  const resolved = path.resolve(filePath);

  const ext = path.extname(resolved).toLowerCase();
  if (!(MAP_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error(`refusing to read non-map file: ${ext === '' ? '(no extension)' : ext}`);
  }
  if (!gameFolders.some((folder) => isInsideFolder(folder, resolved))) {
    throw new Error('refusing to read a path outside the configured game folders');
  }

  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error('not a file');
  if (stat.size > MAX_SUBMISSION_BYTES) {
    throw new Error(`file too large to contribute (${stat.size} bytes)`);
  }

  const bytes = await fs.readFile(resolved);
  return bytes.toString('base64');
}
