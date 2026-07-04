import { useMemo } from 'react';
import type { MapDetailDto, MapVersionDto } from '@antares/shared/types.ts';
import { formatDateMonth } from '../lib/format.ts';
import { useStore } from '../state/store.tsx';

/**
 * Expanded detail — Versions tab (screens.md §5.3): the explainer that never
 * conflates latest with canonical, version rows with dates + tags
 * (installed / canonical / latest / superseded) and a per-version install.
 */

interface VersionRow {
  version: MapVersionDto;
  label: string;
  installed: boolean;
  canonical: boolean;
  latest: boolean;
}

export function VersionsTab({ detail }: { detail: MapDetailDto | null }) {
  const { state, actions } = useStore();
  const diskHashes = state.disk.hashes;
  const running = state.chronoshift.running;

  const rows = useMemo<VersionRow[]>(() => {
    if (detail === null) return [];
    const sorted = [...detail.versions].sort(
      (a, b) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime(),
    );
    return sorted.map((version, i) => ({
      version,
      label: `v${i + 1}`,
      installed: diskHashes.has(version.contentHash),
      canonical: version.versionId === detail.canonicalVersionId,
      latest: version.versionId === detail.latestVersionId,
    }));
  }, [detail, diskHashes]);

  if (detail === null) {
    return <div className="detail-empty">Not in the archive — no version history yet.</div>;
  }

  const install = (row: VersionRow) => {
    const fileName = row.canonical ? `${detail.slug}.map` : `${detail.slug}-${row.label}.map`;
    void actions.chronoshift([
      { slug: detail.slug, name: detail.name, fileName, versionId: row.version.versionId },
    ]);
  };

  return (
    <div>
      <div className="version-explainer">
        <span className="latest-word">Latest</span> is newest by date.{' '}
        <span className="canonical-word">Canonical</span> is the curator's pick — usually latest,
        sometimes not.
      </div>
      {rows.map((row) => (
        <div key={row.version.versionId} className={`version-row${row.canonical ? ' canonical' : ''}`}>
          <span className="version-label">{row.label}</span>
          <span className="version-date">{formatDateMonth(row.version.dateAdded)}</span>
          <span className="version-spacer" />
          {row.installed ? <span className="chip tag-installed">installed</span> : null}
          {row.canonical ? (
            <span className="chip tag-canonical">canonical</span>
          ) : row.latest ? (
            <span className="chip tag-latest">latest</span>
          ) : (
            <span className="chip tag-superseded">superseded</span>
          )}
          {!row.installed ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={running}
              onClick={() => install(row)}
            >
              ⟳ Install
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
