import type { HealthVerdict } from '../taxonomy.ts';
import type { HealthReport } from '../types.ts';
import type { ParsedMapFile } from '../mapfile/parse.ts';
import { checkAiScripting } from './ai.ts';
import { computeMapFacts, type MapFacts } from './facts.ts';
import type { AnalyzeOptions } from './index.ts';
import { MAPKIT_VERSION } from './index.ts';
import type { LintBand, LintCategory, LintFinding, LintReport } from './lint-types.ts';
import { checkMeta } from './meta.ts';
import { checkObjects } from './objects.ts';
import { checkSpawns } from './spawns.ts';
import { checkTriggers } from './triggers.ts';

/**
 * The deterministic map linter (docs/LINTER_SPEC.md). Consumes a ParsedMapFile
 * plus the already-computed HealthReport verdict; emits a 1–10 scripting/quality
 * score + findings. Never re-parses, never calls an LLM. The verdict anchors the
 * score: a `broken` map caps at ≤3 no matter how clean its metadata; `heavy` is
 * an effort signal and is never penalized for size.
 */

// A plain-but-complete verified map should land ~functional (5–6); rewards lift
// it to rich/exceptional, penalties drop it to minimal. Baselines are the "no
// findings" starting point per verdict.
const VERDICT_BASELINE: Record<HealthVerdict, number> = {
  verified: 5.0,
  heavy: 5.0,
  'needs-mod': 3.5,
  broken: 1.5,
};

const VERDICT_CAP: Record<HealthVerdict, readonly [number, number]> = {
  verified: [1, 10],
  heavy: [1, 10],
  'needs-mod': [1, 7],
  broken: [1, 3],
};

/** Max positive (reward) contribution per category, so polish can't run away. */
const CATEGORY_REWARD_CAP: Record<LintCategory, number> = {
  triggers: 2.5,
  'ai-scripting': 1.5,
  'spawns-waypoints': 2,
  'objects-terrain': 3,
  'meta-structural': 2,
};

/** Total reward lift across ALL categories — keeps 9–10 rare (needs polish everywhere). */
const TOTAL_REWARD_CAP = 4.0;

/** Diagnostic-only subscore baselines (meta uses the verdict baseline instead). */
const SUBSCORE_BASE: Record<LintCategory, number> = {
  triggers: 8,
  'ai-scripting': 5,
  'spawns-waypoints': 7,
  'objects-terrain': 6,
  'meta-structural': 0,
};

const LINT_CATEGORIES: readonly LintCategory[] = [
  'triggers',
  'ai-scripting',
  'spawns-waypoints',
  'objects-terrain',
  'meta-structural',
];

// The three ai-orphan rules share one combined −3 floor (spec PART 2).
const AI_ORPHAN_RULES = new Set(['ai-orphan-teamtype', 'ai-orphan-scripttype', 'ai-orphan-taskforce']);

const SEVERITY_RANK: Record<LintFinding['severity'], number> = { error: 0, warn: 1, info: 2 };

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const roundHalf = (x: number): number => Math.round(x * 2) / 2;

/** Positive (reward-capped) and negative parts of one category's contribution. */
function categoryParts(cat: LintCategory, findings: readonly LintFinding[]): { pos: number; neg: number } {
  let pos = 0;
  let neg = 0;
  if (cat === 'ai-scripting') {
    let orphan = 0;
    for (const f of findings) {
      if (f.category !== cat) continue;
      if (AI_ORPHAN_RULES.has(f.ruleId)) orphan += f.scoreImpact;
      else if (f.scoreImpact > 0) pos += f.scoreImpact;
      else neg += f.scoreImpact;
    }
    neg += Math.max(-3, orphan); // combined orphan floor
  } else {
    for (const f of findings) {
      if (f.category !== cat) continue;
      if (f.scoreImpact > 0) pos += f.scoreImpact;
      else neg += f.scoreImpact;
    }
  }
  return { pos: Math.min(pos, CATEGORY_REWARD_CAP[cat]), neg };
}

function bandOf(score: number): LintBand {
  if (score <= 2) return 'unplayable';
  if (score <= 4) return 'minimal';
  if (score <= 6) return 'functional';
  if (score <= 8) return 'rich';
  return 'exceptional';
}

function subscoreOf(
  cat: LintCategory,
  findings: readonly LintFinding[],
  verdict: HealthVerdict,
  facts: MapFacts,
): number | null {
  if (cat === 'triggers' && facts.triggers.triggerIdSet.size === 0) return null;
  if (cat === 'ai-scripting' && !facts.ai.hasAnyAiSection) return null;
  const base = cat === 'meta-structural' ? VERDICT_BASELINE[verdict] : SUBSCORE_BASE[cat];
  const { pos, neg } = categoryParts(cat, findings);
  let s = base + pos + neg;
  if (cat === 'meta-structural') {
    const [lo, hi] = VERDICT_CAP[verdict];
    s = clamp(s, lo, hi);
  }
  return roundHalf(clamp(s, 1, 10));
}

export function lintMap(parsed: ParsedMapFile, health: HealthReport, opts?: AnalyzeOptions): LintReport {
  const facts = computeMapFacts(parsed);
  const verdict = health.verdict;

  const findings: LintFinding[] = [
    ...checkTriggers(facts, parsed, opts),
    ...checkAiScripting(facts, parsed, opts),
    ...checkSpawns(facts, parsed, opts),
    ...checkObjects(facts, parsed, opts),
    ...checkMeta(facts, parsed, opts),
  ];
  findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || Math.abs(b.scoreImpact) - Math.abs(a.scoreImpact),
  );

  let totalPos = 0;
  let totalNeg = 0;
  for (const cat of LINT_CATEGORIES) {
    const { pos, neg } = categoryParts(cat, findings);
    totalPos += pos;
    totalNeg += neg;
  }
  const total = Math.min(totalPos, TOTAL_REWARD_CAP) + totalNeg;
  const [lo, hi] = VERDICT_CAP[verdict];
  const capped = clamp(VERDICT_BASELINE[verdict] + total, lo, hi);
  const score = roundHalf(clamp(capped, 1, 10));

  const subscores = Object.fromEntries(
    LINT_CATEGORIES.map((cat) => [cat, subscoreOf(cat, findings, verdict, facts)]),
  ) as Record<LintCategory, number | null>;

  return { score, band: bandOf(score), subscores, findings, verdict, mapkitVersion: MAPKIT_VERSION };
}
