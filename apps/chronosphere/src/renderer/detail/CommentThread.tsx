import { useState } from 'react';
import type { CommentDto } from '@antares/shared/types.ts';
import { formatRelative } from '../lib/format.ts';
import { useStore } from '../state/store.tsx';
import { ReportDialog } from './ReportDialog.tsx';

/**
 * Flat, one-level comment thread under a review (screens parity with the web
 * CommentThread): the visible replies, a delete on the viewer's own comments
 * (or any, for moderators — driven by `canDelete`), a per-comment Report, and
 * an add-comment box. The server's link-rejection 400 (and length/empty errors)
 * surface inline. Comment state is owned by the store's reviews block, so it
 * survives tab switches; this component keeps only the composer's local draft.
 * Signed-out visitors see a "sign in to reply" line instead of the composer.
 */
export function CommentThread({
  reviewId,
  comments,
}: {
  reviewId: string;
  comments: CommentDto[];
}) {
  const { state, actions } = useStore();
  const signedIn = state.session.signedIn;

  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addComment() {
    const body = text.trim();
    if (body.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await actions.addComment(reviewId, body);
    setSubmitting(false);
    if (result.ok) {
      setText('');
    } else {
      // Covers the "Links aren’t allowed here" 400 and length/empty errors.
      setError(result.error.message);
    }
  }

  return (
    <div className="comment-thread">
      {comments.length > 0 ? (
        <div className="comment-list">
          {comments.map((c) => (
            <div className="comment-item" key={c.id}>
              <div className="comment-head">
                <span className="comment-handle">@{c.discordHandle}</span>
                {c.status === 'hidden' ? (
                  <span className="chip chip-flag-neutral">hidden — under review</span>
                ) : null}
                <span className="comment-when">{formatRelative(c.createdAt)}</span>
              </div>
              <div className="comment-body">{c.text}</div>
              <div className="comment-actions">
                <ReportDialog targetType="comment" targetId={c.id} />
                {c.canDelete === true ? (
                  <button
                    type="button"
                    className="thread-action thread-action-danger"
                    onClick={() => void actions.deleteComment(reviewId, c.id)}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {signedIn ? (
        <div className="comment-compose">
          <textarea
            className="input comment-compose-text"
            placeholder="Add a reply…"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (error !== null) setError(null);
            }}
            aria-label="Add a reply"
          />
          {error !== null ? (
            <div style={{ color: 'var(--error-text)', fontSize: 12, marginTop: 6 }}>⚠ {error}</div>
          ) : null}
          <div className="comment-compose-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={submitting || text.trim().length === 0}
              onClick={() => void addComment()}
            >
              {submitting ? 'Posting…' : 'Reply'}
            </button>
          </div>
        </div>
      ) : (
        <div className="comment-signin">
          <button
            type="button"
            className="link"
            onClick={() =>
              actions.pushToast({
                kind: 'info',
                glyph: '☆',
                title: 'Sign in to join the conversation.',
                sub: 'Replies appear under your Discord handle.',
              })
            }
          >
            Sign in
          </button>{' '}
          to reply.
        </div>
      )}
    </div>
  );
}
