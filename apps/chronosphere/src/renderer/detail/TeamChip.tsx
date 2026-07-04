import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { TEAM_LAYOUTS, type TeamLayout } from '@antares/shared/taxonomy.ts';
import type { TeamLayoutSuggestion } from '@antares/shared/types.ts';
import { teamChipLabel, teamLabel } from '../lib/format.ts';
import { useActions } from '../state/store.tsx';

/**
 * The team-layout suggestion chip ("likely 2v2 ⓘ") with the signed-in
 * confirm/correct control (reconciliation #8): a popover offering confirm or
 * a correction, posting a tag vote via the store.
 */
export function TeamChip({
  suggestion,
  slug,
  signedIn,
}: {
  suggestion: TeamLayoutSuggestion;
  slug: string | null;
  signedIn: boolean;
}) {
  const actions = useActions();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Fixed positioning so the popover never clips inside the overflow-hidden
  // detail dock; opens upward when the chip sits low in the window.
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current !== null && e.target instanceof Node && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const label = teamChipLabel(suggestion);

  if (!signedIn || slug === null) {
    return (
      <span className="chip chip-team" title="Team layout is a suggestion, not a fact — sign in to confirm or correct it.">
        {label}
      </span>
    );
  }

  const vote = (value: TeamLayout) => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      const ok = await actions.teamVote(slug, value);
      setBusy(false);
      setOpen(false);
      if (ok) actions.pushToast({ kind: 'ok', glyph: '✓', title: 'Vote sent.' });
    })();
  };

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="chip chip-team"
        style={{ cursor: 'pointer', font: 'inherit' }}
        title="Confirm or correct the team layout"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setPos(
            rect.top > window.innerHeight * 0.6
              ? { position: 'fixed', left: rect.left, bottom: window.innerHeight - rect.top + 6 }
              : { position: 'fixed', left: rect.left, top: rect.bottom + 6 },
          );
          setOpen((o) => !o);
        }}
      >
        {label}
      </button>
      {open && pos !== null ? (
        <div className="popover" style={pos}>
          <div className="micro-label">Team layout</div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => vote(suggestion.value)}
          >
            ✓ Confirm {teamLabel(suggestion.value)}
          </button>
          {TEAM_LAYOUTS.filter((t) => t !== suggestion.value).map((t) => (
            <button
              key={t}
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => vote(t)}
            >
              {teamLabel(t)}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
