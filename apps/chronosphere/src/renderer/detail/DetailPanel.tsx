import { useEffect } from 'react';
import type { MapCardDto } from '@antares/shared/types.ts';
import { requestSwapConfirm } from '../flows/ChronoshiftLayer.tsx';
import { openExternal } from '../flows/common.tsx';
import {
  folderTail,
  formatCount,
  formatDateMonth,
  formatKb,
  formatRating,
  formatRelative,
  healthChipLabel,
  starString,
} from '../lib/format.ts';
import { archiveInstallState } from '../lib/reconcile.ts';
import { resolveAssetUrl } from '../lib/url.ts';
import { contributeCandidates, findDiskRow, shouldNudge, useStore } from '../state/store.tsx';
import { ActionButton, AuthorChip, FacetChips, PreviewThumb, type ActionDescriptor } from './bits.tsx';
import { SocialActions } from './SocialActions.tsx';
import {
  diskUnitOf,
  displayFacts,
  matchedDetail,
  VERDICT_TITLES,
  websiteMapUrl,
  type DetailTarget,
  type DiskUnit,
} from './context.ts';
import { ExpandedView } from './ExpandedView.tsx';

/**
 * The shared detail panel (screens.md §5 + spec §5) — one mount, three tiers:
 *
 *   collapsed      34px handle: name + PRIMARY ACTION + expand affordances
 *                  (reconciliation #2)
 *   docked-compact 180px: preview thumb (three-step imagery chain) · title ·
 *                  facet chips (team suggestion with confirm/correct) · stats ·
 *                  health chip · review line · context actions — plus the
 *                  EMPTY and MULTI-SELECT states (reconciliation #4)
 *   expanded-full  overlay with the pan/zoom viewer and the
 *                  Overview / Health / Reviews / Versions tabs
 *
 * The context-aware primary action (spec §5 matrix) is kept registered via
 * actions.registerPrimaryAction so global Enter always works.
 */

export function DetailPanel() {
  const { state, actions } = useStore();

  const apiBase = state.settings?.apiBase ?? 'http://localhost:3000';
  const selTarget = state.selection.target;
  const multi = state.selection.multi;
  const detailDto = state.detail.detail;
  const running = state.chronoshift.running;

  // --- resolve the selected target ------------------------------------------

  let target: DetailTarget | null = null;
  if (selTarget !== null) {
    if (selTarget.pane === 'archive') {
      const id = selTarget.id;
      const card: MapCardDto | null =
        state.archive.items.find((c) => c.slug === id) ??
        (detailDto !== null && detailDto.slug === id ? detailDto : null);
      if (card !== null) {
        target = { kind: 'archive', card, install: archiveInstallState(card, state.disk.hashes) };
      }
    } else {
      const hit = findDiskRow(state.disk.rows, selTarget.id);
      if (hit !== null) target = { kind: 'disk', row: hit.row, unit: diskUnitOf(hit.row, hit.sub) };
    }
  }

  const det = target !== null ? matchedDetail(target, detailDto) : null;
  const facts = target !== null ? displayFacts(target, det) : null;
  const batch = multi.length > 0;

  // --- shared helpers --------------------------------------------------------

  const openWebsite = (slug: string) => {
    actions.pushToast({ kind: 'ok', glyph: '↗', title: 'Opening on the website…' });
    // main.ts routes window.open through shell.openExternal (system browser).
    openExternal(websiteMapUrl(apiBase, slug));
  };

  /** Re-run the local analysis (silent incremental rescan) and toast the real verdict. */
  const reVerify = (unit: DiskUnit) => {
    void actions.reVerify(unit.key, unit.name);
  };

  // --- context action matrix (spec §5, labels verbatim from copy.md) ---------

  function buildSingleActions(t: DetailTarget): ActionDescriptor[] {
    if (t.kind === 'archive') {
      const { card, install } = t;
      const installRun = () =>
        void actions.chronoshift([{ slug: card.slug, name: card.name, fileName: `${card.slug}.map` }]);
      if (install === 'none') {
        return [
          { key: 'install', label: '⟳ Chronoshift →', kind: 'primary', disabled: running, run: installRun },
          {
            key: 'add',
            label: 'Add to selection',
            kind: 'secondary',
            run: () => actions.toggleMulti('archive', card.slug),
          },
        ];
      }
      if (install === 'newer') {
        return [
          {
            key: 'update',
            label: 'Update →',
            kind: 'primary',
            disabled: running,
            run: () => {
              actions.pushToast({ kind: 'ok', glyph: '↑', title: 'Updating to canonical…', sub: card.name });
              installRun();
            },
          },
          {
            key: 'keep-current',
            label: 'Keep current',
            kind: 'secondary',
            run: () => actions.pushToast({ kind: 'ok', title: 'Keeping your current version.' }),
          },
          { key: 'website', label: 'Open on website', kind: 'secondary', run: () => openWebsite(card.slug) },
        ];
      }
      return [
        { key: 'reinstall', label: 'Reinstall', kind: 'primary', disabled: running, run: installRun },
        { key: 'website', label: 'Open on website', kind: 'secondary', run: () => openWebsite(card.slug) },
      ];
    }

    const { unit } = t;
    const remove: ActionDescriptor = {
      key: 'remove',
      label: 'Remove',
      kind: 'secondary',
      run: () => void actions.removeToQuarantine(unit.paths, unit.name),
    };
    const whyHealth = () => {
      actions.setDetailTier('expanded');
      actions.setDetailTab('health');
    };

    if (unit.health.verdict === 'broken') {
      if (unit.membership === 'unknown') {
        return [
          {
            key: 'quarantine',
            label: 'Quarantine',
            kind: 'primary',
            run: () => void actions.removeToQuarantine(unit.paths, unit.name),
          },
          { key: 'why', label: 'Why broken?', kind: 'secondary', run: whyHealth },
          {
            key: 'contribute-anyway',
            label: 'Contribute anyway',
            kind: 'secondary',
            disabled: unit.moderation !== 'unknown',
            run: () => actions.openContribute(),
          },
        ];
      }
      // Broken but known/update: decision #6 — confirm before swapping.
      // The shared confirm (SWAP IT / ghost cancel) lives in ChronoshiftLayer.
      const swapSlug = unit.updateTarget?.slug ?? unit.identity?.slug ?? null;
      return [
        {
          key: 'replace',
          label: 'Replace with verified copy',
          kind: 'primary',
          disabled: running || swapSlug === null,
          run: () => {
            if (swapSlug !== null) {
              requestSwapConfirm({ slug: swapSlug, name: unit.name, fileName: unit.file.fileName });
            }
          },
        },
        { key: 'why', label: 'Why?', kind: 'secondary', run: whyHealth },
        remove,
      ];
    }

    if (unit.membership === 'update') {
      const ut = unit.updateTarget;
      return [
        {
          key: 'update',
          label: 'Update (chronoshift canonical)',
          kind: 'primary',
          disabled: running || ut === null,
          run: () => {
            if (ut === null) return;
            actions.pushToast({ kind: 'ok', glyph: '↑', title: 'Updating to canonical…', sub: ut.name });
            void actions.chronoshift([{ slug: ut.slug, name: ut.name, fileName: unit.file.fileName }]);
          },
        },
        {
          key: 'keep-both',
          label: 'Keep both',
          kind: 'secondary',
          run: () => actions.pushToast({ kind: 'ok', title: 'Keeping both versions.' }),
        },
        {
          key: 'remove-old',
          label: 'Remove old',
          kind: 'secondary',
          run: () => void actions.removeToQuarantine(unit.paths, unit.name),
        },
      ];
    }

    if (unit.membership === 'known') {
      const slug = unit.identity?.slug ?? null;
      return [
        { key: 'reverify', label: 'Re-verify', kind: 'primary', run: () => reVerify(unit) },
        {
          key: 'review',
          label: 'Review it',
          kind: 'secondary',
          disabled: slug === null,
          run: () => {
            if (slug !== null) actions.openReviewModal(slug, unit.name);
          },
        },
        remove,
      ];
    }

    // Unknown, by moderation sub-state.
    const first: ActionDescriptor =
      unit.moderation === 'in-review'
        ? { key: 'in-review', label: 'In review', kind: 'primary', disabled: true, run: () => undefined }
        : {
            key: 'contribute',
            label: 'Contribute',
            kind: 'primary',
            disabled: unit.moderation === 'rejected',
            run: () => actions.openContribute(),
          };
    return [
      first,
      {
        key: 'keep-private',
        label: 'Keep private',
        kind: 'secondary',
        run: () => actions.pushToast({ kind: 'ok', title: 'Kept private.' }),
      },
      remove,
    ];
  }

  const singleActions = target !== null ? buildSingleActions(target) : [];

  // --- batch (reconciliation #4: disk side gets Remove AND Contribute) -------

  const archiveSel = multi.filter((m) => m.pane === 'archive');
  const diskSel = multi.filter((m) => m.pane === 'disk');
  const mixed = archiveSel.length > 0 && diskSel.length > 0;

  const diskSelUnits = diskSel
    .map((m) => {
      const hit = findDiskRow(state.disk.rows, m.id);
      return hit !== null ? diskUnitOf(hit.row, hit.sub) : null;
    })
    .filter((u): u is DiskUnit => u !== null);

  const batchChronoshift = () => {
    const requests = archiveSel.map((m) => {
      const card = state.archive.items.find((c) => c.slug === m.id);
      return { slug: m.id, name: card?.name ?? m.id, fileName: `${m.id}.map` };
    });
    actions.clearMulti();
    void actions.chronoshift(requests);
  };

  const batchRemove = () => {
    const paths = new Set<string>();
    for (const unit of diskSelUnits) for (const p of unit.paths) paths.add(p);
    void actions.removeToQuarantine([...paths]);
  };

  const candidates = contributeCandidates(state.disk.rows);
  const selectedHashes = new Set(diskSelUnits.map((u) => u.contentHash));
  const contributableCount = candidates.filter((c) => selectedHashes.has(c.contentHash)).length;
  const batchContribute = () => {
    actions.openContribute();
    // Narrow the pre-checked candidate set to the current selection.
    for (const c of candidates) {
      if (!selectedHashes.has(c.contentHash)) actions.toggleContributeHash(c.contentHash);
    }
  };

  const batchPrimary: ActionDescriptor | null = !batch
    ? null
    : mixed
      ? {
          key: 'mixed',
          label: 'Mixed selection — pick one side',
          kind: 'secondary',
          disabled: true,
          run: () => undefined,
        }
      : archiveSel.length > 0
        ? {
            key: 'batch-install',
            label: '⟳ Chronoshift all selected →',
            kind: 'primary',
            disabled: running,
            run: batchChronoshift,
          }
        : { key: 'batch-remove', label: 'Remove selected', kind: 'primary', run: batchRemove };

  // --- global Enter: keep the registered primary action current --------------

  const primary: ActionDescriptor | null = batch ? batchPrimary : (singleActions[0] ?? null);

  useEffect(() => {
    actions.registerPrimaryAction(
      primary !== null
        ? { label: primary.label, disabled: primary.disabled ?? false, run: primary.run }
        : null,
    );
  });
  useEffect(() => () => actions.registerPrimaryAction(null), [actions]);

  // --- imagery inputs ----------------------------------------------------------

  const localPath =
    target === null
      ? null
      : target.kind === 'disk'
        ? target.unit.file.path
        : (state.disk.files.find((f) => target.kind === 'archive' && target.card.versionHashes.includes(f.contentHash))
            ?.path ?? null);
  const thumbUrl = resolveAssetUrl(
    apiBase,
    det?.thumbnailUrl ?? (target?.kind === 'archive' ? target.card.thumbnailUrl : null),
  );
  // Full-res render (2048px) for the click-to-fullscreen lightbox — only present
  // once the archive has generated one; null → thumb stays a static tile.
  const renderUrl = resolveAssetUrl(apiBase, det?.renderUrl ?? null);
  const renderCacheKey =
    det?.canonicalHash ?? (target?.kind === 'archive' ? target.card.canonicalHash : null);

  // --- render --------------------------------------------------------------------

  const tier = state.detail.tier;
  const expanded = tier === 'expanded' && target !== null && facts !== null && !batch;
  const handleName = batch ? `${multi.length} maps selected` : (facts?.name ?? '');
  const resetKey = selTarget !== null ? `${selTarget.pane}:${selTarget.id}` : 'none';

  const nudgeRow =
    target !== null &&
    target.kind === 'disk' &&
    target.unit.key === target.row.key &&
    shouldNudge(target.row, state.nudgesDismissed)
      ? target.row
      : null;

  const quote =
    det !== null && state.detail.reviews !== null && state.detail.reviews.reviews.length > 0
      ? `"${state.detail.reviews.reviews[0]?.text ?? ''}"`
      : 'No reviews yet.';

  // Social row inputs: an archive-identity slug (bookmark/watch/share) + the
  // verified authorId (follow). Disk files with no archive match get no row.
  const socialSlug = facts?.slug ?? null;
  const socialAuthorId =
    det?.authorId ?? (target?.kind === 'archive' ? target.card.authorId : null);

  // One-line health summary — the chip's tooltip (first finding, else the verdict headline).
  const healthReport =
    target === null ? null : target.kind === 'disk' ? target.unit.health : (det?.health ?? null);
  const healthSummary =
    facts !== null && facts.healthVerdict !== null
      ? (healthReport?.findings[0] ?? VERDICT_TITLES[facts.healthVerdict])
      : null;

  const dateStr =
    facts === null
      ? null
      : facts.dateAddedIso !== null
        ? formatDateMonth(facts.dateAddedIso)
        : facts.addedAtMs !== null
          ? `added ${formatRelative(facts.addedAtMs)}`
          : null;

  const batchTargetLabel = (() => {
    const folders = state.settings?.gameFolders ?? [];
    const folder = (folders.find((f) => f.isDefault) ?? folders[0])?.path ?? null;
    return folder !== null ? `${folderTail(folder)}/Maps/Custom` : '—';
  })();

  return (
    <>
      {expanded && target !== null && facts !== null ? (
        <ExpandedView
          facts={facts}
          detail={det}
          localReport={target.kind === 'disk' ? target.unit.health : null}
          actionsList={singleActions}
          localPath={localPath}
          apiBase={apiBase}
          resetKey={resetKey}
          onReVerify={target.kind === 'disk' ? () => reVerify(target.unit) : null}
        />
      ) : (
        <div className={`detail-dock${tier === 'collapsed' ? ' collapsed' : ''}`}>
          <div className="detail-handle">
            <span className="detail-handle-title">Detail</span>
            {handleName !== '' ? <span className="detail-handle-name">— {handleName}</span> : null}
            <span className="detail-handle-spacer" />
            {tier === 'collapsed' && primary !== null ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={primary.disabled ?? false}
                onClick={primary.run}
              >
                {primary.label}
              </button>
            ) : null}
            <button
              type="button"
              className="dock-icon-btn"
              title="Collapse"
              onClick={() => actions.setDetailTier(tier === 'collapsed' ? 'compact' : 'collapsed')}
            >
              {tier === 'collapsed' ? '▴' : '▾'}
            </button>
            <button
              type="button"
              className="dock-icon-btn"
              title="Expand"
              disabled={target === null || batch}
              onClick={() => {
                if (target !== null && !batch) actions.setDetailTier('expanded');
              }}
            >
              ⤢
            </button>
          </div>
          {tier !== 'collapsed' ? (
            <div className="detail-body">
              {batch ? (
                <>
                  <div className="detail-center" style={{ justifyContent: 'center', gap: 8 }}>
                    <div className="detail-batch-count">{multi.length}</div>
                    <div className="detail-batch-sub">maps selected · target {batchTargetLabel}</div>
                    <div className="batch-chips">
                      {multi.map((m) => {
                        const name =
                          m.pane === 'archive'
                            ? (state.archive.items.find((c) => c.slug === m.id)?.name ?? m.id)
                            : (() => {
                                const hit = findDiskRow(state.disk.rows, m.id);
                                return hit !== null ? diskUnitOf(hit.row, hit.sub).name : m.id;
                              })();
                        return (
                          <span
                            key={`${m.pane}:${m.id}`}
                            className={`batch-chip ${m.pane === 'archive' ? 'from-archive' : 'from-disk'}`}
                          >
                            {name}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="detail-batch-actions">
                    {batchPrimary !== null ? <ActionButton action={batchPrimary} small={false} /> : null}
                    {!mixed && diskSel.length > 0 ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={contributableCount === 0}
                        onClick={batchContribute}
                      >
                        Contribute selected
                      </button>
                    ) : null}
                    <button type="button" className="btn btn-ghost" onClick={() => actions.clearMulti()}>
                      Clear selection
                    </button>
                  </div>
                </>
              ) : target !== null && facts !== null ? (
                <>
                  <PreviewThumb
                    path={localPath}
                    thumbUrl={thumbUrl}
                    renderUrl={renderUrl}
                    cacheKey={renderCacheKey}
                    name={facts.name}
                  />
                  <div className="detail-center">
                    <div className="detail-name">
                      <span>{facts.name}</span>
                      <AuthorChip author={facts.author} verified={facts.verifiedAuthor} />
                    </div>
                    <FacetChips facts={facts} signedIn={state.session.signedIn} />
                    <div className="detail-stats">
                      {facts.rating !== null ? (
                        <span className="row-stars">
                          {starString(facts.rating)}{' '}
                          <span className="rating-value">{formatRating(facts.rating)}</span> (
                          {formatCount(facts.reviewCount)})
                        </span>
                      ) : null}
                      {facts.downloads !== null ? <span>{formatCount(facts.downloads)} downloads</span> : null}
                      {facts.fileSizeKb !== null ? <span>{formatKb(facts.fileSizeKb)}</span> : null}
                      {dateStr !== null ? <span>{dateStr}</span> : null}
                      {facts.healthVerdict !== null ? (
                        <span
                          className={`chip chip-health-${facts.healthVerdict}`}
                          title={healthSummary ?? undefined}
                        >
                          {healthChipLabel(facts.healthVerdict)}
                        </span>
                      ) : null}
                    </div>
                    <div className="detail-quote">{quote}</div>
                    {nudgeRow !== null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <button
                          type="button"
                          className="nudge"
                          style={{ minWidth: 0 }}
                          title={`You’ve got ${nudgeRow.name} installed — review it?`}
                          onClick={() => {
                            const slug = nudgeRow.identity?.slug;
                            if (slug !== undefined) actions.openReviewModal(slug, nudgeRow.name);
                          }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            You’ve got {nudgeRow.name} installed — review it?
                          </span>
                        </button>
                        <button
                          type="button"
                          className="banner-dismiss"
                          title="Dismiss"
                          onClick={() => actions.dismissNudge(nudgeRow.contentHash)}
                        >
                          ✕
                        </button>
                      </div>
                    ) : null}
                    {socialSlug !== null ? (
                      <SocialActions
                        slug={socialSlug}
                        authorId={socialAuthorId}
                        author={facts.author}
                        apiBase={apiBase}
                      />
                    ) : null}
                  </div>
                  <div className="detail-actions">
                    {singleActions.map((a) => (
                      <ActionButton key={a.key} action={a} />
                    ))}
                  </div>
                </>
              ) : (
                <div className="detail-empty">
                  Select a map to see its detail, health, and reviews. Nothing selected.
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
