import { HEALTH_GLYPHS } from '@antares/shared/taxonomy.ts';
import { healthWord, playersLabel } from '../lib/format.ts';
import type { DiskRow } from '../lib/types.ts';
import type { ContributeUpload } from '../state/store.tsx';
import { contributeCandidates, useStore } from '../state/store.tsx';
import { LocalPreviewThumb, ModalHeader, ModalShell, SignInStep } from './common.tsx';

/**
 * Contribute flow (screens.md §9.2 + reconciliation #5): select (headline
 * carries the REAL candidate count) → sign-in gate → consent (names exactly
 * what uploads) → uploading (real per-item progress) → summary (per-map
 * results from the API's per-hash moderation statuses).
 */

function candidateMeta(row: DiskRow): string {
  const parts: string[] = [playersLabel(row.primary.maxPlayers)];
  if (row.primary.theater !== null) parts.push(row.primary.theater);
  if (row.primary.width !== null && row.primary.height !== null) {
    parts.push(`${row.primary.width}×${row.primary.height}`);
  }
  return parts.join(' · ');
}

function resultLabel(upload: ContributeUpload): string {
  if (upload.status === 'failed') return 'failed';
  switch (upload.resultStatus) {
    case 'in-review':
      return 'in review';
    case 'published':
      return 'already in the archive';
    case 'rejected':
      return 'rejected earlier';
    default:
      return 'queued';
  }
}

const ellipsis = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

export function ContributeModal() {
  const { state, actions } = useStore();
  const contribute = state.contribute;
  if (!contribute.open) return null;

  const close = (): void => actions.closeContribute();
  const candidates = contributeCandidates(state.disk.rows);
  const checkedCount = candidates.filter((r) => contribute.checked.has(r.contentHash)).length;
  const uploads = contribute.uploads;
  const overall =
    uploads.length > 0 ? Math.round(uploads.reduce((sum, u) => sum + u.pct, 0) / uploads.length) : 0;
  const doneCount = uploads.filter((u) => u.status === 'done').length;
  const step = contribute.step;

  return (
    <ModalShell className="modal-contribute" onClose={close}>
      <ModalHeader onClose={close}>
        <span className="modal-title">
          <span className="gold">✦</span> Contribute
        </span>
      </ModalHeader>

      <div className="modal-body">
        {step === 'select' ? (
          <>
            <div className="setting-row-title" style={{ fontSize: 15, marginBottom: 4 }}>
              {candidates.length} maps here we’ve never seen. Add them to the archive?
            </div>
            <div className="onb-body-sm" style={{ marginBottom: 12 }}>
              Nothing publishes unreviewed — everything goes through moderation.
            </div>
            {candidates.length === 0 ? (
              <div className="detail-empty">
                Nothing new to contribute — every map here is already known or queued.
              </div>
            ) : (
              candidates.map((row) => {
                const checked = contribute.checked.has(row.contentHash);
                return (
                  <div
                    key={row.contentHash}
                    className="pick-row"
                    onClick={() => actions.toggleContributeHash(row.contentHash)}
                  >
                    <span className={`row-check${checked ? ' checked' : ''}`} title="Select">
                      {checked ? '✓' : ''}
                    </span>
                    <LocalPreviewThumb path={row.primary.path} size={40} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row-name">
                        <span>{row.name}</span>
                      </div>
                      <div className="row-meta">{candidateMeta(row)}</div>
                    </div>
                    <span
                      className={`glyph-health-${row.health.verdict}`}
                      style={{ fontSize: 11, whiteSpace: 'nowrap' }}
                    >
                      {HEALTH_GLYPHS[row.health.verdict]} {healthWord(row.health.verdict)}
                    </span>
                  </div>
                );
              })
            )}
          </>
        ) : null}

        {step === 'signin' ? (
          <SignInStep
            heading="Sign in to contribute"
            body="Contributions are credited to your Discord handle — it anchors recognition and keeps the queue spam-free."
            onSignedIn={() => actions.setContributeStep('consent')}
          />
        ) : null}

        {step === 'consent' ? (
          <>
            <div className="setting-row-title" style={{ fontSize: 15, marginBottom: 12 }}>
              What gets uploaded
            </div>
            <div className="consent-row">
              <span className="consent-glyph yes">✓</span>
              <span>The selected map files and their parsed metadata (players, theater, size).</span>
            </div>
            <div className="consent-row">
              <span className="consent-glyph yes">✓</span>
              <span>Credit to your Discord handle, if accepted.</span>
            </div>
            <div className="consent-row">
              <span className="consent-glyph no">✕</span>
              <span>No personal data. No other folder contents. Nothing else on your disk.</span>
            </div>
            <div className="note-card" style={{ marginTop: 12 }}>
              Queue entries dedupe by content hash — if someone already submitted an identical
              file, credit goes to the first submitter.
            </div>
          </>
        ) : null}

        {step === 'uploading' ? (
          <>
            <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
              <div className="pane-state-title">Uploading {uploads.length} maps…</div>
              <div className="progress-track" style={{ margin: '14px 0 6px' }}>
                <div className="progress-fill gold" style={{ width: `${overall}%` }} />
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-mid)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {overall}%
              </div>
            </div>
            {uploads.map((u) => (
              <div key={u.contentHash} className="progress-row">
                <span style={{ flex: '0 0 40%', ...ellipsis }}>{u.name}</span>
                <div className="progress-track">
                  <div className="progress-fill gold" style={{ width: `${u.pct}%` }} />
                </div>
                <span
                  style={{ width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                  className={u.status === 'failed' ? 'status-err' : u.status === 'done' ? 'status-ok' : ''}
                >
                  {u.status === 'failed' ? '✕' : u.status === 'done' ? '✓' : `${u.pct}%`}
                </span>
              </div>
            ))}
          </>
        ) : null}

        {step === 'summary' ? (
          <>
            <div style={{ textAlign: 'center', marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 30,
                  color: doneCount > 0 ? 'var(--green)' : 'var(--error-text)',
                }}
              >
                {doneCount > 0 ? '✓' : '⚠'}
              </div>
              <div className="pane-state-title" style={{ marginTop: 6 }}>
                {doneCount > 0 ? `${doneCount} maps queued.` : 'Nothing was uploaded.'}
              </div>
              <div className="onb-body-sm" style={{ marginTop: 6 }}>
                {doneCount > 0
                  ? 'They’re in the moderation queue now. You’ll get contributor credit — and a badge — when they’re accepted.'
                  : 'Check the connection and try again — your maps are untouched.'}
              </div>
            </div>
            {uploads.map((u) => (
              <div
                key={u.contentHash}
                className="progress-row"
                title={u.resultMessage ?? u.error ?? ''}
              >
                <span className={u.status === 'done' ? 'status-ok' : 'status-err'}>
                  {u.status === 'done' ? '✓' : '⚠'}
                </span>
                <span style={{ flex: 1, ...ellipsis }}>{u.name}</span>
                <span className={`chip ${u.status === 'done' ? 'chip-flag-gold' : 'chip-flag-neutral'}`}>
                  {resultLabel(u)}
                </span>
              </div>
            ))}
          </>
        ) : null}
      </div>

      {step === 'select' ? (
        <div className="modal-footer">
          <span className="modal-footer-note">{checkedCount} selected</span>
          <span className="modal-footer-spacer" />
          <button type="button" className="btn btn-ghost" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={checkedCount === 0}
            onClick={() => actions.continueContribute()}
          >
            Continue →
          </button>
        </div>
      ) : null}
      {step === 'signin' ? (
        <div className="modal-footer">
          <span className="modal-footer-spacer" />
          <button type="button" className="btn btn-ghost" onClick={close}>
            Cancel
          </button>
        </div>
      ) : null}
      {step === 'consent' ? (
        <div className="modal-footer">
          <span className="modal-footer-spacer" />
          <button type="button" className="btn btn-ghost" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={checkedCount === 0}
            onClick={() => void actions.startContributeUpload()}
          >
            Upload {checkedCount} maps
          </button>
        </div>
      ) : null}
      {step === 'summary' ? (
        <div className="modal-footer">
          <span className="modal-footer-spacer" />
          <button type="button" className="btn btn-primary" onClick={close}>
            Done
          </button>
        </div>
      ) : null}
    </ModalShell>
  );
}
