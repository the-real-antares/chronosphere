import { useEffect, useState } from 'react';
import { openExternal } from '../flows/common.tsx';
import { formatCompact } from '../lib/format.ts';
import { useStore } from '../state/store.tsx';
import { websiteMapUrl } from './context.ts';

/**
 * The detail panel's social row (spec: Stage-2 DetailPanel controls):
 *   ★ Bookmark · 🔔 Watch (+ Mute) · Follow @author · Share (copy web link /
 *   open in browser).
 * Rendered only for archive-identity targets (a real `slug`) — a disk file with
 * no archive match can't be bookmarked/watched. Watch/Follow have no GET-status
 * route, so their filled state reflects what the store learned from a toggle
 * this session; both additionally gate on sign-in for display. Signed-out taps
 * route into the app's existing sign-in nudge (via the store actions).
 */
export function SocialActions({
  slug,
  authorId,
  author,
  apiBase,
}: {
  slug: string;
  authorId: string | null;
  author: string | null;
  apiBase: string;
}) {
  const { state, actions } = useStore();
  const signedIn = state.session.signedIn;

  const bookmarked = state.bookmarks.slugs.has(slug);
  const watch = state.social.watch[slug];
  const watching = signedIn && (watch?.subscribed ?? false);
  const muted = watch?.muted ?? false;
  const follow = authorId !== null ? state.social.follow[authorId] : undefined;
  const following = signedIn && (follow?.following ?? false);

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  const webUrl = websiteMapUrl(apiBase, slug);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(webUrl);
      setCopied(true);
    } catch {
      // Clipboard blocked — fall back to opening the link so the user still
      // gets the URL (they can copy from the address bar).
      openExternal(webUrl);
    }
  }

  return (
    <div className="social-bar">
      <button
        type="button"
        className={`social-pill${bookmarked ? ' on' : ''}`}
        aria-pressed={bookmarked}
        title={bookmarked ? 'Bookmarked' : 'Bookmark this map'}
        onClick={() => void actions.toggleBookmark(slug)}
      >
        <span aria-hidden="true">{bookmarked ? '★' : '☆'}</span>
        <span>{bookmarked ? 'Bookmarked' : 'Bookmark'}</span>
      </button>

      <span className="social-watch">
        <button
          type="button"
          className={`social-pill${watching ? ' on' : ''}`}
          aria-pressed={watching}
          title={watching ? 'Watching — new reviews & versions' : 'Watch for new reviews & versions'}
          onClick={() => void actions.toggleWatch(slug)}
        >
          <span aria-hidden="true">{watching ? '🔔' : '🔕'}</span>
          <span>{watching ? 'Watching' : 'Watch'}</span>
        </button>
        {watching ? (
          <button
            type="button"
            className="social-subtle"
            aria-pressed={muted}
            title={muted ? 'Unmute this map’s notifications' : 'Mute this map’s notifications'}
            onClick={() => void actions.toggleMute(slug)}
          >
            {muted ? 'Unmute' : 'Mute'}
          </button>
        ) : null}
      </span>

      {authorId !== null ? (
        <button
          type="button"
          className={`social-pill${following ? ' on' : ''}`}
          aria-pressed={following}
          title={
            following
              ? `Unfollow ${author ?? 'this author'}`
              : `Follow ${author ?? 'this author'} for new maps & reviews`
          }
          onClick={() => void actions.toggleFollow(authorId, author ?? undefined)}
        >
          <span>{following ? 'Following' : 'Follow'}</span>
          {follow?.followerCount != null ? (
            <span className="social-count">{formatCompact(follow.followerCount)}</span>
          ) : null}
        </button>
      ) : null}

      <span className="social-spacer" />

      <button
        type="button"
        className="social-subtle"
        title="Copy the web link to this map"
        onClick={() => void copyLink()}
      >
        {copied ? 'Copied!' : 'Copy web link'}
      </button>
      <button
        type="button"
        className="social-subtle"
        title="Open this map on the website"
        onClick={() => openExternal(webUrl)}
      >
        Open in browser ↗
      </button>
    </div>
  );
}
