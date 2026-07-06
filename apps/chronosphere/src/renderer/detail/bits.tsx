import { useEffect, useState, type ReactNode } from 'react';
import { sizeChipLabel, playersLabel, typeLabel } from '../lib/format.ts';
import { PreviewCanvas } from './PreviewCanvas.tsx';
import { RenderLightbox } from './RenderLightbox.tsx';
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
// Docked-compact preview thumb (embedded → archive thumb → placeholder).
// When a full-res render exists (renderUrl), the thumb becomes a "view full
// screen" button that opens the pan/zoom lightbox; without one it stays a
// static tile (no broken full-screen offered — spec §4 fallback).

export function PreviewThumb({
  path,
  thumbUrl,
  renderUrl = null,
  cacheKey = null,
  name = '',
}: {
  path: string | null;
  thumbUrl: string | null;
  renderUrl?: string | null;
  cacheKey?: string | null;
  name?: string;
}) {
  const media = useThumbMedia(path, thumbUrl);
  const [imgFailed, setImgFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  useEffect(() => {
    setImgFailed(false);
  }, [thumbUrl]);

  let inner: ReactNode = null;
  if (media.kind === 'embedded') {
    inner = <PreviewCanvas data={media.data} />;
  } else if (media.kind === 'image' && !imgFailed) {
    inner = (
      <img
        src={media.url}
        alt=""
        draggable={false}
        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
        onError={() => setImgFailed(true)}
      />
    );
  }
  // inner === null → styled "no preview available" tile (never a broken image).
  const placeholder = inner === null ? ' thumb-placeholder' : '';
  const canView = renderUrl !== null;

  return (
    <>
      {canView ? (
        <button
          type="button"
          className={`detail-thumb detail-thumb-btn${placeholder}`}
          title="View full screen"
          aria-label={`View the full-screen render${name !== '' ? ` of ${name}` : ''}`}
          onClick={() => setLightboxOpen(true)}
        >
          {inner}
          <span className="thumb-zoom-hint" aria-hidden="true">
            ⤢
          </span>
        </button>
      ) : (
        <div
          className={`detail-thumb${placeholder}`}
          {...(inner === null ? { role: 'img', 'aria-label': 'no preview available' } : {})}
        >
          {inner}
        </div>
      )}
      {lightboxOpen ? (
        <RenderLightbox
          renderUrl={renderUrl}
          cacheKey={cacheKey}
          name={name}
          onClose={() => setLightboxOpen(false)}
        />
      ) : null}
    </>
  );
}
