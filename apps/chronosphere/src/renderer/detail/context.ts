import {
  sizeClassOf,
  type HealthVerdict,
  type MapType,
  type ModerationStatus,
  type SizeClass,
} from '@antares/shared/taxonomy.ts';
import type {
  HashAnnotation,
  HealthReport,
  MapCardDto,
  MapDetailDto,
  TeamLayoutSuggestion,
} from '@antares/shared/types.ts';
import type { ScannedFile } from '../../ipc.ts';
import type { DiskRow, DiskSubRow, InstallState, Membership, UpdateTarget } from '../lib/types.ts';

/**
 * Pure derivations for the shared detail panel: the selected-target model
 * (archive card vs disk unit), the merged display facts (archive DTO fields
 * enriched by / falling back to the local parsed facts), verdict copy, and
 * URL helpers. No IO — everything here is render-time derivation.
 */

// ---------------------------------------------------------------------------
// Target model

/**
 * One selectable thing on the disk side — a top-level row or a disclosure
 * sub-row, normalized to a single shape the action matrix can reason about.
 */
export interface DiskUnit {
  /** The selectable id this unit was resolved from (row.key or sub.key). */
  key: string;
  name: string;
  file: ScannedFile;
  contentHash: string;
  membership: Membership;
  moderation: ModerationStatus;
  /** LOCAL MapKit report — the authority for on-disk files (spec §13). */
  health: HealthReport;
  identity: NonNullable<HashAnnotation['identity']> | null;
  updateTarget: UpdateTarget | null;
  /** Every file path this unit stands for — what "Remove" quarantines. */
  paths: string[];
}

export type DetailTarget =
  | { kind: 'archive'; card: MapCardDto; install: InstallState }
  | { kind: 'disk'; row: DiskRow; unit: DiskUnit };

function stripMapExtension(fileName: string): string {
  return fileName.replace(/\.(map|mpr|yrm)$/i, '');
}

function updateTargetOf(
  identity: NonNullable<HashAnnotation['identity']> | null,
): UpdateTarget | null {
  if (identity === null) return null;
  return {
    identityId: identity.identityId,
    slug: identity.slug,
    name: identity.name,
    canonicalVersionId: identity.canonicalVersionId,
    canonicalHash: identity.canonicalHash,
  };
}

/** Normalize a disk row (or one of its sub-rows) into a DiskUnit. */
export function diskUnitOf(row: DiskRow, sub: DiskSubRow | null): DiskUnit {
  if (sub !== null) {
    const identity = sub.annotation?.identity ?? null;
    return {
      key: sub.key,
      name: identity?.name ?? sub.file.name ?? stripMapExtension(sub.file.fileName),
      file: sub.file,
      contentHash: sub.contentHash,
      membership: sub.membership,
      moderation: sub.annotation?.status ?? 'unknown',
      health: sub.health,
      identity,
      updateTarget: sub.membership === 'update' ? updateTargetOf(identity) : null,
      paths: [sub.file.path],
    };
  }
  const paths =
    row.subRows.length > 0
      ? [...new Set(row.subRows.map((s) => s.file.path))]
      : [row.primary.path];
  return {
    key: row.key,
    name: row.name,
    file: row.primary,
    contentHash: row.contentHash,
    membership: row.membership,
    moderation: row.moderation,
    health: row.health,
    identity: row.identity,
    updateTarget: row.updateTarget,
    paths,
  };
}

// ---------------------------------------------------------------------------
// Display facts (merged archive + local)

export interface DisplayFacts {
  name: string;
  author: string | null;
  /** Gold ✦ keys on the verified author id only — never on a name string. */
  verifiedAuthor: boolean;
  type: MapType | null;
  maxPlayers: number | null;
  theater: string | null;
  width: number | null;
  height: number | null;
  sizeClass: SizeClass | null;
  team: TeamLayoutSuggestion | null;
  healthVerdict: HealthVerdict | null;
  rating: number | null;
  reviewCount: number;
  downloads: number | null;
  fileSizeKb: number | null;
  /** Archive dateAdded (canonical version), when known. */
  dateAddedIso: string | null;
  /** Local file mtime for disk targets. */
  addedAtMs: number | null;
  /** Archive identity slug, when the target maps to one. */
  slug: string | null;
}

/**
 * The detail DTO matching this target, or null when the loaded detail belongs
 * to a previous selection.
 */
export function matchedDetail(target: DetailTarget, detail: MapDetailDto | null): MapDetailDto | null {
  if (detail === null) return null;
  const slug = target.kind === 'archive' ? target.card.slug : target.unit.identity?.slug ?? null;
  return slug !== null && detail.slug === slug ? detail : null;
}

export function displayFacts(target: DetailTarget, detail: MapDetailDto | null): DisplayFacts {
  const det = matchedDetail(target, detail);
  if (target.kind === 'archive') {
    const c: MapCardDto = det ?? target.card;
    return {
      name: c.name,
      author: c.author,
      // A verified-author id (any id) keys the gold ✦ — never a name string.
      verifiedAuthor: c.authorId !== null,
      type: c.type,
      maxPlayers: c.maxPlayers,
      theater: c.theater,
      width: c.width,
      height: c.height,
      sizeClass: c.sizeClass,
      team: c.teamLayout,
      healthVerdict: c.healthVerdict,
      rating: c.rating,
      reviewCount: c.reviewCount,
      downloads: c.downloads,
      fileSizeKb: c.fileSizeKb,
      dateAddedIso: c.dateAdded,
      addedAtMs: null,
      slug: c.slug,
    };
  }
  const { unit } = target;
  const file = unit.file;
  const width = file.width ?? det?.width ?? null;
  const height = file.height ?? det?.height ?? null;
  return {
    name: unit.name,
    author: det?.author ?? null,
    verifiedAuthor: (det?.authorId ?? null) !== null,
    type: det?.type ?? null,
    maxPlayers: file.maxPlayers ?? det?.maxPlayers ?? null,
    theater: file.theater ?? det?.theater ?? null,
    width,
    height,
    sizeClass:
      width !== null && height !== null ? sizeClassOf(width, height) : det?.sizeClass ?? null,
    team: det?.teamLayout ?? null,
    // Local analysis is the authority for what's on disk.
    healthVerdict: unit.health.verdict,
    rating: det?.rating ?? null,
    reviewCount: det?.reviewCount ?? 0,
    downloads: det?.downloads ?? null,
    fileSizeKb: file.bytes / 1024,
    dateAddedIso: det?.dateAdded ?? null,
    addedAtMs: file.mtime,
    slug: unit.identity?.slug ?? null,
  };
}

// ---------------------------------------------------------------------------
// Health copy

/** Verdict banner headline (copy.md §Health tab, verbatim). */
export const VERDICT_TITLES: Record<HealthVerdict, string> = {
  verified: 'Passes analysis cleanly',
  heavy: 'Valid, but heavy',
  broken: 'Fails analysis',
  'needs-mod': 'Needs a mod',
};

/** "312 triggers · 40 AI teams · 130×130 play area" from a report's metrics. */
export function metricsLine(report: HealthReport): string | null {
  const m = report.metrics;
  if (m === undefined) return null;
  const parts: string[] = [];
  if (m.triggers !== undefined) parts.push(`${m.triggers} triggers`);
  if (m.aiTeams !== undefined) parts.push(`${m.aiTeams} AI teams`);
  if (m.width !== undefined && m.height !== undefined) {
    parts.push(`${m.width}×${m.height} play area`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

// ---------------------------------------------------------------------------
// URLs

/** The website's map-detail page for "Open on website". */
export function websiteMapUrl(apiBase: string, slug: string): string {
  return `${apiBase.replace(/\/+$/, '')}/maps/${encodeURIComponent(slug)}`;
}
