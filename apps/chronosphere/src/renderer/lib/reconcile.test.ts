import { describe, expect, it } from 'vitest';
import type { HashAnnotation, HealthReport } from '@antares/shared/types.ts';
import type { HealthVerdict } from '@antares/shared/taxonomy.ts';
import type { ScannedFile } from '../../ipc.ts';
import { archiveInstallState, buildDiskRows, buildTidyProposals, diskHashSet } from './reconcile.ts';

// ---------------------------------------------------------------------------
// Fixtures

function health(verdict: HealthVerdict = 'verified'): HealthReport {
  return { verdict, findings: [], mapkitVersion: '1.0.0' };
}

function file(over: Partial<ScannedFile> & { path: string; contentHash: string }): ScannedFile {
  return {
    folder: '/game/Yuri',
    fileName: over.path.split('/').pop() ?? over.path,
    bytes: 1000,
    mtime: 1_700_000_000_000,
    name: null,
    theater: 'Snow',
    width: 130,
    height: 130,
    maxPlayers: 4,
    health: health(),
    previewAvailable: true,
    ...over,
  };
}

function annotation(over: {
  contentHash: string;
  status?: HashAnnotation['status'];
  identityId?: string;
  name?: string;
  isCanonical?: boolean;
  isLatest?: boolean;
  canonicalHash?: string;
}): HashAnnotation {
  const status = over.status ?? 'published';
  if (status !== 'published') return { contentHash: over.contentHash, status };
  return {
    contentHash: over.contentHash,
    status,
    identity: {
      identityId: over.identityId ?? 'id-1',
      slug: 'some-map',
      name: over.name ?? 'Some Map',
      versionId: `v-${over.contentHash}`,
      isCanonical: over.isCanonical ?? true,
      isLatest: over.isLatest ?? over.isCanonical ?? true,
      canonicalVersionId: 'v-canon',
      canonicalHash: over.canonicalHash ?? over.contentHash,
    },
  };
}

function annMap(...anns: HashAnnotation[]): Map<string, HashAnnotation> {
  return new Map(anns.map((a) => [a.contentHash, a]));
}

// ---------------------------------------------------------------------------
// Membership

describe('membership', () => {
  it('published + canonical → known', () => {
    const { rows, counts } = buildDiskRows(
      [file({ path: '/game/Yuri/Maps/a.map', contentHash: 'aaa' })],
      annMap(annotation({ contentHash: 'aaa', isCanonical: true, name: 'Alpha' })),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.membership).toBe('known');
    expect(rows[0]?.moderation).toBe('published');
    expect(rows[0]?.name).toBe('Alpha');
    expect(rows[0]?.updateTarget).toBeNull();
    expect(counts).toEqual({ total: 1, known: 1, unknown: 0, update: 0, broken: 0, dup: 0 });
  });

  it('published but not canonical → update, carrying the canonical target', () => {
    const { rows } = buildDiskRows(
      [file({ path: '/game/Yuri/Maps/a.map', contentHash: 'old' })],
      annMap(
        annotation({ contentHash: 'old', isCanonical: false, isLatest: false, canonicalHash: 'new', name: 'Alpha' }),
      ),
    );
    expect(rows[0]?.membership).toBe('update');
    expect(rows[0]?.updateTarget).toMatchObject({ canonicalHash: 'new', slug: 'some-map', name: 'Alpha' });
  });

  it('unannotated → unknown with moderation sub-state "unknown"', () => {
    const { rows } = buildDiskRows([file({ path: '/g/Maps/x.map', contentHash: 'xxx' })], new Map());
    expect(rows[0]?.membership).toBe('unknown');
    expect(rows[0]?.moderation).toBe('unknown');
    expect(rows[0]?.identity).toBeNull();
  });

  it('in-review / rejected hashes stay unknown but carry the sub-state', () => {
    const { rows, counts } = buildDiskRows(
      [
        file({ path: '/g/Maps/q.map', contentHash: 'q1' }),
        file({ path: '/g/Maps/r.map', contentHash: 'r1' }),
      ],
      annMap(
        annotation({ contentHash: 'q1', status: 'in-review' }),
        annotation({ contentHash: 'r1', status: 'rejected' }),
      ),
    );
    const byHash = new Map(rows.map((r) => [r.contentHash, r]));
    expect(byHash.get('q1')?.membership).toBe('unknown');
    expect(byHash.get('q1')?.moderation).toBe('in-review');
    expect(byHash.get('r1')?.moderation).toBe('rejected');
    expect(counts.unknown).toBe(2);
  });

  it('falls back to parsed name, then file name sans extension', () => {
    const { rows } = buildDiskRows(
      [
        file({ path: '/g/Maps/parsed.map', contentHash: 'p1', name: 'Parsed Name' }),
        file({ path: '/g/Maps/coolmap_2009.map', contentHash: 'p2', name: null }),
      ],
      new Map(),
    );
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(['Parsed Name', 'coolmap_2009']);
  });
});

// ---------------------------------------------------------------------------
// Exact-duplicate collapse

describe('exact-duplicate collapse', () => {
  const dupFiles = [
    file({ path: '/g/Maps/backyard_final.map', contentHash: 'dup' }),
    file({ path: '/g/Maps/bybrawl.map', contentHash: 'dup' }),
    file({ path: '/g/Maps/Custom/bb (2).map', contentHash: 'dup' }),
  ];

  it('same hash, many paths → ONE row with dupCount and sub-rows', () => {
    const { rows, counts } = buildDiskRows(dupFiles, new Map());
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.kind).toBe('dup');
    expect(row?.dupCount).toBe(3);
    expect(row?.subRows).toHaveLength(3);
    // Each map counted once by membership; surplus copies are the dup count.
    expect(counts).toEqual({ total: 1, known: 0, unknown: 1, update: 0, broken: 0, dup: 2 });
  });

  it('primary = shortest filename', () => {
    const { rows } = buildDiskRows(dupFiles, new Map());
    expect(rows[0]?.primary.fileName).toBe('bb (2).map'); // 10 chars — shortest
    const primarySub = rows[0]?.subRows.find((s) => s.isPrimary);
    expect(primarySub?.file.fileName).toBe('bb (2).map');
    expect(rows[0]?.subRows.filter((s) => s.exactCopy)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Version groups

describe('version groups', () => {
  const meridian = (hash: string, p: string, mtime: number) =>
    file({ path: p, contentHash: hash, mtime });

  it('multiple hashes of one identity → one identity row with disclosure sub-rows', () => {
    const { rows, counts } = buildDiskRows(
      [
        meridian('v1', '/g/Maps/meridian_v1.map', 1),
        meridian('v2', '/g/Maps/meridian_v2.map', 2),
        meridian('vF', '/g/Maps/meridian_FINAL.map', 3),
      ],
      annMap(
        annotation({ contentHash: 'v1', identityId: 'mer', name: 'Meridian Locks', isCanonical: false, isLatest: false, canonicalHash: 'vF' }),
        annotation({ contentHash: 'v2', identityId: 'mer', name: 'Meridian Locks', isCanonical: false, isLatest: false, canonicalHash: 'vF' }),
        annotation({ contentHash: 'vF', identityId: 'mer', name: 'Meridian Locks', isCanonical: true, isLatest: true, canonicalHash: 'vF' }),
      ),
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.kind).toBe('version-group');
    expect(row?.versionCount).toBe(3);
    expect(row?.subRows).toHaveLength(3);
    // Canonical on disk → the group reads as known, represented by the canonical file.
    expect(row?.membership).toBe('known');
    expect(row?.contentHash).toBe('vF');
    // Canonical sub-row is last.
    expect(row?.subRows[2]?.isCanonical).toBe(true);
    expect(counts).toEqual({ total: 1, known: 1, unknown: 0, update: 0, broken: 0, dup: 0 });
  });

  it('no canonical on disk → group is an update pointing at canonical', () => {
    const { rows, counts } = buildDiskRows(
      [
        meridian('v1', '/g/Maps/meridian_v1.map', 1),
        meridian('v2', '/g/Maps/meridian_v2.map', 2),
      ],
      annMap(
        annotation({ contentHash: 'v1', identityId: 'mer', name: 'Meridian Locks', isCanonical: false, isLatest: false, canonicalHash: 'vF' }),
        annotation({ contentHash: 'v2', identityId: 'mer', name: 'Meridian Locks', isCanonical: false, isLatest: true, canonicalHash: 'vF' }),
      ),
    );
    const row = rows[0];
    expect(row?.membership).toBe('update');
    expect(row?.updateTarget?.canonicalHash).toBe('vF');
    // Latest-on-disk represents the group when canonical is absent.
    expect(row?.contentHash).toBe('v2');
    expect(counts.update).toBe(1);
  });

  it('a duplicated member contributes to the dup count', () => {
    const { rows, counts } = buildDiskRows(
      [
        meridian('v2', '/g/Maps/meridian_v2.map', 2),
        meridian('v2', '/g/Maps/Custom/meridian_copy.map', 2),
        meridian('vF', '/g/Maps/meridian_FINAL.map', 3),
      ],
      annMap(
        annotation({ contentHash: 'v2', identityId: 'mer', name: 'Meridian Locks', isCanonical: false, isLatest: false, canonicalHash: 'vF' }),
        annotation({ contentHash: 'vF', identityId: 'mer', name: 'Meridian Locks', isCanonical: true, isLatest: true, canonicalHash: 'vF' }),
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subRows).toHaveLength(3);
    expect(counts.dup).toBe(1);
    expect(counts.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Counts / two-axis rule

describe('counts (two-axis rule)', () => {
  it('membership counts sum to total; broken and dup are separate', () => {
    const files = [
      file({ path: '/g/Maps/known.map', contentHash: 'k1' }),
      file({ path: '/g/Maps/update.map', contentHash: 'u1' }),
      file({ path: '/g/Maps/unknown-broken.map', contentHash: 'x1', health: health('broken') }),
      file({ path: '/g/Maps/dup-a.map', contentHash: 'd1' }),
      file({ path: '/g/Maps/dup-b.map', contentHash: 'd1' }),
    ];
    const { counts } = buildDiskRows(
      files,
      annMap(
        annotation({ contentHash: 'k1', identityId: 'A', isCanonical: true }),
        annotation({ contentHash: 'u1', identityId: 'B', isCanonical: false, isLatest: false, canonicalHash: 'zz' }),
      ),
    );
    expect(counts.total).toBe(4);
    expect(counts.known + counts.unknown + counts.update).toBe(counts.total);
    expect(counts.broken).toBe(1); // separate indicator — the broken map is still counted under unknown
    expect(counts.unknown).toBe(2);
    expect(counts.dup).toBe(1);
  });

  it('health passes through from the primary file', () => {
    const { rows } = buildDiskRows(
      [file({ path: '/g/Maps/heavy.map', contentHash: 'h1', health: health('heavy') })],
      annMap(annotation({ contentHash: 'h1', isCanonical: true })),
    );
    expect(rows[0]?.health.verdict).toBe('heavy');
    expect(rows[0]?.membership).toBe('known');
  });
});

// ---------------------------------------------------------------------------
// Archive install state

describe('archiveInstallState', () => {
  const card = { versionHashes: ['v1', 'v2', 'v3'], canonicalHash: 'v3' };
  it('canonical hash on disk → have', () => {
    expect(archiveInstallState(card, new Set(['v3']))).toBe('have');
  });
  it('older version on disk → newer', () => {
    expect(archiveInstallState(card, new Set(['v1']))).toBe('newer');
  });
  it('nothing on disk → none', () => {
    expect(archiveInstallState(card, new Set(['zz']))).toBe('none');
  });
  it('diskHashSet collects distinct hashes', () => {
    const set = diskHashSet([
      file({ path: '/a.map', contentHash: 'x' }),
      file({ path: '/b.map', contentHash: 'x' }),
      file({ path: '/c.map', contentHash: 'y' }),
    ]);
    expect([...set].sort()).toEqual(['x', 'y']);
  });
});

// ---------------------------------------------------------------------------
// Tidy plan

describe('buildTidyProposals', () => {
  it('proposes known duplicates, superseded versions, and known broken — never unknown', () => {
    const files = [
      // known dup ×3 → 2 proposals
      file({ path: '/g/Maps/bybrawl.map', contentHash: 'dup', mtime: 1 }),
      file({ path: '/g/Maps/backyard_final.map', contentHash: 'dup', mtime: 1 }),
      file({ path: '/g/Maps/Custom/bb (2).map', contentHash: 'dup', mtime: 1 }),
      // version group with canonical on disk → v1 proposed
      file({ path: '/g/Maps/meridian_v1.map', contentHash: 'v1', mtime: 1 }),
      file({ path: '/g/Maps/meridian_FINAL.map', contentHash: 'vF', mtime: 2 }),
      // known broken → proposed
      file({ path: '/g/Maps/busted.map', contentHash: 'br', health: health('broken') }),
      // unknown but valid → PROTECTED
      file({ path: '/g/Maps/final_FINAL_v3.map', contentHash: 'unk' }),
      // unknown AND broken → still protected (unknown is never auto-proposed)
      file({ path: '/g/Maps/coolmap_2009.map', contentHash: 'ub', health: health('broken') }),
    ];
    const { rows } = buildDiskRows(
      files,
      annMap(
        annotation({ contentHash: 'dup', identityId: 'bb', name: 'Backyard Brawl', isCanonical: true }),
        annotation({ contentHash: 'v1', identityId: 'mer', name: 'Meridian Locks', isCanonical: false, isLatest: false, canonicalHash: 'vF' }),
        annotation({ contentHash: 'vF', identityId: 'mer', name: 'Meridian Locks', isCanonical: true, isLatest: true, canonicalHash: 'vF' }),
        annotation({ contentHash: 'br', identityId: 'bu', name: 'Busted', isCanonical: true }),
      ),
    );
    const proposals = buildTidyProposals(rows);
    const byPath = new Map(proposals.map((p) => [p.path, p.reason]));

    expect(byPath.get('/g/Maps/backyard_final.map')).toBe('known · exact duplicate');
    expect(byPath.get('/g/Maps/bybrawl.map')).toBe('known · exact duplicate');
    expect(byPath.has('/g/Maps/Custom/bb (2).map')).toBe(false); // the kept (shortest-name) primary
    expect(byPath.get('/g/Maps/meridian_v1.map')).toBe('known · superseded');
    expect(byPath.has('/g/Maps/meridian_FINAL.map')).toBe(false); // canonical is kept
    expect(byPath.get('/g/Maps/busted.map')).toBe('known · broken');
    expect(byPath.has('/g/Maps/final_FINAL_v3.map')).toBe(false); // protected
    expect(byPath.has('/g/Maps/coolmap_2009.map')).toBe(false); // unknown broken → protected too
    expect(proposals).toHaveLength(4);
  });

  it('does not propose superseded versions when canonical is NOT on disk', () => {
    const { rows } = buildDiskRows(
      [
        file({ path: '/g/Maps/meridian_v1.map', contentHash: 'v1', mtime: 1 }),
        file({ path: '/g/Maps/meridian_v2.map', contentHash: 'v2', mtime: 2 }),
      ],
      annMap(
        annotation({ contentHash: 'v1', identityId: 'mer', isCanonical: false, isLatest: false, canonicalHash: 'vF' }),
        annotation({ contentHash: 'v2', identityId: 'mer', isCanonical: false, isLatest: true, canonicalHash: 'vF' }),
      ),
    );
    expect(buildTidyProposals(rows)).toHaveLength(0);
  });
});
