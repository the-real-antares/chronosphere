/**
 * objects-terrain category checker for the YR map linter.
 *
 * Consumes the shared `MapFacts` decode (facts.ts) plus the raw `ParsedMapFile`
 * and emits `LintFinding[]` for the objects-terrain rules in
 * docs/LINTER_SPEC.md PART 1 §D. Pure, deterministic, no I/O, no LLM.
 *
 * Owns the two data assets the spec assigns to this checker:
 *   - VANILLA_YR_OBJECTS   (every shipped rulesmd.ini ININame)
 *   - VANILLA_YR_OVERLAY_COUNT
 * See the NOTE on VANILLA_YR_OBJECTS below — the inline set is a curated
 * starter to be superseded by the generated `data/vanilla-yr-objects.json`.
 */
import type { ParsedMapFile } from '../mapfile/parse.ts';
import type { MapFacts } from './facts.ts';
import { MOD_THRESHOLD, OVERSIZE_FACTOR, TERRAIN_RICH_THRESHOLD } from './facts.ts';
import type { AnalyzeOptions } from './index.ts';
import type { LintFinding } from './lint-types.ts';

const CATEGORY = 'objects-terrain' as const;

/** Max offending ids listed in a finding's `refs` / message. */
const MAX_REFS = 5;
/** IsoMapPack5 joined base64 payload byte length beyond this reads as oversized. */
const ISOMAPPACK_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Vanilla YR overlay slot count. Overlay indices at/above this (and not in a
 * mod's knownObjects) are out-of-theater art. Only consumed by the Phase-2
 * `overlay-index-out-of-bounds` rule (needs the Format80 decoder), so its exact
 * value is not yet load-bearing. Replace alongside the generated data asset.
 */
export const VANILLA_YR_OVERLAY_COUNT = 0xf9; // 249

/**
 * NOTE (data asset): this is a curated STARTER set of the most common vanilla
 * RA2/YR ININames, sufficient to exercise the checker logic without drowning
 * real maps in false-positive `object-ref-invalid-vanilla` findings. It is NOT
 * the complete shipped list. The lead must replace it with the generated
 * `mapkit/data/vanilla-yr-objects.json` (full [BuildingTypes]/[InfantryTypes]/
 * [VehicleTypes]/[AircraftTypes]/[TerrainTypes]/[SmudgeTypes] from rulesmd.ini).
 * The checker reads only `VANILLA_YR_OBJECTS.has(id)`, so swapping the source is
 * a data-only change.
 */
export const VANILLA_YR_OBJECTS: ReadonlySet<string> = new Set<string>([
  // --- Buildings (Allied) ---
  'GACNST', 'GAPOWR', 'GAREFN', 'GAWEAP', 'GAPILE', 'GADEPT', 'GAAIRC',
  'GATECH', 'GAYARD', 'GAORE', 'GAOREP', 'GASPYSAT', 'GAGAP', 'GAPILL',
  'GTGCAN', 'GACSPH', 'GAWALL', 'GAWEATH', 'GACTWR', 'ATESLA', 'NASAM',
  'GAPRIS', 'GAROBO', 'GAFWLL', 'GADUMY', 'GAFCOM', 'GASAND', 'GADEPT',
  // --- Buildings (Soviet) ---
  'NACNST', 'NAPOWR', 'NAREFN', 'NAWEAP', 'NAHAND', 'NARADR', 'NADEPT',
  'NATECH', 'NAYARD', 'NAINDP', 'NAAPWR', 'NANRCT', 'NAIRON', 'NAMISL',
  'NABNKR', 'NALASR', 'NAFLAK', 'NAWALL', 'NADUMY', 'NACLON', 'NAPSYB',
  'NAPSYA', 'NATBNK',
  // --- Buildings (Yuri) ---
  'YACNST', 'YAPOWR', 'YAREFN', 'YAWEAP', 'YABRCK', 'YARADR', 'YADEPT',
  'YATECH', 'YAGRND', 'YAPPPT', 'YAGGUN', 'YAGNTC', 'YAPSYT', 'YABNKR',
  'YAWALL', 'YADUMY', 'YAPSYB', 'YACLON',
  // --- Civilian / tech / capturable ---
  'CAOILD', 'CAOUTP', 'CATHOSP', 'CAHOSP', 'CAAIRP', 'CAPOWR', 'CASLAB',
  'CAMACH', 'CAMISC', 'CATECH', 'CAFARM', 'CACITY', 'CARUSSIA', 'CAARMR',
  'CABUNK', 'CALAB', 'CASTL', 'CATIME', 'CAWASH', 'CALUNr', 'CACHIG',
  // --- Infantry ---
  'E1', 'E2', 'E3', 'E4', 'GGI', 'SNIPE', 'DOG', 'ENGINEER', 'SEAL',
  'SPY', 'TANY', 'FLAKT', 'SHK', 'IVAN', 'CLEG', 'DESO', 'YURI', 'YURIX',
  'INIT', 'BRUTE', 'VIRUS', 'PTROOP', 'ADOG', 'YADOG', 'CIV1', 'CIV2',
  'CIV3', 'CIVA', 'CIVB', 'CIVC', 'TECHNCN', 'PENTGN', 'JOSH', 'STLN',
  // --- Vehicles ---
  'MCV', 'AMCV', 'HARV', 'SREF', 'MTNK', 'MGTK', 'FV', 'TNKD', 'HTK',
  'V3', 'APOC', 'HTNK', 'ZEP', 'DRON', 'DTRUCK', 'CMISL', 'LCRF', 'AMPHIB',
  'SMCV', 'YHVR', 'GTGT', 'PCV', 'CLEG', 'MIND', 'CAOS', 'SAPC', 'BFRT',
  'TTNK', 'DEST', 'AEGIS', 'CARRIER', 'SUB', 'DLPH', 'SQD', 'HYD', 'BSUB',
  'SONAR', 'DRED', 'SAPC',
  // --- Aircraft ---
  'ORCA', 'BEAG', 'SHAD', 'HIND', 'ASW', 'BPLN', 'PDPLANE', 'SPYP',
  'ORCAB', 'HELI', 'SCHP', 'CASV',
  // --- Terrain (TerrainTypes) ---
  'TIBTRE01', 'TIBTRE02', 'TIBTRE03', 'TREE01', 'TREE02', 'TREE03',
  'TREE04', 'TREE05', 'TREE06', 'TREE07', 'TREE08', 'TREE09', 'TREE10',
  'TREE11', 'TREE12', 'TREE13', 'TREE14', 'TREE15', 'TREE16', 'TREE17',
  'TREE18', 'TREE19', 'TREE20', 'TREE21', 'TREE22', 'TREE23', 'TREE24',
  'TREE25', 'TREE26', 'TREE27', 'TREE28', 'TREE29', 'TREE30', 'TREE31',
  'TREE32', 'TREE33', 'TREE34', 'TREE35', 'TREE36', 'TREE37', 'TREE38',
  'TREE39', 'TREE40', 'TREE41', 'TREE42', 'TREE43', 'TREE44', 'TREE45',
  'TREE46', 'TREE47', 'TREE48', 'TREE49', 'TREE50', 'TREE51', 'TREE52',
  'TREE53', 'TREE54', 'TREE55', 'TREE56', 'TREE57', 'TREE58', 'TREE59',
  'TREE60', 'TREE61', 'TREE62', 'TREE63', 'TREE64', 'TREE65', 'TREE66',
  'TREE67', 'TREE68', 'TREE69', 'TREE70', 'TREE71', 'TREE72', 'TREE73',
  'TREE74', 'TREE75', 'TREE76', 'TREE77', 'TREE78', 'TREE79', 'TREE80',
  'TC01', 'TC02', 'TC03', 'TC04', 'TC05', 'ICE01', 'ICE02', 'ICE03',
  'ICE04', 'ICE05', 'BOXES01', 'BOXES02', 'BOXES03', 'BOXES04', 'BOXES05',
  'BOXES06', 'BOXES07', 'BOXES08', 'BOXES09', 'LT01', 'LT02', 'LT03',
  'LT04', 'LT05', 'ROCK01', 'ROCK02', 'ROCK03', 'ROCK04', 'ROCK05',
  'ROCK06', 'ROCK07',
  // --- Smudge (SmudgeTypes) ---
  'CR01', 'CR02', 'CR03', 'CR04', 'CR05', 'CR06', 'SC01', 'SC02', 'SC03',
  'SC04', 'SC05', 'SC06', 'BOMBCRAT01', 'BOMBCRAT02', 'BOMBCRAT03',
  'BOMBCRAT04', 'BOMBCRAT05', 'BOMBCRAT06', 'DEADBODY',
]);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function finding(
  ruleId: string,
  severity: LintFinding['severity'],
  scoreImpact: number,
  message: string,
  refs?: string[],
): LintFinding {
  const f: LintFinding = { ruleId, category: CATEGORY, severity, scoreImpact, message };
  if (refs && refs.length > 0) f.refs = refs.slice(0, MAX_REFS);
  return f;
}

/**
 * Per-occurrence signed magnitude after the aggregate cap. `unit` and `cap` are
 * negative; the penalty grows with `count` but is floored at `cap`.
 */
function scaled(unit: number, cap: number, count: number): number {
  return Math.max(cap, unit * count);
}

function withMore(ids: string[]): string {
  const shown = ids.slice(0, MAX_REFS).join(', ');
  const extra = ids.length > MAX_REFS ? ` (+${ids.length - MAX_REFS} more)` : '';
  return `${shown}${extra}`;
}

// ---------------------------------------------------------------------------
// checker
// ---------------------------------------------------------------------------

export function checkObjects(
  facts: MapFacts,
  parsed: ParsedMapFile,
  opts?: AnalyzeOptions,
): LintFinding[] {
  const out: LintFinding[] = [];
  const o = facts.objects;
  const known = opts?.knownObjects;

  const isVanilla = (id: string): boolean => VANILLA_YR_OBJECTS.has(id);
  const isKnown = (id: string): boolean => isVanilla(id) || (known?.has(id) ?? false);

  // Map diamond bound (W+H); null when size unknown.
  const bound =
    facts.meta.size !== null ? facts.meta.size.width + facts.meta.size.height : null;

  // === isomappack-missing-or-corrupt (error, -6) — verdict-mirrored ===
  if (!o.isoMapPack.hasIsoMapPack) {
    out.push(
      finding(
        'isomappack-missing-or-corrupt',
        'error',
        -6,
        'no tile data: [IsoMapPack5] section is missing — the map cannot load',
      ),
    );
  } else if (o.isoMapPack.isoMapPackValid === false) {
    out.push(
      finding(
        'isomappack-missing-or-corrupt',
        'error',
        -6,
        'corrupt tile data: [IsoMapPack5] failed to decode',
      ),
    );
  }

  // === object-ref-invalid-vanilla / object-ref-mod-only ===
  // Referenced set = Structures/Units/Infantry/Aircraft field[1] ∪ [Terrain]
  // values ∪ [Smudge] field[0] (facts.distinctReferencedTypes). Unknown = not
  // vanilla and not in knownObjects.
  const unknownIds: string[] = [];
  for (const id of o.distinctReferencedTypes) {
    if (id.length === 0) continue;
    if (!isKnown(id)) unknownIds.push(id);
  }
  unknownIds.sort();
  if (unknownIds.length > 0) {
    if (unknownIds.length < MOD_THRESHOLD) {
      // A few stray ids read as broken/typo'd vanilla art, not a mod dependency.
      out.push(
        finding(
          'object-ref-invalid-vanilla',
          'error',
          scaled(-3, -3, unknownIds.length),
          `references object id(s) not in vanilla YR and not in the provided rules: ${withMore(unknownIds)}`,
          unknownIds,
        ),
      );
    } else {
      // Enough distinct unknowns that the map genuinely needs a mod.
      out.push(
        finding(
          'object-ref-mod-only',
          'warn',
          -1,
          `references ${unknownIds.length} non-vanilla object id(s) — map needs a mod: ${withMore(unknownIds)}`,
          unknownIds,
        ),
      );
    }
  }

  // === malformed-object-row (warn, -1 each, cap -3) ===
  if (o.malformedRowCount > 0) {
    out.push(
      finding(
        'malformed-object-row',
        'warn',
        scaled(-1, -3, o.malformedRowCount),
        `${o.malformedRowCount} object row(s) have too few comma fields (below the WAE minimum for their list)`,
      ),
    );
  }

  // === smudge-syntax-invalid (warn, -0.5 each, cap -3) ===
  if (o.malformedSmudgeCount > 0) {
    out.push(
      finding(
        'smudge-syntax-invalid',
        'warn',
        scaled(-0.5, -3, o.malformedSmudgeCount),
        `${o.malformedSmudgeCount} [Smudge] entr(y/ies) malformed (need ≥3 fields, int X/Y, field[3] must be "0")`,
      ),
    );
  }

  // === terrain-object-off-map (warn, -1 each, cap -3) ===
  if (o.terrainOffMapCount > 0) {
    out.push(
      finding(
        'terrain-object-off-map',
        'warn',
        scaled(-1, -3, o.terrainOffMapCount),
        `${o.terrainOffMapCount} [Terrain] object(s) sit outside the map diamond`,
      ),
    );
  }

  // === object-off-map (warn, -1 each, cap -3) ===
  // Spec scope is Structures/Units/Infantry only (NOT Aircraft), so recompute
  // from the per-section rows facts already carries rather than the aggregate
  // `offMapObjectCount` (which folds Aircraft in — see return note).
  if (bound !== null) {
    const offIds: string[] = [];
    for (const section of ['Structures', 'Units', 'Infantry'] as const) {
      for (const row of o.playerObjectCounts[section].rows) {
        if (row.x === null || row.y === null) continue;
        if (row.x < 0 || row.y < 0 || row.x > bound || row.y > bound) {
          offIds.push(row.id.length > 0 ? row.id : '<blank>');
        }
      }
    }
    if (offIds.length > 0) {
      out.push(
        finding(
          'object-off-map',
          'warn',
          scaled(-1, -3, offIds.length),
          `${offIds.length} placed object(s) sit outside the map diamond: ${withMore(offIds)}`,
          offIds,
        ),
      );
    }
  }

  // === isomappack-tile-misaligned (warn, -1) ===
  // Only when the pack decoded (else isomappack-missing-or-corrupt owns it).
  if (
    o.isoMapPack.hasIsoMapPack &&
    o.isoMapPack.isoMapPackValid === true &&
    o.isoMapPack.structAlignmentRemainder !== null &&
    o.isoMapPack.structAlignmentRemainder !== 0 &&
    o.isoMapPack.structAlignmentRemainder !== 4
  ) {
    out.push(
      finding(
        'isomappack-tile-misaligned',
        'warn',
        -1,
        `decoded IsoMapPack5 length % 11 = ${o.isoMapPack.structAlignmentRemainder} (expected 0 or 4) — tile stream misaligned`,
      ),
    );
  }

  // === isomappack-oversized (warn, -1) ===
  if (o.isoMapPack.hasIsoMapPack) {
    const ratioOversized =
      o.isoMapPack.oversizeRatio !== null && o.isoMapPack.oversizeRatio > OVERSIZE_FACTOR;
    // Raw joined base64 payload length (proxy for a bloated pack).
    let payloadBytes = 0;
    const packSection = parsed.ini.section('IsoMapPack5');
    if (packSection) {
      for (const v of Object.values(packSection)) payloadBytes += v.length;
    }
    const payloadOversized = payloadBytes > ISOMAPPACK_MAX_PAYLOAD_BYTES;
    if (ratioOversized || payloadOversized) {
      const why = ratioOversized
        ? `decoded length is ${o.isoMapPack.oversizeRatio!.toFixed(2)}× the expected size`
        : `base64 payload is ${(payloadBytes / (1024 * 1024)).toFixed(1)}MB`;
      out.push(
        finding('isomappack-oversized', 'warn', -1, `IsoMapPack5 is oversized (${why})`),
      );
    }
  }

  // === barren-objects-terrain (warn, -1) ===
  // Structures/Units/Infantry/Terrain/Smudge all empty && no ore source. Scope
  // excludes Aircraft, so recompute rather than lean on facts.isBarren (which
  // folds Aircraft into its total — see return note).
  const suiEmpty =
    o.playerObjectCounts.Structures.rowCount === 0 &&
    o.playerObjectCounts.Units.rowCount === 0 &&
    o.playerObjectCounts.Infantry.rowCount === 0;
  const barren =
    suiEmpty && o.terrainObjects.length === 0 && o.smudges.length === 0 && !o.hasOreSource;
  if (barren && !isBarrenSuppressed(facts.meta.gameModes)) {
    out.push(
      finding(
        'barren-objects-terrain',
        'warn',
        -1,
        'map has no structures, units, infantry, terrain, smudge, or ore source',
      ),
    );
  }

  // === REWARD: all-object-refs-valid (info, +1) ===
  // Every referenced id is vanilla, theater known, IsoMapPack decodes cleanly &
  // aligned. Overlay indices need Format80 (Phase 2) so they are not yet checked
  // — the INI-visible object refs still gate the reward. Requires a non-empty
  // referenced set so a barren map cannot earn it vacuously.
  const packCleanAligned =
    o.isoMapPack.hasIsoMapPack &&
    o.isoMapPack.isoMapPackValid === true &&
    (o.isoMapPack.structAlignmentRemainder === 0 || o.isoMapPack.structAlignmentRemainder === 4);
  let allRefsVanilla = o.distinctReferencedTypes.size > 0;
  for (const id of o.distinctReferencedTypes) {
    if (id.length > 0 && !isVanilla(id)) {
      allRefsVanilla = false;
      break;
    }
  }
  if (allRefsVanilla && facts.meta.theaterKnown && packCleanAligned) {
    out.push(
      finding(
        'all-object-refs-valid',
        'info',
        1,
        'every referenced object id is vanilla YR, theater is known, and IsoMapPack5 decodes cleanly and aligned',
      ),
    );
  }

  // === REWARD: has-capturable-tech (info, +1) — capped regardless of count ===
  if (o.techStructures.length > 0) {
    const ids = [...new Set(o.techStructures.map((t) => t.id))];
    out.push(
      finding(
        'has-capturable-tech',
        'info',
        1,
        `map includes capturable tech structure(s): ${withMore(ids)}`,
        ids,
      ),
    );
  }

  // === REWARD: resource-economy-present (info, +1) ===
  // Ore-tree half works today; ore/gem overlay half needs Format80 (Phase 2).
  if (o.oreTreeCount > 0) {
    out.push(
      finding(
        'resource-economy-present',
        'info',
        1,
        `map provides a resource economy (${o.oreTreeCount} ore/Tiberium tree(s))`,
      ),
    );
  }

  // === REWARD: hand-decorated-terrain (info, +1) ===
  // Rich [Terrain] and/or [Smudge] with every terrain/smudge ref valid and none
  // off-map / malformed.
  const richTerrain =
    o.terrainObjects.length >= TERRAIN_RICH_THRESHOLD ||
    o.smudges.length >= TERRAIN_RICH_THRESHOLD;
  if (richTerrain) {
    let allDecorValid = o.terrainOffMapCount === 0 && o.malformedSmudgeCount === 0;
    if (allDecorValid) {
      for (const t of o.terrainObjects) {
        if (t.type.length > 0 && !isKnown(t.type)) {
          allDecorValid = false;
          break;
        }
      }
    }
    if (allDecorValid) {
      for (const s of o.smudges) {
        if (s.type.length > 0 && !isKnown(s.type)) {
          allDecorValid = false;
          break;
        }
      }
    }
    if (allDecorValid) {
      out.push(
        finding(
          'hand-decorated-terrain',
          'info',
          1,
          `map is hand-decorated (${o.terrainObjects.length} terrain, ${o.smudges.length} smudge, all valid)`,
        ),
      );
    }
  }

  return out;
}

/**
 * GameMode whitelist for suppressing `barren-objects-terrain` on intentional
 * minimalist custom modes. The spec calls for a whitelist but does not enumerate
 * it, so this defaults to empty (no suppression) — populate once the intended
 * sandbox/minimalist mode tokens are known. See return note to the lead.
 */
const BARREN_SUPPRESSED_GAMEMODES: ReadonlySet<string> = new Set<string>();

function isBarrenSuppressed(gameModes: string[]): boolean {
  return gameModes.some((m) => BARREN_SUPPRESSED_GAMEMODES.has(m.trim().toLowerCase()));
}
