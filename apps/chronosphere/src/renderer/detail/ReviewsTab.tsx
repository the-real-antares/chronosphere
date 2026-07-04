import { useState } from 'react';
import { formatRelative, starString } from '../lib/format.ts';
import { useStore } from '../state/store.tsx';

/**
 * Expanded detail — Reviews tab (screens.md §5.3): LLM summary card, sort
 * (Most helpful / Newest) + rating filter, the review list (handle + badges +
 * stars + date · version + helpful toggle), and the write-flow entry (the
 * compose modal itself is the flows agent's — triggered via the store, which
 * gates on sign-in).
 */

const NO_REVIEWS_SUMMARY = 'No reviews yet — be the first to weigh in once you’ve run it.';

export function ReviewsTab({ slug, mapName }: { slug: string | null; mapName: string }) {
  const { state, actions } = useStore();
  const [ratingFilter, setRatingFilter] = useState(0);
  const block = state.detail.reviews;
  const loading = state.detail.reviewsLoading;
  const sort = state.detail.reviewsSort;
  const signedIn = state.session.signedIn;

  if (slug === null) {
    return <div className="detail-empty">Not in the archive — no reviews yet.</div>;
  }

  const reviews =
    block === null
      ? []
      : ratingFilter === 0
        ? block.reviews
        : block.reviews.filter((r) => Math.round(r.rating) === ratingFilter);

  const summary =
    block !== null ? (block.summary ?? (block.reviewCount === 0 ? NO_REVIEWS_SUMMARY : null)) : null;

  const markHelpful = (reviewId: string) => {
    if (!signedIn) {
      actions.pushToast({ kind: 'err', title: 'Sign in to mark reviews helpful.' });
      return;
    }
    void actions.markHelpful(reviewId);
  };

  return (
    <div>
      {summary !== null ? (
        <div className="summary-card">
          <div className="summary-card-label">Summary</div>
          <div className="summary-card-text">{summary}</div>
        </div>
      ) : null}

      <div className="review-sort-row">
        <span className="micro-label">Sort</span>
        <button
          type="button"
          className={`review-sort-opt${sort === 'helpful' ? ' active' : ''}`}
          onClick={() => void actions.setReviewsSort('helpful')}
        >
          Most helpful
        </button>
        <button
          type="button"
          className={`review-sort-opt${sort === 'newest' ? ' active' : ''}`}
          onClick={() => void actions.setReviewsSort('newest')}
        >
          Newest
        </button>
        <label className="select-wrap">
          <select
            className="select"
            value={ratingFilter}
            onChange={(e) => setRatingFilter(Number(e.target.value))}
          >
            <option value={0}>All ratings</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n}★
              </option>
            ))}
          </select>
          <span className="select-chevron">⌄</span>
        </label>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => actions.openReviewModal(slug, mapName)}
        >
          ★ Write a review
        </button>
      </div>

      {loading && block === null ? (
        <div>
          <div className="skeleton-block skeleton-line" />
          <div className="skeleton-block skeleton-line" style={{ marginTop: 8 }} />
        </div>
      ) : block === null ? (
        <div className="detail-empty">Reviews live on the server — retry when the connection is back.</div>
      ) : reviews.length === 0 ? (
        <div className="detail-empty" style={{ padding: '10px 0' }}>
          Nothing matches.
        </div>
      ) : (
        reviews.map((r) => (
          <div key={r.id} className="review-item">
            <div className="review-head">
              <span className="review-handle">{r.discordHandle}</span>
              {r.badges.map((b) => (
                <span key={b} className="chip chip-contrib-badge">
                  {b}
                </span>
              ))}
              {r.status === 'pending' ? <span className="chip chip-flag-neutral">pending</span> : null}
              <span className="review-stars">{starString(r.rating)}</span>
              <span className="review-when">
                {formatRelative(r.createdAt)} · {r.versionLabel}
              </span>
            </div>
            <div className="review-text">{r.text}</div>
            <button
              type="button"
              className={`helpful-btn${(r.markedHelpfulByMe ?? false) ? ' marked' : ''}`}
              onClick={() => markHelpful(r.id)}
            >
              ▲ Helpful ({r.helpfulCount})
            </button>
          </div>
        ))
      )}
    </div>
  );
}
