/**
 * Triggers category checker for the YR map linter.
 *
 * Consumes the shared MapFacts bundle (facts.triggers / facts.ai) plus the raw
 * ParsedMapFile and emits LintFindings for the `triggers` category. Pure,
 * deterministic, no I/O, no LLM. Rules + severities + scoreImpacts are the
 * PART 1.A table in docs/LINTER_SPEC.md; scoring/caps are applied by the lead.
 *
 * Neutral: when the [Triggers] section is absent the map has no scripting to
 * judge, so this checker emits nothing at all.
 */
import type { MapFacts, TriggerAction, TriggerEvent } from './facts.ts';
import { decodeWaypointZZ } from './facts.ts';
import type { LintFinding } from './lint-types.ts';
import type { ParsedMapFile } from '../mapfile/parse.ts';
import type { AnalyzeOptions } from './index.ts';

// --- rule parameter tables --------------------------------------------------

/** Events that require an object/cell attachment to ever fire. */
const ATTACHMENT_EVENTS = new Set([1, 4, 6, 7, 29, 31, 33, 34, 38, 39, 40, 41, 42, 43, 44, 48]);
/** Actions whose Parameters[1] (P2) is a trigger id. */
const P2_TRIGGER_ACTIONS = new Set([12, 22, 53, 54]);
/** Actions whose Parameters[1] (P2) is a teamtype id. */
const P2_TEAMTYPE_ACTIONS = new Set([4, 5, 7, 80, 101, 105]);
/** Actions whose Parameters[1] (P2) is an integer waypoint index. */
const P2_WAYPOINT_ACTIONS = new Set([17, 18, 59, 63, 64, 65, 66]);
/** Actions whose Parameters[6] (P7) is a WaypointZZ base-26 token. */
const P7_WAYPOINT_ACTIONS = new Set([8, 41, 42, 43, 48, 55, 58, 80, 88, 89, 90, 94, 95, 96, 99]);
/** Reinforcement actions (P2 teamtype, action 80 also carries a P7 waypoint). */
const REINFORCE_ACTIONS = new Set([7, 80]);
/** Events whose Parameters[1] (P2) is a local-variable index. */
const P2_LOCALVAR_EVENTS = new Set([36, 37]);
/** Actions whose Parameters[1] (P2) is a local-variable index. */
const P2_LOCALVAR_ACTIONS = new Set([56, 57]);
/** "All destroyed" style events that can drive a lose/win condition. */
const DESTROY_EVENTS = new Set([9, 10, 11]);

// --- small helpers ----------------------------------------------------------

function isNone(v: string | undefined): boolean {
  if (v === undefined) return true;
  const t = v.trim().toLowerCase();
  return t.length === 0 || t === '<none>' || t === 'none';
}

/** Non-negative integer waypoint/variable index, or null. */
function toIndex(v: string | undefined): number | null {
  if (v === undefined) return null;
  const t = v.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The single active difficulty of a trigger, or null when 0 or >1 flags set. */
function singleDifficulty(t: { easy: boolean; normal: boolean; hard: boolean }): string | null {
  const set: string[] = [];
  if (t.easy) set.push('easy');
  if (t.normal) set.push('normal');
  if (t.hard) set.push('hard');
  return set.length === 1 ? set[0]! : null;
}

// ===========================================================================

export function checkTriggers(
  facts: MapFacts,
  parsed: ParsedMapFile,
  _opts?: AnalyzeOptions,
): LintFinding[] {
  // Neutral: no [Triggers] section → nothing to judge.
  if (parsed.ini.section('Triggers') === undefined) return [];

  const t = facts.triggers;
  const {
    triggerIdSet,
    triggers,
    events,
    actions,
    actionCounts,
    tags,
    tagIdSet,
    teamTypeIdSet,
    waypointNumberSet,
    hasVariableNames,
    localVarIndexSet,
    attachedTagIdSet,
    linkedTriggerGraph,
    isMission,
  } = t;
  const triggerCount = triggerIdSet.size;

  const findings: LintFinding[] = [];
  const emit = (
    ruleId: string,
    severity: LintFinding['severity'],
    scoreImpact: number,
    message: string,
    refs?: string[],
  ): void => {
    const finding: LintFinding = { ruleId, category: 'triggers', severity, scoreImpact, message };
    if (refs !== undefined) finding.refs = refs;
    findings.push(finding);
  };

  // Flags feeding the reward preconditions.
  let malformedFired = false;
  let danglingFired = false;
  let selfAttachFired = false;
  let tooManyActionsFired = false;

  // Flatten actions/events with their owning trigger id (includes orphan blocks).
  const allActions: Array<{ triggerId: string; action: TriggerAction }> = [];
  for (const [tid, list] of actions) for (const a of list) allActions.push({ triggerId: tid, action: a });
  const allEvents: Array<{ triggerId: string; event: TriggerEvent }> = [];
  for (const [tid, list] of events) for (const e of list) allEvents.push({ triggerId: tid, event: e });

  /** Distinct Parameters[1] tokens over actions whose index is in `set`. */
  const actionTargets = (set: Set<number>): Set<string> => {
    const out = new Set<string>();
    for (const { action } of allActions) {
      if (set.has(action.index)) {
        const p2 = action.params[1];
        if (p2 !== undefined && !isNone(p2)) out.add(p2);
      }
    }
    return out;
  };

  // --- trigger-malformed-line (error, -3, per line) ------------------------
  for (const tr of triggers.values()) {
    if (tr.malformed) {
      malformedFired = true;
      emit(
        'trigger-malformed-line',
        'error',
        -3,
        `[Triggers] line ${tr.id} is malformed (fieldCount=${tr.fieldCount}, expected 7 with boolean flags)`,
        [tr.id],
      );
    }
  }

  // --- events-actions-malformed-encoding (error, -3, per line) -------------
  for (const id of t.eventsMalformed) {
    malformedFired = true;
    emit('events-actions-malformed-encoding', 'error', -3, `[Events] entry ${id} has a malformed encoding (bad count/stride)`, [id]);
  }
  for (const id of t.actionsMalformed) {
    malformedFired = true;
    emit('events-actions-malformed-encoding', 'error', -3, `[Actions] entry ${id} has a malformed encoding (bad count/stride)`, [id]);
  }

  // --- trigger-attached-to-self (error, -4, per trigger) -------------------
  for (const id of triggerIdSet) {
    let cur = linkedTriggerGraph.get(id);
    const seen = new Set<string>();
    while (cur !== undefined) {
      if (cur === id) {
        selfAttachFired = true;
        emit('trigger-attached-to-self', 'error', -4, `trigger ${id} forms a self-attaching LinkedTrigger cycle (crashes the game)`, [id]);
        break;
      }
      if (seen.has(cur)) break;
      seen.add(cur);
      cur = linkedTriggerGraph.get(cur);
    }
  }

  // --- trigger-too-many-actions (error, -3, per trigger) -------------------
  for (const [id, count] of actionCounts) {
    if (count > 18) {
      tooManyActionsFired = true;
      emit('trigger-too-many-actions', 'error', -3, `trigger ${id} has ${count} actions (>18 overflows the 512-char buffer and crashes)`, [id]);
    }
  }

  // --- dangling-trigger-ref (error, -2, dedupe by target, cap 5) -----------
  const danglingTrig = new Set<string>();
  for (const { action } of allActions) {
    if (P2_TRIGGER_ACTIONS.has(action.index)) {
      const p2 = action.params[1];
      if (p2 !== undefined && !isNone(p2) && !triggerIdSet.has(p2)) danglingTrig.add(p2);
    }
  }
  {
    const list = [...danglingTrig].slice(0, 5);
    for (const target of list) {
      emit('dangling-trigger-ref', 'error', -2, `a trigger action (id 12/22/53/54) references missing trigger ${target}`, [target]);
    }
    if (list.length > 0) danglingFired = true;
  }

  // --- dangling-teamtype-ref (error, -2, per ref) --------------------------
  // NOTE: event 23's teamtype ref is a string id, but MapFacts reduces every
  // event Parameters[1] to an int (TriggerEvent.p2), so the original id is not
  // recoverable here. We validate only the six action refs (params kept as
  // strings) and skip event 23 to avoid false positives. See return note.
  const danglingTeam = new Set<string>();
  for (const { action } of allActions) {
    if (P2_TEAMTYPE_ACTIONS.has(action.index)) {
      const p2 = action.params[1];
      if (p2 !== undefined && !isNone(p2) && !teamTypeIdSet.has(p2)) danglingTeam.add(p2);
    }
  }
  for (const target of danglingTeam) {
    emit('dangling-teamtype-ref', 'error', -2, `a trigger action (id 4/5/7/80/101/105) references missing teamtype ${target}`, [target]);
  }
  if (danglingTeam.size > 0) danglingFired = true;

  // --- reinforcement-logic-broken (error, -2, per broken reinforcement) ----
  for (const { action } of allActions) {
    if (!REINFORCE_ACTIONS.has(action.index)) continue;
    const teamId = action.params[1];
    const reasons: string[] = [];
    if (teamId === undefined || isNone(teamId) || !teamTypeIdSet.has(teamId)) {
      reasons.push('teamtype missing');
    } else {
      const body = facts.ai.teamTypes.get(teamId);
      if (!body || body.script === null || body.taskForce === null) {
        reasons.push('teamtype has empty TaskForce=/Script=');
      }
    }
    if (action.index === 80) {
      const tok = action.params[6];
      if (tok !== undefined && !isNone(tok)) {
        const wp = decodeWaypointZZ(tok.trim());
        if (wp !== null && !waypointNumberSet.has(wp)) reasons.push(`waypoint ${tok} does not exist`);
      }
    }
    if (reasons.length > 0) {
      emit('reinforcement-logic-broken', 'error', -2, `reinforcement action ${action.index} (team ${teamId ?? '<none>'}) is broken: ${reasons.join('; ')}`, teamId !== undefined && !isNone(teamId) ? [teamId] : undefined);
    }
  }

  // --- tag-references-missing-trigger (warn, -1.5, per tag) ----------------
  for (const tg of tags.values()) {
    if (!isNone(tg.triggerId) && !triggerIdSet.has(tg.triggerId)) {
      emit('tag-references-missing-trigger', 'warn', -1.5, `tag ${tg.id} references missing trigger ${tg.triggerId}`, [tg.id]);
    }
  }

  // --- tag-malformed-line (warn, -1, per tag) ------------------------------
  for (const tg of tags.values()) {
    if (tg.malformed) {
      emit('tag-malformed-line', 'warn', -1, `tag ${tg.id} is malformed (fieldCount=${tg.fieldCount}, repeat=${tg.repeat})`, [tg.id]);
    }
  }

  // --- linkedtrigger-dangling (warn, -1.5, per link) -----------------------
  for (const [src, dst] of linkedTriggerGraph) {
    if (!triggerIdSet.has(dst)) {
      danglingFired = true;
      emit('linkedtrigger-dangling', 'warn', -1.5, `trigger ${src} LinkedTrigger points to missing trigger ${dst}`, [dst]);
    }
  }

  // --- orphan-events-actions-block (warn, -1, per orphan id, cap 5) --------
  {
    const orphans = [...new Set([...t.orphanEventIds, ...t.orphanActionIds])].slice(0, 5);
    for (const id of orphans) {
      emit('orphan-events-actions-block', 'warn', -1, `[Events]/[Actions] block ${id} has no matching trigger`, [id]);
    }
  }

  // --- object-event-trigger-unattached (warn, -1, per trigger) -------------
  const attachedTriggerIds = new Set<string>();
  for (const tg of tags.values()) {
    if (attachedTagIdSet.has(tg.id) && !isNone(tg.triggerId)) attachedTriggerIds.add(tg.triggerId);
  }
  const linkedTargets = new Set(linkedTriggerGraph.values());
  for (const id of triggerIdSet) {
    const evs = events.get(id) ?? [];
    if (!evs.some((e) => ATTACHMENT_EVENTS.has(e.index))) continue;
    if (attachedTriggerIds.has(id) || linkedTargets.has(id)) continue;
    emit('object-event-trigger-unattached', 'warn', -1, `trigger ${id} has an attachment-requiring event but no attached tag (or LinkedTrigger) points to it`, [id]);
  }

  // --- dangling-tag-ref-in-action (warn, -1, per ref) ----------------------
  const danglingActionTags = new Set<string>();
  for (const { action } of allActions) {
    if (action.index === 70) {
      const p2 = action.params[1];
      if (p2 !== undefined && !isNone(p2) && !tagIdSet.has(p2)) danglingActionTags.add(p2);
    }
  }
  for (const target of danglingActionTags) {
    danglingFired = true;
    emit('dangling-tag-ref-in-action', 'warn', -1, `DestroyTag action (id 70) references missing tag ${target}`, [target]);
  }

  // --- dangling-waypoint-ref (warn, -1, per ref) ---------------------------
  const danglingWp = new Set<number>();
  for (const { event } of allEvents) {
    if (event.index === 34 && !waypointNumberSet.has(event.p2)) danglingWp.add(event.p2);
  }
  for (const { action } of allActions) {
    if (P2_WAYPOINT_ACTIONS.has(action.index)) {
      const n = toIndex(action.params[1]);
      if (n !== null && !waypointNumberSet.has(n)) danglingWp.add(n);
    }
    if (P7_WAYPOINT_ACTIONS.has(action.index)) {
      const tok = action.params[6];
      if (tok !== undefined && !isNone(tok)) {
        const wp = decodeWaypointZZ(tok.trim());
        if (wp !== null && !waypointNumberSet.has(wp)) danglingWp.add(wp);
      }
    }
  }
  for (const n of danglingWp) {
    danglingFired = true;
    emit('dangling-waypoint-ref', 'warn', -1, `a trigger event/action references missing waypoint ${n}`, [String(n)]);
  }

  // --- dangling-local-var-ref (warn, -0.75, per ref; only with VariableNames)
  if (hasVariableNames) {
    const danglingVar = new Set<number>();
    for (const { event } of allEvents) {
      if (P2_LOCALVAR_EVENTS.has(event.index) && !localVarIndexSet.has(event.p2)) danglingVar.add(event.p2);
    }
    for (const { action } of allActions) {
      if (P2_LOCALVAR_ACTIONS.has(action.index)) {
        const n = toIndex(action.params[1]);
        if (n !== null && !localVarIndexSet.has(n)) danglingVar.add(n);
      }
    }
    for (const n of danglingVar) {
      danglingFired = true;
      emit('dangling-local-var-ref', 'warn', -0.75, `a trigger event/action references undefined local variable index ${n}`, [String(n)]);
    }
  }

  // --- mission-missing-win-condition (warn, -2, once) ----------------------
  const hasAction1 = allActions.some((x) => x.action.index === 1);
  if (isMission && triggerCount > 0 && !hasAction1) {
    emit('mission-missing-win-condition', 'warn', -2, `mission map has ${triggerCount} triggers but no "Winner Is" (action 1) anywhere`);
  }

  // --- disabled-trigger-never-enabled (info, -0.5, once, scaled) -----------
  const enable53Targets = actionTargets(new Set([53]));
  {
    const affected: string[] = [];
    for (const tr of triggers.values()) {
      if (!tr.disabled) continue;
      if (enable53Targets.has(tr.id)) continue;
      const own = actions.get(tr.id) ?? [];
      if (own.some((a) => a.index === 16)) continue;
      const nameU = tr.name.toUpperCase();
      if (nameU.includes('DEBUG') || nameU.includes('OBSOLETE')) continue;
      affected.push(tr.id);
    }
    if (affected.length > 0 && triggerCount > 0) {
      const impact = round2(-0.5 * (affected.length / triggerCount));
      emit('disabled-trigger-never-enabled', 'info', impact, `${affected.length} disabled trigger(s) are never enabled by any action 53`, affected.slice(0, 5));
    }
  }

  // --- trigger-enables-itself (info, -0.25, per trigger) -------------------
  for (const [tid, acts] of actions) {
    if (!triggerIdSet.has(tid)) continue;
    if (acts.some((a) => a.index === 53 && a.params[1] === tid)) {
      emit('trigger-enables-itself', 'info', -0.25, `trigger ${tid} enables itself (action 53 targeting its own id)`, [tid]);
    }
  }

  // --- enabled-but-never-disabled (info, -0.25, once, scaled) --------------
  const disable54Targets = actionTargets(new Set([54]));
  {
    const affected: string[] = [];
    for (const tr of triggers.values()) {
      if (tr.disabled) continue;
      if (enable53Targets.has(tr.id) && !disable54Targets.has(tr.id)) affected.push(tr.id);
    }
    if (affected.length > 0 && triggerCount > 0) {
      const impact = round2(-0.25 * (affected.length / triggerCount));
      emit('enabled-but-never-disabled', 'info', impact, `${affected.length} trigger(s) are enabled (action 53) but never disabled (action 54)`, affected.slice(0, 5));
    }
  }

  // --- difficulty-mismatch-enable-disable (info, -0.25, cap 5) -------------
  {
    const seen = new Set<string>();
    const pairs: Array<[string, string]> = [];
    for (const { triggerId, action } of allActions) {
      if (action.index !== 53 && action.index !== 54) continue;
      const target = action.params[1];
      if (target === undefined || isNone(target)) continue;
      const src = triggers.get(triggerId);
      const tgt = triggers.get(target);
      if (!src || !tgt) continue;
      const sd = singleDifficulty(src);
      const td = singleDifficulty(tgt);
      if (sd !== null && td !== null && sd !== td) {
        const key = `${triggerId}>${target}`;
        if (!seen.has(key)) {
          seen.add(key);
          pairs.push([triggerId, target]);
        }
      }
    }
    for (const [s, target] of pairs.slice(0, 5)) {
      emit('difficulty-mismatch-enable-disable', 'info', -0.25, `trigger ${s} enables/disables ${target}, which runs on a different single difficulty`, [target]);
    }
  }

  // --- teamtype-missing-taskforce-or-script (info, -0.5, cap 5) ------------
  {
    const missing: string[] = [];
    for (const id of teamTypeIdSet) {
      const body = facts.ai.teamTypes.get(id);
      if (!body || body.script === null || body.taskForce === null) missing.push(id);
    }
    for (const id of missing.slice(0, 5)) {
      emit('teamtype-missing-taskforce-or-script', 'info', -0.5, `teamtype ${id} lacks a TaskForce= or Script= in its body`, [id]);
    }
  }

  // --- reward-clean-trigger-graph (info, +1.5) -----------------------------
  const forceFired = actionTargets(new Set([22]));
  const everyTriggerWired = [...triggerIdSet].every((id) => {
    const evs = events.get(id);
    const hasEvent = (evs !== undefined && evs.length > 0) || forceFired.has(id);
    const hasAction = (actionCounts.get(id) ?? 0) >= 1;
    return hasEvent && hasAction;
  });
  if (
    triggerCount > 0 &&
    !malformedFired &&
    !danglingFired &&
    everyTriggerWired &&
    !selfAttachFired &&
    !tooManyActionsFired
  ) {
    emit('reward-clean-trigger-graph', 'info', 1.5, `all ${triggerCount} triggers are well-formed, fully wired, and free of dangling references`);
  }

  // --- reward-win-lose-logic (info, +1.5) ----------------------------------
  if (isMission && hasAction1) {
    const hasAction2 = allActions.some((x) => x.action.index === 2);
    const destroyDriven = [...triggerIdSet].some((id) => {
      const evs = events.get(id) ?? [];
      if (!evs.some((e) => DESTROY_EVENTS.has(e.index))) return false;
      const acts = actions.get(id) ?? [];
      return acts.some((a) => a.index === 1 || a.index === 2);
    });
    if (hasAction2 || destroyDriven) {
      emit('reward-win-lose-logic', 'info', 1.5, 'mission has both a Winner Is (action 1) and a lose path');
    }
  }

  // --- reward-proper-tag-usage (info, +0.5) --------------------------------
  if (tagIdSet.size > 0) {
    const allTagsClean = [...tags.values()].every(
      (tg) => !tg.malformed && triggerIdSet.has(tg.triggerId) && attachedTagIdSet.has(tg.id),
    );
    if (allTagsClean) {
      emit('reward-proper-tag-usage', 'info', 0.5, `all ${tagIdSet.size} tags are well-formed, resolve to a real trigger, and are attached`);
    }
  }

  return findings;
}
