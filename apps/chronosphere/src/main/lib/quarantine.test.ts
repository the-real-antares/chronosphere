import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isQuarantineJournal, planQuarantine } from './quarantine.ts';

const DEST = '/ud/quarantine/2026-07-03T12-00-00-000Z';

describe('planQuarantine', () => {
  it('preserves file names inside the destination directory', () => {
    const plan = planQuarantine(['/gf/Maps/alpha.map', '/gf/Maps/Custom/beta.yrm'], DEST);
    expect(plan).toEqual([
      { from: '/gf/Maps/alpha.map', to: path.join(DEST, 'alpha.map') },
      { from: '/gf/Maps/Custom/beta.yrm', to: path.join(DEST, 'beta.yrm') },
    ]);
  });

  it('de-duplicates colliding base names as name-2.ext, name-3.ext', () => {
    const plan = planQuarantine(
      ['/a/dupe.map', '/b/dupe.map', '/c/dupe.map'],
      DEST,
    );
    expect(plan.map((p) => path.basename(p.to))).toEqual(['dupe.map', 'dupe-2.map', 'dupe-3.map']);
  });

  it('treats collisions case-insensitively (Windows-safe)', () => {
    const plan = planQuarantine(['/a/Dupe.map', '/b/dupe.MAP'], DEST);
    expect(plan.map((p) => path.basename(p.to))).toEqual(['Dupe.map', 'dupe-2.MAP']);
  });

  it('handles extensionless names', () => {
    const plan = planQuarantine(['/a/README', '/b/README'], DEST);
    expect(plan.map((p) => path.basename(p.to))).toEqual(['README', 'README-2']);
  });
});

describe('isQuarantineJournal', () => {
  const valid = {
    id: '2026-07-03T12-00-00-000Z',
    createdAt: '2026-07-03T12:00:00.000Z',
    entries: [{ from: '/gf/Maps/a.map', to: `${DEST}/a.map` }],
  };

  it('accepts the journal shape written by quarantineFiles', () => {
    expect(isQuarantineJournal(valid)).toBe(true);
    expect(isQuarantineJournal({ ...valid, entries: [] })).toBe(true);
  });

  it('rejects journals with a missing or malformed entries list', () => {
    expect(isQuarantineJournal({ ...valid, entries: undefined })).toBe(false);
    expect(isQuarantineJournal({ ...valid, entries: [{ from: '/only-from.map' }] })).toBe(false);
    expect(isQuarantineJournal({ ...valid, entries: [{ from: 1, to: 2 }] })).toBe(false);
  });

  it('rejects non-objects and journals missing id/createdAt', () => {
    expect(isQuarantineJournal(null)).toBe(false);
    expect(isQuarantineJournal('journal')).toBe(false);
    expect(isQuarantineJournal({ createdAt: valid.createdAt, entries: [] })).toBe(false);
    expect(isQuarantineJournal({ id: valid.id, entries: [] })).toBe(false);
  });
});
