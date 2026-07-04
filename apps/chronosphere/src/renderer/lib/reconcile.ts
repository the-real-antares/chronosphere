import type { HashAnnotation, MapCardDto } from '@antares/shared/types.ts';
import type { ScannedFile } from '../../ipc.ts';
import type {
  DiskCounts,
  DiskRow,
  DiskSubRow,
  InstallState,
  Membership,
  TidyProposal,
  UpdateTarget,
} from './types.ts';

/**
 * PURE reconciliation: scanned files + per-hash archive annotations → the
 * Your-Disk row model and the status-bar counts. No IO, no globals — this is
 * the heart of the product and it is unit-tested (reconcile.test.ts).
 *
 * Membership rules (spec §3 + ARCHITECTURE):
 *   known   — hash is a *published* archive version AND that version is canonical
 *   update  — hash is published but NOT canonical (carries the canonical target)
 *   unknown — everything else, with the per-hash moderation sub-state
 *             ('unknown' | 'in-review' | 'rejected') carried along.
 *
 * Grouping:
 *   exact duplicates — same hash, many paths → ONE row, dupCount, sub-rows;
 *                      primary = shortest filename (ties: lexicographic).
 *   version groups   — many DISK hashes mapping to the SAME identity → ONE
 *                      identity row with disclosure sub-rows; row membership is
 *                      'known' when the canonical version is among them.
 */

// ---------------------------------------------------------------------------
// Internal: one distinct content hash on disk.

interface HashUnit {
  hash: string;
  files: ScannedFile[]; // all exact copies, primary first
  primary: ScannedFile;
  annotation: HashAnnotation | null;
  membership: Membership;
}

function comparePrimary(a: ScannedFile, b: ScannedFile): number {
  if (a.fileName.length !== b.fileName.length) return a.fileName.length - b.fileName.length;
  if (a.fileName !== b.fileName) return a.fileName < b.fileName ? -1 : 1;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function membershipOf(annotation: HashAnnotation | null): Membership {
  if (annotation?.status === 'published' && annotation.identity) {
    return annotation.identity.isCanonical ? 'known' : 'update';
  }
  return 'unknown';
}

function stripMapExtension(fileName: string): string {
  return fileName.replace(/\.(map|mpr|yrm)$/i, '');
}

function displayNameOf(unit: HashUnit): string {
  return unit.annotation?.identity?.name ?? unit.primary.name ?? stripMapExtension(unit.primary.fileName);
}

function updateTargetOf(annotation: HashAnnotation | null): UpdateTarget | null {
  const id = annotation?.identity;
  if (!id) return null;
  return {
    identityId: id.identityId,
    slug: id.slug,
    name: id.name,
    canonicalVersionId: id.canonicalVersionId,
    canonicalHash: id.canonicalHash,
  };
}

function toSubRow(parentKey: string, unit: HashUnit, file: ScannedFile, primaryHash: string): DiskSubRow {
  const isPrimary = unit.hash === primaryHash && file === unit.primary;
  return {
    key: `${parentKey}:${file.path}`,
    file,
    contentHash: unit.hash,
    membership: unit.membership,
    health: file.health,
    annotation: unit.annotation,
    isPrimary,
    exactCopy: unit.hash === primaryHash && !isPrimary,
    isCanonical: unit.annotation?.identity?.isCanonical ?? false,
    isLatest: unit.annotation?.identity?.isLatest ?? false,
  };
}

function foldersOf(files: ScannedFile[]): string[] {
  const out: string[] = [];
  for (const f of files) if (!out.includes(f.folder)) out.push(f.folder);
  return out;
}

// ---------------------------------------------------------------------------
// buildDiskRows

export function buildDiskRows(
  scannedFiles: readonly ScannedFile[],
  annotations: ReadonlyMap<string, HashAnnotation>,
): { rows: DiskRow[]; counts: DiskCounts } {
  // 1. Collapse exact duplicates: one unit per distinct content hash.
  const byHash = new Map<string, ScannedFile[]>();
  for (const file of scannedFiles) {
    const list = byHash.get(file.contentHash);
    if (list) list.push(file);
    else byHash.set(file.contentHash, [file]);
  }

  const units: HashUnit[] = [];
  for (const [hash, files] of byHash) {
    const sorted = [...files].sort(comparePrimary);
    const primary = sorted[0];
    if (!primary) continue;
    const annotation = annotations.get(hash) ?? null;
    units.push({ hash, files: sorted, primary, annotation, membership: membershipOf(annotation) });
  }

  // 2. Group published units by identity (version groups).
  const byIdentity = new Map<string, HashUnit[]>();
  const standalone: HashUnit[] = [];
  for (const unit of units) {
    const identityId = unit.annotation?.identity?.identityId;
    if (identityId !== undefined && unit.annotation?.status === 'published') {
      const list = byIdentity.get(identityId);
      if (list) list.push(unit);
      else byIdentity.set(identityId, [unit]);
    } else {
      standalone.push(unit);
    }
  }

  const rows: DiskRow[] = [];

  for (const unit of standalone) rows.push(buildHashRow(unit));

  for (const [identityId, group] of byIdentity) {
    if (group.length === 1) {
      const only = group[0];
      if (only) rows.push(buildHashRow(only));
      continue;
    }
    rows.push(buildVersionGroupRow(identityId, group));
  }

  rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  // 3. Counts (two-axis rule): membership counts sum to total; broken and
  //    dup are separate, non-summing indicators.
  const counts: DiskCounts = { total: rows.length, known: 0, unknown: 0, update: 0, broken: 0, dup: 0 };
  for (const row of rows) {
    counts[row.membership] += 1;
    if (row.health.verdict === 'broken') counts.broken += 1;
  }
  for (const unit of units) counts.dup += unit.files.length - 1;

  return { rows, counts };
}

function buildHashRow(unit: HashUnit): DiskRow {
  const key = `h:${unit.hash}`;
  const isDup = unit.files.length > 1;
  const subRows: DiskSubRow[] = isDup
    ? unit.files.map((file) => toSubRow(key, unit, file, unit.hash))
    : [];
  return {
    key,
    kind: isDup ? 'dup' : 'single',
    name: displayNameOf(unit),
    primary: unit.primary,
    contentHash: unit.hash,
    membership: unit.membership,
    moderation: unit.annotation?.status ?? 'unknown',
    health: unit.primary.health,
    annotation: unit.annotation,
    identity: unit.annotation?.identity ?? null,
    updateTarget: unit.membership === 'update' ? updateTargetOf(unit.annotation) : null,
    dupCount: unit.files.length,
    versionCount: 1,
    subRows,
    folder: unit.primary.folder,
    folders: foldersOf(unit.files),
  };
}

function buildVersionGroupRow(identityId: string, group: HashUnit[]): DiskRow {
  // Representative version: canonical > latest > newest file on disk.
  const primaryUnit =
    group.find((u) => u.annotation?.identity?.isCanonical) ??
    group.find((u) => u.annotation?.identity?.isLatest) ??
    [...group].sort((a, b) => b.primary.mtime - a.primary.mtime)[0] ??
    group[0];
  if (!primaryUnit) throw new Error('empty version group');

  const key = `id:${identityId}`;
  // Sub-row order: non-canonical first (oldest file first), canonical last.
  const ordered = [...group].sort((a, b) => {
    const ca = a.annotation?.identity?.isCanonical ? 1 : 0;
    const cb = b.annotation?.identity?.isCanonical ? 1 : 0;
    if (ca !== cb) return ca - cb;
    return a.primary.mtime - b.primary.mtime;
  });

  const subRows: DiskSubRow[] = [];
  for (const unit of ordered) {
    for (const file of unit.files) subRows.push(toSubRow(key, unit, file, primaryUnit.hash));
  }

  const hasCanonical = group.some((u) => u.annotation?.identity?.isCanonical);
  const membership: Membership = hasCanonical ? 'known' : 'update';
  const dupCount = primaryUnit.files.length;
  const allFiles = group.flatMap((u) => u.files);

  return {
    key,
    kind: 'version-group',
    name: displayNameOf(primaryUnit),
    primary: primaryUnit.primary,
    contentHash: primaryUnit.hash,
    membership,
    moderation: 'published',
    health: primaryUnit.primary.health,
    annotation: primaryUnit.annotation,
    identity: primaryUnit.annotation?.identity ?? null,
    updateTarget: membership === 'update' ? updateTargetOf(primaryUnit.annotation) : null,
    dupCount,
    versionCount: group.length,
    subRows,
    folder: primaryUnit.primary.folder,
    folders: foldersOf(allFiles),
  };
}

// ---------------------------------------------------------------------------
// Archive install-state marker (left pane), derived from disk hashes.

export function archiveInstallState(
  card: Pick<MapCardDto, 'versionHashes' | 'canonicalHash'>,
  diskHashes: ReadonlySet<string>,
): InstallState {
  if (diskHashes.has(card.canonicalHash)) return 'have';
  if (card.versionHashes.some((h) => diskHashes.has(h))) return 'newer';
  return 'none';
}

/** The set of distinct content hashes on disk — feed to archiveInstallState. */
export function diskHashSet(scannedFiles: readonly ScannedFile[]): Set<string> {
  const out = new Set<string>();
  for (const f of scannedFiles) out.add(f.contentHash);
  return out;
}

// ---------------------------------------------------------------------------
// Tidy plan (spec §8). PURE derivation — the store quarantines the paths.
//
// Proposable: KNOWN (published) files only —
//   · surplus exact copies of a published hash          → "known · exact duplicate"
//   · non-canonical versions when canonical is on disk  → "known · superseded"
//   · published rows whose health verdict is broken     → "known · broken"
// Protected: unknown maps are NEVER auto-proposed (may be unpublished drafts).

export function buildTidyProposals(rows: readonly DiskRow[]): TidyProposal[] {
  const out: TidyProposal[] = [];
  const propose = (file: ScannedFile, name: string, reason: string): void => {
    if (out.some((p) => p.path === file.path)) return;
    out.push({
      path: file.path,
      fileName: file.fileName,
      name,
      reason,
      contentHash: file.contentHash,
      theater: file.theater,
      dim: file.width !== null && file.height !== null ? Math.max(file.width, file.height) : null,
    });
  };

  for (const row of rows) {
    const published = row.moderation === 'published';
    if (!published) continue; // unknown maps are protected — never auto-proposed

    // Surplus exact copies (dup rows and duplicated members of version groups).
    for (const sub of row.subRows) {
      if (sub.exactCopy && !sub.isPrimary && sub.annotation?.status === 'published') {
        propose(sub.file, row.name, 'known · exact duplicate');
      }
    }

    // Superseded versions — only when the canonical version is also on disk,
    // so tidying never removes the sole copy of a known map.
    if (row.kind === 'version-group' && row.membership === 'known') {
      for (const sub of row.subRows) {
        if (!sub.isCanonical && !sub.exactCopy && sub.annotation?.status === 'published') {
          propose(sub.file, row.name, 'known · superseded');
        }
      }
    }

    // Known broken files.
    if (row.health.verdict === 'broken' && row.kind !== 'version-group') {
      propose(row.primary, row.name, 'known · broken');
    }
  }

  return out;
}
