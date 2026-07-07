import { useStore } from '../state/store.tsx';
import { ModalHeader, ModalShell, SignInStep } from './common.tsx';

/**
 * Review compose modal (screens.md §9.4): sign-in gate → compose (stars +
 * text; submit requires stars ≥ 1) → submitting → "Sent — pending review."
 */

export function ReviewModal() {
  const { state, actions } = useStore();
  const modal = state.reviewModal;
  if (!modal.open) return null;

  const close = (): void => actions.closeReviewModal();
  const step = modal.step;

  return (
    <ModalShell className="modal-review" onClose={close}>
      <ModalHeader onClose={close}>
        <span className="modal-title" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span className="gold">★</span> Review{' '}
          <span style={{ color: 'var(--text-mid)', fontWeight: 600 }}>— {modal.mapName}</span>
        </span>
      </ModalHeader>

      <div className="modal-body">
        {step === 'signin' ? (
          <SignInStep
            heading="Sign in to review"
            body="Reviews appear under your Discord handle — no anonymous path. Reading reviews needs no account."
            onSignedIn={() => actions.setReviewModalStep('compose')}
          />
        ) : null}

        {step === 'compose' ? (
          <>
            <div className="section-label" style={{ marginTop: 0 }}>
              Your rating
            </div>
            <div className="star-input" role="radiogroup" aria-label="Your rating">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={modal.rating === value}
                  className={`star-btn${value <= modal.rating ? ' lit' : ''}`}
                  onClick={() => actions.setReviewDraft({ rating: value })}
                >
                  {value <= modal.rating ? '★' : '☆'}
                </button>
              ))}
            </div>
            <div className="section-label">Your take</div>
            <textarea
              className="input"
              placeholder="How does it play? Balance, chokepoints, naval…"
              value={modal.text}
              onChange={(e) => actions.setReviewDraft({ text: e.target.value })}
            />
            <div className="modal-footer-note" style={{ marginTop: 10 }}>
              Your review posts immediately, stamped with the version you have installed. Anyone can
              report it if something’s off.
            </div>
            {modal.error !== null ? (
              <div style={{ color: 'var(--error-text)', fontSize: 12, marginTop: 8 }}>
                ⚠ {modal.error}
              </div>
            ) : null}
          </>
        ) : null}

        {step === 'submitting' ? (
          <div style={{ textAlign: 'center', padding: '26px 0' }}>
            <span className="spin" style={{ fontSize: 18, color: 'var(--accent)' }}>
              ⟳
            </span>
            <div className="pane-state-title" style={{ marginTop: 10 }}>
              Submitting…
            </div>
          </div>
        ) : null}

        {step === 'success' ? (
          <div style={{ textAlign: 'center', padding: '18px 0 8px' }}>
            <div style={{ fontSize: 30, color: 'var(--green)' }}>✓</div>
            <div className="pane-state-title" style={{ marginTop: 8 }}>
              Posted — it’s live.
            </div>
            <div className="onb-body-sm" style={{ marginTop: 6 }}>
              Thanks for the review. It’s visible on the map now.
            </div>
          </div>
        ) : null}
      </div>

      {step === 'compose' ? (
        <div className="modal-footer">
          <span className="modal-footer-spacer" />
          <button type="button" className="btn btn-ghost" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={modal.rating < 1}
            onClick={() => void actions.submitReview()}
          >
            Submit review
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
      {step === 'success' ? (
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
