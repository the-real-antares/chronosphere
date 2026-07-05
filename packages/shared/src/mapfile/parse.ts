/**
 * Structural parsing of RA2/YR .map files (which are INI text), extracting
 * the fields the archive and MapKit care about. Field semantics follow the
 * World-Altering Editor's MapLoader.
 */
import type { Theater } from '../taxonomy.ts';
import { IniFile } from './ini.ts';
import { decodePackSection } from './packs.ts';

export class MapParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapParseError';
  }
}

/** [Map] Theater= game tokens → shared taxonomy Theater labels. */
export const THEATER_LABEL_BY_TOKEN: Record<string, Theater> = {
  TEMPERATE: 'Temperate',
  SNOW: 'Snow',
  URBAN: 'Urban',
  NEWURBAN: 'New Urban',
  DESERT: 'Desert',
  LUNAR: 'Lunar',
};

export interface ParsedMapFile {
  ini: IniFile;
  name: string | null;
  theater: string | null;
  width: number | null;
  height: number | null;
  startWaypoints: number[];
  maxPlayers: number | null;
  basic: Record<string, string>;
  gameModes: string[];
  previewSize: { width: number; height: number } | null;
  hasPreviewPack: boolean;
  hasIsoMapPack: boolean;
  triggerCount: number;
  aiTeamCount: number;
  referencedObjects: string[];
  isoMapPackValid: boolean | null;
  // --- Additive linter-foundation fields (backward compatible). See docs/LINTER_SPEC.md PART 4.2. ---
  /** [Map] LocalSize=x,y,w,h → all four parts (null when absent or <4 int parts). WAE throws on missing → we flag it in meta. */
  localSize: { x: number; y: number; width: number; height: number } | null;
  /** [Map] Size parts[0]/[1] (the paint-region origin; parts[2]/[3] feed width/height). null when absent/invalid. */
  sizeOrigin: { x: number; y: number } | null;
  /** Raw int([Basic] MaxPlayer) — the DECLARED value, never the derived maxPlayers. null when absent/non-int. */
  maxPlayerDeclared: number | null;
  /** Raw int([Basic] MinPlayer). null when absent/non-int. */
  minPlayerDeclared: number | null;
  /** [Basic] Official typed flag: {yes,true,1}→true, {no,false,0}→false, else null. */
  official: boolean | null;
  /** [Basic] MultiplayerOnly typed flag. */
  multiplayerOnly: boolean | null;
  /** int([Basic] RequiredAddOn) (1 ⇒ requires Yuri's Revenge). null when absent/non-int. */
  requiredAddOn: number | null;
  /** int([Basic] NewINIFormat) — the map-format revision. null when absent/non-int. */
  newIniFormat: number | null;
  /** True when a [Header] section is present (non-standard for hand-authored maps). */
  hasHeaderSection: boolean;
  /** True when the [Map] Theater token (uppercased) is a known theater in THEATER_LABEL_BY_TOKEN. */
  theaterKnown: boolean;
}

/** The four object lists whose values reference rules.ini object ids. */
const OBJECT_LIST_SECTIONS = ['Structures', 'Units', 'Infantry', 'Aircraft'] as const;

function bytesToText(bytes: Uint8Array): string {
  // Maps are ASCII/ANSI text; latin1 preserves every byte 1:1 (base64 pack
  // data must survive untouched). Strip a UTF-8 BOM if present.
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    start = 3;
  }
  return Buffer.from(bytes.subarray(start)).toString('latin1');
}

function intOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

/** Size=x,y,w,h → { width: w, height: h } (WAE reads parts[2] and parts[3]). */
function parseSizeQuad(value: string | undefined): { width: number; height: number } | null {
  if (value === undefined) return null;
  const parts = value.split(',');
  if (parts.length < 4) return null;
  const width = intOrNull(parts[2]);
  const height = intOrNull(parts[3]);
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  return { width, height };
}

function sectionKeyCount(ini: IniFile, name: string): number {
  const section = ini.section(name);
  return section ? Object.keys(section).length : 0;
}

/** Typed [Basic]-style flag: {yes,true,1}→true, {no,false,0}→false, else null. */
function boolFlagOrNull(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const t = value.trim().toLowerCase();
  if (t === 'yes' || t === 'true' || t === '1') return true;
  if (t === 'no' || t === 'false' || t === '0') return false;
  return null;
}

/** x,y,w,h → all four parts as ints (null when <4 parts or any non-int). */
function parseRectQuad(
  value: string | undefined,
): { x: number; y: number; width: number; height: number } | null {
  if (value === undefined) return null;
  const parts = value.split(',');
  if (parts.length < 4) return null;
  const x = intOrNull(parts[0]);
  const y = intOrNull(parts[1]);
  const width = intOrNull(parts[2]);
  const height = intOrNull(parts[3]);
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height };
}

/** Size parts[0]/[1] → { x, y } (null when <2 parts or non-int). */
function parseOriginXY(value: string | undefined): { x: number; y: number } | null {
  if (value === undefined) return null;
  const parts = value.split(',');
  if (parts.length < 2) return null;
  const x = intOrNull(parts[0]);
  const y = intOrNull(parts[1]);
  if (x === null || y === null) return null;
  return { x, y };
}

/**
 * Collect every TaskForce member unit id: [TaskForces] index→id, then each
 * [<id>] body's numeric member keys hold `count,unitId`. Used to widen
 * referencedObjects so the needs-mod verdict catches mod-only recruits.
 */
function collectTaskForceUnitIds(ini: IniFile): string[] {
  const out: string[] = [];
  const registry = ini.section('TaskForces');
  if (!registry) return out;
  for (const taskForceId of Object.values(registry)) {
    const body = ini.section(taskForceId.trim());
    if (!body) continue;
    for (const [key, raw] of Object.entries(body)) {
      if (!/^\d+$/.test(key)) continue; // numeric member slots only (skip Name/Group)
      const unitId = raw.split(',')[1]?.trim();
      if (unitId !== undefined && unitId.length > 0) out.push(unitId);
    }
  }
  return out;
}

export function parseMapFile(bytes: Uint8Array): ParsedMapFile {
  const ini = IniFile.parse(bytesToText(bytes));
  if (ini.sectionNames().length === 0) {
    throw new MapParseError('no INI sections found — not a map file');
  }

  const basic = ini.section('Basic') ?? (Object.create(null) as Record<string, string>);

  const nameRaw = basic['Name'];
  const name = nameRaw !== undefined && nameRaw !== '' ? nameRaw : null;

  const mapSize = parseSizeQuad(ini.get('Map', 'Size'));
  const width = mapSize?.width ?? null;
  const height = mapSize?.height ?? null;

  const theaterRaw = ini.get('Map', 'Theater');
  const theaterPresent = theaterRaw !== undefined && theaterRaw !== '';
  const theater = theaterPresent
    ? (THEATER_LABEL_BY_TOKEN[theaterRaw.toUpperCase()] ?? theaterRaw)
    : null;
  const theaterKnown = theaterPresent && THEATER_LABEL_BY_TOKEN[theaterRaw.toUpperCase()] !== undefined;

  const waypoints = ini.section('Waypoints') ?? {};
  const startWaypoints: number[] = [];
  for (let i = 0; i < 8; i++) {
    const value = waypoints[String(i)];
    if (value !== undefined && value !== '') startWaypoints.push(i);
  }

  let maxPlayers: number | null = startWaypoints.length > 0 ? startWaypoints.length : null;
  if (maxPlayers === null) {
    const fromBasic = intOrNull(basic['MaxPlayer']);
    maxPlayers = fromBasic !== null && fromBasic > 0 ? fromBasic : null;
  }

  const gameModeRaw = basic['GameMode'];
  const gameModes =
    gameModeRaw !== undefined
      ? gameModeRaw
          .split(',')
          .map((mode) => mode.trim().toLowerCase())
          .filter((mode) => mode.length > 0)
      : [];

  const previewSize = parseSizeQuad(ini.get('Preview', 'Size'));

  // Like WAE's ReadIsoMapPack, an existing-but-empty pack section counts as
  // "no data".
  const hasPreviewPack = sectionKeyCount(ini, 'PreviewPack') > 0;
  const hasIsoMapPack = sectionKeyCount(ini, 'IsoMapPack5') > 0;

  const triggerCount = sectionKeyCount(ini, 'Triggers');
  const aiTeamCount = sectionKeyCount(ini, 'TeamTypes');

  const seen = new Set<string>();
  const referencedObjects: string[] = [];
  for (const sectionName of OBJECT_LIST_SECTIONS) {
    const section = ini.section(sectionName);
    if (!section) continue;
    for (const value of Object.values(section)) {
      // WAE MapLoader: INDEX=OWNER,ID,... — the object type id is the second
      // comma field (WAE splits with RemoveEmptyEntries, hence the filter).
      const fields = value
        .split(',')
        .map((field) => field.trim())
        .filter((field) => field.length > 0);
      const id = fields[1];
      if (id !== undefined && !seen.has(id)) {
        seen.add(id);
        referencedObjects.push(id);
      }
    }
  }
  // Union TaskForce member unit ids so the needs-mod verdict catches mod-only
  // recruits (e.g. survival maps that spawn a modded unit via AI teams).
  for (const unitId of collectTaskForceUnitIds(ini)) {
    if (!seen.has(unitId)) {
      seen.add(unitId);
      referencedObjects.push(unitId);
    }
  }

  let isoMapPackValid: boolean | null = null;
  if (hasIsoMapPack) {
    try {
      const tileData = decodePackSection(ini.section('IsoMapPack5')!);
      // Plausibility: WAE requires ≥4 bytes of pack data and writes 4 bytes of
      // padding even for an empty tile list (it deliberately does NOT enforce
      // tile-struct alignment — that check is commented out in MapLoader).
      isoMapPackValid = tileData.length >= 4;
    } catch {
      isoMapPackValid = false;
    }
  }

  return {
    ini,
    name,
    theater,
    width,
    height,
    startWaypoints,
    maxPlayers,
    basic,
    gameModes,
    previewSize,
    hasPreviewPack,
    hasIsoMapPack,
    triggerCount,
    aiTeamCount,
    referencedObjects,
    isoMapPackValid,
    localSize: parseRectQuad(ini.get('Map', 'LocalSize')),
    sizeOrigin: parseOriginXY(ini.get('Map', 'Size')),
    maxPlayerDeclared: intOrNull(basic['MaxPlayer']),
    minPlayerDeclared: intOrNull(basic['MinPlayer']),
    official: boolFlagOrNull(basic['Official']),
    multiplayerOnly: boolFlagOrNull(basic['MultiplayerOnly']),
    requiredAddOn: intOrNull(basic['RequiredAddOn']),
    newIniFormat: intOrNull(basic['NewINIFormat']),
    hasHeaderSection: ini.section('Header') !== undefined,
    theaterKnown,
  };
}
