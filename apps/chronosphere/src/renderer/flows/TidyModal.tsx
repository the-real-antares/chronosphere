import { useStore } from '../state/store.tsx';
import { LocalPreviewThumb, ModalHeader, ModalShell } from './common.tsx';

/**
 * Tidy modal (screens.md §9.3, spec §8 safety rules): ONLY known
 * superseded/duplicate/broken files are proposed (lib/reconcile.ts encodes
 * that; unknown maps are protected and never auto-proposed). Preview list +
 * count before acting; applyTidy quarantines with the Undo toast.
 */

export function TidyModal() {
  const { state, actions } = useStore();
  if (!state.tidy.open) return null;

  const { proposals, applying } = state.tidy;
  const n = proposals.length;
  const close = (): void => actions.closeTidy();

  return (
    <ModalShell className="modal-tidy" onClose={close}>
      <ModalHeader onClose={close}>
        <span className="modal-title">⌦ Tidy my folder</span>
      </ModalHeader>
      <div className="modal-body">
        {n === 0 ? (
          <div className="detail-empty">
            Nothing to tidy — no known duplicates, superseded versions, or broken files.
          </div>
        ) : (
          <>
            <div className="onb-body-sm" style={{ marginBottom: 12 }}>
              These <strong style={{ color: 'var(--text-hi)' }}>known</strong> files are superseded
              or exact duplicates. They’ll be{' '}
              <strong style={{ color: 'var(--text-hi)' }}>quarantined</strong>, not deleted —
              recover any of them with one click.
            </div>
            {proposals.map((p) => (
              <div key={p.path} className="pick-row" style={{ cursor: 'default' }} title={p.path}>
                <LocalPreviewThumb path={p.path} size={34} frameClassName="pick-thumb pick-thumb-sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row-name">
                    <span>{p.name}</span>
                  </div>
                  <div className="row-meta">
                    {p.reason} · <span className="mono">{p.fileName}</span>
                  </div>
                </div>
                <span style={{ color: 'var(--text-mid)' }}>⧉</span>
              </div>
            ))}
          </>
        )}
        <div className="note-card" style={{ marginTop: 14 }}>
          <span className="protected-word">Protected:</span> unknown maps that are otherwise valid
          (like <span className="mono">final_FINAL_v3</span>) may be unpublished drafts — they’re
          never auto-proposed.
        </div>
      </div>
      <div className="modal-footer">
        <span className="modal-footer-note">{n} maps will be quarantined</span>
        <span className="modal-footer-spacer" />
        <button type="button" className="btn btn-ghost" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={applying || n === 0}
          onClick={() => void actions.applyTidy()}
        >
          Quarantine {n}
        </button>
      </div>
    </ModalShell>
  );
}
