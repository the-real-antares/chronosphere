/**
 * ai-scripting category checker for the YR map linter.
 *
 * Consumes the precomputed `MapFacts.ai` graph (ScriptTypes / TeamTypes /
 * TaskForces / AITriggerTypes) plus the shared waypoint key set, and emits
 * `LintFinding`s per docs/LINTER_SPEC.md PART 1 §B. Pure, deterministic, no I/O.
 *
 * Neutral: emits nothing when the map defines none of the four AI sections
 * (`facts.ai.hasAnyAiSection === false`).
 *
 * Rule ids owned here (exact spec severities / scoreImpacts, per-rule capped):
 *   ai-teamtype-missing-script     error  -3   per teamtype, cap 5
 *   ai-teamtype-missing-taskforce  error  -3   per teamtype, cap 5
 *   ai-aitrigger-dangling-team     error  -2   per ref,      cap 5
 *   ai-taskforce-unknown-unit      warn   -1   per unit,     cap 3   (knownObjects-gated)
 *   ai-taskforce-empty             warn   -1   per taskforce, cap 3
 *   ai-scripttype-bad-waypoint-arg warn   -1   per ref,      cap 5
 *   ai-aitrigger-team-max-zero     warn   -1   per teamtype, cap 3
 *   ai-teamtype-body-missing       warn   -1   per id,       cap 3
 *   ai-scripttype-empty            info   -0.5 once, fraction-scaled
 *   ai-orphan-teamtype             info   -0.25 once, count-scaled  \
 *   ai-orphan-scripttype           info   -0.25 once, count-scaled   > combined -3 cap
 *   ai-orphan-taskforce            info   -0.25 once, count-scaled  /
 *   reward-clean-ai-graph          info   +1.5 once
 */
import type { MapFacts } from './facts.ts';
import type { AnalyzeOptions } from './index.ts';
import type { LintFinding } from './lint-types.ts';
import type { ParsedMapFile } from '../mapfile/parse.ts';

const CATEGORY = 'ai-scripting' as const;

/**
 * ScriptType action ids whose `argument` field is a [Waypoints] key.
 *
 * NOTE: MapFacts does NOT expose a "which script-action ids take a waypoint
 * argument" table — that is domain data. Hardcoded here conservatively to the
 * unambiguous RA2/YR waypoint action (3 = "Move to waypoint") to avoid false
 * positives on a warn-level rule. See the return notes: the lead may want to
 * centralize/expand this table.
 */
const WAYPOINT_ARG_SCRIPT_ACTIONS = new Set<number>([3]);

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function checkAiScripting(
  facts: MapFacts,
  parsed: ParsedMapFile,
  opts?: AnalyzeOptions,
): LintFinding[] {
  void parsed; // all inputs come from precomputed MapFacts; parsed kept for contract parity.
  const ai = facts.ai;

  // Neutral: no [ScriptTypes]/[TeamTypes]/[TaskForces]/[AITriggerTypes].
  if (!ai.hasAnyAiSection) return [];

  const findings: LintFinding[] = [];

  const scriptTypeIdSet = new Set(ai.scriptTypeIds);
  const taskForceIdSet = new Set(ai.taskForceIds);
  const teamTypeIdSet = new Set(ai.teamTypeIds);
  const waypointKeySet = facts.triggers.waypointNumberSet; // == spawns.allWaypointKeys

  // Counts captured for the reward gate.
  let missingScriptCount = 0;
  let missingTaskForceCount = 0;
  let aiTriggerDanglingCount = 0;
  let bodyMissingCount = 0;
  let max0Count = 0;
  let badWaypointCount = 0;
  let unknownUnitCount = 0;

  // --- ai-teamtype-missing-script (error, -3, per teamtype, cap 5) ---------
  {
    const ids: string[] = [];
    for (const [id, body] of ai.teamTypes) {
      if (body.script !== null && !scriptTypeIdSet.has(body.script)) ids.push(id);
    }
    missingScriptCount = ids.length;
    if (ids.length > 0) {
      const cap = 5;
      const refs = ids.slice(0, cap);
      findings.push({
        ruleId: 'ai-teamtype-missing-script',
        category: CATEGORY,
        severity: 'error',
        scoreImpact: round2(-3 * Math.min(ids.length, cap)),
        message: `${ids.length} TeamType(s) reference a Script= that is not in [ScriptTypes]: ${refs.join(', ')}`,
        refs,
      });
    }
  }

  // --- ai-teamtype-missing-taskforce (error, -3, per teamtype, cap 5) ------
  {
    const ids: string[] = [];
    for (const [id, body] of ai.teamTypes) {
      if (body.taskForce !== null && !taskForceIdSet.has(body.taskForce)) ids.push(id);
    }
    missingTaskForceCount = ids.length;
    if (ids.length > 0) {
      const cap = 5;
      const refs = ids.slice(0, cap);
      findings.push({
        ruleId: 'ai-teamtype-missing-taskforce',
        category: CATEGORY,
        severity: 'error',
        scoreImpact: round2(-3 * Math.min(ids.length, cap)),
        message: `${ids.length} TeamType(s) reference a TaskForce= that is not in [TaskForces]: ${refs.join(', ')}`,
        refs,
      });
    }
  }

  // --- ai-aitrigger-dangling-team (error, -2, per ref, cap 5) --------------
  {
    const refIds: string[] = [];
    for (const t of ai.aiTriggers) {
      if (t.team1 !== null && !teamTypeIdSet.has(t.team1)) refIds.push(t.team1);
      if (t.team2 !== null && !teamTypeIdSet.has(t.team2)) refIds.push(t.team2);
    }
    aiTriggerDanglingCount = refIds.length;
    if (refIds.length > 0) {
      const cap = 5;
      const refs = [...new Set(refIds)].slice(0, cap);
      findings.push({
        ruleId: 'ai-aitrigger-dangling-team',
        category: CATEGORY,
        severity: 'error',
        scoreImpact: round2(-2 * Math.min(refIds.length, cap)),
        message: `${refIds.length} AITrigger team reference(s) point to a team not in [TeamTypes]: ${refs.join(', ')}`,
        refs,
      });
    }
  }

  // --- ai-taskforce-unknown-unit (warn, -1, per unit, cap 3) ---------------
  // knownObjects-gated: skip entirely when absent (same policy as needs-mod).
  {
    const known = opts?.knownObjects;
    if (known) {
      const unknown = new Set<string>();
      for (const tf of ai.taskForces.values()) {
        for (const m of tf.members) {
          if (m.unitId.length > 0 && !known.has(m.unitId)) unknown.add(m.unitId);
        }
      }
      unknownUnitCount = unknown.size;
      if (unknown.size > 0) {
        const cap = 3;
        const ids = [...unknown];
        const refs = ids.slice(0, cap);
        findings.push({
          ruleId: 'ai-taskforce-unknown-unit',
          category: CATEGORY,
          severity: 'warn',
          scoreImpact: round2(-1 * Math.min(ids.length, cap)),
          message: `${ids.length} TaskForce member unit id(s) unknown to the loaded rules: ${refs.join(', ')}`,
          refs,
        });
      }
    }
  }

  // --- ai-taskforce-empty (warn, -1, per taskforce, cap 3) -----------------
  {
    const ids: string[] = [];
    for (const [id, body] of ai.taskForces) {
      if (body.memberSlotCount === 0) ids.push(id);
    }
    if (ids.length > 0) {
      const cap = 3;
      const refs = ids.slice(0, cap);
      findings.push({
        ruleId: 'ai-taskforce-empty',
        category: CATEGORY,
        severity: 'warn',
        scoreImpact: round2(-1 * Math.min(ids.length, cap)),
        message: `${ids.length} TaskForce(s) have no members: ${refs.join(', ')}`,
        refs,
      });
    }
  }

  // --- ai-scripttype-bad-waypoint-arg (warn, -1, per ref, cap 5) -----------
  {
    const occ: string[] = []; // one entry (script id) per bad occurrence
    const refSet = new Set<string>();
    for (const [id, body] of ai.scriptTypes) {
      for (const a of body.actions) {
        if (WAYPOINT_ARG_SCRIPT_ACTIONS.has(a.action) && !waypointKeySet.has(a.argument)) {
          occ.push(id);
          refSet.add(id);
        }
      }
    }
    badWaypointCount = occ.length;
    if (occ.length > 0) {
      const cap = 5;
      const refs = [...refSet].slice(0, cap);
      findings.push({
        ruleId: 'ai-scripttype-bad-waypoint-arg',
        category: CATEGORY,
        severity: 'warn',
        scoreImpact: round2(-1 * Math.min(occ.length, cap)),
        message: `${occ.length} ScriptType waypoint action(s) reference a waypoint not in [Waypoints]: ${refs.join(', ')}`,
        refs,
      });
    }
  }

  // --- ai-aitrigger-team-max-zero (warn, -1, per teamtype, cap 3) ----------
  {
    const ids: string[] = [];
    for (const team of ai.aiTriggerReferencedTeams) {
      const body = ai.teamTypes.get(team);
      if (body && body.max === 0) ids.push(team);
    }
    max0Count = ids.length;
    if (ids.length > 0) {
      const cap = 3;
      const refs = ids.slice(0, cap);
      findings.push({
        ruleId: 'ai-aitrigger-team-max-zero',
        category: CATEGORY,
        severity: 'warn',
        scoreImpact: round2(-1 * Math.min(ids.length, cap)),
        message: `${ids.length} AITrigger-recruited team(s) have Max=0 and never build: ${refs.join(', ')}`,
        refs,
      });
    }
  }

  // --- ai-teamtype-body-missing (warn, -1, per id, cap 3) ------------------
  {
    const ids: string[] = [];
    for (const [id, body] of ai.teamTypes) {
      if (!body.bodyPresent) ids.push(id);
    }
    bodyMissingCount = ids.length;
    if (ids.length > 0) {
      const cap = 3;
      const refs = ids.slice(0, cap);
      findings.push({
        ruleId: 'ai-teamtype-body-missing',
        category: CATEGORY,
        severity: 'warn',
        scoreImpact: round2(-1 * Math.min(ids.length, cap)),
        message: `${ids.length} [TeamTypes] id(s) have no matching body section: ${refs.join(', ')}`,
        refs,
      });
    }
  }

  // --- ai-scripttype-empty (info, -0.5, once, fraction-scaled) -------------
  {
    const total = ai.scriptTypes.size;
    const emptyIds: string[] = [];
    for (const [id, body] of ai.scriptTypes) {
      if (body.actionCount === 0) emptyIds.push(id);
    }
    if (emptyIds.length > 0 && total > 0) {
      const refs = emptyIds.slice(0, 5);
      const magnitude = 0.5 * (emptyIds.length / total); // fraction-scaled, capped at 0.5
      findings.push({
        ruleId: 'ai-scripttype-empty',
        category: CATEGORY,
        severity: 'info',
        scoreImpact: round2(-magnitude),
        message: `${emptyIds.length}/${total} ScriptType(s) have zero actions: ${refs.join(', ')}`,
        refs,
      });
    }
  }

  // --- ai-orphan-* (info, -0.25 each, count-scaled, combined -3 cap) -------
  {
    const orphanTeams: string[] = [];
    for (const [id] of ai.teamTypes) {
      if (!ai.reachableTeamIds.has(id)) orphanTeams.push(id);
    }
    const orphanScripts: string[] = [];
    for (const [id] of ai.scriptTypes) {
      if (!ai.usedScriptIds.has(id)) orphanScripts.push(id);
    }
    const orphanTaskForces: string[] = [];
    for (const [id] of ai.taskForces) {
      if (!ai.usedTaskForceIds.has(id)) orphanTaskForces.push(id);
    }

    const rawTeam = 0.25 * orphanTeams.length;
    const rawScript = 0.25 * orphanScripts.length;
    const rawTaskForce = 0.25 * orphanTaskForces.length;
    const rawSum = rawTeam + rawScript + rawTaskForce;
    const factor = rawSum > 3 ? 3 / rawSum : 1; // combined -3 cap across the three orphan rules

    const pushOrphan = (ruleId: string, ids: string[], raw: number, label: string): void => {
      if (ids.length === 0) return;
      const refs = ids.slice(0, 5);
      findings.push({
        ruleId,
        category: CATEGORY,
        severity: 'info',
        scoreImpact: round2(-raw * factor),
        message: `${ids.length} orphan ${label}(s) (never referenced): ${refs.join(', ')}`,
        refs,
      });
    };
    pushOrphan('ai-orphan-teamtype', orphanTeams, rawTeam, 'TeamType');
    pushOrphan('ai-orphan-scripttype', orphanScripts, rawScript, 'ScriptType');
    pushOrphan('ai-orphan-taskforce', orphanTaskForces, rawTaskForce, 'TaskForce');
  }

  // --- reward-clean-ai-graph (info, +1.5, once) ----------------------------
  {
    const registryEntries =
      ai.teamTypeIds.length + ai.scriptTypeIds.length + ai.taskForceIds.length + ai.aiTriggers.length;

    let usedTeamsComplete = true;
    for (const id of ai.reachableTeamIds) {
      const body = ai.teamTypes.get(id);
      if (!body || body.script === null || body.taskForce === null) {
        usedTeamsComplete = false;
        break;
      }
    }

    const cleanGraph =
      registryEntries > 0 &&
      missingScriptCount === 0 &&
      missingTaskForceCount === 0 &&
      aiTriggerDanglingCount === 0 &&
      bodyMissingCount === 0 &&
      badWaypointCount === 0 &&
      max0Count === 0 &&
      unknownUnitCount === 0 &&
      usedTeamsComplete;

    if (cleanGraph) {
      findings.push({
        ruleId: 'reward-clean-ai-graph',
        category: CATEGORY,
        severity: 'info',
        scoreImpact: 1.5,
        message:
          'Clean AI graph: no dangling Script/TaskForce/team refs, every recruited team fully wired, no Max=0 team.',
      });
    }
  }

  return findings;
}
