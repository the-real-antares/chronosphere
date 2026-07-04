import { describe, expect, it } from 'vitest';
import { IniFile } from '../src/mapfile/ini.ts';
import { MapParseError, parseMapFile } from '../src/mapfile/parse.ts';
import { makeMapFileBytes, seededBytes } from '../src/testing/fixtures.ts';

describe('parseMapFile on a full fixture map', () => {
  const previewRgb = seededBytes(12 * 8 * 3, 0xace);
  const bytes = makeMapFileBytes({
    name: 'Coldest Front',
    theater: 'Snow',
    width: 80,
    height: 60,
    players: 4,
    triggers: 3,
    aiTeams: 2,
    previewRgb,
    previewW: 12,
    previewH: 8,
    extraObjects: ['GAWEAP', 'NAMODX', 'BRUTE', 'ORCA'],
    gameMode: 'Standard, MegaWealth',
  });
  const parsed = parseMapFile(bytes);

  it('exposes the IniFile', () => {
    expect(parsed.ini).toBeInstanceOf(IniFile);
    expect(parsed.ini.get('Basic', 'Name')).toBe('Coldest Front');
  });

  it('reads [Basic] Name', () => {
    expect(parsed.name).toBe('Coldest Front');
    expect(parsed.basic['Name']).toBe('Coldest Front');
    expect(parsed.basic['MaxPlayer']).toBe('4');
  });

  it('maps the theater token to its label', () => {
    expect(parsed.theater).toBe('Snow');
  });

  it('reads [Map] Size', () => {
    expect(parsed.width).toBe(80);
    expect(parsed.height).toBe(60);
  });

  it('collects start waypoints 0..7 and derives maxPlayers', () => {
    expect(parsed.startWaypoints).toEqual([0, 1, 2, 3]);
    expect(parsed.maxPlayers).toBe(4);
  });

  it('lowercases the GameMode list', () => {
    expect(parsed.gameModes).toEqual(['standard', 'megawealth']);
  });

  it('reads the preview size and pack presence', () => {
    expect(parsed.previewSize).toEqual({ width: 12, height: 8 });
    expect(parsed.hasPreviewPack).toBe(true);
    expect(parsed.hasIsoMapPack).toBe(true);
  });

  it('counts triggers and AI teams', () => {
    expect(parsed.triggerCount).toBe(3);
    expect(parsed.aiTeamCount).toBe(2);
  });

  it('collects referenced object ids from all four object lists', () => {
    expect([...parsed.referencedObjects].sort()).toEqual(['BRUTE', 'GAWEAP', 'NAMODX', 'ORCA']);
  });

  it('validates the IsoMapPack5 data', () => {
    expect(parsed.isoMapPackValid).toBe(true);
  });
});

describe('parseMapFile edge cases', () => {
  it('throws MapParseError on non-INI garbage', () => {
    const garbage = new Uint8Array(1000);
    for (let i = 0; i < garbage.length; i++) garbage[i] = i & 0xff;
    expect(() => parseMapFile(garbage)).toThrow(MapParseError);
  });

  it('throws MapParseError on an empty file', () => {
    expect(() => parseMapFile(new Uint8Array(0))).toThrow(MapParseError);
  });

  it('falls back to [Basic] MaxPlayer when there are no start waypoints', () => {
    const parsed = parseMapFile(
      makeMapFileBytes({ name: 'Starless', theater: 'Urban', width: 50, height: 50, players: 6, omitStarts: true }),
    );
    expect(parsed.startWaypoints).toEqual([]);
    expect(parsed.maxPlayers).toBe(6);
  });

  it('returns null maxPlayers when neither waypoints nor MaxPlayer exist', () => {
    const text = '[Basic]\nName=Bare\n[Map]\nSize=0,0,30,30\nTheater=SNOW\n';
    const parsed = parseMapFile(Uint8Array.from(Buffer.from(text, 'latin1')));
    expect(parsed.maxPlayers).toBeNull();
    expect(parsed.gameModes).toEqual([]);
    expect(parsed.hasIsoMapPack).toBe(false);
    expect(parsed.isoMapPackValid).toBeNull();
    expect(parsed.previewSize).toBeNull();
    expect(parsed.triggerCount).toBe(0);
    expect(parsed.aiTeamCount).toBe(0);
    expect(parsed.referencedObjects).toEqual([]);
  });

  it('maps NEWURBAN → "New Urban" and passes unknown theaters through', () => {
    const newUrban = parseMapFile(
      makeMapFileBytes({ name: 'NU', theater: 'New Urban', width: 40, height: 40, players: 2 }),
    );
    expect(newUrban.theater).toBe('New Urban');

    const custom = parseMapFile(
      makeMapFileBytes({ name: 'Odd', theater: 'MARS', width: 40, height: 40, players: 2 }),
    );
    expect(custom.theater).toBe('MARS');
  });

  it('flags a corrupt IsoMapPack5', () => {
    const parsed = parseMapFile(
      makeMapFileBytes({ name: 'Broken', theater: 'Desert', width: 40, height: 40, players: 2, corruptIsoPack: true }),
    );
    expect(parsed.hasIsoMapPack).toBe(true);
    expect(parsed.isoMapPackValid).toBe(false);
  });

  it('reports null width/height for a malformed [Map] Size', () => {
    const text = '[Basic]\nName=x\n[Map]\nSize=0,0,broken\nTheater=SNOW\n';
    const parsed = parseMapFile(Uint8Array.from(Buffer.from(text, 'latin1')));
    expect(parsed.width).toBeNull();
    expect(parsed.height).toBeNull();
  });
});

describe('IniFile basics', () => {
  it('parses sections, keys, comments and trims values', () => {
    const ini = IniFile.parse('; header comment\n[Alpha]\nA = 1 \nB=two\n\n[Beta]\nA=3\n');
    expect(ini.sectionNames()).toEqual(['Alpha', 'Beta']);
    expect(ini.section('Alpha')).toMatchObject({ A: '1', B: 'two' });
    expect(ini.get('Beta', 'A')).toBe('3');
    expect(ini.get('Beta', 'missing')).toBeUndefined();
    expect(ini.section('Gamma')).toBeUndefined();
  });

  it('merges duplicate sections and lets the last duplicate key win', () => {
    const ini = IniFile.parse('[S]\nA=1\n[S]\nB=2\nA=3\n');
    expect(ini.section('S')).toMatchObject({ A: '3', B: '2' });
  });
});
