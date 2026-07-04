/**
 * MapKit — the deterministic map health analyzer (no LLM, ever). Runs at web
 * ingest and locally in Chronosphere; reports carry MAPKIT_VERSION so stale
 * reports can be re-verified after analyzer upgrades.
 *
 * Verdict rules, applied in order:
 *   1. broken    — unparseable file; missing/invalid [Map] Size; no tile data;
 *                  corrupt [IsoMapPack5]; or no start locations (no 0..7
 *                  waypoints AND no [Basic] Player= campaign human house).
 *   2. needs-mod — knownObjects provided and some referenced object ids are
 *                  not in it (never demoted to broken).
 *   3. heavy     — ≥250 triggers, ≥35 AI teams, or ≥22500 cells (150×150).
 *   4. verified  — otherwise.
 */
import type { HealthReport } from '../types.ts';
import { MapParseError, parseMapFile, type ParsedMapFile } from '../mapfile/parse.ts';

export const MAPKIT_VERSION = '1.0.0';

export interface AnalyzeOptions {
  /** Object ids from an install's rules.ini; when absent, needs-mod detection is skipped. */
  knownObjects?: Set<string>;
}

const HEAVY_TRIGGERS = 250;
const HEAVY_AI_TEAMS = 35;
const HEAVY_CELLS = 22500; // 150×150
const MAX_LISTED_MISSING_OBJECTS = 5;

export function analyzeParsed(parsed: ParsedMapFile, opts?: AnalyzeOptions): HealthReport {
  const metrics: NonNullable<HealthReport['metrics']> = {
    triggers: parsed.triggerCount,
    aiTeams: parsed.aiTeamCount,
  };
  if (parsed.width !== null) metrics.width = parsed.width;
  if (parsed.height !== null) metrics.height = parsed.height;

  // 1. broken
  const brokenFindings: string[] = [];
  if (parsed.width === null || parsed.height === null) {
    brokenFindings.push('missing or invalid [Map] Size');
  }
  if (!parsed.hasIsoMapPack) {
    brokenFindings.push('no tile data ([IsoMapPack5] missing)');
  } else if (parsed.isoMapPackValid === false) {
    brokenFindings.push('corrupt tile data');
  }
  const basicPlayer = parsed.basic['Player'];
  const hasHumanHouse = basicPlayer !== undefined && basicPlayer !== '';
  if (parsed.startWaypoints.length === 0 && !hasHumanHouse) {
    brokenFindings.push('no start locations');
  }
  if (brokenFindings.length > 0) {
    return { verdict: 'broken', findings: brokenFindings, metrics, mapkitVersion: MAPKIT_VERSION };
  }

  // 2. needs-mod
  const known = opts?.knownObjects;
  if (known) {
    const missing = parsed.referencedObjects.filter((id) => !known.has(id));
    if (missing.length > 0) {
      const listed = missing.slice(0, MAX_LISTED_MISSING_OBJECTS).join(', ');
      const more =
        missing.length > MAX_LISTED_MISSING_OBJECTS
          ? ` (+${missing.length - MAX_LISTED_MISSING_OBJECTS} more)`
          : '';
      return {
        verdict: 'needs-mod',
        findings: [`references missing art → needs a mod: ${listed}${more}`],
        metrics,
        mapkitVersion: MAPKIT_VERSION,
      };
    }
  }

  // 3. heavy
  const heavyParts: string[] = [];
  if (parsed.triggerCount >= HEAVY_TRIGGERS) heavyParts.push(`${parsed.triggerCount} triggers`);
  if (parsed.aiTeamCount >= HEAVY_AI_TEAMS) heavyParts.push(`${parsed.aiTeamCount} AI teams`);
  if (parsed.width !== null && parsed.height !== null && parsed.width * parsed.height >= HEAVY_CELLS) {
    heavyParts.push(`${parsed.width}×${parsed.height} cells`);
  }
  if (heavyParts.length > 0) {
    return {
      verdict: 'heavy',
      findings: [heavyParts.join(' · ')],
      metrics,
      mapkitVersion: MAPKIT_VERSION,
    };
  }

  // 4. verified
  return { verdict: 'verified', findings: [], metrics, mapkitVersion: MAPKIT_VERSION };
}

export function analyzeMap(bytes: Uint8Array, opts?: AnalyzeOptions): HealthReport {
  let parsed: ParsedMapFile;
  try {
    parsed = parseMapFile(bytes);
  } catch (err) {
    if (err instanceof MapParseError) {
      return { verdict: 'broken', findings: ['unreadable map file'], mapkitVersion: MAPKIT_VERSION };
    }
    throw err;
  }
  return analyzeParsed(parsed, opts);
}
