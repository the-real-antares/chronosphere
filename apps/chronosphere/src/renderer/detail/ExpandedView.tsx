import { featureLabel, gameModeLabel, HEALTH_GLYPHS, type HealthVerdict } from '@antares/shared/taxonomy.ts';
import type { HealthReport, MapDetailDto } from '@antares/shared/types.ts';
import { formatCount, formatKb, formatRating, formatRelative, starString } from '../lib/format.ts';
import { resolveAssetUrl } from '../lib/url.ts';
import { useActions, useAppState, type DetailTab } from '../state/store.tsx';
import { ActionButton, AuthorChip, FacetChips, type ActionDescriptor } from './bits.tsx';
import { metricsLine, VERDICT_TITLES, type DisplayFacts } from './context.ts';
import { ReviewsTab } from './ReviewsTab.tsx';
import { SocialActions } from './SocialActions.tsx';
import { useViewerMedia } from './media.ts';
import { VersionsTab } from './VersionsTab.tsx';
import { Viewer } from './Viewer.tsx';

/**
 * The expanded-full detail overlay (screens.md §5.3): header, the pan/zoom
 * viewer fed by the render-cache → embedded-preview → placeholder chain, and
 * the Overview / Health / Reviews / Versions tab column.
 */

const TAB_LABELS: Record<DetailTab, string> = {
  overview: 'Overview',
  health: 'Health',
  reviews: 'Reviews',
  versions: 'Versions',
};

export interface MapkitParity {
  localVersion: string;
  reportVersion: string;
}

export function ExpandedView({
  facts,
  detail,
  localReport,
  actionsList,
  localPath,
  apiBase,
  resetKey,
  onReVerify,
}: {
  facts: DisplayFacts;
  detail: MapDetailDto | null;
  /** Local MapKit report when the target is a disk file (local authority). */
  localReport: HealthReport | null;
  actionsList: ActionDescriptor[];
  localPath: string | null;
  apiBase: string;
  resetKey: string;
  onReVerify: (() => void) | null;
}) {
  const state = useAppState();
  const actions = useActions();
  const tab = state.detail.tab;

  const { media, markRenderFailed } = useViewerMedia({
    renderUrl: resolveAssetUrl(apiBase, detail?.renderUrl ?? null),
    cacheKey: detail?.canonicalHash ?? null,
    path: localPath,
  });

  const report = localReport ?? detail?.health ?? null;
  const parity: MapkitParity | null =
    localReport !== null &&
    detail?.health != null &&
    detail.health.mapkitVersion !== localReport.mapkitVersion
      ? { localVersion: localReport.mapkitVersion, reportVersion: detail.health.mapkitVersion }
      : null;

  const dock = () => actions.setDetailTier('compact');

  return (
    <div className="detail-expanded">
      <div className="expanded-header">
        <span className="micro">Map Detail</span>
        <div className="expanded-title">{facts.name}</div>
        <AuthorChip author={facts.author} verified={facts.verifiedAuthor} />
        <span style={{ flex: 1 }} />
        <button type="button" className="dock-icon-btn" onClick={dock}>
          – dock
        </button>
        <button type="button" className="dock-icon-btn" onClick={dock}>
          ✕ close
        </button>
      </div>
      <div className="expanded-main">
        <Viewer media={media} onRenderError={markRenderFailed} resetKey={resetKey} />
        <div className="expanded-content">
          <div className="detail-tabs">
            {(Object.keys(TAB_LABELS) as DetailTab[]).map((t) => (
              <button
                key={t}
                type="button"
                className={`detail-tab${tab === t ? ' active' : ''}`}
                onClick={() => actions.setDetailTab(t)}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="tab-body">
            {tab === 'overview' ? (
              <OverviewTab facts={facts} detail={detail} actionsList={actionsList} apiBase={apiBase} />
            ) : tab === 'health' ? (
              <HealthTab
                report={report}
                fallbackVerdict={facts.healthVerdict}
                parity={parity}
                onReVerify={onReVerify}
              />
            ) : tab === 'reviews' ? (
              <ReviewsTab slug={facts.slug} mapName={facts.name} />
            ) : (
              <VersionsTab detail={detail} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview

function OverviewTab({
  facts,
  detail,
  actionsList,
  apiBase,
}: {
  facts: DisplayFacts;
  detail: MapDetailDto | null;
  actionsList: ActionDescriptor[];
  apiBase: string;
}) {
  const state = useAppState();
  const added =
    facts.dateAddedIso !== null
      ? formatRelative(facts.dateAddedIso)
      : facts.addedAtMs !== null
        ? formatRelative(facts.addedAtMs)
        : null;
  return (
    <div>
      <FacetChips facts={facts} signedIn={state.session.signedIn} />
      {facts.slug !== null ? (
        <SocialActions
          slug={facts.slug}
          authorId={detail?.authorId ?? null}
          author={facts.author}
          apiBase={apiBase}
        />
      ) : null}
      <div className="stat-band">
        <div>
          <div className="stat-num">{facts.rating !== null ? formatRating(facts.rating) : '—'}</div>
          <div className="stat-label">
            {facts.rating !== null
              ? `${starString(facts.rating)} · ${formatCount(facts.reviewCount)} reviews`
              : `${formatCount(facts.reviewCount)} reviews`}
          </div>
        </div>
        <div>
          <div className="stat-num">
            {facts.downloads !== null ? formatCount(facts.downloads) : '—'}
          </div>
          <div className="stat-label">Downloads</div>
        </div>
        <div>
          <div className="stat-num">
            {facts.fileSizeKb !== null ? formatKb(facts.fileSizeKb) : '—'}
          </div>
          <div className="stat-label">{added !== null ? `File size · added ${added}` : 'File size'}</div>
        </div>
      </div>
      {detail?.description != null && detail.description !== '' ? (
        <>
          <div className="section-label">Description</div>
          <div className="description-body">{detail.description}</div>
        </>
      ) : null}
      {detail?.facts &&
      (detail.facts.official ||
        detail.facts.mission ||
        detail.facts.gameModes.length > 0 ||
        detail.facts.features.length > 0) ? (
        <>
          <div className="section-label">Modes &amp; features</div>
          <div className="facts-chips">
            {detail.facts.official ? <span className="fact-chip fact-chip-gold">Official</span> : null}
            {detail.facts.mission ? <span className="fact-chip fact-chip-accent">Mission</span> : null}
            {detail.facts.gameModes.map((m) => (
              <span key={m} className="fact-chip">
                {gameModeLabel(m)}
              </span>
            ))}
            {detail.facts.features.map((fk) => (
              <span key={fk} className="fact-chip fact-chip-dim">
                {featureLabel(fk)}
              </span>
            ))}
          </div>
        </>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
        {actionsList.map((a) => (
          <ActionButton key={a.key} action={a} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Health

function HealthTab({
  report,
  fallbackVerdict,
  parity,
  onReVerify,
}: {
  report: HealthReport | null;
  fallbackVerdict: HealthVerdict | null;
  parity: MapkitParity | null;
  onReVerify: (() => void) | null;
}) {
  const verdict = report?.verdict ?? fallbackVerdict;
  if (verdict === undefined || verdict === null) {
    return <div className="detail-empty">No health report yet.</div>;
  }
  const bannerClass =
    verdict === 'verified' ? ' verified' : verdict === 'broken' ? ' broken' : '';
  const metrics = report !== null ? metricsLine(report) : null;
  // "Chronosphere-verified" claims require analyzer-version parity (spec §13).
  const showBadge = verdict === 'verified' && parity === null;
  return (
    <div>
      <div className={`verdict-banner${bannerClass}`}>
        <span className={`verdict-glyph glyph-health-${verdict}`}>{HEALTH_GLYPHS[verdict]}</span>
        <div>
          <div className={`verdict-title glyph-health-${verdict}`}>{VERDICT_TITLES[verdict]}</div>
          {report !== null ? <div className="verdict-stamp">MapKit {report.mapkitVersion}</div> : null}
        </div>
        {showBadge ? (
          <span className="chip chip-verified-badge" style={{ marginLeft: 'auto' }}>
            Chronosphere-verified
          </span>
        ) : null}
      </div>
      {report !== null && (report.findings.length > 0 || metrics !== null) ? (
        <>
          <div className="section-label">Findings</div>
          {report.findings.map((finding) => (
            <div key={finding} className="finding-row">
              <span className={`glyph-health-${verdict}`}>
                {verdict === 'verified' ? '✓' : HEALTH_GLYPHS[verdict]}
              </span>
              <span>{finding}</span>
            </div>
          ))}
          {metrics !== null ? (
            <div className="finding-row">
              <span className={`glyph-health-${verdict}`}>{HEALTH_GLYPHS[verdict]}</span>
              <span>{metrics}</span>
            </div>
          ) : null}
        </>
      ) : null}
      {parity !== null ? (
        <div className="footnote">
          This report is stamped MapKit {parity.reportVersion}; your local analyzer ran MapKit{' '}
          {parity.localVersion} — re-verify to refresh it.{' '}
          {onReVerify !== null ? (
            <button type="button" className="link" onClick={onReVerify}>
              Re-verify
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="footnote">
        MapKit is a deterministic linter — it checks the file, not framerate. A clean pass isn't a
        performance promise.
      </div>
    </div>
  );
}
