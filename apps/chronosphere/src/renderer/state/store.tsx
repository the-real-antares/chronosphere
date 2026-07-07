import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import type {
  ArchiveSortFieldKey,
  HealthVerdict,
  MapType,
  QualityBand,
  SizeClass,
  SortDir,
  TeamLayout,
  Theater,
} from '@antares/shared/taxonomy.ts';
import { archiveSortField, HEALTH_GLYPHS } from '@antares/shared/taxonomy.ts';
import type {
  ArchiveQuery,
  CommentDto,
  HashAnnotation,
  MapCardDto,
  MapDetailDto,
  NotificationDto,
  ReviewDto,
  ReviewsBlockDto,
} from '@antares/shared/types.ts';
import type { ChronoSettings, QuarantineSummary, ScannedFile, UpdateStatus } from '../../ipc.ts';
import {
  createApiClient,
  type ApiClient,
  type ApiResult,
  type AuthMode,
  type ReportInput,
  type ReportResultDto,
} from '../api/client.ts';
import { base64ToBytes } from '../api/client.ts';
import { healthWord } from '../lib/format.ts';
import { buildDiskRows, buildTidyProposals, diskHashSet } from '../lib/reconcile.ts';
import type { DiskCounts, DiskRow, DiskSubRow, TidyProposal } from '../lib/types.ts';

/**
 * The app store: React context + reducer + async thunks bound to the typed
 * IPC surface (window.chrono) and the API client. No external state library.
 */

// ---------------------------------------------------------------------------
// State shapes

export type Phase = 'booting' | 'onboarding' | 'library';
export type Pane = 'archive' | 'disk';
export type DetailTier = 'collapsed' | 'compact' | 'expanded';
export type DetailTab = 'overview' | 'health' | 'reviews' | 'versions';
export type ConnectionState = 'online' | 'offline';
export type DiskStatusFilter = 'all' | 'known' | 'unknown' | 'update' | 'broken' | 'needsmod' | 'dup';
export type DiskSort = 'status' | 'name' | 'recent' | 'health';
export type ToastKind = 'ok' | 'err' | 'flavor' | 'info';

export interface ArchiveFilters {
  q: string;
  type: MapType | 'all';
  minPlayers: 2 | 4 | 6 | 8 | null;
  theater: Theater | 'all';
  team: TeamLayout | 'any';
  size: SizeClass | 'any';
  /** Health verdict facet (audit finding — desktop was missing this). */
  health: HealthVerdict | 'all';
  /** Coarse lint-score band (QUALITY_BANDS); 'any' clears it. */
  quality: QualityBand | 'any';
  /** Enrichment tags — a map matches if it carries ANY (OR). */
  tags: string[];
  /** 'My bookmarks' filter → bookmarked=me (no-op / prompt when signed out). */
  bookmarked: boolean;
  /** Sort field key from the shared ARCHIVE_SORT_FIELDS descriptor. */
  sort: ArchiveSortFieldKey;
  /** Sort direction; seeded from the field's defaultDir, toggleable. */
  dir: SortDir;
}

export const DEFAULT_ARCHIVE_FILTERS: ArchiveFilters = {
  q: '',
  type: 'all',
  minPlayers: null,
  theater: 'all',
  team: 'any',
  size: 'any',
  health: 'all',
  quality: 'any',
  tags: [],
  bookmarked: false,
  sort: 'downloads',
  dir: 'desc',
};

export interface ArchiveState {
  items: MapCardDto[];
  total: number;
  page: number;
  loading: boolean;
  loadingMore: boolean;
  endReached: boolean;
  /** Connection-lost / server-error state for the pane (null = fine). */
  error: string | null;
  filters: ArchiveFilters;
}

/** The authed viewer's bookmarked map slugs — hydrated once, drives the ★ stars. */
export interface BookmarksState {
  slugs: ReadonlySet<string>;
  hydrated: boolean;
}

/** Per-map watch state, learned from a toggle (no GET-status endpoint exists). */
export interface WatchState {
  subscribed: boolean;
  muted: boolean;
}

/** Per-author follow state, learned from a toggle; count is null until known. */
export interface FollowState {
  following: boolean;
  followerCount: number | null;
}

/**
 * Optimistic social state for the detail panel's Watch / Follow toggles. The
 * backend exposes no GET-status route (the web resolves it server-side at SSR),
 * so the desktop learns each target's state from its first toggle and reconciles
 * against the POST/DELETE response. Absent key → treat as not-subscribed /
 * not-following (and the UI additionally gates on sign-in).
 */
export interface SocialState {
  /** Keyed by map slug. */
  watch: Record<string, WatchState>;
  /** Keyed by verified authorId. */
  follow: Record<string, FollowState>;
}

/** In-app notification center (the bell in the title bar). */
export interface NotificationsState {
  unread: number;
  open: boolean;
  /** null → not yet loaded this session. */
  items: NotificationDto[] | null;
  loading: boolean;
  page: number;
  total: number;
}

export interface DiskFilters {
  q: string;
  status: DiskStatusFilter;
  sort: DiskSort;
}

export interface DiskState {
  files: ScannedFile[];
  annotations: ReadonlyMap<string, HashAnnotation>;
  rows: DiskRow[];
  counts: DiskCounts;
  /** Distinct content hashes on disk — drives archive install-state markers. */
  hashes: ReadonlySet<string>;
  scanning: boolean;
  scanProgress: { done: number; total: number } | null;
  scanError: string | null;
  filters: DiskFilters;
  /** Open disclosure groups (row keys). */
  openGroups: ReadonlySet<string>;
  /** Watcher-driven "N new maps found" banner count (0 = hidden). */
  newFound: number;
}

export interface SelectionState {
  /** Detail target — the last selected row from either pane. */
  target: { pane: Pane; id: string } | null;
  /** Multi-select (Space/checkbox); may span panes — batch UI resolves sides. */
  multi: { pane: Pane; id: string }[];
  focusedPane: Pane;
}

export interface DetailState {
  tier: DetailTier;
  tab: DetailTab;
  /** Archive detail for the target (also loaded for known disk rows). */
  detail: MapDetailDto | null;
  detailLoading: boolean;
  reviews: ReviewsBlockDto | null;
  reviewsLoading: boolean;
  reviewsSort: 'helpful' | 'newest';
}

export type ChronoItemStatus = 'pending' | 'downloading' | 'verifying' | 'done' | 'failed';

export interface ChronoshiftItem {
  key: string;
  slug: string;
  name: string;
  fileName: string;
  versionId: string | null;
  status: ChronoItemStatus;
  /** Coarse-but-honest per-item progress: 0 pending · 10 downloading · 80 verifying · 100 done. */
  pct: number;
  error: string | null;
  verdict: HealthVerdict | null;
}

export interface BatchSummary {
  total: number;
  succeeded: number;
  failed: { name: string; error: string }[];
}

export interface ChronoshiftState {
  running: boolean;
  items: ChronoshiftItem[];
  /** Set after a batch with failures — flows agent renders the partial-failure summary. */
  summary: BatchSummary | null;
}

export type ContributeStep = 'select' | 'signin' | 'consent' | 'uploading' | 'summary';

export interface ContributeUpload {
  contentHash: string;
  name: string;
  fileName: string;
  status: 'pending' | 'uploading' | 'done' | 'failed';
  pct: number;
  /** Per-hash moderation result from the API ('in-review' / 'published' / …). */
  resultStatus: string | null;
  resultMessage: string | null;
  error: string | null;
}

export interface ContributeState {
  open: boolean;
  step: ContributeStep;
  /** Checked candidate hashes (pre-checked on open). */
  checked: ReadonlySet<string>;
  uploads: ContributeUpload[];
}

export interface TidyState {
  open: boolean;
  proposals: TidyProposal[];
  applying: boolean;
}

export type ReviewModalStep = 'signin' | 'compose' | 'submitting' | 'success';

export interface ReviewModalState {
  open: boolean;
  slug: string | null;
  mapName: string;
  step: ReviewModalStep;
  rating: number;
  text: string;
  error: string | null;
}

export interface VersionPickerState {
  open: boolean;
  slug: string | null;
  mapName: string;
}

export interface SessionState {
  signedIn: boolean;
  handle: string | null;
  checking: boolean;
}

export interface ToastItem {
  id: number;
  kind: ToastKind;
  glyph: string;
  title: string;
  sub: string | null;
  actionLabel: string | null;
  onAction: (() => void) | null;
}

export interface ActivityEntry {
  id: string;
  glyph: string;
  text: string;
  /** Epoch ms — render with formatRelative(). */
  at: number;
}

export interface StorageInfo {
  quarantine: QuarantineSummary[];
  renderCacheBytes: number;
}

export interface AppState {
  phase: Phase;
  bootError: string | null;
  settings: ChronoSettings | null;
  connection: ConnectionState;
  session: SessionState;
  authMode: AuthMode | 'unknown';
  archive: ArchiveState;
  bookmarks: BookmarksState;
  social: SocialState;
  notifications: NotificationsState;
  disk: DiskState;
  selection: SelectionState;
  detail: DetailState;
  chronoshift: ChronoshiftState;
  contribute: ContributeState;
  tidy: TidyState;
  reviewModal: ReviewModalState;
  versionPicker: VersionPickerState;
  settingsModalOpen: boolean;
  activityDrawerOpen: boolean;
  toasts: ToastItem[];
  activity: ActivityEntry[];
  /** Dismissed review nudges, per contentHash (persisted). */
  nudgesDismissed: ReadonlySet<string>;
  storage: StorageInfo | null;
}

export function createInitialState(): AppState {
  return {
    phase: 'booting',
    bootError: null,
    settings: null,
    connection: 'online',
    session: { signedIn: false, handle: null, checking: false },
    authMode: 'unknown',
    archive: {
      items: [],
      total: 0,
      page: 0,
      loading: false,
      loadingMore: false,
      endReached: false,
      error: null,
      filters: { ...DEFAULT_ARCHIVE_FILTERS },
    },
    bookmarks: { slugs: new Set(), hydrated: false },
    social: { watch: {}, follow: {} },
    notifications: { unread: 0, open: false, items: null, loading: false, page: 0, total: 0 },
    disk: {
      files: [],
      annotations: new Map(),
      rows: [],
      counts: { total: 0, known: 0, unknown: 0, update: 0, broken: 0, dup: 0 },
      hashes: new Set(),
      scanning: false,
      scanProgress: null,
      scanError: null,
      filters: { q: '', status: 'all', sort: 'status' },
      openGroups: new Set(),
      newFound: 0,
    },
    selection: { target: null, multi: [], focusedPane: 'archive' },
    detail: {
      tier: 'compact',
      tab: 'overview',
      detail: null,
      detailLoading: false,
      reviews: null,
      reviewsLoading: false,
      reviewsSort: 'helpful',
    },
    chronoshift: { running: false, items: [], summary: null },
    contribute: { open: false, step: 'select', checked: new Set(), uploads: [] },
    tidy: { open: false, proposals: [], applying: false },
    reviewModal: {
      open: false,
      slug: null,
      mapName: '',
      step: 'compose',
      rating: 0,
      text: '',
      error: null,
    },
    versionPicker: { open: false, slug: null, mapName: '' },
    settingsModalOpen: false,
    activityDrawerOpen: false,
    toasts: [],
    activity: [],
    nudgesDismissed: new Set(),
    storage: null,
  };
}

// ---------------------------------------------------------------------------
// Actions (reducer input)

type Action =
  | { type: 'phase/set'; phase: Phase }
  | { type: 'boot/error'; message: string }
  | { type: 'settings/loaded'; settings: ChronoSettings }
  | { type: 'hydrate'; activity: ActivityEntry[]; nudgesDismissed: Set<string> }
  | { type: 'connection/set'; online: boolean }
  | { type: 'session/set'; signedIn: boolean; handle: string | null; checking: boolean }
  | { type: 'authMode/set'; mode: AuthMode }
  | { type: 'archive/loadStart'; reset: boolean }
  | { type: 'archive/loadOk'; items: MapCardDto[]; total: number; page: number; append: boolean }
  | { type: 'archive/loadErr'; message: string }
  | { type: 'archive/filters'; patch: Partial<ArchiveFilters> }
  | { type: 'bookmark/hydrated'; slugs: Set<string> }
  | { type: 'bookmark/set'; slug: string; on: boolean }
  | { type: 'social/watchSet'; slug: string; watch: WatchState }
  | { type: 'social/followSet'; authorId: string; follow: FollowState }
  | { type: 'notif/unread'; unread: number }
  | { type: 'notif/open'; open: boolean }
  | { type: 'notif/loadStart' }
  | {
      type: 'notif/loaded';
      items: NotificationDto[];
      total: number;
      unread: number;
      page: number;
      append: boolean;
    }
  | { type: 'notif/loadErr' }
  | { type: 'notif/markRead'; ids: string[] | 'all' }
  | { type: 'scan/start' }
  | { type: 'scan/progress'; done: number; total: number }
  | {
      type: 'scan/done';
      files: ScannedFile[];
      annotations: Map<string, HashAnnotation>;
      rows: DiskRow[];
      counts: DiskCounts;
      error: string | null;
    }
  | { type: 'scan/error'; message: string }
  | { type: 'disk/filters'; patch: Partial<DiskFilters> }
  | { type: 'disk/toggleGroup'; key: string }
  | { type: 'disk/newFound'; add: number }
  | { type: 'disk/dismissNewFound' }
  | { type: 'select'; pane: Pane; id: string }
  | { type: 'selection/clearTarget' }
  | { type: 'selection/toggleMulti'; pane: Pane; id: string }
  | { type: 'selection/clearMulti' }
  | { type: 'selection/focusPane'; pane: Pane }
  | { type: 'detail/tier'; tier: DetailTier }
  | { type: 'detail/tab'; tab: DetailTab }
  | { type: 'detail/loading' }
  | { type: 'detail/loaded'; detail: MapDetailDto | null }
  | { type: 'reviews/loading' }
  | { type: 'reviews/loaded'; block: ReviewsBlockDto | null }
  | { type: 'reviews/sort'; sort: 'helpful' | 'newest' }
  | { type: 'chrono/start'; items: ChronoshiftItem[] }
  | { type: 'chrono/item'; key: string; patch: Partial<ChronoshiftItem> }
  | { type: 'chrono/finish'; summary: BatchSummary | null }
  | { type: 'chrono/clearSummary' }
  | { type: 'tidy/open'; proposals: TidyProposal[] }
  | { type: 'tidy/close' }
  | { type: 'tidy/applying'; applying: boolean }
  | { type: 'contribute/open'; checked: Set<string> }
  | { type: 'contribute/close' }
  | { type: 'contribute/step'; step: ContributeStep }
  | { type: 'contribute/toggle'; hash: string }
  | { type: 'contribute/uploads'; uploads: ContributeUpload[] }
  | { type: 'contribute/uploadPatch'; hash: string; patch: Partial<ContributeUpload> }
  | { type: 'reviewModal/open'; slug: string; mapName: string; step: ReviewModalStep }
  | { type: 'reviewModal/close' }
  | { type: 'reviewModal/step'; step: ReviewModalStep }
  | { type: 'reviewModal/draft'; rating: number | null; text: string | null }
  | { type: 'reviewModal/error'; message: string | null }
  | { type: 'versionPicker/open'; slug: string; mapName: string }
  | { type: 'versionPicker/close' }
  | { type: 'toast/push'; toast: ToastItem }
  | { type: 'toast/dismiss'; id: number }
  | { type: 'activity/add'; entry: ActivityEntry }
  | { type: 'nudge/dismiss'; hash: string }
  | { type: 'settingsModal/set'; open: boolean }
  | { type: 'activityDrawer/set'; open: boolean }
  | { type: 'storage/set'; info: StorageInfo };

// ---------------------------------------------------------------------------
// Reducer

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'phase/set':
      return { ...state, phase: action.phase };
    case 'boot/error':
      return { ...state, bootError: action.message };
    case 'settings/loaded':
      return { ...state, settings: action.settings };
    case 'hydrate':
      return { ...state, activity: action.activity, nudgesDismissed: action.nudgesDismissed };
    case 'connection/set':
      return { ...state, connection: action.online ? 'online' : 'offline' };
    case 'session/set':
      return {
        ...state,
        session: { signedIn: action.signedIn, handle: action.handle, checking: action.checking },
      };
    case 'authMode/set':
      return { ...state, authMode: action.mode };

    case 'archive/loadStart':
      return {
        ...state,
        archive: {
          ...state.archive,
          loading: action.reset,
          loadingMore: !action.reset,
          error: null,
          ...(action.reset ? { items: [], page: 0, endReached: false } : {}),
        },
      };
    case 'archive/loadOk': {
      const items = action.append ? [...state.archive.items, ...action.items] : action.items;
      return {
        ...state,
        archive: {
          ...state.archive,
          items,
          total: action.total,
          page: action.page,
          loading: false,
          loadingMore: false,
          endReached: items.length >= action.total,
          error: null,
        },
      };
    }
    case 'archive/loadErr':
      return {
        ...state,
        archive: { ...state.archive, loading: false, loadingMore: false, error: action.message },
      };
    case 'archive/filters':
      return {
        ...state,
        archive: { ...state.archive, filters: { ...state.archive.filters, ...action.patch } },
      };
    case 'bookmark/hydrated':
      return { ...state, bookmarks: { slugs: action.slugs, hydrated: true } };
    case 'bookmark/set': {
      const slugs = new Set(state.bookmarks.slugs);
      if (action.on) slugs.add(action.slug);
      else slugs.delete(action.slug);
      return { ...state, bookmarks: { ...state.bookmarks, slugs } };
    }
    case 'social/watchSet':
      return {
        ...state,
        social: { ...state.social, watch: { ...state.social.watch, [action.slug]: action.watch } },
      };
    case 'social/followSet':
      return {
        ...state,
        social: {
          ...state.social,
          follow: { ...state.social.follow, [action.authorId]: action.follow },
        },
      };
    case 'notif/unread':
      return { ...state, notifications: { ...state.notifications, unread: action.unread } };
    case 'notif/open':
      return { ...state, notifications: { ...state.notifications, open: action.open } };
    case 'notif/loadStart':
      return { ...state, notifications: { ...state.notifications, loading: true } };
    case 'notif/loaded': {
      const items = action.append
        ? [...(state.notifications.items ?? []), ...action.items]
        : action.items;
      return {
        ...state,
        notifications: {
          ...state.notifications,
          items,
          total: action.total,
          unread: action.unread,
          page: action.page,
          loading: false,
        },
      };
    }
    case 'notif/loadErr':
      return { ...state, notifications: { ...state.notifications, loading: false } };
    case 'notif/markRead': {
      const items = state.notifications.items;
      if (items === null) return state;
      const markAll = action.ids === 'all';
      const idSet = markAll ? null : new Set(action.ids);
      const next = items.map((n) =>
        !n.read && (markAll || idSet!.has(n.id)) ? { ...n, read: true } : n,
      );
      const unread = next.reduce((acc, n) => acc + (n.read ? 0 : 1), 0);
      return { ...state, notifications: { ...state.notifications, items: next, unread } };
    }

    case 'scan/start':
      return {
        ...state,
        disk: { ...state.disk, scanning: true, scanProgress: null, scanError: null },
      };
    case 'scan/progress':
      return {
        ...state,
        disk: { ...state.disk, scanProgress: { done: action.done, total: action.total } },
      };
    case 'scan/done':
      return {
        ...state,
        disk: {
          ...state.disk,
          files: action.files,
          annotations: action.annotations,
          rows: action.rows,
          counts: action.counts,
          hashes: diskHashSet(action.files),
          scanning: false,
          scanProgress: null,
          scanError: action.error,
        },
      };
    case 'scan/error':
      return {
        ...state,
        disk: { ...state.disk, scanning: false, scanProgress: null, scanError: action.message },
      };
    case 'disk/filters':
      return {
        ...state,
        disk: { ...state.disk, filters: { ...state.disk.filters, ...action.patch } },
      };
    case 'disk/toggleGroup': {
      const open = new Set(state.disk.openGroups);
      if (open.has(action.key)) open.delete(action.key);
      else open.add(action.key);
      return { ...state, disk: { ...state.disk, openGroups: open } };
    }
    case 'disk/newFound':
      return { ...state, disk: { ...state.disk, newFound: state.disk.newFound + action.add } };
    case 'disk/dismissNewFound':
      return { ...state, disk: { ...state.disk, newFound: 0 } };

    case 'select':
      return {
        ...state,
        selection: {
          ...state.selection,
          target: { pane: action.pane, id: action.id },
          focusedPane: action.pane,
        },
        detail: {
          ...state.detail,
          tab: 'overview',
          // Selecting pops the dock out of collapsed, never auto-expands.
          tier: state.detail.tier === 'collapsed' ? 'compact' : state.detail.tier,
        },
      };
    case 'selection/clearTarget':
      return {
        ...state,
        selection: { ...state.selection, target: null },
        detail: { ...state.detail, detail: null, reviews: null },
      };
    case 'selection/toggleMulti': {
      const exists = state.selection.multi.some(
        (m) => m.pane === action.pane && m.id === action.id,
      );
      const multi = exists
        ? state.selection.multi.filter((m) => !(m.pane === action.pane && m.id === action.id))
        : [...state.selection.multi, { pane: action.pane, id: action.id }];
      return { ...state, selection: { ...state.selection, multi } };
    }
    case 'selection/clearMulti':
      return { ...state, selection: { ...state.selection, multi: [] } };
    case 'selection/focusPane':
      return { ...state, selection: { ...state.selection, focusedPane: action.pane } };

    case 'detail/tier':
      return { ...state, detail: { ...state.detail, tier: action.tier } };
    case 'detail/tab':
      return { ...state, detail: { ...state.detail, tab: action.tab } };
    case 'detail/loading':
      return { ...state, detail: { ...state.detail, detailLoading: true } };
    case 'detail/loaded':
      return { ...state, detail: { ...state.detail, detail: action.detail, detailLoading: false } };
    case 'reviews/loading':
      return { ...state, detail: { ...state.detail, reviewsLoading: true } };
    case 'reviews/loaded':
      return { ...state, detail: { ...state.detail, reviews: action.block, reviewsLoading: false } };
    case 'reviews/sort':
      return { ...state, detail: { ...state.detail, reviewsSort: action.sort } };

    case 'chrono/start':
      return { ...state, chronoshift: { running: true, items: action.items, summary: null } };
    case 'chrono/item':
      return {
        ...state,
        chronoshift: {
          ...state.chronoshift,
          items: state.chronoshift.items.map((item) =>
            item.key === action.key ? { ...item, ...action.patch } : item,
          ),
        },
      };
    case 'chrono/finish':
      return {
        ...state,
        chronoshift: { ...state.chronoshift, running: false, summary: action.summary },
      };
    case 'chrono/clearSummary':
      return { ...state, chronoshift: { ...state.chronoshift, summary: null, items: [] } };

    case 'tidy/open':
      return { ...state, tidy: { open: true, proposals: action.proposals, applying: false } };
    case 'tidy/close':
      return { ...state, tidy: { ...state.tidy, open: false } };
    case 'tidy/applying':
      return { ...state, tidy: { ...state.tidy, applying: action.applying } };

    case 'contribute/open':
      return {
        ...state,
        contribute: { open: true, step: 'select', checked: action.checked, uploads: [] },
      };
    case 'contribute/close':
      return { ...state, contribute: { ...state.contribute, open: false } };
    case 'contribute/step':
      return { ...state, contribute: { ...state.contribute, step: action.step } };
    case 'contribute/toggle': {
      const checked = new Set(state.contribute.checked);
      if (checked.has(action.hash)) checked.delete(action.hash);
      else checked.add(action.hash);
      return { ...state, contribute: { ...state.contribute, checked } };
    }
    case 'contribute/uploads':
      return { ...state, contribute: { ...state.contribute, uploads: action.uploads } };
    case 'contribute/uploadPatch':
      return {
        ...state,
        contribute: {
          ...state.contribute,
          uploads: state.contribute.uploads.map((u) =>
            u.contentHash === action.hash ? { ...u, ...action.patch } : u,
          ),
        },
      };

    case 'reviewModal/open':
      return {
        ...state,
        reviewModal: {
          open: true,
          slug: action.slug,
          mapName: action.mapName,
          step: action.step,
          rating: 0,
          text: '',
          error: null,
        },
      };
    case 'reviewModal/close':
      return { ...state, reviewModal: { ...state.reviewModal, open: false } };
    case 'versionPicker/open':
      return { ...state, versionPicker: { open: true, slug: action.slug, mapName: action.mapName } };
    case 'versionPicker/close':
      return { ...state, versionPicker: { ...state.versionPicker, open: false } };
    case 'reviewModal/step':
      return { ...state, reviewModal: { ...state.reviewModal, step: action.step, error: null } };
    case 'reviewModal/draft':
      return {
        ...state,
        reviewModal: {
          ...state.reviewModal,
          rating: action.rating ?? state.reviewModal.rating,
          text: action.text ?? state.reviewModal.text,
        },
      };
    case 'reviewModal/error':
      return { ...state, reviewModal: { ...state.reviewModal, error: action.message } };

    case 'toast/push':
      return { ...state, toasts: [...state.toasts, action.toast] };
    case 'toast/dismiss':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };

    case 'activity/add':
      return { ...state, activity: [action.entry, ...state.activity].slice(0, ACTIVITY_CAP) };
    case 'nudge/dismiss': {
      const dismissed = new Set(state.nudgesDismissed);
      dismissed.add(action.hash);
      return { ...state, nudgesDismissed: dismissed };
    }

    case 'settingsModal/set':
      return { ...state, settingsModalOpen: action.open };
    case 'activityDrawer/set':
      return { ...state, activityDrawerOpen: action.open };
    case 'storage/set':
      return { ...state, storage: action.info };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Constants & pure selectors

export const ACTIVITY_CAP = 200;
const ACTIVITY_KEY = 'chronosphere.activity.v1';
const NUDGES_KEY = 'chronosphere.nudges-dismissed.v1';
const TOAST_DISMISS_MS = 4200;
const TOAST_DISMISS_ACTION_MS = 7000;
const ANNOTATE_BATCH = 500;

/** Voice lines (Settings toggle, default OFF) — rendered as a suffix on the relevant toast. */
export const FLAVOR_LINES = {
  install: 'Kirov reporting.',
  scan: 'Battle control online.',
  broken: 'Cannot deploy here.',
} as const;

/** Find a disk row or sub-row by its selectable id. */
export function findDiskRow(
  rows: readonly DiskRow[],
  id: string,
): { row: DiskRow; sub: DiskSubRow | null } | null {
  for (const row of rows) {
    if (row.key === id) return { row, sub: null };
    for (const sub of row.subRows) {
      if (sub.key === id) return { row, sub };
    }
  }
  return null;
}

/** Unknown-and-not-yet-queued rows — the Contribute flow's candidate list. */
export function contributeCandidates(rows: readonly DiskRow[]): DiskRow[] {
  return rows.filter((r) => r.membership === 'unknown' && r.moderation === 'unknown');
}

/** Review-nudge visibility: installed (known) + reviewable + not dismissed. */
export function shouldNudge(row: DiskRow, dismissed: ReadonlySet<string>): boolean {
  return (
    row.membership === 'known' && row.identity !== null && !dismissed.has(row.contentHash)
  );
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function loadPersisted(): { activity: ActivityEntry[]; nudgesDismissed: Set<string> } {
  let activity: ActivityEntry[] = [];
  let nudgesDismissed = new Set<string>();
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        activity = parsed
          .filter(
            (e): e is ActivityEntry =>
              typeof e === 'object' &&
              e !== null &&
              typeof (e as ActivityEntry).id === 'string' &&
              typeof (e as ActivityEntry).glyph === 'string' &&
              typeof (e as ActivityEntry).text === 'string' &&
              typeof (e as ActivityEntry).at === 'number',
          )
          .slice(0, ACTIVITY_CAP);
      }
    }
  } catch {
    /* corrupt storage — start clean */
  }
  try {
    const raw = localStorage.getItem(NUDGES_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        nudgesDismissed = new Set(parsed.filter((h): h is string => typeof h === 'string'));
      }
    }
  } catch {
    /* corrupt storage — start clean */
  }
  return { activity, nudgesDismissed };
}

// ---------------------------------------------------------------------------
// Thunks / actions surface

export interface ChronoshiftRequest {
  slug: string;
  name: string;
  fileName: string;
  versionId?: string;
}

export interface PrimaryAction {
  label: string;
  disabled: boolean;
  run: () => void;
}

interface Deps {
  dispatch: (action: Action) => void;
  getState: () => AppState;
  api: ApiClient;
}

function createActions(deps: Deps) {
  const { dispatch, getState, api } = deps;

  let toastSeq = 0;
  let detailSeq = 0;
  // Registered by the pane/detail agents — kept out of state to avoid render loops.
  const visibleIds: Record<Pane, string[]> = { archive: [], disk: [] };
  const searchEls: Record<Pane, HTMLInputElement | null> = { archive: null, disk: null };
  let primaryAction: PrimaryAction | null = null;

  function settings(): ChronoSettings | null {
    return getState().settings;
  }

  function flavorOn(): boolean {
    return settings()?.easterEggs ?? false;
  }

  /** Append a voice line to a toast sub when easter eggs are on. */
  function withFlavor(sub: string, line: string): string {
    return flavorOn() ? `${sub} · ${line}` : sub;
  }

  function defaultFolder(): string | null {
    const folders = settings()?.gameFolders ?? [];
    return (folders.find((f) => f.isDefault) ?? folders[0])?.path ?? null;
  }

  // --- toasts ---------------------------------------------------------------

  function pushToast(input: {
    kind: ToastKind;
    glyph?: string;
    title: string;
    sub?: string;
    actionLabel?: string;
    onAction?: () => void;
  }): number {
    const id = ++toastSeq;
    const toast: ToastItem = {
      id,
      kind: input.kind,
      glyph: input.glyph ?? (input.kind === 'err' ? '⚠' : input.kind === 'ok' ? '✓' : '✦'),
      title: input.title,
      sub: input.sub ?? null,
      actionLabel: input.actionLabel ?? null,
      onAction: input.onAction ?? null,
    };
    dispatch({ type: 'toast/push', toast });
    const ttl = toast.actionLabel !== null ? TOAST_DISMISS_ACTION_MS : TOAST_DISMISS_MS;
    setTimeout(() => dispatch({ type: 'toast/dismiss', id }), ttl);
    return id;
  }

  function dismissToast(id: number): void {
    dispatch({ type: 'toast/dismiss', id });
  }

  // --- activity ----------------------------------------------------------------

  function addActivity(glyph: string, text: string): void {
    const entry: ActivityEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      glyph,
      text,
      at: Date.now(),
    };
    dispatch({ type: 'activity/add', entry });
    try {
      const next = [entry, ...getState().activity].slice(0, ACTIVITY_CAP);
      localStorage.setItem(ACTIVITY_KEY, JSON.stringify(next));
    } catch {
      /* storage full — activity stays in memory */
    }
  }

  // --- connection ----------------------------------------------------------------

  function onConnectionChange(online: boolean): void {
    const prev = getState().connection;
    if (online && prev === 'offline') {
      dispatch({ type: 'connection/set', online: true });
      pushToast({ kind: 'ok', glyph: '●', title: 'Reconnected.', sub: 'Archive is live again.' });
    } else if (!online && prev === 'online') {
      dispatch({ type: 'connection/set', online: false });
      pushToast({
        kind: 'err',
        title: 'Connection lost.',
        sub: 'Server-backed actions paused. Disk still works.',
      });
    }
  }

  function retryConnection(): void {
    void loadArchive(true);
  }

  // --- settings -------------------------------------------------------------------

  async function updateSettings(patch: Partial<ChronoSettings>): Promise<ChronoSettings> {
    const next = await window.chrono.settings.set(patch);
    dispatch({ type: 'settings/loaded', settings: next });
    return next;
  }

  async function addGameFolder(path: string): Promise<{ ok: boolean; reason: string }> {
    const validation = await window.chrono.gameFolder.validate(path);
    if (!validation.ok) return validation;
    const current = settings()?.gameFolders ?? [];
    if (current.some((f) => f.path === path)) return { ok: true, reason: 'already added' };
    const gameFolders = [...current, { path, isDefault: current.length === 0 }];
    await updateSettings({ gameFolders });
    void rescan(true);
    return validation;
  }

  async function removeGameFolder(path: string): Promise<void> {
    const current = settings()?.gameFolders ?? [];
    let gameFolders = current.filter((f) => f.path !== path);
    if (gameFolders.length > 0 && !gameFolders.some((f) => f.isDefault)) {
      gameFolders = gameFolders.map((f, i) => ({ ...f, isDefault: i === 0 }));
    }
    await updateSettings({ gameFolders });
    void rescan(true);
  }

  async function setDefaultFolder(path: string): Promise<void> {
    const current = settings()?.gameFolders ?? [];
    await updateSettings({
      gameFolders: current.map((f) => ({ ...f, isDefault: f.path === path })),
    });
  }

  function autoDetectFolders(): Promise<string[]> {
    return window.chrono.gameFolder.autoDetect();
  }

  async function setApiBase(apiBase: string): Promise<void> {
    await updateSettings({ apiBase });
    void loadArchive(true);
  }

  async function loadStorageInfo(): Promise<void> {
    const [quarantine, renderCacheBytes] = await Promise.all([
      window.chrono.quarantine.list(),
      window.chrono.renderCache.cacheSize(),
    ]);
    dispatch({ type: 'storage/set', info: { quarantine, renderCacheBytes } });
  }

  async function clearRenderCache(): Promise<void> {
    await window.chrono.renderCache.clear();
    await loadStorageInfo();
  }

  async function emptyQuarantine(): Promise<void> {
    await window.chrono.quarantine.emptyQuarantine();
    await loadStorageInfo();
  }

  async function restoreQuarantine(id: string): Promise<void> {
    const result = await window.chrono.quarantine.undo(id);
    pushToast({ kind: 'ok', title: result.restored === 1 ? 'Restored.' : `Restored ${result.restored} maps.` });
    await loadStorageInfo();
    void rescan(true);
  }

  // --- session --------------------------------------------------------------------

  async function checkSession(): Promise<void> {
    dispatch({ type: 'session/set', signedIn: false, handle: null, checking: true });
    const result = await api.getSession();
    if (result.ok) {
      dispatch({
        type: 'session/set',
        signedIn: result.data.signedIn,
        handle: result.data.discordHandle,
        checking: false,
      });
      if (result.data.signedIn) void hydrateBookmarks();
    } else {
      dispatch({ type: 'session/set', signedIn: false, handle: null, checking: false });
    }
  }

  /** Probe GET /api/auth/discord: redirect → 'discord'; 404 → 'dev' (DEV MODE sign-in). */
  async function checkAuthMode(): Promise<AuthMode> {
    const mode = await api.checkAuthMode();
    dispatch({ type: 'authMode/set', mode });
    return mode;
  }

  async function devSignIn(handle: string): Promise<boolean> {
    const result = await api.devSignin(handle);
    if (!result.ok) {
      pushToast({ kind: 'err', title: 'Sign-in failed.', sub: result.error.message });
      return false;
    }
    await window.chrono.settings.setAuthToken(result.data.token);
    const next = await window.chrono.settings.get();
    dispatch({ type: 'settings/loaded', settings: next });
    dispatch({
      type: 'session/set',
      signedIn: true,
      handle: result.data.discordHandle,
      checking: false,
    });
    pushToast({
      kind: 'ok',
      title: 'Signed in with Discord.',
      sub: `@${result.data.discordHandle} — review, tag, and contribute unlocked.`,
    });
    void hydrateBookmarks();
    return true;
  }

  async function signInWithDiscord(): Promise<boolean> {
    // The browser flow returns the token to a loopback server, which the main
    // process stores into settings; reflect it the same way devSignIn does.
    const result = await window.chrono.auth.beginDiscord();
    if (!result?.token) return false;
    const next = await window.chrono.settings.get();
    dispatch({ type: 'settings/loaded', settings: next });
    dispatch({ type: 'session/set', signedIn: true, handle: result.handle, checking: false });
    pushToast({
      kind: 'ok',
      title: 'Signed in with Discord.',
      sub: `@${result.handle} — review, tag, and contribute unlocked.`,
    });
    void hydrateBookmarks();
    return true;
  }

  async function signOut(): Promise<void> {
    await api.signout();
    await window.chrono.settings.setAuthToken(null);
    const next = await window.chrono.settings.get();
    dispatch({ type: 'settings/loaded', settings: next });
    dispatch({ type: 'session/set', signedIn: false, handle: null, checking: false });
    // Clear the ★ set and any bookmarks-only filter so the pane isn't stuck empty.
    dispatch({ type: 'bookmark/hydrated', slugs: new Set() });
    if (getState().archive.filters.bookmarked) setArchiveFilters({ bookmarked: false });
    pushToast({ kind: 'ok', title: 'Signed out.' });
  }

  // --- archive ---------------------------------------------------------------------

  function buildQuery(page: number): ArchiveQuery {
    const f = getState().archive.filters;
    return {
      page,
      perPage: 24,
      sort: f.sort,
      dir: f.dir,
      type: f.type,
      theater: f.theater,
      team: f.team,
      size: f.size,
      ...(f.health !== 'all' ? { health: f.health } : {}),
      ...(f.quality !== 'any' ? { quality: f.quality } : {}),
      ...(f.tags.length > 0 ? { tags: f.tags } : {}),
      ...(f.bookmarked ? { bookmarked: 'me' as const } : {}),
      ...(f.q.trim().length > 0 ? { q: f.q.trim() } : {}),
      ...(f.minPlayers !== null ? { minPlayers: f.minPlayers } : {}),
    };
  }

  async function loadArchive(reset: boolean): Promise<void> {
    const { archive } = getState();
    if (archive.loading || archive.loadingMore) return;
    if (!reset && archive.endReached) return;
    const page = reset ? 1 : archive.page + 1;
    dispatch({ type: 'archive/loadStart', reset });
    const result = await api.listMaps(buildQuery(page));
    if (result.ok) {
      dispatch({
        type: 'archive/loadOk',
        items: result.data.items,
        total: result.data.total,
        page: result.data.page,
        append: !reset,
      });
    } else {
      dispatch({ type: 'archive/loadErr', message: result.error.message });
    }
  }

  function loadMoreArchive(): Promise<void> {
    return loadArchive(false);
  }

  /** Any filter change resets paging. */
  function setArchiveFilters(patch: Partial<ArchiveFilters>): void {
    dispatch({ type: 'archive/filters', patch });
    void loadArchive(true);
  }

  /**
   * Pick a sort FIELD — seeds `dir` from the shared descriptor's `defaultDir`
   * so the direction is always derived from ARCHIVE_SORT_FIELDS, never a
   * per-client guess. The direction toggle then flips it independently.
   */
  function setArchiveSort(field: ArchiveSortFieldKey): void {
    const dir: SortDir = archiveSortField(field)?.defaultDir ?? 'desc';
    setArchiveFilters({ sort: field, dir });
  }

  function toggleArchiveDir(): void {
    const dir: SortDir = getState().archive.filters.dir === 'asc' ? 'desc' : 'asc';
    setArchiveFilters({ dir });
  }

  /** Toggle one enrichment tag in the multi-select (OR) tag facet. */
  function toggleArchiveTag(tag: string): void {
    const tags = getState().archive.filters.tags;
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    setArchiveFilters({ tags: next });
  }

  /**
   * Toggle the "My bookmarks" filter. Signed out → a gentle sign-in nudge
   * instead (bookmarked=me is a no-op without a viewer anyway).
   */
  function toggleMyBookmarks(): void {
    const next = !getState().archive.filters.bookmarked;
    if (next && !getState().session.signedIn) {
      promptSignIn('see your bookmarks');
      return;
    }
    setArchiveFilters({ bookmarked: next });
  }

  function clearArchiveFilters(): void {
    const { sort, dir } = getState().archive.filters;
    dispatch({ type: 'archive/filters', patch: { ...DEFAULT_ARCHIVE_FILTERS, sort, dir } });
    void loadArchive(true);
  }

  // --- bookmarks -------------------------------------------------------------

  /**
   * Load the viewer's bookmarked slugs (fills the ★ stars). Callers gate on a
   * known sign-in; the endpoint is auth-gated regardless, so a stray call while
   * signed out simply 401s and no-ops (no reliance on just-dispatched state).
   */
  async function hydrateBookmarks(): Promise<void> {
    const result = await api.getMyBookmarks();
    if (result.ok) {
      dispatch({ type: 'bookmark/hydrated', slugs: new Set(result.data.slugs) });
    }
  }

  /** ★ toggle on an archive row — optimistic, reverts on failure. */
  async function toggleBookmark(slug: string): Promise<void> {
    if (!getState().session.signedIn) {
      promptSignIn('bookmark maps');
      return;
    }
    const on = !getState().bookmarks.slugs.has(slug);
    dispatch({ type: 'bookmark/set', slug, on });
    const result = await api.bookmark(slug, on);
    if (!result.ok) {
      dispatch({ type: 'bookmark/set', slug, on: !on });
      pushToast({ kind: 'err', title: 'Bookmark didn’t save.', sub: result.error.message });
    }
  }

  /**
   * Gentle "sign in" affordance for signed-out writes: a toast whose action
   * routes into the app's existing sign-in flow (Discord loopback, or Settings
   * for the dev-handle path).
   */
  function promptSignIn(what: string): void {
    pushToast({
      kind: 'info',
      glyph: '☆',
      title: `Sign in to ${what}.`,
      sub: 'Connect your Discord — browsing and installing need no account.',
      actionLabel: 'Sign in',
      onAction: () => void beginSignIn(),
    });
  }

  async function beginSignIn(): Promise<void> {
    const mode = await checkAuthMode();
    if (mode === 'discord') {
      await signInWithDiscord();
    } else if (mode === 'dev') {
      // Dev sign-in needs a handle input — point at the Settings surface.
      openSettingsModal();
    } else {
      pushToast({
        kind: 'err',
        title: 'Couldn’t reach the server.',
        sub: 'Try again, or sign in later from Settings.',
      });
    }
  }

  // --- watch (map subscriptions) --------------------------------------------------
  // No GET-status route exists (the web resolves subscribe/follow server-side at
  // SSR), so these learn each target's state from its first toggle and reconcile
  // against the POST/DELETE response.

  /** 🔔 Watch/unwatch a map's activity — optimistic; reconciles from the response. */
  async function toggleWatch(slug: string): Promise<void> {
    if (!getState().session.signedIn) {
      promptSignIn('watch maps for updates');
      return;
    }
    const current = getState().social.watch[slug];
    const on = !(current?.subscribed ?? false);
    // Optimistic — unwatching also clears the mute flag.
    dispatch({
      type: 'social/watchSet',
      slug,
      watch: { subscribed: on, muted: on ? (current?.muted ?? false) : false },
    });
    const result = await api.watch(slug, on);
    if (result.ok) {
      dispatch({
        type: 'social/watchSet',
        slug,
        watch: { subscribed: result.data.subscribed, muted: result.data.muted },
      });
    } else {
      dispatch({ type: 'social/watchSet', slug, watch: current ?? { subscribed: !on, muted: false } });
      pushToast({
        kind: 'err',
        title: on ? 'Couldn’t watch that map.' : 'Couldn’t stop watching.',
        sub: result.error.message,
      });
    }
  }

  /** Mute/unmute a watched map's broadcasts without unsubscribing. */
  async function toggleMute(slug: string): Promise<void> {
    const current = getState().social.watch[slug];
    if (current === undefined || !current.subscribed) return;
    const muted = !current.muted;
    dispatch({ type: 'social/watchSet', slug, watch: { subscribed: true, muted } });
    const result = await api.setMuted(slug, muted);
    if (result.ok) {
      dispatch({
        type: 'social/watchSet',
        slug,
        watch: { subscribed: result.data.subscribed, muted: result.data.muted },
      });
    } else {
      dispatch({ type: 'social/watchSet', slug, watch: current });
      pushToast({ kind: 'err', title: 'Couldn’t change mute.', sub: result.error.message });
    }
  }

  // --- follow (author) ------------------------------------------------------------

  /**
   * Follow/unfollow a map's verified author. The follow route resolves its
   * `:handle` segment by user id OR handle, so the verified `authorId` passes
   * straight through; ids that don't map to a real account (e.g. the site owner)
   * 404 → a gentle info toast and no state change.
   */
  async function toggleFollow(authorId: string, displayName?: string): Promise<void> {
    if (!getState().session.signedIn) {
      promptSignIn('follow contributors');
      return;
    }
    const current = getState().social.follow[authorId];
    const on = !(current?.following ?? false);
    const prevCount = current?.followerCount ?? null;
    dispatch({
      type: 'social/followSet',
      authorId,
      follow: {
        following: on,
        followerCount: prevCount === null ? null : Math.max(0, prevCount + (on ? 1 : -1)),
      },
    });
    const result = await api.follow(authorId, on);
    if (result.ok) {
      dispatch({
        type: 'social/followSet',
        authorId,
        follow: { following: result.data.following, followerCount: result.data.followerCount },
      });
    } else {
      dispatch({
        type: 'social/followSet',
        authorId,
        follow: current ?? { following: false, followerCount: prevCount },
      });
      const notAccount = result.error.status === 404;
      pushToast({
        kind: notAccount ? 'info' : 'err',
        title: notAccount
          ? `${displayName ?? 'This author'} isn’t on the archive yet.`
          : 'Couldn’t update follow.',
        sub: notAccount ? 'You can follow them once they’ve joined.' : result.error.message,
      });
    }
  }

  // --- comments -------------------------------------------------------------------

  /** Patch one review inside the loaded reviews block (comments / report flag). */
  function patchReview(reviewId: string, patch: (r: ReviewDto) => ReviewDto): void {
    const block = getState().detail.reviews;
    if (block === null) return;
    dispatch({
      type: 'reviews/loaded',
      block: {
        ...block,
        reviews: block.reviews.map((r) => (r.id === reviewId ? patch(r) : r)),
      },
    });
  }

  /**
   * Add a reply to a review. Returns the ApiResult so the composer can surface
   * the server's inline errors (notably the "links aren't allowed" 400). On
   * success the comment is appended to the review's thread in the loaded block so
   * it survives tab switches.
   */
  async function addComment(reviewId: string, text: string): Promise<ApiResult<CommentDto>> {
    const result = await api.addComment(reviewId, text);
    if (result.ok) {
      patchReview(reviewId, (r) => ({ ...r, comments: [...(r.comments ?? []), result.data] }));
    }
    return result;
  }

  /** Soft-delete a comment (optimistic; rolls back + toasts on failure). */
  async function deleteComment(
    reviewId: string,
    commentId: string,
  ): Promise<ApiResult<{ ok: true }>> {
    const prev = getState().detail.reviews?.reviews.find((r) => r.id === reviewId)?.comments ?? null;
    patchReview(reviewId, (r) => ({
      ...r,
      comments: (r.comments ?? []).filter((c) => c.id !== commentId),
    }));
    const result = await api.deleteComment(commentId);
    if (!result.ok && prev !== null) {
      patchReview(reviewId, (r) => ({ ...r, comments: prev }));
      pushToast({ kind: 'err', title: 'Couldn’t delete that comment.', sub: result.error.message });
    }
    return result;
  }

  // --- reports --------------------------------------------------------------------

  /**
   * Report a review or comment. Returns the ApiResult so the modal can show
   * inline errors; on success a reported review is flagged so its Report control
   * disables (comments carry no per-viewer flag to set).
   */
  async function submitReport(input: ReportInput): Promise<ApiResult<ReportResultDto>> {
    const result = await api.report(input);
    if (result.ok && input.targetType === 'review') {
      patchReview(input.targetId, (r) => ({ ...r, reportedByMe: true }));
    }
    return result;
  }

  // --- notifications --------------------------------------------------------------

  /** The cheap bell-badge poll — signed-in only; drives the unread badge to 0 out. */
  async function pollUnread(): Promise<void> {
    if (!getState().session.signedIn) {
      if (getState().notifications.unread !== 0) dispatch({ type: 'notif/unread', unread: 0 });
      return;
    }
    const result = await api.getUnreadCount();
    if (result.ok) dispatch({ type: 'notif/unread', unread: result.data.unread });
  }

  function toggleNotifications(): void {
    const open = !getState().notifications.open;
    dispatch({ type: 'notif/open', open });
    if (open) void loadNotifications(1, false);
  }

  function closeNotifications(): void {
    dispatch({ type: 'notif/open', open: false });
  }

  /** Load a page of the inbox (page 1 replaces; later pages append). */
  async function loadNotifications(page = 1, append = false): Promise<void> {
    if (!getState().session.signedIn || getState().notifications.loading) return;
    dispatch({ type: 'notif/loadStart' });
    const result = await api.getNotifications(page);
    if (result.ok) {
      dispatch({
        type: 'notif/loaded',
        items: result.data.items,
        total: result.data.total,
        unread: result.data.unread,
        page: result.data.page,
        append,
      });
    } else {
      dispatch({ type: 'notif/loadErr' });
    }
  }

  async function markAllNotificationsRead(): Promise<void> {
    if (getState().notifications.unread === 0) return;
    dispatch({ type: 'notif/markRead', ids: 'all' });
    const result = await api.markNotificationsRead({ all: true });
    if (!result.ok) void pollUnread(); // re-sync the badge if the write failed
  }

  /** Open a notification: mark it read, then deep-link to its map when anchored. */
  async function openNotification(n: NotificationDto): Promise<void> {
    dispatch({ type: 'notif/open', open: false });
    if (!n.read) {
      dispatch({ type: 'notif/markRead', ids: [n.id] });
      const result = await api.markNotificationsRead({ ids: [n.id] });
      if (!result.ok) void pollUnread();
    }
    if (n.identitySlug !== undefined && n.identitySlug !== '') openMapBySlug(n.identitySlug);
  }

  // --- scan --------------------------------------------------------------------------

  async function annotateAll(
    hashes: string[],
    previous: ReadonlyMap<string, HashAnnotation>,
  ): Promise<Map<string, HashAnnotation>> {
    // Seed with previous annotations so a transient server failure doesn't
    // flip every known map to unknown.
    const out = new Map<string, HashAnnotation>();
    for (const h of hashes) {
      const prev = previous.get(h);
      if (prev) out.set(h, prev);
    }
    for (const batch of chunk(hashes, ANNOTATE_BATCH)) {
      const result = await api.annotateHashes(batch);
      if (result.ok) {
        for (const a of result.data) out.set(a.contentHash, a);
      }
    }
    return out;
  }

  async function runScan(): Promise<{ counts: DiskCounts; newHashes: number } | null> {
    const state = getState();
    if (state.disk.scanning) return null;
    dispatch({ type: 'scan/start' });
    const prevHashes = state.disk.hashes;
    try {
      const results = await window.chrono.scan.scanFolders();
      const files = results.flatMap((r) => r.files);
      const failed = results.filter((r) => !r.ok);
      const error = failed.length > 0 ? failed.map((f) => `${f.folder}: ${f.error ?? 'scan failed'}`).join(' · ') : null;
      const hashes = [...diskHashSet(files)];
      const annotations = await annotateAll(hashes, getState().disk.annotations);
      const { rows, counts } = buildDiskRows(files, annotations);
      dispatch({ type: 'scan/done', files, annotations, rows, counts, error });
      let newHashes = 0;
      if (prevHashes.size > 0) {
        for (const h of hashes) if (!prevHashes.has(h)) newHashes += 1;
      }
      return { counts, newHashes };
    } catch (err) {
      dispatch({ type: 'scan/error', message: String(err) });
      return null;
    }
  }

  /** Manual "⟳ Rescan" — completion toast + activity entry. silent=true skips both. */
  async function rescan(silent = false): Promise<void> {
    const result = await runScan();
    if (!result || silent) return;
    const { counts } = result;
    pushToast({
      kind: 'ok',
      glyph: '⟲',
      title: 'Scan complete.',
      sub: withFlavor(
        `${counts.total} maps · ${counts.unknown} we’ve never seen.`,
        FLAVOR_LINES.scan,
      ),
    });
    addActivity('⟲', 'Rescanned game folder');
  }

  /** Watcher-driven rescan → gentle "N new maps found" banner (never a modal). */
  async function watcherRescan(): Promise<void> {
    const result = await runScan();
    if (result && result.newHashes > 0) {
      dispatch({ type: 'disk/newFound', add: result.newHashes });
    }
  }

  function dismissNewFound(): void {
    dispatch({ type: 'disk/dismissNewFound' });
  }

  /**
   * Per-row "Re-verify": a silent incremental rescan re-runs local MapKit
   * (the scan cache makes unchanged files cheap), then toasts the FRESH
   * verdict read back from the reconciled rows. `key` is a row or sub-row key.
   */
  async function reVerify(key: string, displayName: string): Promise<void> {
    await rescan(true);
    // Let React flush the scan results before reading them back.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const fresh = findDiskRow(getState().disk.rows, key);
    if (fresh === null) return;
    const health = fresh.sub?.health ?? fresh.row.health;
    const verdict = health.verdict;
    let sub: string;
    if (verdict === 'verified') sub = `● verified · MapKit ${health.mapkitVersion}`;
    else if (verdict === 'heavy') sub = '▲ heavy — valid but complexity-heavy';
    else if (verdict === 'broken') sub = withFlavor('⚠ still broken', FLAVOR_LINES.broken);
    else sub = `⊘ needs a mod · MapKit ${health.mapkitVersion}`;
    pushToast({
      kind: verdict === 'broken' ? 'err' : 'ok',
      glyph: '⟲',
      title: `Re-verified ${displayName}`,
      sub,
    });
  }

  // --- disk filters / groups ------------------------------------------------------------

  function setDiskFilters(patch: Partial<DiskFilters>): void {
    dispatch({ type: 'disk/filters', patch });
  }

  /** Status-bar segment click: sets the disk status filter AND focuses the disk pane. */
  function setDiskStatusFilter(status: DiskStatusFilter): void {
    dispatch({ type: 'disk/filters', patch: { status } });
    dispatch({ type: 'selection/focusPane', pane: 'disk' });
  }

  function toggleGroup(key: string): void {
    dispatch({ type: 'disk/toggleGroup', key });
  }

  // --- selection & detail -----------------------------------------------------------------

  async function loadDetailForTarget(pane: Pane, id: string): Promise<void> {
    const seq = ++detailSeq;
    let slug: string | null = null;
    const state = getState();
    if (pane === 'archive') {
      slug = state.archive.items.find((c) => c.slug === id)?.slug ?? id;
    } else {
      const hit = findDiskRow(state.disk.rows, id);
      slug = hit?.row.identity?.slug ?? null;
    }
    if (slug === null) {
      dispatch({ type: 'detail/loaded', detail: null });
      dispatch({ type: 'reviews/loaded', block: null });
      return;
    }
    dispatch({ type: 'detail/loading' });
    dispatch({ type: 'reviews/loading' });
    const [detail, reviews] = await Promise.all([
      api.getMapDetail(slug),
      api.getReviews(slug, { sort: getState().detail.reviewsSort }),
    ]);
    if (seq !== detailSeq) return; // superseded by a newer selection
    dispatch({ type: 'detail/loaded', detail: detail.ok ? detail.data : null });
    dispatch({ type: 'reviews/loaded', block: reviews.ok ? reviews.data : null });
  }

  /** Row click / keyboard move: sets the detail target, clears multi, focuses the pane. */
  function select(pane: Pane, id: string): void {
    dispatch({ type: 'select', pane, id });
    dispatch({ type: 'selection/clearMulti' });
    void loadDetailForTarget(pane, id);
  }

  function toggleMulti(pane: Pane, id: string): void {
    dispatch({ type: 'selection/toggleMulti', pane, id });
  }

  function clearMulti(): void {
    dispatch({ type: 'selection/clearMulti' });
  }

  function focusPane(pane: Pane): void {
    dispatch({ type: 'selection/focusPane', pane });
  }

  function setDetailTier(tier: DetailTier): void {
    dispatch({ type: 'detail/tier', tier });
  }

  function setDetailTab(tab: DetailTab): void {
    dispatch({ type: 'detail/tab', tab });
  }

  async function setReviewsSort(sort: 'helpful' | 'newest'): Promise<void> {
    dispatch({ type: 'reviews/sort', sort });
    const slug = getState().detail.detail?.slug;
    if (slug === undefined) return;
    dispatch({ type: 'reviews/loading' });
    const result = await api.getReviews(slug, { sort });
    dispatch({ type: 'reviews/loaded', block: result.ok ? result.data : getState().detail.reviews });
  }

  // --- keyboard plumbing (panes register their visible order + search inputs) ---------------

  function registerVisibleIds(pane: Pane, ids: string[]): void {
    visibleIds[pane] = ids;
  }

  function registerSearchEl(pane: Pane, el: HTMLInputElement | null): void {
    searchEls[pane] = el;
  }

  function focusSearch(): void {
    const pane = getState().selection.focusedPane;
    searchEls[pane]?.focus();
  }

  function moveSelection(direction: 1 | -1): void {
    const state = getState();
    const pane = state.selection.focusedPane;
    const ids = visibleIds[pane];
    if (ids.length === 0) return;
    const currentId =
      state.selection.target?.pane === pane ? state.selection.target.id : null;
    const currentIndex = currentId !== null ? ids.indexOf(currentId) : -1;
    const nextIndex =
      currentIndex === -1
        ? direction === 1
          ? 0
          : ids.length - 1
        : Math.min(ids.length - 1, Math.max(0, currentIndex + direction));
    const nextId = ids[nextIndex];
    if (nextId !== undefined && nextId !== currentId) select(pane, nextId);
  }

  function registerPrimaryAction(action: PrimaryAction | null): void {
    primaryAction = action;
  }

  function invokePrimaryAction(): void {
    if (primaryAction && !primaryAction.disabled) primaryAction.run();
  }

  function toggleMultiOnTarget(): void {
    const target = getState().selection.target;
    if (target) toggleMulti(target.pane, target.id);
  }

  // --- chronoshift -----------------------------------------------------------------------

  /**
   * Single + batch install. Sequential; per-item status is real (download →
   * re-verify from disk → done/failed). Ends with a silent rescan so the disk
   * rows and archive install markers reflect what actually landed.
   */
  async function chronoshift(requests: ChronoshiftRequest[]): Promise<void> {
    if (requests.length === 0 || getState().chronoshift.running) return;
    const target = defaultFolder();
    if (target === null) {
      pushToast({ kind: 'err', title: 'No game folder configured.', sub: 'Add one in Settings.' });
      return;
    }
    const items: ChronoshiftItem[] = requests.map((r) => ({
      key: `${r.slug}:${r.versionId ?? 'canonical'}`,
      slug: r.slug,
      name: r.name,
      fileName: r.fileName,
      versionId: r.versionId ?? null,
      status: 'pending',
      pct: 0,
      error: null,
      verdict: null,
    }));
    dispatch({ type: 'chrono/start', items });

    let succeeded = 0;
    const failed: { name: string; error: string }[] = [];
    let lastVerdict: HealthVerdict | null = null;
    let lastHash: string | null = null;

    for (const item of items) {
      dispatch({ type: 'chrono/item', key: item.key, patch: { status: 'downloading', pct: 10 } });
      try {
        const url = api.downloadUrl(item.slug, item.versionId ?? undefined);
        const result = await window.chrono.installMap({
          url,
          targetFolder: target,
          fileName: item.fileName,
        });
        dispatch({ type: 'chrono/item', key: item.key, patch: { status: 'verifying', pct: 80 } });
        lastVerdict = result.health.verdict;
        lastHash = result.contentHash;
        dispatch({
          type: 'chrono/item',
          key: item.key,
          patch: { status: 'done', pct: 100, verdict: result.health.verdict },
        });
        succeeded += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed.push({ name: item.name, error: message });
        dispatch({
          type: 'chrono/item',
          key: item.key,
          patch: { status: 'failed', error: message },
        });
      }
    }

    const summary: BatchSummary | null =
      failed.length > 0 ? { total: items.length, succeeded, failed } : null;
    dispatch({ type: 'chrono/finish', summary });

    await rescan(true);
    // Let React flush the scan results so the landed row is findable below.
    await new Promise((resolve) => setTimeout(resolve, 0));

    if (items.length === 1) {
      const only = items[0];
      if (only && succeeded === 1) {
        const verdict = lastVerdict ?? 'verified';
        let sub = `${only.name} · re-verified ${HEALTH_GLYPHS[verdict]} ${healthWord(verdict)}`;
        sub = withFlavor(sub, verdict === 'broken' ? FLAVOR_LINES.broken : FLAVOR_LINES.install);
        pushToast({ kind: 'ok', glyph: '⟳', title: 'Chronoshifted into your game.', sub });
        addActivity('⟳', `Chronoshifted ${only.name}`);
        // Move the selection to the freshly landed disk row.
        if (lastHash !== null) {
          const landed = findDiskRow(getState().disk.rows, `h:${lastHash}`);
          const key = landed?.row.key ?? getState().disk.rows.find((r) => r.contentHash === lastHash)?.key;
          if (key !== undefined) select('disk', key);
        }
      } else if (only) {
        pushToast({
          kind: 'err',
          title: 'Chronoshift failed.',
          sub: `${only.name} — ${failed[0]?.error ?? 'transfer failed'}. Nothing was written.`,
        });
      }
    } else if (failed.length === 0) {
      pushToast({
        kind: 'ok',
        glyph: '⟳',
        title: `Chronoshifted ${items.length} maps.`,
        sub: withFlavor('All re-verified against the archive.', FLAVOR_LINES.scan),
      });
      addActivity('⟳', `Batch chronoshift · ${items.length} maps`);
    } else {
      pushToast({
        kind: 'err',
        title: `Chronoshifted ${succeeded} of ${items.length} maps.`,
        sub: `${failed.length} failed — nothing was destroyed. See the summary.`,
      });
      if (succeeded > 0) addActivity('⟳', `Batch chronoshift · ${succeeded} maps`);
    }
  }

  function clearChronoshiftSummary(): void {
    dispatch({ type: 'chrono/clearSummary' });
  }

  // --- quarantine / remove ------------------------------------------------------------------

  /**
   * Remove disk files to the recoverable quarantine (never hard-delete) with
   * an Undo toast. `displayName` names the single-map variant's toast.
   */
  async function removeToQuarantine(paths: string[], displayName?: string): Promise<void> {
    if (paths.length === 0) return;
    const result = await window.chrono.quarantine.quarantineFiles(paths);
    const single = paths.length === 1 && displayName !== undefined;
    pushToast({
      kind: 'ok',
      glyph: '⌦',
      title: single ? `Quarantined ${displayName}.` : `Quarantined ${result.moved} maps.`,
      sub: single
        ? 'Moved to a recoverable bin — nothing destroyed.'
        : 'Recoverable from the quarantine bin.',
      actionLabel: 'Undo',
      onAction: () => {
        void (async () => {
          const undo = await window.chrono.quarantine.undo(result.id);
          pushToast({
            kind: 'ok',
            title: undo.restored === 1 ? 'Restored.' : `Restored ${undo.restored} maps.`,
          });
          await rescan(true);
        })();
      },
    });
    addActivity('⌦', single ? `Quarantined ${displayName}` : `Quarantined ${result.moved} maps`);
    dispatch({ type: 'selection/clearMulti' });
    await rescan(true);
  }

  // --- tidy ------------------------------------------------------------------------------

  /** Derive the tidy plan (known superseded/duplicate/broken only — never unknown). */
  function openTidy(): void {
    const proposals = buildTidyProposals(getState().disk.rows);
    dispatch({ type: 'tidy/open', proposals });
  }

  function closeTidy(): void {
    dispatch({ type: 'tidy/close' });
  }

  async function applyTidy(): Promise<void> {
    const { proposals, applying } = getState().tidy;
    if (applying || proposals.length === 0) return;
    dispatch({ type: 'tidy/applying', applying: true });
    const result = await window.chrono.quarantine.quarantineFiles(proposals.map((p) => p.path));
    dispatch({ type: 'tidy/applying', applying: false });
    dispatch({ type: 'tidy/close' });
    pushToast({
      kind: 'ok',
      glyph: '⌦',
      title: `Quarantined ${result.moved} stale maps.`,
      sub: 'Known duplicates & superseded versions — recover anytime.',
      actionLabel: 'Undo',
      onAction: () => {
        void (async () => {
          const undo = await window.chrono.quarantine.undo(result.id);
          pushToast({ kind: 'ok', title: `Restored ${undo.restored} maps.` });
          await rescan(true);
        })();
      },
    });
    addActivity('⌦', `Tidied folder · ${result.moved} maps quarantined`);
    await rescan(true);
  }

  // --- contribute -----------------------------------------------------------------------

  function openContribute(): void {
    const candidates = contributeCandidates(getState().disk.rows);
    dispatch({ type: 'contribute/open', checked: new Set(candidates.map((r) => r.contentHash)) });
    dispatch({ type: 'disk/dismissNewFound' });
  }

  function closeContribute(): void {
    dispatch({ type: 'contribute/close' });
  }

  function setContributeStep(step: ContributeStep): void {
    dispatch({ type: 'contribute/step', step });
  }

  function toggleContributeHash(hash: string): void {
    dispatch({ type: 'contribute/toggle', hash });
  }

  /** Continue from select: signed out → sign-in step, else consent. */
  function continueContribute(): void {
    dispatch({
      type: 'contribute/step',
      step: getState().session.signedIn ? 'consent' : 'signin',
    });
  }

  /** Sequential uploads with real per-item progress and per-hash API results. */
  async function startContributeUpload(): Promise<void> {
    const state = getState();
    const rows = contributeCandidates(state.disk.rows).filter((r) =>
      state.contribute.checked.has(r.contentHash),
    );
    if (rows.length === 0) return;
    const uploads: ContributeUpload[] = rows.map((r) => ({
      contentHash: r.contentHash,
      name: r.name,
      fileName: r.primary.fileName,
      status: 'pending',
      pct: 0,
      resultStatus: null,
      resultMessage: null,
      error: null,
    }));
    dispatch({ type: 'contribute/uploads', uploads });
    dispatch({ type: 'contribute/step', step: 'uploading' });

    let done = 0;
    for (const row of rows) {
      const hash = row.contentHash;
      dispatch({ type: 'contribute/uploadPatch', hash, patch: { status: 'uploading', pct: 20 } });
      try {
        const base64 = await window.chrono.readFileBase64(row.primary.path);
        dispatch({ type: 'contribute/uploadPatch', hash, patch: { pct: 50 } });
        const result = await api.submitMap({
          bytes: base64ToBytes(base64),
          fileName: row.primary.fileName,
          name: row.name,
        });
        if (result.ok) {
          dispatch({
            type: 'contribute/uploadPatch',
            hash,
            patch: {
              status: 'done',
              pct: 100,
              resultStatus: result.data.status,
              resultMessage: result.data.message,
            },
          });
          done += 1;
        } else {
          dispatch({
            type: 'contribute/uploadPatch',
            hash,
            patch: { status: 'failed', error: result.error.message },
          });
        }
      } catch (err) {
        dispatch({
          type: 'contribute/uploadPatch',
          hash,
          patch: { status: 'failed', error: err instanceof Error ? err.message : String(err) },
        });
      }
    }

    dispatch({ type: 'contribute/step', step: 'summary' });
    if (done > 0) {
      pushToast({
        kind: 'ok',
        glyph: '✦',
        title: `Contributed ${done} maps.`,
        sub: 'In the moderation queue — credit lands when accepted.',
      });
      addActivity('✦', `Contributed ${done} maps to the archive`);
      // Refresh annotations so queued rows flip to their per-hash "in review" state.
      await rescan(true);
    }
  }

  // --- reviews -------------------------------------------------------------------------

  function openReviewModal(slug: string, mapName: string): void {
    const step: ReviewModalStep = getState().session.signedIn ? 'compose' : 'signin';
    dispatch({ type: 'reviewModal/open', slug, mapName, step });
  }

  function closeReviewModal(): void {
    dispatch({ type: 'reviewModal/close' });
  }

  function openVersionPicker(slug: string, mapName: string): void {
    dispatch({ type: 'versionPicker/open', slug, mapName });
  }

  function closeVersionPicker(): void {
    dispatch({ type: 'versionPicker/close' });
  }

  function setReviewModalStep(step: ReviewModalStep): void {
    dispatch({ type: 'reviewModal/step', step });
  }

  function setReviewDraft(patch: { rating?: number; text?: string }): void {
    dispatch({
      type: 'reviewModal/draft',
      rating: patch.rating ?? null,
      text: patch.text ?? null,
    });
  }

  async function submitReview(): Promise<void> {
    const modal = getState().reviewModal;
    if (modal.slug === null || modal.rating < 1) return; // stars required
    dispatch({ type: 'reviewModal/step', step: 'submitting' });
    const result = await api.postReview(modal.slug, {
      rating: modal.rating,
      text: modal.text,
    });
    if (result.ok) {
      dispatch({ type: 'reviewModal/step', step: 'success' });
    } else {
      dispatch({ type: 'reviewModal/step', step: 'compose' });
      dispatch({ type: 'reviewModal/error', message: result.error.message });
      pushToast({ kind: 'err', title: 'Review didn’t send.', sub: result.error.message });
    }
  }

  async function markHelpful(reviewId: string): Promise<void> {
    const result = await api.markHelpful(reviewId);
    if (!result.ok) return;
    const block = getState().detail.reviews;
    if (block === null) return;
    dispatch({
      type: 'reviews/loaded',
      block: {
        ...block,
        reviews: block.reviews.map((r) =>
          r.id === reviewId
            ? {
                ...r,
                helpfulCount: result.data.helpfulCount,
                markedHelpfulByMe: result.data.markedHelpfulByMe,
              }
            : r,
        ),
      },
    });
  }

  // --- team vote ------------------------------------------------------------------------

  /** Confirm/correct the team-layout suggestion; refreshes the open detail on success. */
  async function teamVote(slug: string, value: TeamLayout): Promise<boolean> {
    const result = await api.teamVote(slug, value);
    if (!result.ok) {
      pushToast({ kind: 'err', title: 'Vote didn’t send.', sub: result.error.message });
      return false;
    }
    const open = getState().detail.detail;
    if (open?.slug === slug) {
      const refreshed = await api.getMapDetail(slug);
      if (refreshed.ok) dispatch({ type: 'detail/loaded', detail: refreshed.data });
    }
    return true;
  }

  // --- nudges -----------------------------------------------------------------------------

  function dismissNudge(contentHash: string): void {
    dispatch({ type: 'nudge/dismiss', hash: contentHash });
    try {
      localStorage.setItem(NUDGES_KEY, JSON.stringify([...getState().nudgesDismissed, contentHash]));
    } catch {
      /* storage full — dismissal stays in memory */
    }
  }

  // --- shell -------------------------------------------------------------------------------

  function openSettingsModal(): void {
    dispatch({ type: 'settingsModal/set', open: true });
    void loadStorageInfo();
  }

  function closeSettingsModal(): void {
    dispatch({ type: 'settingsModal/set', open: false });
  }

  function toggleActivityDrawer(): void {
    dispatch({ type: 'activityDrawer/set', open: !getState().activityDrawerOpen });
  }

  function closeActivityDrawer(): void {
    dispatch({ type: 'activityDrawer/set', open: false });
  }

  // --- deep links -----------------------------------------------------------------------------

  /**
   * Open a map's detail by slug — reuses the standard "open map" path: selecting
   * an archive target loads detail by slug (it falls back to the slug even when
   * the map isn't in the currently-loaded page) and pops the dock out of
   * collapsed.
   */
  function openMapBySlug(slug: string): void {
    select('archive', slug);
  }

  /** Handle a chronosphere://map/<slug> deep link (main → renderer). */
  function handleDeepLink(slug: string): void {
    const clean = slug.trim();
    if (clean.length === 0) return;
    openMapBySlug(clean);
  }

  // --- boot / onboarding ----------------------------------------------------------------------

  async function enterLibrary(): Promise<void> {
    dispatch({ type: 'phase/set', phase: 'library' });
    void checkSession();
    void checkAuthMode();
    void loadArchive(true);
    await rescan(true);
    try {
      await window.chrono.watch.start();
    } catch {
      /* watcher is best-effort — manual rescan still works */
    }
  }

  async function boot(): Promise<void> {
    try {
      if (!window.chrono) throw new Error('window.chrono missing — preload bridge unavailable');
      const loaded = await window.chrono.settings.get();
      dispatch({ type: 'settings/loaded', settings: loaded });
      dispatch({ type: 'hydrate', ...loadPersisted() });
      if (loaded.onboarded && loaded.gameFolders.length > 0) {
        await enterLibrary();
      } else {
        dispatch({ type: 'phase/set', phase: 'onboarding' });
      }
      // A launch-by-link (cold start) stashed its slug in the main process
      // before the renderer could subscribe — pull it once and open it.
      try {
        const pending = await window.chrono.consumePendingDeepLink();
        if (pending !== null) handleDeepLink(pending);
      } catch {
        /* no pending deep link */
      }
    } catch (err) {
      dispatch({ type: 'boot/error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Onboarding finish: persist folders + onboarded flag, enter the library
   * (first sync + scan), then the summary toast with the real counts.
   */
  async function completeOnboarding(gameFolders: string[]): Promise<void> {
    await updateSettings({
      gameFolders: gameFolders.map((path, i) => ({ path, isDefault: i === 0 })),
      onboarded: true,
    });
    await enterLibrary();
    const { counts } = getState().disk;
    pushToast({
      kind: 'ok',
      title: `Scanned ${counts.total} maps · ${counts.unknown} we’ve never seen · ${counts.broken} look broken.`,
      sub: 'Welcome to Chronosphere.',
    });
    addActivity('⟲', `First scan — indexed ${counts.total} maps.`);
  }

  /** Settings → "Replay first-run". */
  function replayOnboarding(): void {
    dispatch({ type: 'settingsModal/set', open: false });
    dispatch({ type: 'phase/set', phase: 'onboarding' });
  }

  // --- updates --------------------------------------------------------------------------------

  /** Kick off a user-initiated update check; results arrive via handleUpdateStatus. */
  function checkForUpdates(): void {
    pushToast({ kind: 'info', glyph: '⟳', title: 'Checking for updates…' });
    void window.chrono.updates.check();
  }

  /** Turn an electron-updater outcome (main → renderer) into a toast. */
  function handleUpdateStatus(status: UpdateStatus): void {
    switch (status.kind) {
      case 'available':
        pushToast({
          kind: 'ok',
          glyph: '↑',
          title: `Update available (v${status.version})`,
          sub: 'Downloading in the background…',
        });
        break;
      case 'not-available':
        pushToast({ kind: 'ok', title: `You’re on the latest version (v${status.version}).` });
        break;
      case 'downloaded':
        pushToast({
          kind: 'ok',
          glyph: '↑',
          title: `Update v${status.version} downloaded.`,
          sub: 'Restart Chronosphere to install it.',
        });
        break;
      case 'error':
        pushToast({ kind: 'err', title: 'Update check failed.', sub: status.message });
        break;
      case 'dev':
        pushToast({
          kind: 'info',
          title: 'Updates run in the installed build.',
          sub: 'Dev mode doesn’t check the release feed.',
        });
        break;
    }
  }

  // --- events from main ---------------------------------------------------------------------

  function handleScanProgress(done: number, total: number): void {
    dispatch({ type: 'scan/progress', done, total });
  }

  return {
    // boot / phase
    boot,
    enterLibrary,
    completeOnboarding,
    replayOnboarding,
    // connection
    onConnectionChange,
    retryConnection,
    // settings
    updateSettings,
    addGameFolder,
    removeGameFolder,
    setDefaultFolder,
    autoDetectFolders,
    setApiBase,
    loadStorageInfo,
    clearRenderCache,
    emptyQuarantine,
    restoreQuarantine,
    // session
    checkSession,
    checkAuthMode,
    devSignIn,
    signInWithDiscord,
    signOut,
    // archive
    loadArchive,
    loadMoreArchive,
    setArchiveFilters,
    setArchiveSort,
    toggleArchiveDir,
    toggleArchiveTag,
    toggleMyBookmarks,
    clearArchiveFilters,
    // bookmarks
    hydrateBookmarks,
    toggleBookmark,
    // watch / follow (social)
    toggleWatch,
    toggleMute,
    toggleFollow,
    // comments
    addComment,
    deleteComment,
    // reports
    submitReport,
    // notifications
    pollUnread,
    toggleNotifications,
    closeNotifications,
    loadNotifications,
    markAllNotificationsRead,
    openNotification,
    // deep links
    handleDeepLink,
    openMapBySlug,
    // scan / disk
    rescan,
    reVerify,
    watcherRescan,
    dismissNewFound,
    setDiskFilters,
    setDiskStatusFilter,
    toggleGroup,
    // selection / detail
    select,
    toggleMulti,
    clearMulti,
    focusPane,
    setDetailTier,
    setDetailTab,
    setReviewsSort,
    // keyboard plumbing
    registerVisibleIds,
    registerSearchEl,
    focusSearch,
    moveSelection,
    registerPrimaryAction,
    invokePrimaryAction,
    toggleMultiOnTarget,
    // chronoshift
    chronoshift,
    clearChronoshiftSummary,
    // quarantine / tidy
    removeToQuarantine,
    openTidy,
    closeTidy,
    applyTidy,
    // contribute
    openContribute,
    closeContribute,
    setContributeStep,
    toggleContributeHash,
    continueContribute,
    startContributeUpload,
    // reviews
    openReviewModal,
    closeReviewModal,
    setReviewModalStep,
    openVersionPicker,
    closeVersionPicker,
    setReviewDraft,
    submitReview,
    markHelpful,
    // tags
    teamVote,
    // nudges
    dismissNudge,
    // shell
    pushToast,
    dismissToast,
    addActivity,
    openSettingsModal,
    closeSettingsModal,
    toggleActivityDrawer,
    closeActivityDrawer,
    // updates
    checkForUpdates,
    handleUpdateStatus,
    // events
    handleScanProgress,
  };
}

export type Actions = ReturnType<typeof createActions>;

// ---------------------------------------------------------------------------
// Provider + hooks

export interface StoreValue {
  state: AppState;
  actions: Actions;
  api: ApiClient;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const actionsRef = useRef<{ actions: Actions; api: ApiClient } | null>(null);
  if (actionsRef.current === null) {
    // The client reads config lazily so settings changes apply immediately.
    let boundActions: Actions | null = null;
    const api = createApiClient({
      getApiBase: () => stateRef.current.settings?.apiBase ?? 'https://the-real-antares.com',
      getAuthToken: () => stateRef.current.settings?.authToken ?? null,
      onConnectionChange: (online) => boundActions?.onConnectionChange(online),
    });
    boundActions = createActions({ dispatch, getState: () => stateRef.current, api });
    actionsRef.current = { actions: boundActions, api };
  }
  const { actions, api } = actionsRef.current;

  // Boot once; wire main-process events for the provider's lifetime.
  useEffect(() => {
    void actions.boot();
    if (!window.chrono) return undefined;
    const offProgress = window.chrono.scan.onProgress((p) => {
      actions.handleScanProgress(p.done, p.total);
    });
    const offChanged = window.chrono.watch.onFilesChanged(() => {
      void actions.watcherRescan();
    });
    const offUpdates = window.chrono.updates.onStatus((status) => {
      actions.handleUpdateStatus(status);
    });
    const offDeepLink = window.chrono.onDeepLink((slug) => {
      actions.handleDeepLink(slug);
    });
    return () => {
      offProgress();
      offChanged();
      offUpdates();
      offDeepLink();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<StoreValue>(() => ({ state, actions, api }), [state, actions, api]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (value === null) throw new Error('useStore must be used inside <StoreProvider>');
  return value;
}

export function useAppState(): AppState {
  return useStore().state;
}

export function useActions(): Actions {
  return useStore().actions;
}
