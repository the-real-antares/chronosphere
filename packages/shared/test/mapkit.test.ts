import { describe, expect, it } from 'vitest';
import { MAPKIT_VERSION, analyzeMap, analyzeParsed } from '../src/mapkit/index.ts';
import { parseMapFile } from '../src/mapfile/parse.ts';
import { makeMapFileBytes } from '../src/testing/fixtures.ts';

const base = { name: 'Test', theater: 'Temperate', width: 90, height: 90, players: 4 } as const;

describe('MapKit verdicts', () => {
  it('verified: a healthy map with empty findings and full metrics', () => {
    const report = analyzeMap(makeMapFileBytes({ ...base, triggers: 10, aiTeams: 5 }));
    expect(report.verdict).toBe('verified');
    expect(report.findings).toEqual([]);
    expect(report.metrics).toEqual({ triggers: 10, aiTeams: 5, width: 90, height: 90 });
    expect(report.mapkitVersion).toBe(MAPKIT_VERSION);
  });

  it('broken: unparseable file', () => {
    const report = analyzeMap(Uint8Array.from(Buffer.from('PK not a map at all')));
    expect(report.verdict).toBe('broken');
    expect(report.findings).toEqual(['unreadable map file']);
    expect(report.mapkitVersion).toBe(MAPKIT_VERSION);
  });

  it('broken: missing [Map] Size and missing tile data', () => {
    const parsed = parseMapFile(Uint8Array.from(Buffer.from('[Basic]\nName=Empty\n', 'latin1')));
    const report = analyzeParsed(parsed);
    expect(report.verdict).toBe('broken');
    expect(report.findings).toContain('missing or invalid [Map] Size');
    expect(report.findings).toContain('no tile data ([IsoMapPack5] missing)');
    expect(report.findings).toContain('no start locations');
  });

  it('broken: corrupt IsoMapPack5 → "corrupt tile data"', () => {
    const report = analyzeMap(makeMapFileBytes({ ...base, corruptIsoPack: true }));
    expect(report.verdict).toBe('broken');
    expect(report.findings).toEqual(['corrupt tile data']);
  });

  it('broken: no start waypoints and no [Basic] Player= → "no start locations"', () => {
    const report = analyzeMap(makeMapFileBytes({ ...base, omitStarts: true }));
    expect(report.verdict).toBe('broken');
    expect(report.findings).toEqual(['no start locations']);
  });

  it('not broken: no start waypoints but [Basic] Player= names a campaign human house', () => {
    const report = analyzeMap(makeMapFileBytes({ ...base, omitStarts: true, basicPlayer: 'Americans' }));
    expect(report.verdict).toBe('verified');
    expect(report.findings).toEqual([]);
  });

  it('needs-mod: referenced objects missing from knownObjects, up to 5 listed', () => {
    const bytes = makeMapFileBytes({
      ...base,
      extraObjects: ['GACNST', 'MOD1', 'MOD2', 'MOD3', 'MOD4', 'MOD5', 'MOD6', 'MOD7'],
    });
    const report = analyzeMap(bytes, { knownObjects: new Set(['GACNST']) });
    expect(report.verdict).toBe('needs-mod');
    expect(report.findings).toHaveLength(1);
    const finding = report.findings[0]!;
    expect(finding).toContain('references missing art → needs a mod');
    // Exactly 5 of the 7 missing ids are listed (in file discovery order).
    expect(finding.match(/MOD\d/g)).toHaveLength(5);
    expect(finding).toContain('(+2 more)');
    expect(finding).not.toContain('GACNST');
  });

  it('needs-mod detection is skipped without knownObjects', () => {
    const bytes = makeMapFileBytes({ ...base, extraObjects: ['TOTALLYMODDED'] });
    expect(analyzeMap(bytes).verdict).toBe('verified');
  });

  it('verified when every referenced object is known', () => {
    const bytes = makeMapFileBytes({ ...base, extraObjects: ['GACNST', 'GAWEAP'] });
    const report = analyzeMap(bytes, { knownObjects: new Set(['GACNST', 'GAWEAP']) });
    expect(report.verdict).toBe('verified');
  });

  it('broken wins over needs-mod (never demoted)', () => {
    const bytes = makeMapFileBytes({ ...base, corruptIsoPack: true, extraObjects: ['MODTNK'] });
    const report = analyzeMap(bytes, { knownObjects: new Set(['GACNST']) });
    expect(report.verdict).toBe('broken');
  });

  it('heavy: trigger and AI-team thresholds, combined into one finding', () => {
    const report = analyzeMap(makeMapFileBytes({ ...base, triggers: 312, aiTeams: 40 }));
    expect(report.verdict).toBe('heavy');
    expect(report.findings).toEqual(['312 triggers · 40 AI teams']);
    expect(report.metrics).toEqual({ triggers: 312, aiTeams: 40, width: 90, height: 90 });
  });

  it('heavy: at exactly the boundary values', () => {
    expect(analyzeMap(makeMapFileBytes({ ...base, triggers: 250 })).verdict).toBe('heavy');
    expect(analyzeMap(makeMapFileBytes({ ...base, triggers: 249 })).verdict).toBe('verified');
    expect(analyzeMap(makeMapFileBytes({ ...base, aiTeams: 35 })).verdict).toBe('heavy');
    expect(analyzeMap(makeMapFileBytes({ ...base, aiTeams: 34 })).verdict).toBe('verified');
  });

  it('heavy: 150×150 cells', () => {
    const report = analyzeMap(makeMapFileBytes({ ...base, width: 150, height: 150 }));
    expect(report.verdict).toBe('heavy');
    expect(report.findings).toEqual(['150×150 cells']);
    expect(analyzeMap(makeMapFileBytes({ ...base, width: 149, height: 150 })).verdict).toBe('verified');
  });

  it('needs-mod wins over heavy (rule order)', () => {
    const bytes = makeMapFileBytes({ ...base, triggers: 400, extraObjects: ['MODTNK'] });
    const report = analyzeMap(bytes, { knownObjects: new Set(['GACNST']) });
    expect(report.verdict).toBe('needs-mod');
  });
});
