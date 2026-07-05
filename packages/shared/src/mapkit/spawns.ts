/**
 * spawns-waypoints category checker for the YR map linter.
 *
 * Pure, deterministic. Consumes the shared `MapFacts` bundle (already decoded by
 * computeMapFacts) plus the `ParsedMapFile`, and emits `LintFinding[]`. Every
 * ruleId / severity / scoreImpact matches docs/LINTER_SPEC.md PART 1 section C
 * exactly; the scoreImpacts there are already per-rule-capped, so they are used
 * verbatim.
 *
 * Ordering note (spec): `non-numeric-start-waypoint` conceptually runs first and
 * its entries are excluded from duplicate/bounds/symmetry math. That exclusion is
 * already baked into the facts (duplicateStartCells / outOfBoundsStarts / spawn
 * symmetry only consider numeric — and, for bounds/symmetry, in-bounds — starts),
 * so this checker just reads those pre-filtered facts.
 */
import type { MapFacts } from './facts.ts';
import type { AnalyzeOptions } from './index.ts';
import type { LintFinding } from './lint-types.ts';
import type { ParsedMapFile } from '../mapfile/parse.ts';

const CATEGORY = 'spawns-waypoints' as const;

/** Reward set for a clean balanced start count. */
const BALANCED_COUNTS = new Set([2, 4, 6, 8]);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function checkSpawns(
  facts: MapFacts,
  parsed: ParsedMapFile,
  opts?: AnalyzeOptions,
): LintFinding[] {
  const findings: LintFinding[] = [];
  const { spawns, meta, triggers } = facts;
  const {
    startCount,
    nonNumericStarts,
    duplicateStartCells,
    outOfBoundsStarts,
    gapIndices,
    spawnSeparation,
    spawnSymmetry,
    scriptingWaypointCount,
    startContiguity,
  } = spawns;

  const size = meta.size;
  const declaredMaxPlayer = meta.maxPlayerDeclared;
  const basicPlayerEmpty = meta.basicPlayer === null;

  // --- error rules --------------------------------------------------------

  // no-multiplayer-starts | error | −6 (verdict-guarded; band cap dominates)
  if (startCount === 0 && basicPlayerEmpty) {
    findings.push({
      ruleId: 'no-multiplayer-starts',
      category: CATEGORY,
      severity: 'error',
      scoreImpact: -6,
      message:
        'Map declares no start waypoints (0..7) and no single-player [Basic] Player — no one can spawn.',
    });
  }

  // single-start-in-multiplayer-map | error | −4
  const mpFlavored =
    meta.multiplayerOnly === true ||
    meta.gameModes.length > 0 ||
    (declaredMaxPlayer !== null && declaredMaxPlayer > 1);
  if (startCount === 1 && basicPlayerEmpty && mpFlavored) {
    const idx = spawns.startWaypointIndices[0];
    findings.push({
      ruleId: 'single-start-in-multiplayer-map',
      category: CATEGORY,
      severity: 'error',
      scoreImpact: -4,
      message: `Multiplayer-flavored map has only a single start waypoint (index ${idx}).`,
      ...(idx !== undefined ? { refs: [String(idx)] } : {}),
    });
  }

  // duplicate-start-cells | error | −3
  if (duplicateStartCells.length > 0) {
    const refs = duplicateStartCells.flatMap((g) => g.indices.map(String));
    const groupDesc = duplicateStartCells
      .map((g) => `[${g.indices.join('/')}]→(${g.x},${g.y})`)
      .join(', ');
    findings.push({
      ruleId: 'duplicate-start-cells',
      category: CATEGORY,
      severity: 'error',
      scoreImpact: -3,
      message: `Multiple start waypoints decode to the same cell: ${groupDesc}.`,
      refs,
    });
  }

  // non-numeric-start-waypoint | error | −3
  if (nonNumericStarts.length > 0) {
    findings.push({
      ruleId: 'non-numeric-start-waypoint',
      category: CATEGORY,
      severity: 'error',
      scoreImpact: -3,
      message: `Start waypoint(s) with non-numeric coordinate value: index ${nonNumericStarts.join(', ')}.`,
      refs: nonNumericStarts.map(String),
    });
  }

  // start-waypoint-out-of-bounds | error | −3 (only meaningful when size known)
  if (size !== null && outOfBoundsStarts.length > 0) {
    findings.push({
      ruleId: 'start-waypoint-out-of-bounds',
      category: CATEGORY,
      severity: 'error',
      scoreImpact: -3,
      message: `Start waypoint(s) outside the map's cell diamond: index ${outOfBoundsStarts.join(', ')}.`,
      refs: outOfBoundsStarts.map(String),
    });
  }

  // --- warn rules ---------------------------------------------------------

  // start-count-below-maxplayer | warn | −2
  if (declaredMaxPlayer !== null && startCount > 0 && startCount < declaredMaxPlayer) {
    findings.push({
      ruleId: 'start-count-below-maxplayer',
      category: CATEGORY,
      severity: 'warn',
      scoreImpact: -2,
      message: `Only ${startCount} start waypoint(s) but [Basic] MaxPlayer=${declaredMaxPlayer}.`,
    });
  }

  // maxplayer-metadata-mismatch | warn | −1
  if (declaredMaxPlayer !== null && startCount > declaredMaxPlayer) {
    findings.push({
      ruleId: 'maxplayer-metadata-mismatch',
      category: CATEGORY,
      severity: 'warn',
      scoreImpact: -1,
      message: `${startCount} start waypoints exceed declared [Basic] MaxPlayer=${declaredMaxPlayer}.`,
    });
  }

  // noncontiguous-start-indices | warn | −1
  if (gapIndices.length > 0) {
    findings.push({
      ruleId: 'noncontiguous-start-indices',
      category: CATEGORY,
      severity: 'warn',
      scoreImpact: -1,
      message: `Start waypoint indices are non-contiguous; missing index ${gapIndices.join(', ')}.`,
      refs: gapIndices.map(String),
    });
  }

  // poor-spawn-separation | warn | −1
  if (size !== null && spawnSeparation !== null && spawnSeparation.min > 0) {
    const threshold = Math.max(3, (size.width + size.height) * 0.05);
    if (spawnSeparation.min < threshold) {
      findings.push({
        ruleId: 'poor-spawn-separation',
        category: CATEGORY,
        severity: 'warn',
        scoreImpact: -1,
        message: `Closest two starts are only ${spawnSeparation.min.toFixed(1)} cells apart (min recommended ${threshold.toFixed(1)}).`,
      });
    }
  }

  // --- info rules ---------------------------------------------------------

  // odd-start-count | info | −0.5
  if (startCount >= 3 && startCount % 2 === 1) {
    findings.push({
      ruleId: 'odd-start-count',
      category: CATEGORY,
      severity: 'info',
      scoreImpact: -0.5,
      message: `Odd number of start waypoints (${startCount}) — teams cannot be balanced.`,
    });
  }

  // --- reward rules -------------------------------------------------------

  // clean-balanced-start-set | info | +1
  const allNumeric = nonNumericStarts.length === 0;
  const distinctCells = duplicateStartCells.length === 0;
  const allInBounds = size !== null && outOfBoundsStarts.length === 0;
  const maxPlayerOk = declaredMaxPlayer === null || declaredMaxPlayer === startCount;
  if (
    BALANCED_COUNTS.has(startCount) &&
    startContiguity &&
    allNumeric &&
    allInBounds &&
    distinctCells &&
    maxPlayerOk
  ) {
    findings.push({
      ruleId: 'clean-balanced-start-set',
      category: CATEGORY,
      severity: 'info',
      scoreImpact: 1,
      message: `Clean, balanced start set: ${startCount} contiguous, in-bounds, distinct starts.`,
    });
  }

  // symmetric-spawns | info | +1
  // spawnSymmetry is only non-null when size is known, count≥2, and every start
  // is numeric + in-bounds (valid.length === startCoords.length), matching spec.
  if (
    spawnSymmetry !== null &&
    startCount >= 2 &&
    (spawnSymmetry.pointSymmetric || spawnSymmetry.axisMirror)
  ) {
    const kind = spawnSymmetry.pointSymmetric ? '180° point-symmetric' : 'axis-mirrored';
    findings.push({
      ruleId: 'symmetric-spawns',
      category: CATEGORY,
      severity: 'info',
      scoreImpact: 1,
      message: `Start waypoints are ${kind} about their centroid — balanced layout.`,
    });
  }

  // scripted-navigation-waypoints | info | +0.5
  if (scriptingWaypointCount > 0 && triggers.triggerIdSet.size > 0) {
    findings.push({
      ruleId: 'scripted-navigation-waypoints',
      category: CATEGORY,
      severity: 'info',
      scoreImpact: 0.5,
      message: `${scriptingWaypointCount} scripting waypoint(s) (index≥8) present alongside ${triggers.triggerIdSet.size} trigger(s).`,
    });
  }

  return findings;
}
