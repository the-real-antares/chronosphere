import { useEffect, useState } from 'react';
import { sizeChipLabel, playersLabel, typeLabel } from '../lib/format.ts';
import { PreviewCanvas } from './PreviewCanvas.tsx';
import { TeamChip } from './TeamChip.tsx';
import { useThumbMedia } from './media.ts';
import type { DisplayFacts } from './context.ts';

/** Small shared presentational pieces for the detail panel. */

// ---------------------------------------------------------------------------
// Context actions

export interface ActionDescriptor {
  key: string;
  label: string;
  kind: 'primary' | 'secondary';
  disabled?: boolean;
  run: () => void;
}

export function ActionButton({ action, small = true }: { action: ActionDescriptor; small?: boolean }) {
  const kindClass = action.kind === 'primary' ? 'btn-primary' : 'btn-secondary';
  return (
    <button
      type="button"
      className={`btn ${kindClass}${small ? ' btn-sm' : ''}`}
      disabled={action.disabled ?? false}
      onClick={action.run}
    >
      {action.label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Author line

/** "by Antares ✦" (gold, verified id only) / "by name" / italic "source unknown". */
export function AuthorChip({ author, verified }: { author: string | null; verified: boolean }) {
  if (author === null) return <span className="author-chip unknown">source unknown</span>;
  return (
    <span className={`author-chip${verified ? ' gold' : ''}`}>
      by {author}
      {verified ? ' ✦' : ''}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Facet chips (type · players/Mission · team suggestion · theater · size · mod)

export function FacetChips({ facts, signedIn }: { facts: DisplayFacts; signedIn: boolean }) {
  return (
    <div className="chip-row">
      {facts.type !== null ? <span className="chip chip-facet">{typeLabel(facts.type)}</span> : null}
      <span className="chip chip-facet">{playersLabel(facts.maxPlayers)}</span>
      {facts.team !== null ? (
        <TeamChip suggestion={facts.team} slug={facts.slug} signedIn={signedIn} />
      ) : null}
      {facts.theater !== null ? <span className="chip chip-facet">{facts.theater}</span> : null}
      {facts.sizeClass !== null && facts.width !== null && facts.height !== null ? (
        <span className="chip chip-facet">
          {sizeChipLabel(facts.sizeClass, facts.width, facts.height)}
        </span>
      ) : null}
      {facts.healthVerdict === 'needs-mod' ? <span className="chip chip-mod">needs a mod</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Docked-compact preview thumb (embedded → archive thumb → placeholder)

export function PreviewThumb({ path, thumbUrl }: { path: string | null; thumbUrl: string | null }) {
  const media = useThumbMedia(path, thumbUrl);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setImgFailed(false);
  }, [thumbUrl]);

  if (media.kind === 'embedded') {
    return (
      <div className="detail-thumb">
        <PreviewCanvas data={media.data} />
      </div>
    );
  }
  if (media.kind === 'image' && !imgFailed) {
    return (
      <div className="detail-thumb">
        <img
          src={media.url}
          alt=""
          draggable={false}
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => setImgFailed(true)}
        />
      </div>
    );
  }
  // Styled "no preview available" tile — never a broken image (spec §4.3).
  return <div className="detail-thumb thumb-placeholder" role="img" aria-label="no preview available" />;
}
