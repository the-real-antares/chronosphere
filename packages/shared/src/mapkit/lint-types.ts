import type { HealthVerdict } from '../taxonomy.ts';

/**
 * Linter type contract (stable). The linter is a deterministic layer over the
 * MapKit: it consumes a ParsedMapFile + the HealthReport verdict and emits a
 * LintReport (a 1–10 scripting/quality score + findings). Never re-parses,
 * never calls an LLM. See docs/LINTER_SPEC.md for rules + scoring.
 */

export type LintCategory =
  | 'triggers'
  | 'ai-scripting'
  | 'spawns-waypoints'
  | 'objects-terrain'
  | 'meta-structural';

export type LintSeverity = 'error' | 'warn' | 'info';

export type LintBand = 'unplayable' | 'minimal' | 'functional' | 'rich' | 'exceptional';

/** One rule outcome. Emitted by a category checker. */
export interface LintFinding {
  ruleId: string;
  category: LintCategory;
  severity: LintSeverity;
  /** Signed points after the per-rule cap: negative = penalty, positive = reward. */
  scoreImpact: number;
  /** Human-readable, names the offending id, e.g. "action 53 targets missing trigger 0A000000". */
  message: string;
  /** Offending ids (capped list). */
  refs?: string[];
}

export interface LintReport {
  /** 1..10, rounded to 0.5 — the authoritative scripting/quality score. */
  score: number;
  band: LintBand;
  /** Per-category diagnostic subscores; null = n/a (no triggers / no AI). Do NOT sum — the overall score is separate. */
  subscores: Record<LintCategory, number | null>;
  /** Sorted error → warn → info, then by descending |scoreImpact|. */
  findings: LintFinding[];
  /** Echoed health verdict — the scoring anchor. */
  verdict: HealthVerdict;
  mapkitVersion: string;
}
