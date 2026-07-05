/**
 * MapFacts — the single, deduped structural decode shared by all five linter
 * category checkers (triggers / ai / spawns / objects / meta). Computed once
 * per map by `computeMapFacts(parsed)`; every checker reads it, nothing is
 * parsed twice, and no checker re-reads `parsed.ini` for anything already here.
 *
 * Pure, deterministic, no I/O, no LLM. Field names are a contract — the five
 * checker authors import these exact names. See docs/LINTER_SPEC.md PART 3/4.1.
 *
 * NOTE: vanilla-vs-mod classification of object ids is deliberately NOT done
 * here — it needs the `VANILLA_YR_OBJECTS` data asset (owned by objects.ts) and
 * `opts.knownObjects`. facts only surfaces the raw referenced id set.
 */
import { decodePackSection } from '../mapfile/packs.ts';
import type { ParsedMapFile } from '../mapfile/parse.ts';
import { sizeClassOf, type SizeClass } from '../taxonomy.ts';

// ---------------------------------------------------------------------------
// Tunables (named data constants; the checkers import these).
// ---------------------------------------------------------------------------
/** Distinct-unknown object count at/above which the map reads as mod-only (not broken art). */
export const MOD_THRESHOLD = 3;
/** IsoMapPack decoded length beyond this × the theoretical size is "oversized". */
export const OVERSIZE_FACTOR = 1.25;
/** [Terrain] entry count at/above which terrain reads as hand-decorated. */
export const TERRAIN_RICH_THRESHOLD = 20;
/** 11-byte tile struct; IsoMapPack5 decoded length should be ≡ 0 or 4 (padding) mod this. */
export const ISOMAPPACK_TILE_STRIDE = 11;

/** Waypoint cells the engine reserves (home/build cells), excluded from "scripting" waypoints. */
export const HOME_CELL_WAYPOINTS = new Set([98, 99, 699, 700]);

/** Capturable tech-building ids (has-capturable-tech reward). */
export const TECH_STRUCTURE_IDS = new Set([
  'CAOILD',
  'CAOUTP',
  'CATHOSP',
  'CAHOSP',
  'CAAIRP',
  'CAPOWR',
  'CASLAB',
  'CAMACH',
]);
/** Ore/Tiberium tree terrain ids (resource-economy reward, works without Format80). */
export const ORE_TREE_TERRAIN_IDS = new Set(['TIBTRE01', 'TIBTRE02', 'TIBTRE03']);
/** Owner house tokens that mark neutral/civilian/capturable objects. */
export const NEUTRAL_OWNER_TOKENS = new Set(['neutral', 'special', 'civilian']);

/** WAE minimum comma-field counts per object list; a shorter row is malformed. */
export const OBJECT_MIN_FIELDS = {
  Structures: 17,
  Aircraft: 12,
  Units: 14,
  Infantry: 14,
} as const;
/** 0-based index of the attached-tag field per object list. */
const OBJECT_TAG_FIELD = { Structures: 6, Infantry: 8, Units: 7, Aircraft: 7 } as const;

const OBJECT_SECTIONS = ['Structures', 'Units', 'Infantry', 'Aircraft'] as const;
type ObjectSection = (typeof OBJECT_SECTIONS)[number];

// ===========================================================================
// Fact bundle types
// ===========================================================================

/** Meta / header facts (owner: meta.ts; several shared). */
export interface MetaFacts {
  name: string | null;
  basicSectionPresent: boolean;
  /** Raw [Map] Theater token, trimmed (null when absent/empty). */
  theaterToken: string | null;
  theaterKnown: boolean;
  size: { width: number; height: number } | null;
  /** [Map] Size parts[0]/[1]. */
  sizeOrigin: { x: number; y: number } | null;
  localSize: { x: number; y: number; width: number; height: number } | null;
  /** Raw int([Basic] MaxPlayer) — DECLARED, never the derived maxPlayers. */
  maxPlayerDeclared: number | null;
  minPlayerDeclared: number | null;
  official: boolean | null;
  multiplayerOnly: boolean | null;
  requiredAddOn: number | null;
  requiresYR: boolean;
  newIniFormat: number | null;
  /** [Basic] Player= (campaign human house), null when absent/empty. */
  basicPlayer: string | null;
  gameModes: string[];
  hasHeaderSection: boolean;
  maxDimension: number | null;
  cellArea: number | null;
  sizeClass: SizeClass | null;
  /** A single-player mission (has [Basic] Player=). */
  isMission: boolean;
  isMissionLike: boolean;
}

export interface StartCoord {
  index: number;
  raw: string;
  /** Cell x = raw % 1000 (valid only when numeric). */
  x: number;
  /** Cell y = ⌊raw / 1000⌋ (valid only when numeric). */
  y: number;
  numeric: boolean;
}

/** Spawns / waypoints facts (owner: spawns.ts; shared by triggers + ai). */
export interface SpawnFacts {
  /** Present start waypoint indices in 0..7. */
  startWaypointIndices: number[];
  startCount: number;
  startCoords: StartCoord[];
  /** Indices whose raw value is not /^\d+$/. */
  nonNumericStarts: number[];
  /** Groups of ≥2 start indices decoding to the same cell. */
  duplicateStartCells: Array<{ x: number; y: number; indices: number[] }>;
  /** Indices of numeric starts out of the map's diamond (needs size). */
  outOfBoundsStarts: number[];
  /** True when present indices form a contiguous 0..max run (no gaps). */
  startContiguity: boolean;
  gapIndices: number[];
  /** Full [Waypoints] numeric key set (superset of 0..7). */
  allWaypointKeys: number[];
  /** Count of waypoint keys index≥8 excluding home cells 98/99/699/700. */
  scriptingWaypointCount: number;
  hasHomeCells: boolean;
  /** Min/mean pairwise Euclidean distance among valid in-bounds starts (null when <2 or size unknown). */
  spawnSeparation: { min: number; mean: number } | null;
  /** 180° point / axis mirror symmetry (null when not computable). */
  spawnSymmetry: { pointSymmetric: boolean; axisMirror: boolean } | null;
}

export interface TriggerEntry {
  id: string;
  house: string;
  /** parts[1], or null when <none>/none. */
  linkedTriggerId: string | null;
  name: string;
  /** parts[3] === '1'. */
  disabled: boolean;
  easy: boolean;
  normal: boolean;
  hard: boolean;
  fieldCount: number;
  /** <7 fields or fields[3..6] not boolean. */
  malformed: boolean;
}

export interface TriggerEvent {
  /** Event type id. */
  index: number;
  /** Parameters[0]. */
  p1: number;
  /** Parameters[1]. */
  p2: number;
  /** Extra field carried by event types 60/61 only. */
  str?: string;
}

export interface TriggerAction {
  /** Action type id. */
  index: number;
  /** Parameters[0..6] (7 raw string fields). P2 = params[1], P7 = params[6]. */
  params: string[];
}

export interface TagEntry {
  id: string;
  /** parts[0]. */
  repeat: number;
  name: string;
  /** parts[2] — the trigger this tag fires. */
  triggerId: string;
  fieldCount: number;
  /** fieldCount≠3 or repeat∉{0,1,2}. */
  malformed: boolean;
}

/** Triggers-graph facts (owner: triggers.ts). */
export interface TriggerFacts {
  triggerIdSet: Set<string>;
  triggers: Map<string, TriggerEntry>;
  /** [Events] parsed per trigger id. */
  events: Map<string, TriggerEvent[]>;
  /** Trigger ids whose [Events] encoding is malformed. */
  eventsMalformed: Set<string>;
  /** [Actions] parsed per trigger id. */
  actions: Map<string, TriggerAction[]>;
  /** Parsed action count per trigger id (for the >18 crash rule). */
  actionCounts: Map<string, number>;
  /** Trigger ids whose [Actions] encoding is malformed. */
  actionsMalformed: Set<string>;
  tagIdSet: Set<string>;
  tags: Map<string, TagEntry>;
  /** VALUES of [TeamTypes] (the team type ids a trigger action can reference). */
  teamTypeIdSet: Set<string>;
  /** = allWaypointKeys, as a Set for O(1) membership. */
  waypointNumberSet: Set<number>;
  hasVariableNames: boolean;
  /** [VariableNames] numeric key set. */
  localVarIndexSet: Set<number>;
  /** Object attached-tag fields ∪ [CellTags] values ∪ teamtype Tag=. */
  attachedTagIdSet: Set<string>;
  /** [Events] keys not in triggerIdSet. */
  orphanEventIds: string[];
  /** [Actions] keys not in triggerIdSet. */
  orphanActionIds: string[];
  /** triggerId → linkedTriggerId (only non-<none> links). */
  linkedTriggerGraph: Map<string, string>;
  isMission: boolean;
}

export interface TeamTypeBody {
  script: string | null;
  taskForce: string | null;
  house: string | null;
  tag: string | null;
  waypoint: string | null;
  max: number | null;
  priority: number | null;
  group: number | null;
  autocreate: boolean | null;
  /** True when a [<teamTypeId>] body section exists. */
  bodyPresent: boolean;
}

export interface ScriptTypeBody {
  actions: Array<{ action: number; argument: number }>;
  actionCount: number;
}

export interface TaskForceBody {
  members: Array<{ count: number; unitId: string }>;
  /** Number of numeric member-slot keys. */
  memberSlotCount: number;
}

export interface AiTriggerEntry {
  id: string;
  /** field[1] — Team1 (null when <none>/empty). */
  team1: string | null;
  /** field[4]. */
  conditionType: number | null;
  /** field[13]. */
  side: number | null;
  /** field[14] — Team2 (null when <none>/empty). */
  team2: string | null;
  enabledEasy: boolean;
  enabledNormal: boolean;
  enabledHard: boolean;
}

/** AI-scripting-graph facts (owner: ai.ts). */
export interface AiFacts {
  /** Registry list = VALUES of [TeamTypes]. */
  teamTypeIds: string[];
  teamTypes: Map<string, TeamTypeBody>;
  scriptTypeIds: string[];
  scriptTypes: Map<string, ScriptTypeBody>;
  taskForceIds: string[];
  taskForces: Map<string, TaskForceBody>;
  /** Every unit id recruited by any TaskForce. */
  taskForceUnitIds: Set<string>;
  aiTriggers: AiTriggerEntry[];
  /** Team1 ∪ Team2 over all AITriggers (excluding <none>). */
  aiTriggerReferencedTeams: Set<string>;
  /** Team ids reachable via AITriggers, Autocreate=yes, or a trigger action token. */
  reachableTeamIds: Set<string>;
  /** Script ids referenced by any teamtype Script=. */
  usedScriptIds: Set<string>;
  /** TaskForce ids referenced by any teamtype TaskForce=. */
  usedTaskForceIds: Set<string>;
  /** Every non-empty [Actions] parameter token (for team-recruited-by-trigger detection). */
  triggerActionTokens: Set<string>;
  houseNames: string[];
  graphIntegrity: {
    danglingCounts: {
      teamMissingScript: number;
      teamMissingTaskForce: number;
      aiTriggerDanglingTeam: number;
      teamBodyMissing: number;
    };
  };
  /** True when any of [ScriptTypes]/[TeamTypes]/[TaskForces]/[AITriggerTypes] is present. */
  hasAnyAiSection: boolean;
}

export interface ObjectRow {
  owner: string;
  id: string;
  x: number | null;
  y: number | null;
  /** Attached tag id (null when absent/<none>). */
  tag: string | null;
  fieldCount: number;
}

export interface TerrainObject {
  /** Raw cell key. */
  cell: number;
  x: number;
  y: number;
  type: string;
}

export interface SmudgeObject {
  type: string;
  x: number | null;
  y: number | null;
  malformed: boolean;
}

/** Objects / terrain facts (owner: objects.ts). */
export interface ObjectFacts {
  playerObjectCounts: Record<
    ObjectSection,
    { rowCount: number; distinctTypeIds: Set<string>; rows: ObjectRow[] }
  >;
  /**
   * Union of every referenced object type id: Structures/Units/Infantry/Aircraft
   * field[1] ∪ [Terrain] values ∪ [Smudge] field[0]. Vanilla-vs-mod split is the
   * objects checker's job (it owns VANILLA_YR_OBJECTS + opts.knownObjects).
   */
  distinctReferencedTypes: Set<string>;
  terrainObjects: TerrainObject[];
  terrainOffMapCount: number;
  oreTreeCount: number;
  smudges: SmudgeObject[];
  malformedSmudgeCount: number;
  smudgeOffMapCount: number;
  isoMapPack: {
    hasIsoMapPack: boolean;
    isoMapPackValid: boolean | null;
    decodedByteLength: number | null;
    tileCount: number | null;
    /** decodedLen % 11. */
    structAlignmentRemainder: number | null;
    /** decodedLen ÷ theoretical size (null when size unknown/undecodable). */
    oversizeRatio: number | null;
  };
  techStructures: Array<{ id: string; owner: string; x: number | null; y: number | null }>;
  oilDerricks: number;
  neutralCivilianObjects: number;
  offMapObjectCount: number;
  malformedRowCount: number;
  hasOreSource: boolean;
  isBarren: boolean;
  /** Phase 2 (Format80): all zero until the overlay decoder lands → approximate=true. */
  overlayResources: {
    oreCellCount: number;
    gemCellCount: number;
    veinCount: number;
    maxOverlayIndex: number | null;
    approximate: boolean;
  };
}

export interface MapFacts {
  meta: MetaFacts;
  spawns: SpawnFacts;
  triggers: TriggerFacts;
  ai: AiFacts;
  objects: ObjectFacts;
}

// ===========================================================================
// Small extractors (exported where a checker needs to re-run the decode)
// ===========================================================================

function intOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const t = value.trim();
  if (!/^[+-]?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

function intOr(value: string | undefined, fallback: number): number {
  const n = intOrNull(value);
  return n === null ? fallback : n;
}

function boolFlagOrNull(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const t = value.trim().toLowerCase();
  if (t === 'yes' || t === 'true' || t === '1') return true;
  if (t === 'no' || t === 'false' || t === '0') return false;
  return null;
}

function isNoneToken(value: string | undefined): boolean {
  if (value === undefined) return true;
  const t = value.trim().toLowerCase();
  return t.length === 0 || t === '<none>' || t === 'none';
}

/** parts[0..3] as ints (null when <4 parts or any non-int). */
export function parseRectQuad(
  value: string | undefined,
): { x: number; y: number; width: number; height: number } | null {
  if (value === undefined) return null;
  const p = value.split(',');
  if (p.length < 4) return null;
  const x = intOrNull(p[0]);
  const y = intOrNull(p[1]);
  const width = intOrNull(p[2]);
  const height = intOrNull(p[3]);
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height };
}

/**
 * Decode a Helpers-style bijective base-26 waypoint token (A=1..Z=26); the
 * decoded WAYPOINT NUMBER is the accumulated value − 1. Returns null on any
 * non-A..Z input. Used for action P7 / event waypoint arguments (WaypointZZ).
 */
export function decodeWaypointZZ(token: string): number | null {
  if (!/^[A-Z]+$/.test(token)) return null;
  let n = 0;
  for (let i = 0; i < token.length; i++) {
    n = n * 26 + (token.charCodeAt(i) - 64); // 'A' → 1
  }
  return n - 1;
}

/** [Events] value → parsed events + malformed flag. Stride 3 fields/event (4 for types 60/61). */
export function parseEventsValue(value: string): { events: TriggerEvent[]; malformed: boolean } {
  const f = value.split(',').map((s) => s.trim());
  const n = intOrNull(f[0]);
  if (n === null || n < 0) return { events: [], malformed: true };
  const events: TriggerEvent[] = [];
  let pos = 1;
  let malformed = false;
  for (let i = 0; i < n; i++) {
    const type = intOrNull(f[pos]);
    if (type === null) {
      malformed = true;
      break;
    }
    const extended = type === 60 || type === 61;
    const stride = extended ? 4 : 3;
    if (pos + stride > f.length) {
      malformed = true;
      break;
    }
    const ev: TriggerEvent = { index: type, p1: intOr(f[pos + 1], 0), p2: intOr(f[pos + 2], 0) };
    if (extended) {
      const extra = f[pos + 3];
      if (extra !== undefined) ev.str = extra;
    }
    events.push(ev);
    pos += stride;
  }
  if (!malformed && pos !== f.length) malformed = true; // trailing garbage
  return { events, malformed };
}

/** [Actions] value → parsed actions + malformed flag. Stride 8 fields/action (type + params[0..6]). */
export function parseActionsValue(value: string): {
  actions: TriggerAction[];
  malformed: boolean;
} {
  const f = value.split(',').map((s) => s.trim());
  const n = intOrNull(f[0]);
  if (n === null || n < 0) return { actions: [], malformed: true };
  const actions: TriggerAction[] = [];
  let pos = 1;
  let malformed = false;
  for (let i = 0; i < n; i++) {
    if (pos + 8 > f.length) {
      malformed = true;
      break;
    }
    const type = intOrNull(f[pos]);
    if (type === null) {
      malformed = true;
      break;
    }
    actions.push({ index: type, params: f.slice(pos + 1, pos + 8) });
    pos += 8;
  }
  if (!malformed && pos !== f.length) malformed = true;
  return { actions, malformed };
}

/** Numeric keys of a section, ascending. */
function numericKeys(section: Record<string, string> | undefined): number[] {
  if (!section) return [];
  const out: number[] = [];
  for (const key of Object.keys(section)) {
    if (/^\d+$/.test(key)) out.push(Number(key));
  }
  out.sort((a, b) => a - b);
  return out;
}

// ===========================================================================
// computeMapFacts
// ===========================================================================

export function computeMapFacts(parsed: ParsedMapFile): MapFacts {
  const size = parsed.width !== null && parsed.height !== null
    ? { width: parsed.width, height: parsed.height }
    : null;
  const bound = size ? size.width + size.height : null;

  // Filled by the object pass, consumed by the trigger pass (attached-tag graph).
  const attachedTagIdSet = new Set<string>();

  return {
    meta: computeMeta(parsed, size),
    objects: computeObjects(parsed, size, bound, attachedTagIdSet),
    spawns: computeSpawns(parsed, size),
    triggers: computeTriggers(parsed, attachedTagIdSet),
    ai: computeAi(parsed),
  };
}

// --- meta -----------------------------------------------------------------

function computeMeta(
  parsed: ParsedMapFile,
  size: { width: number; height: number } | null,
): MetaFacts {
  const theaterRaw = parsed.ini.get('Map', 'Theater');
  const theaterToken =
    theaterRaw !== undefined && theaterRaw.trim() !== '' ? theaterRaw.trim() : null;
  const basicPlayerRaw = parsed.basic['Player'];
  const basicPlayer =
    basicPlayerRaw !== undefined && basicPlayerRaw !== '' ? basicPlayerRaw : null;
  const isMission = basicPlayer !== null;

  return {
    name: parsed.name,
    basicSectionPresent: parsed.ini.section('Basic') !== undefined,
    theaterToken,
    theaterKnown: parsed.theaterKnown,
    size,
    sizeOrigin: parsed.sizeOrigin,
    localSize: parsed.localSize,
    maxPlayerDeclared: parsed.maxPlayerDeclared,
    minPlayerDeclared: parsed.minPlayerDeclared,
    official: parsed.official,
    multiplayerOnly: parsed.multiplayerOnly,
    requiredAddOn: parsed.requiredAddOn,
    requiresYR: parsed.requiredAddOn === 1,
    newIniFormat: parsed.newIniFormat,
    basicPlayer,
    gameModes: parsed.gameModes,
    hasHeaderSection: parsed.hasHeaderSection,
    maxDimension: size ? Math.max(size.width, size.height) : null,
    cellArea: size ? size.width * size.height : null,
    sizeClass: size ? sizeClassOf(size.width, size.height) : null,
    isMission,
    isMissionLike: isMission,
  };
}

// --- spawns ---------------------------------------------------------------

function computeSpawns(
  parsed: ParsedMapFile,
  size: { width: number; height: number } | null,
): SpawnFacts {
  const waypoints = parsed.ini.section('Waypoints') ?? {};
  const bound = size ? size.width + size.height : null;

  // Full [Waypoints] key set.
  const allWaypointKeys = numericKeys(waypoints);
  let scriptingWaypointCount = 0;
  let hasHomeCells = false;
  for (const k of allWaypointKeys) {
    if (HOME_CELL_WAYPOINTS.has(k)) hasHomeCells = true;
    else if (k >= 8) scriptingWaypointCount++;
  }

  const startWaypointIndices = [...parsed.startWaypoints];
  const startCoords: StartCoord[] = [];
  const nonNumericStarts: number[] = [];
  for (const index of startWaypointIndices) {
    const raw = waypoints[String(index)] ?? '';
    const numeric = /^\d+$/.test(raw);
    if (!numeric) nonNumericStarts.push(index);
    const v = numeric ? Number(raw) : 0;
    startCoords.push({
      index,
      raw,
      x: numeric ? v % 1000 : -1,
      y: numeric ? Math.floor(v / 1000) : -1,
      numeric,
    });
  }

  // Duplicate cells (numeric only).
  const cellGroups = new Map<string, number[]>();
  for (const c of startCoords) {
    if (!c.numeric) continue;
    const key = `${c.x},${c.y}`;
    const g = cellGroups.get(key);
    if (g) g.push(c.index);
    else cellGroups.set(key, [c.index]);
  }
  const duplicateStartCells: Array<{ x: number; y: number; indices: number[] }> = [];
  for (const [key, indices] of cellGroups) {
    if (indices.length < 2) continue;
    const [xs, ys] = key.split(',');
    duplicateStartCells.push({ x: Number(xs), y: Number(ys), indices });
  }

  // Out of bounds (numeric, needs size).
  const outOfBoundsStarts: number[] = [];
  if (bound !== null) {
    for (const c of startCoords) {
      if (!c.numeric) continue;
      if (c.x < 1 || c.y < 1 || c.x > bound || c.y > bound) outOfBoundsStarts.push(c.index);
    }
  }

  // Contiguity 0..max.
  const gapIndices: number[] = [];
  if (startWaypointIndices.length > 0) {
    const max = Math.max(...startWaypointIndices);
    const present = new Set(startWaypointIndices);
    for (let i = 0; i <= max; i++) if (!present.has(i)) gapIndices.push(i);
  }
  const startContiguity = gapIndices.length === 0;

  // Valid (numeric + in-bounds) coords for separation + symmetry.
  const valid = startCoords.filter(
    (c) => c.numeric && (bound === null ? false : c.x >= 1 && c.y >= 1 && c.x <= bound && c.y <= bound),
  );

  let spawnSeparation: { min: number; mean: number } | null = null;
  if (valid.length >= 2) {
    let min = Infinity;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        const a = valid[i]!;
        const b = valid[j]!;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < min) min = d;
        sum += d;
        count++;
      }
    }
    spawnSeparation = { min, mean: count > 0 ? sum / count : 0 };
  }

  let spawnSymmetry: { pointSymmetric: boolean; axisMirror: boolean } | null = null;
  if (size !== null && valid.length >= 2 && valid.length === startCoords.length) {
    const tol = Math.max(2, Math.round((size.width + size.height) * 0.05));
    const cx = valid.reduce((s, c) => s + c.x, 0) / valid.length;
    const cy = valid.reduce((s, c) => s + c.y, 0) / valid.length;
    const hasPartner = (px: number, py: number): boolean =>
      valid.some((c) => Math.hypot(c.x - px, c.y - py) <= tol);
    const pointSymmetric = valid.every((c) => hasPartner(2 * cx - c.x, 2 * cy - c.y));
    const mirrorX = valid.every((c) => hasPartner(2 * cx - c.x, c.y));
    const mirrorY = valid.every((c) => hasPartner(c.x, 2 * cy - c.y));
    spawnSymmetry = { pointSymmetric, axisMirror: mirrorX || mirrorY };
  }

  return {
    startWaypointIndices,
    startCount: startWaypointIndices.length,
    startCoords,
    nonNumericStarts,
    duplicateStartCells,
    outOfBoundsStarts,
    startContiguity,
    gapIndices,
    allWaypointKeys,
    scriptingWaypointCount,
    hasHomeCells,
    spawnSeparation,
    spawnSymmetry,
  };
}

// --- triggers -------------------------------------------------------------

function computeTriggers(parsed: ParsedMapFile, attachedTagIdSet: Set<string>): TriggerFacts {
  const ini = parsed.ini;
  const triggerSection = ini.section('Triggers') ?? {};

  const triggerIdSet = new Set<string>(Object.keys(triggerSection));
  const triggers = new Map<string, TriggerEntry>();
  const linkedTriggerGraph = new Map<string, string>();
  for (const [id, value] of Object.entries(triggerSection)) {
    const p = value.split(',').map((s) => s.trim());
    const linkedRaw = p[1];
    const linkedTriggerId = isNoneToken(linkedRaw) ? null : linkedRaw!;
    const isBool = (s: string | undefined): boolean => s === '0' || s === '1';
    const malformed =
      p.length < 7 || !isBool(p[3]) || !isBool(p[4]) || !isBool(p[5]) || !isBool(p[6]);
    triggers.set(id, {
      id,
      house: p[0] ?? '',
      linkedTriggerId,
      name: p[2] ?? '',
      disabled: p[3] === '1',
      easy: p[4] === '1',
      normal: p[5] === '1',
      hard: p[6] === '1',
      fieldCount: p.length,
      malformed,
    });
    if (linkedTriggerId !== null) linkedTriggerGraph.set(id, linkedTriggerId);
  }

  // Events.
  const events = new Map<string, TriggerEvent[]>();
  const eventsMalformed = new Set<string>();
  const orphanEventIds: string[] = [];
  const eventsSection = ini.section('Events') ?? {};
  for (const [id, value] of Object.entries(eventsSection)) {
    if (!triggerIdSet.has(id)) orphanEventIds.push(id);
    const parsedEvents = parseEventsValue(value);
    events.set(id, parsedEvents.events);
    if (parsedEvents.malformed) eventsMalformed.add(id);
  }

  // Actions.
  const actions = new Map<string, TriggerAction[]>();
  const actionCounts = new Map<string, number>();
  const actionsMalformed = new Set<string>();
  const orphanActionIds: string[] = [];
  const triggerActionTokens = new Set<string>();
  const actionsSection = ini.section('Actions') ?? {};
  for (const [id, value] of Object.entries(actionsSection)) {
    if (!triggerIdSet.has(id)) orphanActionIds.push(id);
    const parsedActions = parseActionsValue(value);
    actions.set(id, parsedActions.actions);
    actionCounts.set(id, parsedActions.actions.length);
    if (parsedActions.malformed) actionsMalformed.add(id);
    for (const a of parsedActions.actions) {
      for (const param of a.params) {
        if (param.length > 0) triggerActionTokens.add(param);
      }
    }
  }

  // Tags.
  const tagsSection = ini.section('Tags') ?? {};
  const tagIdSet = new Set<string>(Object.keys(tagsSection));
  const tags = new Map<string, TagEntry>();
  for (const [id, value] of Object.entries(tagsSection)) {
    const p = value.split(',').map((s) => s.trim());
    const repeat = intOr(p[0], -1);
    const malformed = p.length !== 3 || repeat < 0 || repeat > 2;
    tags.set(id, {
      id,
      repeat,
      name: p[1] ?? '',
      triggerId: p[2] ?? '',
      fieldCount: p.length,
      malformed,
    });
  }

  // Team type ids (VALUES of [TeamTypes]).
  const teamTypesSection = ini.section('TeamTypes') ?? {};
  const teamTypeIdSet = new Set<string>();
  for (const v of Object.values(teamTypesSection)) {
    const t = v.trim();
    if (t.length > 0) teamTypeIdSet.add(t);
  }

  // Waypoint number set (= full [Waypoints] key set).
  const waypointNumberSet = new Set(numericKeys(ini.section('Waypoints')));

  // Local variables.
  const variableNamesSection = ini.section('VariableNames');
  const hasVariableNames = variableNamesSection !== undefined;
  const localVarIndexSet = new Set(numericKeys(variableNamesSection));

  // Attached tags: object fields (filled during object pass) ∪ [CellTags] ∪ teamtype Tag=.
  const cellTags = ini.section('CellTags');
  if (cellTags) {
    for (const v of Object.values(cellTags)) {
      const t = v.trim();
      if (!isNoneToken(t)) attachedTagIdSet.add(t);
    }
  }
  for (const teamTypeId of teamTypeIdSet) {
    const tag = ini.get(teamTypeId, 'Tag');
    if (tag !== undefined && !isNoneToken(tag)) attachedTagIdSet.add(tag.trim());
  }

  return {
    triggerIdSet,
    triggers,
    events,
    eventsMalformed,
    actions,
    actionCounts,
    actionsMalformed,
    tagIdSet,
    tags,
    teamTypeIdSet,
    waypointNumberSet,
    hasVariableNames,
    localVarIndexSet,
    attachedTagIdSet,
    orphanEventIds,
    orphanActionIds,
    linkedTriggerGraph,
    isMission: parsed.basic['Player'] !== undefined && parsed.basic['Player'] !== '',
  };
}

// --- ai -------------------------------------------------------------------

function computeAi(parsed: ParsedMapFile): AiFacts {
  const ini = parsed.ini;
  const teamTypesSection = ini.section('TeamTypes');
  const scriptTypesSection = ini.section('ScriptTypes');
  const taskForcesSection = ini.section('TaskForces');
  const aiTriggersSection = ini.section('AITriggerTypes');
  const hasAnyAiSection =
    teamTypesSection !== undefined ||
    scriptTypesSection !== undefined ||
    taskForcesSection !== undefined ||
    aiTriggersSection !== undefined;

  // Registry lists.
  const teamTypeIds = teamTypesSection
    ? Object.values(teamTypesSection).map((v) => v.trim()).filter((v) => v.length > 0)
    : [];
  const scriptTypeIds = scriptTypesSection
    ? Object.values(scriptTypesSection).map((v) => v.trim()).filter((v) => v.length > 0)
    : [];
  const taskForceIds = taskForcesSection
    ? Object.values(taskForcesSection).map((v) => v.trim()).filter((v) => v.length > 0)
    : [];
  const scriptTypeIdSet = new Set(scriptTypeIds);
  const taskForceIdSet = new Set(taskForceIds);
  const teamTypeIdSet = new Set(teamTypeIds);

  // TeamType bodies.
  const teamTypes = new Map<string, TeamTypeBody>();
  const usedScriptIds = new Set<string>();
  const usedTaskForceIds = new Set<string>();
  for (const id of teamTypeIds) {
    const body = ini.section(id);
    const nn = (k: string): string | null => {
      const v = body?.[k];
      return v !== undefined && v.trim().length > 0 ? v.trim() : null;
    };
    const script = nn('Script');
    const taskForce = nn('TaskForce');
    if (script !== null) usedScriptIds.add(script);
    if (taskForce !== null) usedTaskForceIds.add(taskForce);
    teamTypes.set(id, {
      script,
      taskForce,
      house: nn('House'),
      tag: nn('Tag'),
      waypoint: nn('Waypoint'),
      max: intOrNull(body?.['Max']),
      priority: intOrNull(body?.['Priority']),
      group: intOrNull(body?.['Group']),
      autocreate: boolFlagOrNull(body?.['Autocreate']),
      bodyPresent: body !== undefined,
    });
  }

  // ScriptType bodies.
  const scriptTypes = new Map<string, ScriptTypeBody>();
  for (const id of scriptTypeIds) {
    const body = ini.section(id);
    const keys = numericKeys(body);
    const actions: Array<{ action: number; argument: number }> = [];
    for (const k of keys) {
      const parts = (body?.[String(k)] ?? '').split(',').map((s) => s.trim());
      actions.push({ action: intOr(parts[0], -1), argument: intOr(parts[1], 0) });
    }
    scriptTypes.set(id, { actions, actionCount: keys.length });
  }

  // TaskForce bodies.
  const taskForces = new Map<string, TaskForceBody>();
  const taskForceUnitIds = new Set<string>();
  for (const id of taskForceIds) {
    const body = ini.section(id);
    const keys = numericKeys(body);
    const members: Array<{ count: number; unitId: string }> = [];
    for (const k of keys) {
      const parts = (body?.[String(k)] ?? '').split(',').map((s) => s.trim());
      const unitId = parts[1] ?? '';
      members.push({ count: intOr(parts[0], 0), unitId });
      if (unitId.length > 0) taskForceUnitIds.add(unitId);
    }
    taskForces.set(id, { members, memberSlotCount: keys.length });
  }

  // AI triggers.
  const aiTriggers: AiTriggerEntry[] = [];
  const aiTriggerReferencedTeams = new Set<string>();
  if (aiTriggersSection) {
    for (const [id, value] of Object.entries(aiTriggersSection)) {
      const f = value.split(',').map((s) => s.trim());
      const team1 = isNoneToken(f[1]) ? null : f[1]!;
      const team2 = isNoneToken(f[14]) ? null : f[14]!;
      const len = f.length;
      aiTriggers.push({
        id,
        team1,
        conditionType: intOrNull(f[4]),
        side: intOrNull(f[13]),
        team2,
        enabledEasy: f[len - 3] === '1',
        enabledNormal: f[len - 2] === '1',
        enabledHard: f[len - 1] === '1',
      });
      if (team1 !== null) aiTriggerReferencedTeams.add(team1);
      if (team2 !== null) aiTriggerReferencedTeams.add(team2);
    }
  }

  // Trigger action tokens (recompute cheaply from [Actions] — needed for reachability).
  const triggerActionTokens = new Set<string>();
  const actionsSection = ini.section('Actions');
  if (actionsSection) {
    for (const value of Object.values(actionsSection)) {
      const { actions } = parseActionsValue(value);
      for (const a of actions) for (const p of a.params) if (p.length > 0) triggerActionTokens.add(p);
    }
  }

  // Reachability.
  const reachableTeamIds = new Set<string>();
  for (const id of teamTypeIds) {
    const body = teamTypes.get(id);
    const reachable =
      aiTriggerReferencedTeams.has(id) ||
      body?.autocreate === true ||
      (id.length >= 4 && triggerActionTokens.has(id));
    if (reachable) reachableTeamIds.add(id);
  }

  // Houses.
  const housesSection = ini.section('Houses');
  const houseSet = new Set<string>();
  if (housesSection) {
    for (const v of Object.values(housesSection)) {
      const t = v.trim();
      if (t.length > 0) houseSet.add(t);
    }
  }
  for (const body of teamTypes.values()) if (body.house !== null) houseSet.add(body.house);

  // Dangling counts (computable from parsed alone; unit-unknown is opts-gated → checker).
  let teamMissingScript = 0;
  let teamMissingTaskForce = 0;
  let teamBodyMissing = 0;
  for (const body of teamTypes.values()) {
    if (!body.bodyPresent) teamBodyMissing++;
    if (body.script !== null && !scriptTypeIdSet.has(body.script)) teamMissingScript++;
    if (body.taskForce !== null && !taskForceIdSet.has(body.taskForce)) teamMissingTaskForce++;
  }
  let aiTriggerDanglingTeam = 0;
  for (const t of aiTriggers) {
    if (t.team1 !== null && !teamTypeIdSet.has(t.team1)) aiTriggerDanglingTeam++;
    if (t.team2 !== null && !teamTypeIdSet.has(t.team2)) aiTriggerDanglingTeam++;
  }

  return {
    teamTypeIds,
    teamTypes,
    scriptTypeIds,
    scriptTypes,
    taskForceIds,
    taskForces,
    taskForceUnitIds,
    aiTriggers,
    aiTriggerReferencedTeams,
    reachableTeamIds,
    usedScriptIds,
    usedTaskForceIds,
    triggerActionTokens,
    houseNames: [...houseSet],
    graphIntegrity: {
      danglingCounts: {
        teamMissingScript,
        teamMissingTaskForce,
        aiTriggerDanglingTeam,
        teamBodyMissing,
      },
    },
    hasAnyAiSection,
  };
}

// --- objects --------------------------------------------------------------

function computeObjects(
  parsed: ParsedMapFile,
  size: { width: number; height: number } | null,
  bound: number | null,
  attachedTagIdSet: Set<string>,
): ObjectFacts {
  const ini = parsed.ini;
  const distinctReferencedTypes = new Set<string>();
  const isOffMap = (x: number | null, y: number | null): boolean =>
    bound !== null && x !== null && y !== null && (x < 0 || y < 0 || x > bound || y > bound);

  const playerObjectCounts = {
    Structures: { rowCount: 0, distinctTypeIds: new Set<string>(), rows: [] as ObjectRow[] },
    Units: { rowCount: 0, distinctTypeIds: new Set<string>(), rows: [] as ObjectRow[] },
    Infantry: { rowCount: 0, distinctTypeIds: new Set<string>(), rows: [] as ObjectRow[] },
    Aircraft: { rowCount: 0, distinctTypeIds: new Set<string>(), rows: [] as ObjectRow[] },
  } satisfies ObjectFacts['playerObjectCounts'];

  let malformedRowCount = 0;
  let offMapObjectCount = 0;
  let neutralCivilianObjects = 0;
  let oilDerricks = 0;
  const techStructures: Array<{ id: string; owner: string; x: number | null; y: number | null }> = [];

  for (const section of OBJECT_SECTIONS) {
    const body = ini.section(section);
    if (!body) continue;
    const bucket = playerObjectCounts[section];
    const tagField = OBJECT_TAG_FIELD[section];
    const minFields = OBJECT_MIN_FIELDS[section];
    for (const value of Object.values(body)) {
      const f = value.split(',').map((s) => s.trim());
      const owner = f[0] ?? '';
      const id = f[1] ?? '';
      const x = intOrNull(f[3]);
      const y = intOrNull(f[4]);
      const tagRaw = f[tagField];
      const tag = tagRaw !== undefined && !isNoneToken(tagRaw) ? tagRaw : null;
      const row: ObjectRow = { owner, id, x, y, tag, fieldCount: f.length };
      bucket.rows.push(row);
      bucket.rowCount++;
      if (id.length > 0) {
        bucket.distinctTypeIds.add(id);
        distinctReferencedTypes.add(id);
      }
      if (tag !== null) attachedTagIdSet.add(tag);
      if (f.length < minFields) malformedRowCount++;
      if (isOffMap(x, y)) offMapObjectCount++;
      const ownerLower = owner.toLowerCase();
      if (NEUTRAL_OWNER_TOKENS.has(ownerLower)) {
        neutralCivilianObjects++;
        if (section === 'Structures' && TECH_STRUCTURE_IDS.has(id)) {
          techStructures.push({ id, owner, x, y });
        }
      }
      if (section === 'Structures' && id === 'CAOILD') oilDerricks++;
    }
  }

  // Terrain.
  const terrainSection = ini.section('Terrain');
  const terrainObjects: TerrainObject[] = [];
  let terrainOffMapCount = 0;
  let oreTreeCount = 0;
  if (terrainSection) {
    for (const [key, rawType] of Object.entries(terrainSection)) {
      const type = rawType.trim();
      if (type.length > 0) distinctReferencedTypes.add(type);
      if (ORE_TREE_TERRAIN_IDS.has(type)) oreTreeCount++;
      // Cell key decode: y = slice(0, len−3), x = slice(len−3).
      const cell = intOrNull(key);
      if (cell === null || key.length < 4) {
        terrainObjects.push({ cell: cell ?? -1, x: -1, y: -1, type });
        continue;
      }
      const x = intOr(key.slice(key.length - 3), -1);
      const y = intOr(key.slice(0, key.length - 3), -1);
      terrainObjects.push({ cell, x, y, type });
      if (bound !== null && (x < 0 || y < 0 || x > bound || y > bound)) terrainOffMapCount++;
    }
  }

  // Smudge.
  const smudgeSection = ini.section('Smudge');
  const smudges: SmudgeObject[] = [];
  let malformedSmudgeCount = 0;
  let smudgeOffMapCount = 0;
  if (smudgeSection) {
    for (const value of Object.values(smudgeSection)) {
      const f = value.split(',').map((s) => s.trim());
      const type = f[0] ?? '';
      const x = intOrNull(f[1]);
      const y = intOrNull(f[2]);
      const fourth = f[3];
      const malformed =
        f.length < 3 || x === null || y === null || (fourth !== undefined && fourth !== '0');
      if (type.length > 0) distinctReferencedTypes.add(type);
      smudges.push({ type, x, y, malformed });
      if (malformed) malformedSmudgeCount++;
      if (isOffMap(x, y)) smudgeOffMapCount++;
    }
  }

  // IsoMapPack.
  let decodedByteLength: number | null = null;
  let tileCount: number | null = null;
  let structAlignmentRemainder: number | null = null;
  let oversizeRatio: number | null = null;
  if (parsed.hasIsoMapPack) {
    try {
      const decoded = decodePackSection(ini.section('IsoMapPack5')!);
      decodedByteLength = decoded.length;
      tileCount = Math.floor(decoded.length / ISOMAPPACK_TILE_STRIDE);
      structAlignmentRemainder = decoded.length % ISOMAPPACK_TILE_STRIDE;
      if (size) {
        const theoretical = (size.width * 2 - 1) * size.height * ISOMAPPACK_TILE_STRIDE + 4;
        if (theoretical > 0) oversizeRatio = decoded.length / theoretical;
      }
    } catch {
      // isoMapPackValid already captured the failure on parsed.
    }
  }

  const hasOreSource = oreTreeCount > 0;
  const totalObjectRows =
    playerObjectCounts.Structures.rowCount +
    playerObjectCounts.Units.rowCount +
    playerObjectCounts.Infantry.rowCount +
    playerObjectCounts.Aircraft.rowCount;
  const isBarren =
    totalObjectRows === 0 && terrainObjects.length === 0 && smudges.length === 0 && !hasOreSource;

  return {
    playerObjectCounts,
    distinctReferencedTypes,
    terrainObjects,
    terrainOffMapCount,
    oreTreeCount,
    smudges,
    malformedSmudgeCount,
    smudgeOffMapCount,
    isoMapPack: {
      hasIsoMapPack: parsed.hasIsoMapPack,
      isoMapPackValid: parsed.isoMapPackValid,
      decodedByteLength,
      tileCount,
      structAlignmentRemainder,
      oversizeRatio,
    },
    techStructures,
    oilDerricks,
    neutralCivilianObjects,
    offMapObjectCount,
    malformedRowCount,
    hasOreSource,
    isBarren,
    overlayResources: {
      oreCellCount: 0,
      gemCellCount: 0,
      veinCount: 0,
      maxOverlayIndex: null,
      approximate: true, // Phase 2: needs the Format80/LCW overlay decoder.
    },
  };
}
