import type { ReportReason, TeamLayout } from '@antares/shared/taxonomy.ts';
import type {
  ArchiveQuery,
  BookmarkStatusDto,
  CommentDto,
  ContributorDto,
  FollowStatusDto,
  HashAnnotation,
  GroupVersionDto,
  MapCardDto,
  MapDetailDto,
  MyBookmarksDto,
  NotificationDto,
  Paged,
  ReviewDto,
  ReviewsBlockDto,
  SessionDto,
  StatsDto,
  SubmissionResultDto,
  SubscriptionStatusDto,
} from '@antares/shared/types.ts';

/**
 * Typed client over the shared /api/v1 REST backend (ARCHITECTURE.md table).
 * Every method resolves to an ApiResult — it NEVER throws raw. Network and
 * timeout failures also notify onConnectionChange(false); any success
 * notifies onConnectionChange(true) so the store can flip the
 * connection-lost state without polling.
 */

export const API_TIMEOUT_MS = 8000;
export const ARCHIVE_PER_PAGE = 24;

export type ApiFailureKind = 'network' | 'timeout' | 'http' | 'parse';

export interface ApiFailure {
  kind: ApiFailureKind;
  /** HTTP status for kind 'http'. */
  status: number | null;
  /** Server-provided or synthesized message — safe to log, not raw copy for the UI. */
  message: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiFailure };

export interface ReviewsQuery {
  sort?: 'helpful' | 'newest';
  rating?: 1 | 2 | 3 | 4 | 5;
}

export interface SubmitMapArgs {
  /** Raw file bytes (from window.chrono.readFileBase64 → base64ToBytes). */
  bytes: Uint8Array;
  fileName: string;
  name: string;
  notes?: string;
}

/** POST /api/auth/dev-signin response (dev only — Discord OAuth unconfigured). */
export interface DevSigninDto {
  token: string;
  signedIn: boolean;
  discordHandle: string;
}

/** How sign-in is available on this server. */
export type AuthMode = 'discord' | 'dev' | 'unreachable';

/** GET /contributors/:handle — profile + accepted map cards. */
export interface ContributorProfileDto {
  contributor: ContributorDto;
  maps: MapCardDto[];
}

export interface ApiClientConfig {
  getApiBase(): string;
  getAuthToken(): string | null;
  onConnectionChange?(online: boolean): void;
  /** Test seam; defaults to global fetch. */
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  formData?: FormData;
  auth?: boolean;
  /** Don't parse a JSON body (e.g. signout). */
  emptyOk?: boolean;
}

/** POST /api/v1/reports payload (REPORT_REASONS). */
export interface ReportInput {
  targetType: 'review' | 'comment';
  targetId: string;
  reason: ReportReason;
  note?: string;
}

/** POST /api/v1/reports result. */
export interface ReportResultDto {
  ok: true;
  /** DISTINCT reporters with an open report on this target. */
  reportCount: number;
  /** True when this report pushed the target over the auto-hide threshold. */
  autoHidden: boolean;
}

/** GET /api/v1/notifications — a page of the inbox plus the unread badge count. */
export type NotificationsPageDto = Paged<NotificationDto> & { unread: number };

export function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function createApiClient(config: ApiClientConfig) {
  const fetchFn = config.fetchFn ?? fetch;
  const timeoutMs = config.timeoutMs ?? API_TIMEOUT_MS;

  function baseUrl(): string {
    return config.getApiBase().replace(/\/+$/, '');
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {};
    const token = config.getAuthToken();
    if ((options.auth ?? false) && token) headers['authorization'] = `Bearer ${token}`;

    let body: BodyInit | undefined;
    if (options.formData) {
      body = options.formData;
    } else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await fetchFn(`${baseUrl()}${path}`, {
        method: options.method ?? 'GET',
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
      config.onConnectionChange?.(false);
      return {
        ok: false,
        error: {
          kind: timedOut ? 'timeout' : 'network',
          status: null,
          message: timedOut ? `request timed out after ${timeoutMs}ms` : String(err),
        },
      };
    }

    // The server answered — the connection is alive even when the call 4xx/5xxs.
    config.onConnectionChange?.(true);

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const parsed = (await response.json()) as { error?: unknown };
        if (typeof parsed.error === 'string') message = parsed.error;
      } catch {
        /* non-JSON error body — keep the status message */
      }
      return { ok: false, error: { kind: 'http', status: response.status, message } };
    }

    if (options.emptyOk && response.status === 204) {
      return { ok: true, data: undefined as T };
    }
    try {
      return { ok: true, data: (await response.json()) as T };
    } catch (err) {
      if (options.emptyOk) return { ok: true, data: undefined as T };
      return { ok: false, error: { kind: 'parse', status: response.status, message: String(err) } };
    }
  }

  return {
    // --- catalog -------------------------------------------------------------

    getStats(): Promise<ApiResult<StatsDto>> {
      return request<StatsDto>('/api/v1/stats');
    },

    /** Archive list — server-side pagination, perPage 24, filters AND-combine. */
    listMaps(query: ArchiveQuery): Promise<ApiResult<Paged<MapCardDto>>> {
      const params = new URLSearchParams();
      if (query.q) params.set('q', query.q);
      if (query.type && query.type !== 'all') params.set('type', query.type);
      if (query.minPlayers !== undefined) params.set('minPlayers', String(query.minPlayers));
      if (query.theater && query.theater !== 'all') params.set('theater', query.theater);
      if (query.size && query.size !== 'any') params.set('size', query.size);
      if (query.health && query.health !== 'all') params.set('health', query.health);
      if (query.team && query.team !== 'any') params.set('team', query.team);
      if (query.sort) params.set('sort', query.sort);
      if (query.dir) params.set('dir', query.dir);
      if (query.quality) params.set('quality', query.quality);
      // Multi-tag OR — the backend accepts a comma-joined `tags` param.
      if (query.tags && query.tags.length > 0) params.set('tags', query.tags.join(','));
      if (query.bookmarked) params.set('bookmarked', query.bookmarked);
      params.set('page', String(query.page ?? 1));
      params.set('perPage', String(query.perPage ?? ARCHIVE_PER_PAGE));
      // Auth flows the Bearer when present so `bookmarked=me` can resolve the
      // viewer; harmless (and header-free) when signed out.
      return request<Paged<MapCardDto>>(`/api/v1/maps?${params.toString()}`, { auth: true });
    },

    getMapDetail(slug: string): Promise<ApiResult<MapDetailDto>> {
      return request<MapDetailDto>(`/api/v1/maps/${encodeURIComponent(slug)}`);
    },

    getGroupVersions(slug: string): Promise<ApiResult<{ versions: GroupVersionDto[] }>> {
      return request<{ versions: GroupVersionDto[] }>(`/api/v1/maps/${encodeURIComponent(slug)}/versions`);
    },

    // --- reviews ---------------------------------------------------------------

    getReviews(slug: string, query: ReviewsQuery = {}): Promise<ApiResult<ReviewsBlockDto>> {
      const params = new URLSearchParams();
      if (query.sort) params.set('sort', query.sort);
      if (query.rating !== undefined) params.set('rating', String(query.rating));
      const qs = params.size > 0 ? `?${params.toString()}` : '';
      return request<ReviewsBlockDto>(`/api/v1/maps/${encodeURIComponent(slug)}/reviews${qs}`);
    },

    postReview(
      slug: string,
      body: { rating: number; text: string; versionId?: string },
    ): Promise<ApiResult<ReviewDto>> {
      return request<ReviewDto>(`/api/v1/maps/${encodeURIComponent(slug)}/reviews`, {
        method: 'POST',
        body,
        auth: true,
      });
    },

    /** Toggle "helpful" on a review — one per user. */
    markHelpful(
      reviewId: string,
    ): Promise<ApiResult<{ helpfulCount: number; markedHelpfulByMe: boolean }>> {
      return request(`/api/v1/reviews/${encodeURIComponent(reviewId)}/helpful`, {
        method: 'POST',
        auth: true,
        emptyOk: true,
      });
    },

    // --- bookmarks / watch / follow --------------------------------------------

    /** Add (on) / remove (off) a bookmark on a map → {bookmarked, bookmarkCount}. */
    bookmark(slug: string, on: boolean): Promise<ApiResult<BookmarkStatusDto>> {
      return request<BookmarkStatusDto>(`/api/v1/maps/${encodeURIComponent(slug)}/bookmark`, {
        method: on ? 'POST' : 'DELETE',
        auth: true,
      });
    },

    /** The authed viewer's bookmarked identity ids + slugs (fills the ★ stars). */
    getMyBookmarks(): Promise<ApiResult<MyBookmarksDto>> {
      return request<MyBookmarksDto>('/api/v1/me/bookmarks', { auth: true });
    },

    /** Subscribe (on) / unsubscribe (off) to a map's activity → {subscribed, muted}. */
    watch(slug: string, on: boolean): Promise<ApiResult<SubscriptionStatusDto>> {
      return request<SubscriptionStatusDto>(`/api/v1/maps/${encodeURIComponent(slug)}/watch`, {
        method: on ? 'POST' : 'DELETE',
        auth: true,
      });
    },

    /** Mute (muted) / unmute a watched map without unsubscribing → {subscribed, muted}. */
    setMuted(slug: string, muted: boolean): Promise<ApiResult<SubscriptionStatusDto>> {
      return request<SubscriptionStatusDto>(
        `/api/v1/maps/${encodeURIComponent(slug)}/watch?muted=${muted ? 'true' : 'false'}`,
        { method: 'POST', auth: true },
      );
    },

    /** Follow (on) / unfollow (off) a contributor → {following, followerCount}. */
    follow(handle: string, on: boolean): Promise<ApiResult<FollowStatusDto>> {
      return request<FollowStatusDto>(`/api/v1/users/${encodeURIComponent(handle)}/follow`, {
        method: on ? 'POST' : 'DELETE',
        auth: true,
      });
    },

    // --- comments --------------------------------------------------------------

    /** Post a reply to a review → the created (auto-published) comment. */
    addComment(reviewId: string, text: string): Promise<ApiResult<CommentDto>> {
      return request<CommentDto>(`/api/v1/reviews/${encodeURIComponent(reviewId)}/comments`, {
        method: 'POST',
        body: { text },
        auth: true,
      });
    },

    /** Soft-remove a comment (author or moderator only). */
    deleteComment(id: string): Promise<ApiResult<{ ok: true }>> {
      return request<{ ok: true }>(`/api/v1/comments/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        auth: true,
      });
    },

    // --- reports ---------------------------------------------------------------

    /** Report a review or comment (REPORT_REASONS); dedupes per reporter. */
    report(input: ReportInput): Promise<ApiResult<ReportResultDto>> {
      return request<ReportResultDto>('/api/v1/reports', {
        method: 'POST',
        body: input,
        auth: true,
      });
    },

    // --- notifications ---------------------------------------------------------

    /** A page of the viewer's inbox (newest-first) plus the unread badge count. */
    getNotifications(page?: number): Promise<ApiResult<NotificationsPageDto>> {
      const qs = page !== undefined ? `?page=${page}` : '';
      return request<NotificationsPageDto>(`/api/v1/notifications${qs}`, { auth: true });
    },

    /** The cheap bell-badge poll — just the unread count. */
    getUnreadCount(): Promise<ApiResult<{ unread: number }>> {
      return request<{ unread: number }>('/api/v1/notifications/unread', { auth: true });
    },

    /** Mark inbox rows read: all of them, or a specific set of ids. */
    markNotificationsRead(
      which: { all: true } | { ids: string[] },
    ): Promise<ApiResult<{ updated: number; unread: number }>> {
      return request<{ updated: number; unread: number }>('/api/v1/notifications/read', {
        method: 'POST',
        body: which,
        auth: true,
      });
    },

    // --- tags ------------------------------------------------------------------

    /** Confirm/correct the team-layout suggestion (crowd tag vote). */
    teamVote(slug: string, value: TeamLayout): Promise<ApiResult<void>> {
      return request<void>(`/api/v1/maps/${encodeURIComponent(slug)}/team-vote`, {
        method: 'POST',
        body: { value },
        auth: true,
        emptyOk: true,
      });
    },

    // --- reconciliation ----------------------------------------------------------

    /** The app's reconciliation primitive. Callers batch to ≤500 hashes per call. */
    annotateHashes(hashes: string[]): Promise<ApiResult<HashAnnotation[]>> {
      return request<HashAnnotation[]>('/api/v1/hashes/annotate', {
        method: 'POST',
        body: { hashes },
      });
    },

    // --- contribute ---------------------------------------------------------------

    /** multipart: file (.map/.mpr/.yrm, ≤5 MB) + name + notes → moderation queue. */
    submitMap(args: SubmitMapArgs): Promise<ApiResult<SubmissionResultDto>> {
      const form = new FormData();
      const buffer = new ArrayBuffer(args.bytes.byteLength);
      new Uint8Array(buffer).set(args.bytes);
      form.set('file', new Blob([buffer], { type: 'application/octet-stream' }), args.fileName);
      form.set('name', args.name);
      if (args.notes !== undefined) form.set('notes', args.notes);
      return request<SubmissionResultDto>('/api/v1/submissions', {
        method: 'POST',
        formData: form,
        auth: true,
      });
    },

    getContributors(sort?: 'maps' | 'reviews' | 'tags'): Promise<ApiResult<ContributorDto[]>> {
      const qs = sort !== undefined ? `?sort=${sort}` : '';
      return request<ContributorDto[]>(`/api/v1/contributors${qs}`);
    },

    getContributor(handle: string): Promise<ApiResult<ContributorProfileDto>> {
      return request<ContributorProfileDto>(`/api/v1/contributors/${encodeURIComponent(handle)}`);
    },

    // --- downloads -----------------------------------------------------------------

    /**
     * Canonical (or ?version=) file URL — the server increments the downloads
     * counter on fetch. Feed to window.chrono.installMap.
     */
    downloadUrl(slug: string, versionId?: string): string {
      const suffix = versionId !== undefined ? `?version=${encodeURIComponent(versionId)}` : '';
      return `${baseUrl()}/api/v1/download/maps/${encodeURIComponent(slug)}${suffix}`;
    },

    // --- auth ------------------------------------------------------------------------

    getSession(): Promise<ApiResult<SessionDto>> {
      return request<SessionDto>('/api/auth/session', { auth: true });
    },

    /**
     * Probe how sign-in works on this server: GET /api/auth/discord redirects
     * (OAuth configured) or 404s {oauth not configured} → DEV sign-in path.
     */
    async checkAuthMode(): Promise<AuthMode> {
      try {
        const response = await fetchFn(`${baseUrl()}/api/auth/discord`, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        });
        config.onConnectionChange?.(true);
        if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
          return 'discord';
        }
        return response.status === 404 ? 'dev' : 'discord';
      } catch {
        config.onConnectionChange?.(false);
        return 'unreachable';
      }
    },

    /** DEV MODE sign-in (server-gated to non-production without OAuth). */
    devSignin(handle: string): Promise<ApiResult<DevSigninDto>> {
      return request<DevSigninDto>('/api/auth/dev-signin', { method: 'POST', body: { handle } });
    },

    signout(): Promise<ApiResult<void>> {
      return request<void>('/api/auth/signout', { method: 'POST', auth: true, emptyOk: true });
    },

    /** URL to open in the system browser for the Discord OAuth flow. */
    discordAuthUrl(): string {
      return `${baseUrl()}/api/auth/discord`;
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
