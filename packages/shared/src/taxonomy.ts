/**
 * The shared vocabulary. Both clients (website + Chronosphere) and the backend
 * speak exactly these values — one vocabulary, reconciled across the archive.
 */

export const MAP_TYPES = [
  'multiplayer',
  'survival',
  'coop-mission',
  'custom-mission',
  'custom-mode',
] as const;
export type MapType = (typeof MAP_TYPES)[number];

export const MAP_TYPE_LABELS: Record<MapType, string> = {
  multiplayer: 'Multiplayer',
  survival: 'Survival',
  'coop-mission': 'Co-op mission',
  'custom-mission': 'Custom mission',
  'custom-mode': 'Custom mode',
};

export const THEATERS = ['Temperate', 'Snow', 'Urban', 'New Urban', 'Desert', 'Lunar'] as const;
export type Theater = (typeof THEATERS)[number];

/** Size classes are contiguous — small ≤90, medium 91–129, large ≥130 (max dimension). */
export const SIZE_CLASSES = ['small', 'medium', 'large'] as const;
export type SizeClass = (typeof SIZE_CLASSES)[number];

export function sizeClassOf(width: number, height: number): SizeClass {
  const d = Math.max(width, height);
  if (d <= 90) return 'small';
  if (d <= 129) return 'medium';
  return 'large';
}

export const SIZE_CLASS_LABELS: Record<SizeClass, string> = {
  small: 'Small ≤90',
  medium: 'Medium 91–129',
  large: 'Large 130+',
};

export const TEAM_LAYOUTS = ['1v1', '2v2', '3v3', '4v4', 'ffa'] as const;
export type TeamLayout = (typeof TEAM_LAYOUTS)[number];

/** Team layout is always a suggestion, never a fact — carry the confidence with the value. */
export const CONFIDENCES = ['low', 'medium', 'high'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const HEALTH_VERDICTS = ['verified', 'heavy', 'broken', 'needs-mod'] as const;
export type HealthVerdict = (typeof HEALTH_VERDICTS)[number];

export const HEALTH_LABELS: Record<HealthVerdict, string> = {
  verified: 'Verified',
  heavy: 'Heavy',
  broken: 'Broken',
  'needs-mod': 'Needs a mod',
};

/** Glyphs are part of the contract: never rely on color alone. ⚠ is reserved for Broken. */
export const HEALTH_GLYPHS: Record<HealthVerdict, string> = {
  verified: '●',
  heavy: '▲',
  broken: '⚠',
  'needs-mod': '⊘',
};

/** Per-hash moderation status (contribute flow + Build-a-Map queue). */
export const MODERATION_STATUSES = ['unknown', 'in-review', 'rejected', 'published'] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const ARCHIVE_SORTS = ['newest', 'downloads', 'rating'] as const;
export type ArchiveSort = (typeof ARCHIVE_SORTS)[number];

/** Player filter buckets used by both clients: Any / 2+ / 4+ / 6+ / 8. */
export const MIN_PLAYER_BUCKETS = [2, 4, 6, 8] as const;

export const MAP_FILE_EXTENSIONS = ['.map', '.mpr', '.yrm'] as const;

/** Max accepted upload size for submissions (server-side validation). */
export const MAX_SUBMISSION_BYTES = 5 * 1024 * 1024;

/** Contributor badges, computed from accepted contributions / confirmed tags. */
export const BADGE_THRESHOLDS = [
  { badge: 'FIRST ADDITION', kind: 'contribution', count: 1 },
  { badge: 'ARCHIVIST', kind: 'contribution', count: 10 },
  { badge: 'HOUSE BUILDER', kind: 'contribution', count: 100 },
  { badge: 'SURVEYOR', kind: 'tags', count: 10 },
] as const;
export type BadgeKind = (typeof BADGE_THRESHOLDS)[number]['kind'];

export function badgesFor(acceptedContributions: number, confirmedTags: number): string[] {
  const out: string[] = [];
  for (const t of BADGE_THRESHOLDS) {
    const n = t.kind === 'contribution' ? acceptedContributions : confirmedTags;
    if (n >= t.count) out.push(t.badge);
  }
  return out;
}
