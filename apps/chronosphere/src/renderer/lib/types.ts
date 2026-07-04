import type { HashAnnotation, HealthReport } from '@antares/shared/types.ts';
import type { ModerationStatus } from '@antares/shared/taxonomy.ts';
import type { ScannedFile } from '../../ipc.ts';

/**
 * The reconciled Your-Disk row model — the app's core data shape. Built by
 * lib/reconcile.ts from ScannedFile[] + per-hash HashAnnotations, consumed by
 * the disk pane, the detail panel, and every flow (tidy/contribute/update).
 */

/** Axis A — membership. Mutually exclusive; the status bar counts these once each. */
export type Membership = 'known' | 'update' | 'unknown';

/** Row shape: one file, an exact-duplicate collapse, or a version group. */
export type DiskRowKind = 'single' | 'dup' | 'version-group';

/** Canonical-version target carried by `update` rows (spec §8: update installs canonical). */
export interface UpdateTarget {
  identityId: string;
  slug: string;
  name: string;
  canonicalVersionId: string;
  canonicalHash: string;
}

/** An indented disclosure sub-row under a dup or version-group row. */
export interface DiskSubRow {
  /** Stable selectable id: `${parentKey}:${path}`. */
  key: string;
  file: ScannedFile;
  contentHash: string;
  membership: Membership;
  health: HealthReport;
  annotation: HashAnnotation | null;
  /** True for the file the parent row itself represents. */
  isPrimary: boolean;
  /** True when this file is an exact content copy of the parent row's primary hash. */
  exactCopy: boolean;
  /** True when this hash is the identity's canonical version (version groups). */
  isCanonical: boolean;
  /** True when this hash is the identity's latest version (version groups). */
  isLatest: boolean;
}

export interface DiskRow {
  /** Stable selectable id: `id:${identityId}` for version groups, `h:${hash}` otherwise. */
  key: string;
  kind: DiskRowKind;
  /** Display name: archive identity name ?? parsed [Basic] name ?? file name sans extension. */
  name: string;
  /** The representative file (dup: shortest filename; version group: canonical > latest > newest). */
  primary: ScannedFile;
  contentHash: string;
  membership: Membership;
  /**
   * Per-hash moderation sub-state. 'published' for known/update rows;
   * 'unknown' | 'in-review' | 'rejected' for unknown rows.
   */
  moderation: ModerationStatus;
  /** Axis B — health passthrough from the primary file's local MapKit report. */
  health: HealthReport;
  annotation: HashAnnotation | null;
  /** Archive identity info when the primary hash is published. */
  identity: NonNullable<HashAnnotation['identity']> | null;
  /** Present on membership 'update' rows — where "Update (chronoshift canonical)" goes. */
  updateTarget: UpdateTarget | null;
  /** Exact content copies of the primary hash on disk (1 = no duplicates). Drives `⧉ ×N`. */
  dupCount: number;
  /** Distinct archive versions of this identity on disk (1 = not a version group). Drives `N versions`. */
  versionCount: number;
  /** Disclosure sub-rows; empty for kind 'single'. */
  subRows: DiskSubRow[];
  /** Game folder of the primary file. */
  folder: string;
  /** Every configured game folder this row has files in. */
  folders: string[];
}

/**
 * Status-bar counts (two-axis rule): known + unknown + update === total —
 * each map (row) counted once by membership. broken (rows whose health verdict
 * is 'broken') and dup (surplus exact copies across all hashes) are separate,
 * non-summing indicators.
 */
export interface DiskCounts {
  total: number;
  known: number;
  unknown: number;
  update: number;
  broken: number;
  dup: number;
}

/** Archive-pane install-state marker, derived from the set of hashes on disk. */
export type InstallState = 'none' | 'have' | 'newer';

/** One line of the Tidy plan (spec §8 — only known superseded/duplicate/broken, never unknown). */
export interface TidyProposal {
  path: string;
  fileName: string;
  name: string;
  /** Verbatim reason line, e.g. "known · exact duplicate". */
  reason: string;
  contentHash: string;
  theater: string | null;
  dim: number | null;
}
