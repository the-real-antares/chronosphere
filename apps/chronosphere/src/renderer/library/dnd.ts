/**
 * Archive-row → disk-pane drag-and-drop (reconciliation decision #3).
 * The payload rides the drag as a custom MIME type so the disk pane can
 * distinguish map drags from stray OS file drags.
 */

export const MAP_DRAG_TYPE = 'application/x-chronosphere-map';

export interface MapDragPayload {
  slug: string;
  name: string;
  fileName: string;
}

export function setMapDrag(dt: DataTransfer, payload: MapDragPayload): void {
  dt.setData(MAP_DRAG_TYPE, JSON.stringify(payload));
  dt.effectAllowed = 'copy';
}

export function hasMapDrag(dt: DataTransfer | null): boolean {
  return dt !== null && Array.from(dt.types).includes(MAP_DRAG_TYPE);
}

export function readMapDrag(dt: DataTransfer | null): MapDragPayload | null {
  if (dt === null) return null;
  const raw = dt.getData(MAP_DRAG_TYPE);
  if (raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const p = parsed as Record<string, unknown>;
      if (
        typeof p['slug'] === 'string' &&
        typeof p['name'] === 'string' &&
        typeof p['fileName'] === 'string'
      ) {
        return { slug: p['slug'], name: p['name'], fileName: p['fileName'] };
      }
    }
  } catch {
    /* malformed payload — treat as not-a-map-drag */
  }
  return null;
}
