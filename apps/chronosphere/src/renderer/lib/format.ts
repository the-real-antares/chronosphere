import {
  HEALTH_GLYPHS,
  MAP_TYPE_LABELS,
  type Confidence,
  type HealthVerdict,
  type MapType,
  type SizeClass,
  type TeamLayout,
} from '@antares/shared/taxonomy.ts';
import type { MapCardDto, TeamLayoutSuggestion } from '@antares/shared/types.ts';

/**
 * Display formatting helpers — the site's/prototype's exact string patterns.
 * All pure; middots (·), em-dashes (—) and glyphs are load-bearing.
 */

// ---------------------------------------------------------------------------
// Numbers

/** 312 → "312 KB"; ≥1024 KB → "1.2 MB". */
export function formatKb(kb: number): string {
  if (kb >= 1024) {
    const mb = kb / 1024;
    return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
  }
  return `${Math.round(kb)} KB`;
}

/** 24900 → "24,900". */
export function formatCount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** 24900 → "24.9k" (archive-row downloads); < 1000 stays as-is. */
export function formatCompact(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  const m = n / 1_000_000;
  return `${m >= 100 ? Math.round(m) : Math.round(m * 10) / 10}M`;
}

// ---------------------------------------------------------------------------
// Dates

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ISO date → "Nov 2024". Bad input → "—". */
export function formatDateMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${MONTHS[d.getMonth()] ?? '—'} ${d.getFullYear()}`;
}

/** Epoch ms or ISO → "just now" / "3 days ago" / "2 weeks ago" / "4 months ago". */
export function formatRelative(when: number | string, now = Date.now()): string {
  const t = typeof when === 'number' ? when : new Date(when).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? '1 minute ago' : `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
  const d = Math.floor(h / 24);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return w === 1 ? '1 week ago' : `${w} weeks ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return mo <= 1 ? '1 month ago' : `${mo} months ago`;
  const y = Math.floor(d / 365);
  return y <= 1 ? '1 year ago' : `${y} years ago`;
}

// ---------------------------------------------------------------------------
// Stars & ratings

/** 4.3 → "★★★★☆" (rounded to nearest star, padded to 5). */
export function starString(rating: number): string {
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

/** 4.6 → "4.6". */
export function formatRating(rating: number): string {
  return rating.toFixed(1);
}

// ---------------------------------------------------------------------------
// Labels

/** Shared type labels — "Co-op mission", never the prototype's short forms. */
export function typeLabel(type: MapType): string {
  return MAP_TYPE_LABELS[type];
}

export function teamLabel(team: TeamLayout): string {
  return team === 'ffa' ? 'FFA' : team;
}

/** "likely 2v2" + confidence cue: high → '', medium → ' ⓘ', low → ' ⓘ?'. */
export function teamChipLabel(suggestion: TeamLayoutSuggestion): string {
  const suffix: Record<Confidence, string> = { high: '', medium: ' ⓘ', low: ' ⓘ?' };
  return `likely ${teamLabel(suggestion.value)}${suffix[suggestion.confidence]}`;
}

const SIZE_WORD: Record<SizeClass, string> = { small: 'Small', medium: 'Medium', large: 'Large' };

/** "Medium · 130×130". */
export function sizeChipLabel(sizeClass: SizeClass, width: number, height: number): string {
  return `${SIZE_WORD[sizeClass]} · ${width}×${height}`;
}

/** "4P", or "Mission" when maxPlayers is null. */
export function playersLabel(maxPlayers: number | null): string {
  return maxPlayers === null ? 'Mission' : `${maxPlayers}P`;
}

/** "by Antares" / "source unknown" (author null). The ✦ marker is a separate element. */
export function authorLabel(author: string | null): string {
  return author === null ? 'source unknown' : `by ${author}`;
}

/** "● verified" — glyph + lowercase label, for meta lines and health chips. */
export function healthChipLabel(verdict: HealthVerdict): string {
  return `${HEALTH_GLYPHS[verdict]} ${healthWord(verdict)}`;
}

/** Lowercase in-row health word: verified / heavy / broken / needs a mod. */
export function healthWord(verdict: HealthVerdict): string {
  return verdict === 'needs-mod' ? 'needs a mod' : verdict;
}

// ---------------------------------------------------------------------------
// Meta lines (the site's/prototype's exact patterns)

/** Archive row: "4P · Snow · 2v2 · 130×130 · by Antares" ("Mission"/"—"/"source unknown" fallbacks). */
export function archiveMetaLine(card: MapCardDto): string {
  const parts = [
    playersLabel(card.maxPlayers),
    card.theater,
    card.teamLayout ? teamLabel(card.teamLayout.value) : '—',
    `${card.width}×${card.height}`,
    authorLabel(card.author),
  ];
  return parts.join(' · ');
}

/** Disk row: "known · verified · 8P · Snow" (+ " · needs Mental Omega" when mod-locked). */
export function diskMetaLine(args: {
  membership: 'known' | 'update' | 'unknown';
  healthVerdict: HealthVerdict;
  maxPlayers: number | null;
  theater: string | null;
  mod?: string | null;
}): string {
  const parts = [args.membership, healthWord(args.healthVerdict), playersLabel(args.maxPlayers)];
  if (args.theater !== null) parts.push(args.theater);
  if (args.mod != null && args.mod !== '') parts.push(`needs ${args.mod}`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Paths

/** "…/Yuri" — last path segment with a leading ellipsis, for the folder button. */
export function folderTail(folderPath: string, segments = 1): string {
  const parts = folderPath.split(/[\\/]/).filter((p) => p.length > 0);
  if (parts.length === 0) return folderPath;
  return `…/${parts.slice(-segments).join('/')}`;
}
