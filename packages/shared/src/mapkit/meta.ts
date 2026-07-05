/**
 * meta-structural linter category (owner of the header / dimension / player-count
 * checks). Pure, deterministic; reads only the precomputed MapFacts (plus the
 * ParsedMapFile / AnalyzeOptions the contract passes). See docs/LINTER_SPEC.md
 * PART 1 §E for the authoritative rule table.
 *
 * Global-dedup notes (owners live elsewhere, do NOT emit them here):
 *  - MaxPlayer↔start-count mismatch → spawns-waypoints.
 *  - Theater validity is owned HERE (meta-theater-missing / -unknown-token).
 *
 * Self-guards: every dimension/localsize rule requires the parsed value to be
 * non-null, so it can never re-charge a `broken`-cause (missing Size).
 */
import type { ParsedMapFile } from '../mapfile/parse.ts';
import type { MapFacts } from './facts.ts';
import type { AnalyzeOptions } from './index.ts';
import type { LintFinding } from './lint-types.ts';

/** Names that read as an unfinished / default map title. */
const PLACEHOLDER_NAMES = new Set([
  'no name',
  'noname',
  'new map',
  'untitled',
  'map name',
  'default',
  '[no name]',
  'unnamed',
]);

/** Recognised competitive/co-op game modes (meta-gamemode-declared reward). */
const KNOWN_GAME_MODES = new Set([
  'standard',
  'battle',
  'cooperative',
  'unholyalliance',
  'navalwar',
  'landrush',
  'megawealth',
  'freeforall',
  'teamalliance',
  'meatgrinder',
  'duel',
  'siege',
  'tournament',
]);

const ENGINE_MAX_DIMENSION = 512;

function isPlaceholderName(name: string): boolean {
  return PLACEHOLDER_NAMES.has(name.trim().toLowerCase());
}

export function checkMeta(
  facts: MapFacts,
  _parsed: ParsedMapFile,
  _opts?: AnalyzeOptions,
): LintFinding[] {
  const findings: LintFinding[] = [];
  const m = facts.meta;
  const startCount = facts.spawns.startCount;

  const emit = (
    ruleId: string,
    severity: LintFinding['severity'],
    scoreImpact: number,
    message: string,
    refs?: string[],
  ): void => {
    const f: LintFinding = {
      ruleId,
      category: 'meta-structural',
      severity,
      scoreImpact,
      message,
    };
    if (refs && refs.length > 0) f.refs = refs;
    findings.push(f);
  };

  // "MP-like" per §E meta-maxplayer-missing: many players expected or explicitly MP-only.
  const mpLike = startCount >= 2 || m.multiplayerOnly === true;

  // --- Basic section / name --------------------------------------------------
  if (!m.basicSectionPresent) {
    emit('meta-basic-section-missing', 'error', -3, 'Map has no [Basic] section.');
  }

  if (m.name === null) {
    emit('meta-name-missing', 'error', -2, 'Map has no [Basic] Name.');
  } else if (isPlaceholderName(m.name)) {
    emit(
      'meta-name-placeholder',
      'warn',
      -1.5,
      `Map name is a placeholder: "${m.name.trim()}".`,
    );
  }

  // --- Theater (owned here) --------------------------------------------------
  if (m.theaterToken === null) {
    emit('meta-theater-missing', 'error', -2.5, 'Map has no [Map] Theater.');
  } else if (!m.theaterKnown) {
    emit(
      'meta-theater-unknown-token',
      'error',
      -2.5,
      `[Map] Theater token "${m.theaterToken}" is not a known YR theater.`,
      [m.theaterToken],
    );
  }

  // --- LocalSize -------------------------------------------------------------
  if (m.localSize === null) {
    emit('meta-localsize-missing', 'error', -2, 'Map has no valid [Map] LocalSize quad.');
  } else if (m.size !== null) {
    const { x, y, width: lw, height: lh } = m.localSize;
    const { width: W, height: H } = m.size;
    const outOfBounds =
      x < 0 || y < 0 || lw <= 0 || lh <= 0 || x + lw > W || y + lh > H;
    if (outOfBounds) {
      emit(
        'meta-localsize-out-of-bounds',
        'warn',
        -1.5,
        `LocalSize (${x},${y},${lw},${lh}) falls outside the ${W}x${H} map.`,
      );
    } else if (lw < 10 || lh < 10 || lw * lh < 0.25 * (W * H)) {
      emit(
        'meta-localsize-degenerate',
        'warn',
        -1,
        `LocalSize (${lw}x${lh}) is degenerate for a ${W}x${H} map.`,
      );
    }
  }

  // --- Size origin -----------------------------------------------------------
  if (m.sizeOrigin !== null && (m.sizeOrigin.x !== 0 || m.sizeOrigin.y !== 0)) {
    emit(
      'meta-size-origin-nonzero',
      'warn',
      -1,
      `[Map] Size origin is non-zero (${m.sizeOrigin.x},${m.sizeOrigin.y}).`,
    );
  }

  // --- Dimensions (self-guarded on non-null size) ----------------------------
  if (m.size !== null) {
    const { width: W, height: H } = m.size;
    if (Math.max(W, H) < 20) {
      emit(
        'meta-dimensions-too-small',
        'warn',
        -1.5,
        `Map dimensions ${W}x${H} are too small (max dimension < 20).`,
      );
    }
    if (W > ENGINE_MAX_DIMENSION || H > ENGINE_MAX_DIMENSION) {
      emit(
        'meta-dimensions-exceed-engine-max',
        'error',
        -2,
        `Map dimensions ${W}x${H} exceed the engine maximum of ${ENGINE_MAX_DIMENSION}.`,
      );
    }
  }

  // --- Player counts ---------------------------------------------------------
  if (m.maxPlayerDeclared === null) {
    if (mpLike) {
      emit(
        'meta-maxplayer-missing',
        'warn',
        -1,
        'Multiplayer-like map has no [Basic] MaxPlayer.',
      );
    }
  } else if (mpLike && (m.maxPlayerDeclared < 2 || m.maxPlayerDeclared > 8)) {
    emit(
      'meta-maxplayer-out-of-range',
      'warn',
      -1,
      `[Basic] MaxPlayer=${m.maxPlayerDeclared} is out of the valid 2..8 range.`,
    );
  }

  if (
    m.minPlayerDeclared !== null &&
    m.maxPlayerDeclared !== null &&
    m.minPlayerDeclared > m.maxPlayerDeclared
  ) {
    emit(
      'meta-minplayer-gt-maxplayer',
      'warn',
      -1,
      `[Basic] MinPlayer=${m.minPlayerDeclared} exceeds MaxPlayer=${m.maxPlayerDeclared}.`,
    );
  }

  // --- Flags -----------------------------------------------------------------
  if (m.official === true) {
    emit(
      'meta-official-flag-on-custom',
      'warn',
      -1,
      '[Basic] Official=yes is reserved for Westwood built-ins and breaks CnCNet dedup.',
    );
  }

  if (m.multiplayerOnly === true && m.basicPlayer !== null && startCount === 0) {
    emit(
      'meta-multiplayeronly-mission-contradiction',
      'info',
      -0.5,
      'Map is MultiplayerOnly yet declares a [Basic] Player and has no start waypoints.',
    );
  }

  if (m.newIniFormat !== null && m.newIniFormat < 4) {
    emit(
      'meta-newiniformat-stale',
      'info',
      -0.5,
      `[Basic] NewINIFormat=${m.newIniFormat} is stale (< 4).`,
    );
  }

  // --- Informational surfacing (0 impact) ------------------------------------
  if (m.hasHeaderSection) {
    emit(
      'meta-header-section-nonstandard',
      'info',
      0,
      'Map carries a non-standard [Header] section.',
    );
  }

  if (m.requiresYR) {
    emit(
      'meta-requiredaddon-surface',
      'info',
      0,
      '[Basic] RequiredAddOn=1 — this map requires Yuri\'s Revenge.',
    );
  }

  // --- Rewards ---------------------------------------------------------------
  const declaredModes = m.gameModes
    .map((g) => g.trim().toLowerCase())
    .filter((g) => KNOWN_GAME_MODES.has(g));
  if (declaredModes.length > 0) {
    emit(
      'meta-gamemode-declared',
      'info',
      0.5,
      `Map declares recognised game mode(s): ${declaredModes.join(', ')}.`,
      declaredModes,
    );
  }

  // meta-header-complete-bonus: a fully, coherently authored header.
  const nameOk = m.name !== null && !isPlaceholderName(m.name);
  const dimsOk =
    m.size !== null &&
    m.size.width >= 20 &&
    m.size.width <= ENGINE_MAX_DIMENSION &&
    m.size.height >= 20 &&
    m.size.height <= ENGINE_MAX_DIMENSION;
  let localSizeOk = false;
  if (m.localSize !== null && m.size !== null) {
    const { x, y, width: lw, height: lh } = m.localSize;
    const { width: W, height: H } = m.size;
    const inBounds =
      x >= 0 && y >= 0 && lw > 0 && lh > 0 && x + lw <= W && y + lh <= H;
    const nonDegenerate = lw >= 10 && lh >= 10 && lw * lh >= 0.25 * (W * H);
    localSizeOk = inBounds && nonDegenerate;
  }
  const playersOk =
    (mpLike && m.maxPlayerDeclared !== null && m.maxPlayerDeclared === startCount) ||
    (m.isMission && m.basicPlayer !== null);

  if (nameOk && m.theaterKnown && dimsOk && localSizeOk && playersOk) {
    emit(
      'meta-header-complete-bonus',
      'info',
      1.5,
      'Map has a complete, coherent header (name, theater, dimensions, LocalSize, player counts).',
    );
  }

  return findings;
}
