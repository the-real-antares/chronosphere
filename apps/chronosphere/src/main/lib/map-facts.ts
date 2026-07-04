import { sha1Hex } from '@antares/shared/hash.ts';
import { parseMapFile } from '@antares/shared/mapfile/parse.ts';
import { analyzeMap, analyzeParsed, MAPKIT_VERSION } from '@antares/shared/mapkit/index.ts';
import type { HealthReport } from '@antares/shared/types.ts';

/**
 * One place that turns raw map-file bytes into facts + a health report.
 * Used by the scanner and by installMap's post-write re-verification.
 * Never fabricates a "verified" verdict: unparseable input degrades to the
 * analyzer's broken verdict (or a local broken report as a last resort).
 */

export interface MapFacts {
  contentHash: string;
  name: string | null;
  theater: string | null;
  width: number | null;
  height: number | null;
  maxPlayers: number | null;
  health: HealthReport;
  previewAvailable: boolean;
}

export function extractMapFacts(bytes: Uint8Array): MapFacts {
  const contentHash = sha1Hex(bytes);
  try {
    const parsed = parseMapFile(bytes);
    return {
      contentHash,
      name: parsed.name,
      theater: parsed.theater,
      width: parsed.width,
      height: parsed.height,
      maxPlayers: parsed.maxPlayers,
      health: analyzeParsed(parsed),
      previewAvailable: parsed.hasPreviewPack && parsed.previewSize !== null,
    };
  } catch {
    return {
      contentHash,
      name: null,
      theater: null,
      width: null,
      height: null,
      maxPlayers: null,
      health: analyzeBytesSafe(bytes),
      previewAvailable: false,
    };
  }
}

/** analyzeMap already maps MapParseError to a broken verdict; guard anything else. */
function analyzeBytesSafe(bytes: Uint8Array): HealthReport {
  try {
    return analyzeMap(bytes);
  } catch {
    return {
      verdict: 'broken',
      findings: ['file could not be read as a map'],
      mapkitVersion: MAPKIT_VERSION,
    };
  }
}
