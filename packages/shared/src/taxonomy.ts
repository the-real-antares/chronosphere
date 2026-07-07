/**
 * The shared vocabulary. Both clients (website + Chronosphere) and the backend
 * speak exactly these values — see design_handoff_antares_site/DESIGN.md §Taxonomy
 * and design_handoff_chronosphere/DESIGN.md §9. One vocabulary, reconciled.
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

/**
 * LLM enrichment tags — the fixed vocabulary the Codex pass picks from
 * (CODEX_MAPS_RUNBOOK.md §5: mode + theme + curation). Stored per identity in
 * `aiTags`; drives the archive tag facet and the chips on cards/detail.
 */
export const AI_TAGS = [
  // mode
  '1v1',
  '2v2',
  'ffa',
  'survival',
  'coop-mission',
  'naval',
  'tower-defense',
  'megawealth',
  'unholy-alliance',
  'no-superweapons',
  // theme
  'urban-warfare',
  'naval-heavy',
  'resource-race',
  'chokepoint',
  'open-field',
  'maze',
  'asymmetric',
  'remake',
  'joke-troll',
  // curation
  'beginner-friendly',
  'competitive',
  'casual',
  'showcase',
] as const;
export type AiTag = (typeof AI_TAGS)[number];

export const AI_TAG_LABELS: Record<AiTag, string> = {
  '1v1': '1v1',
  '2v2': '2v2',
  ffa: 'FFA',
  survival: 'Survival',
  'coop-mission': 'Co-op mission',
  naval: 'Naval',
  'tower-defense': 'Tower defense',
  megawealth: 'Megawealth',
  'unholy-alliance': 'Unholy alliance',
  'no-superweapons': 'No superweapons',
  'urban-warfare': 'Urban warfare',
  'naval-heavy': 'Naval heavy',
  'resource-race': 'Resource race',
  chokepoint: 'Chokepoint',
  'open-field': 'Open field',
  maze: 'Maze',
  asymmetric: 'Asymmetric',
  remake: 'Remake',
  'joke-troll': 'Joke / troll',
  'beginner-friendly': 'Beginner-friendly',
  competitive: 'Competitive',
  casual: 'Casual',
  showcase: 'Showcase',
};

/** Display label for an AI tag; falls back to the raw value if off-vocabulary. */
export function aiTagLabel(tag: string): string {
  return (AI_TAG_LABELS as Record<string, string>)[tag] ?? tag;
}

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

/**
 * Moderation status for user-authored content — reviews AND comments. Reactive
 * moderation: content auto-publishes; a mod (or 3 distinct reporters) can hide
 * it pending review, and a mod can remove it.
 * - `published` — public.
 * - `hidden` — auto-hidden by reports or a mod, awaiting a decision; not public.
 * - `removed` — a mod took it down; not public.
 */
export const CONTENT_STATUSES = ['published', 'hidden', 'removed'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/**
 * Legacy pre-auto-publish review states, retained ONLY for back-compat with
 * rows written before the reactive-moderation migration ('approved' reads as
 * published). New reviews use {@link CONTENT_STATUSES}.
 * @deprecated Superseded by {@link CONTENT_STATUSES}.
 */
export const LEGACY_REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;

/**
 * The full accepted set on `reviews.status`: the canonical content statuses
 * plus the legacy values still present in un-migrated rows. `ReviewStatus` is
 * kept wide so DTOs stay assignable during the migration window.
 */
export const REVIEW_STATUSES = [...CONTENT_STATUSES, ...LEGACY_REVIEW_STATUSES] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** What a report points at. */
export type ReportTargetType = 'review' | 'comment';

/**
 * Ordered reasons a user can pick when reporting a review or comment. Order is
 * the UI order; `value` is what the client sends and the backend stores.
 */
export const REPORT_REASONS = [
  { value: 'spam', label: 'Spam / links' },
  { value: 'offensive', label: 'Offensive or hateful' },
  { value: 'harmful', label: 'Harmful or dangerous' },
  { value: 'sexual', label: 'Sexual content' },
  { value: 'doxxing', label: 'Doxxing / personal info' },
  { value: 'off-topic', label: 'Off-topic' },
  { value: 'scam', label: 'Scam / shady' },
  { value: 'other', label: 'Other' },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]['value'];

/** Lifecycle of a report in the mod queue. */
export const REPORT_STATUSES = ['open', 'dismissed', 'upheld'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** How many DISTINCT reporters auto-hide a target pending mod review. */
export const REPORT_AUTOHIDE_THRESHOLD = 3;

/**
 * In-app notification kinds (phase-3 social layer). Delivery is the in-app
 * notification center only (a bell + list) on both clients — no email/Discord in
 * v1. Two sources feed the list:
 *  - FOLLOW a user → their new reviews + new maps (`followed-*`).
 *  - SUBSCRIBE / watch a map → replies to your review/comment, new reviews on the
 *    map, and new versions of it (`review-reply`, `comment-reply`,
 *    `new-*-of-watched`). A subscription is auto-created on interaction (review or
 *    comment) and toggled manually via Watch.
 * The actor's own action never notifies the actor. Per-sub mute + a global
 * `notificationsMuted` suppress delivery (see the notifications service).
 */
export const NOTIFICATION_TYPES = [
  'review-reply',
  'comment-reply',
  'new-review-on-watched',
  'new-version-of-watched',
  'followed-new-review',
  'followed-new-map',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  'review-reply': 'Reply to your review',
  'comment-reply': 'Reply in a thread you joined',
  'new-review-on-watched': 'New review on a map you watch',
  'new-version-of-watched': 'New version of a map you watch',
  'followed-new-review': 'New review from someone you follow',
  'followed-new-map': 'New map from someone you follow',
};

/** True for a value in the notification vocabulary (narrows unknown row strings). */
export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

/**
 * @deprecated Legacy single-token archive sort. Superseded by
 * `ARCHIVE_SORT_FIELDS` + a direction (see `resolveLegacySort`). Kept exported
 * so existing URLs and the current UIs keep working through the migration.
 */
export const ARCHIVE_SORTS = ['newest', 'downloads', 'rating', 'quality'] as const;
/** @deprecated See {@link ARCHIVE_SORTS}. */
export type ArchiveSort = (typeof ARCHIVE_SORTS)[number];

export type SortDir = 'asc' | 'desc';

/**
 * A sortable archive field — the SINGLE source both UIs render their sort
 * control from and the backend builds `ORDER BY` from (no more per-client
 * hardcoded sort lists). `defaultDir` is applied when a field is first chosen;
 * `nullsLast` fields (rating/quality/favorited) always sort NULLs last in BOTH
 * directions.
 */
export interface ArchiveSortField {
  key: string;
  label: string;
  defaultDir: SortDir;
  nullsLast?: boolean;
}

export const ARCHIVE_SORT_FIELDS = [
  { key: 'date', label: 'Newest', defaultDir: 'desc' },
  { key: 'downloads', label: 'Most downloaded', defaultDir: 'desc' },
  { key: 'installed', label: 'Most installed', defaultDir: 'desc', nullsLast: false },
  { key: 'rating', label: 'Highest rated', defaultDir: 'desc', nullsLast: true },
  { key: 'quality', label: 'Highest quality', defaultDir: 'desc', nullsLast: true },
  { key: 'commented', label: 'Most reviewed', defaultDir: 'desc' },
  { key: 'favorited', label: 'Most bookmarked', defaultDir: 'desc', nullsLast: true },
  { key: 'name', label: 'Name (A–Z)', defaultDir: 'asc' },
] as const satisfies readonly ArchiveSortField[];

export type ArchiveSortFieldKey = (typeof ARCHIVE_SORT_FIELDS)[number]['key'];

/** The archive's default sort field (newest first). */
export const DEFAULT_ARCHIVE_SORT_FIELD: ArchiveSortFieldKey = 'date';

/** Descriptor for a field key, or undefined if unknown. */
export function archiveSortField(key: string): ArchiveSortField | undefined {
  return ARCHIVE_SORT_FIELDS.find((f) => f.key === key);
}

/**
 * Map a legacy {@link ARCHIVE_SORTS} token → {field, dir} for back-compat.
 * Every legacy token resolves to its field's default direction; unknown → null.
 */
export function resolveLegacySort(value: string): { field: ArchiveSortFieldKey; dir: SortDir } | null {
  switch (value) {
    case 'newest':
      return { field: 'date', dir: 'desc' };
    case 'downloads':
      return { field: 'downloads', dir: 'desc' };
    case 'rating':
      return { field: 'rating', dir: 'desc' };
    case 'quality':
      return { field: 'quality', dir: 'desc' };
    default:
      return null;
  }
}

/** Player filter buckets used by both clients: Any / 2+ / 4+ / 6+ / 8. */
export const MIN_PLAYER_BUCKETS = [2, 4, 6, 8] as const;

/**
 * Quality bands over the 1–10 lint score — a coarse facet both UIs render the
 * same. Maps match inclusively on [min, max]; unlinted maps (null score) never
 * match a band.
 */
export const QUALITY_BANDS = [
  { value: 'high', label: 'Great (8–10)', min: 8, max: 10 },
  { value: 'mid', label: 'Good (5–7)', min: 5, max: 7 },
  { value: 'low', label: 'Rough (1–4)', min: 1, max: 4 },
] as const;
export type QualityBand = (typeof QUALITY_BANDS)[number]['value'];

/**
 * The archive filter facets — the SINGLE descriptor both UIs render their
 * filter controls from. `key` is the URL query parameter each facet drives;
 * `anyValue` (single-selects) is the sentinel that clears the filter.
 * Multi-select facets combine with OR (a map matches ANY selected value).
 */
export type ArchiveFacetKind = 'select' | 'multiselect';

export interface ArchiveFacetOption {
  value: string;
  label: string;
}

export interface ArchiveFacetDef {
  key: 'type' | 'minPlayers' | 'theater' | 'size' | 'health' | 'team' | 'quality' | 'tags';
  label: string;
  kind: ArchiveFacetKind;
  options: readonly ArchiveFacetOption[];
  /** Single-select sentinel meaning "no filter". */
  anyValue?: string;
  /** Multi-select combine semantics. */
  combine?: 'or' | 'and';
}

export const ARCHIVE_FACETS: readonly ArchiveFacetDef[] = [
  {
    key: 'type',
    label: 'Type',
    kind: 'select',
    anyValue: 'all',
    options: MAP_TYPES.map((t) => ({ value: t, label: MAP_TYPE_LABELS[t] })),
  },
  {
    key: 'minPlayers',
    label: 'Players',
    kind: 'select',
    anyValue: 'any',
    options: MIN_PLAYER_BUCKETS.map((n) => ({ value: String(n), label: n === 8 ? '8' : `${n}+` })),
  },
  {
    key: 'theater',
    label: 'Theater',
    kind: 'select',
    anyValue: 'all',
    options: THEATERS.map((t) => ({ value: t, label: t })),
  },
  {
    key: 'size',
    label: 'Size',
    kind: 'select',
    anyValue: 'any',
    options: SIZE_CLASSES.map((s) => ({ value: s, label: SIZE_CLASS_LABELS[s] })),
  },
  {
    key: 'health',
    label: 'Health',
    kind: 'select',
    anyValue: 'all',
    options: HEALTH_VERDICTS.map((h) => ({ value: h, label: HEALTH_LABELS[h] })),
  },
  {
    key: 'team',
    label: 'Team',
    kind: 'select',
    anyValue: 'any',
    options: TEAM_LAYOUTS.map((t) => ({ value: t, label: t === 'ffa' ? 'FFA' : t })),
  },
  {
    key: 'quality',
    label: 'Quality',
    kind: 'select',
    anyValue: 'any',
    options: QUALITY_BANDS.map((q) => ({ value: q.value, label: q.label })),
  },
  {
    key: 'tags',
    label: 'Tags',
    kind: 'multiselect',
    combine: 'or',
    options: AI_TAGS.map((t) => ({ value: t, label: AI_TAG_LABELS[t] })),
  },
];

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
