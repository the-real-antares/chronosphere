import { describe, expect, it } from 'vitest';
import type { MapCardDto } from '@antares/shared/types.ts';
import {
  archiveMetaLine,
  diskMetaLine,
  folderTail,
  formatCompact,
  formatCount,
  formatDateMonth,
  formatKb,
  formatRelative,
  healthChipLabel,
  playersLabel,
  sizeChipLabel,
  starString,
  teamChipLabel,
  typeLabel,
} from './format.ts';

function card(over: Partial<MapCardDto> = {}): MapCardDto {
  return {
    identityId: 'i1',
    slug: 'antares-station',
    name: 'Antares Station',
    author: 'Antares',
    authorId: 'antares',
    type: 'multiplayer',
    theater: 'Snow',
    width: 130,
    height: 130,
    sizeClass: 'large',
    maxPlayers: 4,
    teamLayout: { value: '2v2', confidence: 'high' },
    tags: [],
    downloads: 24900,
    rating: 4.6,
    reviewCount: 128,
    fileSizeKb: 223,
    dateAdded: '2024-11-05T00:00:00.000Z',
    healthVerdict: 'verified',
    thumbnailUrl: null,
    versionHashes: ['a'],
    canonicalHash: 'a',
    latestHash: 'a',
    ...over,
  };
}

describe('format', () => {
  it('formatKb', () => {
    expect(formatKb(312)).toBe('312 KB');
    expect(formatKb(223.4)).toBe('223 KB');
    expect(formatKb(2048)).toBe('2 MB');
    expect(formatKb(1228.8)).toBe('1.2 MB');
  });

  it('formatCount / formatCompact', () => {
    expect(formatCount(24900)).toBe('24,900');
    expect(formatCompact(24900)).toBe('24.9k');
    expect(formatCompact(950)).toBe('950');
    expect(formatCompact(1_200_000)).toBe('1.2M');
  });

  it('formatDateMonth', () => {
    expect(formatDateMonth('2024-11-05T00:00:00.000Z')).toBe('Nov 2024');
    expect(formatDateMonth('nonsense')).toBe('—');
  });

  it('formatRelative', () => {
    const now = Date.UTC(2026, 6, 3);
    expect(formatRelative(now - 30_000, now)).toBe('just now');
    expect(formatRelative(now - 3 * 24 * 3600_000, now)).toBe('3 days ago');
    expect(formatRelative(now - 14 * 24 * 3600_000, now)).toBe('2 weeks ago');
    expect(formatRelative(now - 70 * 24 * 3600_000, now)).toBe('2 months ago');
  });

  it('stars', () => {
    expect(starString(4.6)).toBe('★★★★★');
    expect(starString(4.3)).toBe('★★★★☆');
    expect(starString(0)).toBe('☆☆☆☆☆');
  });

  it('labels', () => {
    expect(typeLabel('coop-mission')).toBe('Co-op mission');
    expect(typeLabel('custom-mode')).toBe('Custom mode');
    expect(teamChipLabel({ value: '2v2', confidence: 'high' })).toBe('likely 2v2');
    expect(teamChipLabel({ value: 'ffa', confidence: 'medium' })).toBe('likely FFA ⓘ');
    expect(teamChipLabel({ value: '2v2', confidence: 'low' })).toBe('likely 2v2 ⓘ?');
    expect(sizeChipLabel('medium', 120, 120)).toBe('Medium · 120×120');
    expect(playersLabel(null)).toBe('Mission');
    expect(healthChipLabel('needs-mod')).toBe('⊘ needs a mod');
    expect(healthChipLabel('broken')).toBe('⚠ broken');
  });

  it('archive meta line matches the site pattern', () => {
    expect(archiveMetaLine(card())).toBe('4P · Snow · 2v2 · 130×130 · by Antares');
    expect(archiveMetaLine(card({ maxPlayers: null, teamLayout: null, author: null }))).toBe(
      'Mission · Snow · — · 130×130 · source unknown',
    );
  });

  it('disk meta line matches the prototype pattern', () => {
    expect(
      diskMetaLine({ membership: 'known', healthVerdict: 'verified', maxPlayers: 8, theater: 'Snow' }),
    ).toBe('known · verified · 8P · Snow');
    expect(
      diskMetaLine({
        membership: 'known',
        healthVerdict: 'needs-mod',
        maxPlayers: 2,
        theater: 'Urban',
        mod: 'Mental Omega',
      }),
    ).toBe('known · needs a mod · 2P · Urban · needs Mental Omega');
  });

  it('folderTail', () => {
    expect(folderTail('/Users/x/Westwood/RA2/Yuri')).toBe('…/Yuri');
    expect(folderTail('C:\\Games\\CnCNet\\Yuri')).toBe('…/Yuri');
  });
});
