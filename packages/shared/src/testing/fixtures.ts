/**
 * Fixture builder: fabricates valid YR-format .map file bytes. Used by the
 * shared test suite AND by the web seed generator (which runs the fabricated
 * files through the real ingest pipeline).
 */
import { encodePackSection } from '../mapfile/packs.ts';
import { buildPreviewSections } from '../mapfile/preview.ts';
import { THEATER_LABEL_BY_TOKEN } from '../mapfile/parse.ts';

export interface MakeMapFileOptions {
  name: string;
  /** Taxonomy label ('New Urban') or raw game token ('NEWURBAN') — both work. */
  theater: string;
  width: number;
  height: number;
  /** Start waypoints 0..players-1 are written (unless omitStarts). Also [Basic] MaxPlayer=. */
  players: number;
  triggers?: number;
  aiTeams?: number;
  previewRgb?: Uint8Array;
  previewW?: number;
  previewH?: number;
  /** Write an [IsoMapPack5] whose chunk stream is garbage (valid base64, lying header). */
  corruptIsoPack?: boolean;
  /** Leave [Waypoints] empty — no multiplayer start locations. */
  omitStarts?: boolean;
  /** Object ids referenced from the object lists (spread across Structures/Units/Infantry/Aircraft). */
  extraObjects?: string[];
  /** [Basic] GameMode= value (comma list allowed). */
  gameMode?: string;
  /** [Basic] Player= — a campaign human house (marks single-player missions). */
  basicPlayer?: string;
}

const TOKEN_BY_LOWER_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(THEATER_LABEL_BY_TOKEN).map(([token, label]) => [label.toLowerCase(), token]),
);

/** Deterministic pseudo-random bytes (xorshift32) — handy for preview pixels. */
export function seededBytes(length: number, seed: number): Uint8Array {
  let s = seed >>> 0 || 0x9e3779b9;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    out[i] = s & 0xff;
  }
  return out;
}

/** A small synthetic [IsoMapPack5] payload: 11-byte tile structs + 4 padding bytes. */
function makeTileBuffer(width: number, height: number): Uint8Array {
  const tileCount = Math.max(1, Math.min(24, Math.min(width, height)));
  const buf = new Uint8Array(tileCount * 11 + 4); // trailing 4 zero padding bytes, like WAE
  for (let i = 0; i < tileCount; i++) {
    const off = i * 11;
    const x = i + 1;
    const y = i + 1;
    const tileIndex = (i * 7) % 96;
    buf[off] = x & 0xff; //         X (u16 LE)
    buf[off + 1] = (x >> 8) & 0xff;
    buf[off + 2] = y & 0xff; //     Y (u16 LE)
    buf[off + 3] = (y >> 8) & 0xff;
    buf[off + 4] = tileIndex & 0xff; // TileIndex (i32 LE)
    buf[off + 5] = 0;
    buf[off + 6] = 0;
    buf[off + 7] = 0;
    buf[off + 8] = i % 4; //        SubTileIndex
    buf[off + 9] = 0; //            Level
    buf[off + 10] = 0; //           IceGrowth
  }
  return buf;
}

export function makeMapFileBytes(opts: MakeMapFileOptions): Uint8Array {
  const lines: string[] = [];

  // [Preview]/[PreviewPack] go first — the game requires them at the top of
  // the file (WAE MapWriter.MoveSectionToFirst).
  if (opts.previewRgb) {
    if (!opts.previewW || !opts.previewH) {
      throw new RangeError('previewRgb requires previewW and previewH');
    }
    const { preview, previewPack } = buildPreviewSections(opts.previewRgb, opts.previewW, opts.previewH);
    lines.push('[Preview]');
    for (const [key, value] of Object.entries(preview)) lines.push(`${key}=${value}`);
    lines.push('', '[PreviewPack]');
    previewPack.forEach((line, i) => lines.push(`${i + 1}=${line}`));
    lines.push('');
  }

  lines.push('[Basic]');
  lines.push(`Name=${opts.name}`);
  lines.push(`MaxPlayer=${opts.players}`);
  if (opts.gameMode !== undefined) lines.push(`GameMode=${opts.gameMode}`);
  if (opts.basicPlayer !== undefined) lines.push(`Player=${opts.basicPlayer}`);
  lines.push('MultiplayerOnly=1');
  lines.push('Official=no');

  const theaterToken = TOKEN_BY_LOWER_LABEL[opts.theater.toLowerCase()] ?? opts.theater;
  lines.push('', '[Map]');
  lines.push(`Size=0,0,${opts.width},${opts.height}`);
  lines.push(`LocalSize=2,4,${Math.max(1, opts.width - 4)},${Math.max(1, opts.height - 8)}`);
  lines.push(`Theater=${theaterToken}`);

  lines.push('', '[Waypoints]');
  if (!opts.omitStarts) {
    for (let i = 0; i < opts.players; i++) {
      const x = 15 + i * 7;
      const y = 15 + i * 5;
      lines.push(`${i}=${y * 1000 + x}`); // waypoint cell = Y*1000 + X
    }
  }

  const triggers = opts.triggers ?? 0;
  if (triggers > 0) {
    lines.push('', '[Triggers]');
    for (let i = 0; i < triggers; i++) {
      const id = `01${String(i).padStart(6, '0')}`;
      lines.push(`${id}=Neutral,<none>,Trigger ${i},0,1,1,1,0`);
    }
  }

  const aiTeams = opts.aiTeams ?? 0;
  if (aiTeams > 0) {
    lines.push('', '[TeamTypes]');
    for (let i = 0; i < aiTeams; i++) {
      lines.push(`${i}=02${String(i).padStart(6, '0')}`);
    }
  }

  if (opts.extraObjects && opts.extraObjects.length > 0) {
    // Spread ids round-robin across the four object lists; the id is always
    // the second comma field (OWNER,ID,...), matching WAE's MapLoader.
    const byList: Record<string, string[]> = {
      Structures: [],
      Units: [],
      Infantry: [],
      Aircraft: [],
    };
    const listNames = Object.keys(byList) as (keyof typeof byList)[];
    opts.extraObjects.forEach((id, i) => {
      const list = byList[listNames[i % listNames.length]!]!;
      const index = list.length;
      list.push(`${index}=Neutral,${id},256,${10 + i},${12 + i},0,Guard,,0,1,1,0,1,,,,1,0`);
    });
    for (const listName of listNames) {
      const entries = byList[listName]!;
      if (entries.length === 0) continue;
      lines.push('', `[${listName}]`);
      lines.push(...entries);
    }
  }

  lines.push('', '[IsoMapPack5]');
  if (opts.corruptIsoPack) {
    // Valid base64, invalid chunk stream: the header claims 0xffff compressed
    // bytes that are not there.
    lines.push(`1=${Buffer.from([0xff, 0xff, 0x00, 0x20, 1, 2, 3]).toString('base64')}`);
  } else {
    encodePackSection(makeTileBuffer(opts.width, opts.height)).forEach((line, i) =>
      lines.push(`${i + 1}=${line}`),
    );
  }
  lines.push('');

  return Uint8Array.from(Buffer.from(lines.join('\r\n'), 'latin1'));
}
