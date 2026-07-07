import { useState } from 'react';
// Import VALUES from the taxonomy submodule, NOT the '@antares/shared' barrel
// (the barrel pulls node:crypto via hash.ts).
import { REPORT_REASONS, type ReportReason, type ReportTargetType } from '@antares/shared/taxonomy.ts';
import { ModalHeader, ModalShell } from '../flows/common.tsx';
import { useStore } from '../state/store.tsx';

/**
 * A "Report" affordance (trigger link + modal) reusable for reviews AND
 * comments. Pick a reason (REPORT_REASONS), optionally add a note, POST it to
 * /api/v1/reports. Carries the "false reports → ban" warning. Signed-out → a
 * gentle sign-in nudge (the store's promptSignIn toast, via toggle path).
 */

type Phase = 'idle' | 'submitting' | 'sent';

export function ReportDialog({
  targetType,
  targetId,
  reportedByMe = false,
}: {
  targetType: ReportTargetType;
  targetId: string;
  reportedByMe?: boolean;
}) {
  const { state, actions } = useStore();
  const signedIn = state.session.signedIn;

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState(reportedByMe);

  function openDialog() {
    if (!signedIn) {
      actions.pushToast({
        kind: 'info',
        glyph: '⚑',
        title: `Sign in to report this ${targetType}.`,
        sub: 'Reports go to the moderators under your Discord handle.',
      });
      return;
    }
    setReason('');
    setNote('');
    setError(null);
    setPhase('idle');
    setOpen(true);
  }

  async function submit() {
    if (reason === '' || phase === 'submitting') return;
    setPhase('submitting');
    setError(null);
    const trimmed = note.trim();
    const result = await actions.submitReport({
      targetType,
      targetId,
      reason,
      ...(trimmed.length > 0 ? { note: trimmed } : {}),
    });
    if (result.ok) {
      setReported(true);
      setPhase('sent');
      setTimeout(() => setOpen(false), 1400);
    } else {
      setError(result.error.message);
      setPhase('idle');
    }
  }

  return (
    <>
      <button
        type="button"
        className="thread-action thread-action-danger"
        onClick={openDialog}
        disabled={reported}
        aria-haspopup="dialog"
        title={reported ? 'You reported this' : `Report this ${targetType}`}
      >
        {reported ? 'Reported' : 'Report'}
      </button>

      {open ? (
        <ModalShell className="modal-report" onClose={() => setOpen(false)}>
          <ModalHeader onClose={() => setOpen(false)}>
            <span className="modal-title">Report this {targetType}</span>
          </ModalHeader>
          <div className="modal-body">
            {phase === 'sent' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 0' }}>
                <span style={{ color: 'var(--green)', fontSize: 20 }} aria-hidden="true">
                  ✓
                </span>
                <span style={{ color: 'var(--text-mid)' }}>
                  Thanks — our moderators will take a look.
                </span>
              </div>
            ) : (
              <>
                <div className="modal-footer-note" style={{ marginBottom: 12 }}>
                  Tell us what’s wrong. Pick the closest reason.
                </div>
                <div className="report-reasons" role="radiogroup" aria-label="Reason">
                  {REPORT_REASONS.map((r) => (
                    <label key={r.value} className="report-reason">
                      <input
                        type="radio"
                        name="report-reason"
                        value={r.value}
                        checked={reason === r.value}
                        onChange={() => setReason(r.value)}
                      />
                      <span>{r.label}</span>
                    </label>
                  ))}
                </div>
                <div className="section-label">Add a note (optional)</div>
                <textarea
                  className="input"
                  value={note}
                  maxLength={1000}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Anything the moderators should know…"
                />
                {error !== null ? (
                  <div style={{ color: 'var(--error-text)', fontSize: 12, marginTop: 8 }}>
                    ⚠ {error}
                  </div>
                ) : null}
                <div className="report-warn">
                  Reports are reviewed by moderators. Filing false or malicious reports can get your
                  account banned.
                </div>
              </>
            )}
          </div>
          {phase !== 'sent' ? (
            <div className="modal-footer">
              <span className="modal-footer-spacer" />
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={reason === '' || phase === 'submitting'}
                onClick={() => void submit()}
              >
                {phase === 'submitting' ? 'Sending…' : 'Submit report'}
              </button>
            </div>
          ) : null}
        </ModalShell>
      ) : null}
    </>
  );
}
