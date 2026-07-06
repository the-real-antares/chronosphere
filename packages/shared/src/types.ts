import type {
  ArchiveSort,
  Confidence,
  HealthVerdict,
  MapType,
  ModerationStatus,
  ReviewStatus,
  SizeClass,
  TeamLayout,
  Theater,
} from './taxonomy.ts';

/**
 * Domain + API contract shared by the website, the Chronosphere app, and the backend.
 * The data model is identity → many versions, with two pointers that are never
 * conflated: latest (newest by date) and canonical (curator-recommended).
 */

export interface HealthReport {
  verdict: HealthVerdict;
  /** Specific findings, e.g. "corrupt tile data", "no start locations", "references missing art → needs <mod>". */
  findings: string[];
  /** Present for heavy verdicts and useful context otherwise. */
  metrics?: {
    triggers?: number;
    aiTeams?: number;
    width?: number;
    height?: number;
  };
  /** Analyzer version that produced this report. Mismatch ⇒ "re-verify". */
  mapkitVersion: string;
}

export interface TeamLayoutSuggestion {
  value: TeamLayout;
  confidence: Confidence;
}

export interface MapVersionDto {
  versionId: string;
  /** Backend-computed SHA-1 over the file bytes — the identity/dedup key. */
  contentHash: string;
  fileSizeKb: number;
  dateAdded: string; // ISO
  downloads: number;
  health: HealthReport | null;
}

/** One archive card / one identity. The archive shows the canonical version. */
export interface MapCardDto {
  identityId: string;
  slug: string;
  name: string;
  /** Display credit: string, or null → "source unknown". */
  author: string | null;
  /** Verified author id — the gold ✦ keys on this, never on a name string. */
  authorId: string | null;
  type: MapType;
  theater: Theater;
  width: number;
  height: number;
  sizeClass: SizeClass;
  maxPlayers: number | null; // null → Mission / N-A
  teamLayout: TeamLayoutSuggestion | null;
  tags: string[];
  /** LLM-generated tags from the fixed enrichment vocabulary (AI_TAGS). */
  aiTags: string[];
  downloads: number;
  rating: number | null; // identity-level mean of approved reviews
  reviewCount: number;
  fileSizeKb: number; // canonical version
  dateAdded: string; // canonical version
  healthVerdict: HealthVerdict | null; // canonical version
  thumbnailUrl: string | null;
  /**
   * Every version's content hash, so a client can compute have/update/unknown
   * on paged results without loading the whole archive.
   */
  versionHashes: string[];
  canonicalHash: string;
  latestHash: string;
  /** Identities in this map's version group (>1 = re-uploads/versions folded into this card). */
  versionCount?: number;
  /** Deterministic 1–10 scripting/quality score (canonical version); null = not yet linted. */
  lintScore?: number | null;
}

/** One member of a map's version group — a distinct-content version a client can install. */
export interface GroupVersionDto {
  slug: string;
  name: string;
  theater: Theater;
  maxPlayers: number | null;
  width: number;
  height: number;
  sizeClass: SizeClass;
  healthVerdict: HealthVerdict | null;
  lintScore: number | null;
  downloads: number;
  dateAdded: string;
  /** Canonical version content hash — for client have-detection. */
  canonicalHash: string;
  /** The group's representative (the card the user opened this list from). */
  isCanonical: boolean;
}

export interface MapDetailDto extends MapCardDto {
  description: string | null;
  health: HealthReport | null;
  renderUrl: string | null;
  fileUrl: string;
  versions: MapVersionDto[];
  latestVersionId: string;
  canonicalVersionId: string;
}

export interface ReviewDto {
  id: string;
  identityId: string;
  versionId: string;
  /** Which version the review was written against, for display ("v2"). */
  versionLabel: string;
  rating: number; // 1–5
  text: string;
  discordHandle: string;
  badges: string[];
  status: ReviewStatus;
  helpfulCount: number;
  markedHelpfulByMe?: boolean;
  createdAt: string;
}

export interface ReviewsBlockDto {
  summary: string | null; // LLM one-liner, human-approved server-side
  rating: number | null;
  reviewCount: number;
  reviews: ReviewDto[];
}

export interface ContributorDto {
  discordHandle: string;
  since: string; // ISO month
  acceptedContributions: number;
  reviewCount: number;
  confirmedTags: number;
  badges: string[];
}

export interface StatsDto {
  mapsInArchive: number;
  totalDownloads: number;
  authoredByAntares: number;
  lastIngest: string; // ISO
}

export interface ShowcaseEntryDto {
  slug: string;
  name: string;
  metaLine: string; // e.g. "8P · LUNAR · SURVIVAL · BY ANTARES ✦"
  renderUrl: string | null;
}

export interface ArchiveQuery {
  q?: string;
  type?: MapType | 'all';
  minPlayers?: 2 | 4 | 6 | 8;
  theater?: Theater | 'all';
  size?: SizeClass | 'any';
  health?: HealthVerdict | 'all';
  team?: TeamLayout | 'any';
  /** Single LLM enrichment tag (AI_TAGS) the map must carry. */
  tag?: string;
  sort?: ArchiveSort;
  page?: number; // 1-based
  perPage?: number; // default 12 (web), app may ask more
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

/** Per-hash annotation for the app's reconciliation (POST /api/v1/hashes/annotate). */
export interface HashAnnotation {
  contentHash: string;
  status: ModerationStatus; // 'unknown' → not in archive & not queued
  identity?: {
    identityId: string;
    slug: string;
    name: string;
    versionId: string;
    isCanonical: boolean;
    isLatest: boolean;
    canonicalVersionId: string;
    canonicalHash: string;
  };
}

export interface SessionDto {
  signedIn: boolean;
  discordHandle: string | null;
}

export interface SubmissionResultDto {
  contentHash: string;
  status: ModerationStatus; // 'in-review' on accept; 'published'/'in-review'/'rejected' when already known
  message: string;
}

export interface BulkArchiveInfoDto {
  mapCount: number;
  zipBytes: number;
  builtAt: string;
  url: string;
}

export type ApiError = { error: string };
