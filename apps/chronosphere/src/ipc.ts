import type { HealthReport } from '@antares/shared/types.ts';

/**
 * The typed IPC contract between the Electron main process, the preload
 * bridge, and the renderer. This file must stay runnable in both worlds:
 * plain types + channel-name constants + defaults, no node/electron imports.
 */

// ---------------------------------------------------------------------------
// Settings

export interface GameFolder {
  path: string;
  isDefault: boolean;
}

export interface ChronoSettings {
  gameFolders: GameFolder[];
  /** Base URL of the Antares web API. */
  apiBase: string;
  easterEggs: boolean;
  reducedMotion: boolean;
  authToken: string | null;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: ChronoSettings = {
  gameFolders: [],
  apiBase: 'https://the-real-antares.com',
  // Voice-line easter eggs are opt-in (reconciliation decision: default OFF).
  easterEggs: false,
  reducedMotion: false,
  authToken: null,
  onboarded: false,
};

// ---------------------------------------------------------------------------
// Scanning

export interface ScannedFile {
  path: string;
  /** The game folder this file was found under. */
  folder: string;
  fileName: string;
  bytes: number;
  /** mtime, epoch milliseconds. */
  mtime: number;
  /** SHA-1 over file bytes — the CnCNet-compatible content hash. */
  contentHash: string;
  // Parsed facts (null when the file could not be parsed).
  name: string | null;
  theater: string | null;
  width: number | null;
  height: number | null;
  maxPlayers: number | null;
  health: HealthReport;
  previewAvailable: boolean;
}

export interface FolderScanResult {
  folder: string;
  ok: boolean;
  error: string | null;
  /** The directories that were actually walked (Maps/, Maps/Custom/, or the folder root). */
  scannedDirs: string[];
  files: ScannedFile[];
}

export interface ScanProgress {
  folder: string;
  done: number;
  total: number;
  file: string | null;
}

// ---------------------------------------------------------------------------
// Previews

export interface PreviewData {
  width: number;
  height: number;
  /** Base64 of raw RGB bytes (3 bytes/pixel, row-major) — renderer expands to RGBA for putImageData. */
  rgbBase64: string;
}

// ---------------------------------------------------------------------------
// Watch

export interface FilesChangedEvent {
  folder: string;
}

// ---------------------------------------------------------------------------
// Quarantine

export interface QuarantineResult {
  id: string;
  moved: number;
  errors: string[];
}

export interface QuarantineSummary {
  id: string;
  createdAt: string;
  count: number;
  bytes: number;
}

export interface UndoResult {
  restored: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Install / game folders

export interface InstallMapRequest {
  url: string;
  targetFolder: string;
  fileName: string;
}

export interface InstallMapResult {
  path: string;
  /** Re-computed from the bytes actually written to disk. */
  contentHash: string;
  /** Re-analyzed from the bytes actually written to disk — never assumed. */
  health: HealthReport;
}

export interface GameFolderValidation {
  ok: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// App info (splash self-test)

export interface AppInfo {
  userDataPath: string;
  appVersion: string;
  platform: string;
  electronVersion: string;
}

// ---------------------------------------------------------------------------
// Channels

export const IPC = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  scanFolders: 'scan:folders',
  /** main → renderer event. */
  scanProgress: 'scan:progress',
  previewGet: 'preview:get',
  watchStart: 'watch:start',
  watchStop: 'watch:stop',
  /** main → renderer event. */
  filesChanged: 'files:changed',
  quarantineFiles: 'quarantine:files',
  quarantineUndo: 'quarantine:undo',
  quarantineList: 'quarantine:list',
  quarantineEmpty: 'quarantine:empty',
  renderCachePut: 'render-cache:put',
  renderCacheGet: 'render-cache:get',
  renderCacheSize: 'render-cache:size',
  renderCacheClear: 'render-cache:clear',
  installMap: 'install:map',
  gameFolderValidate: 'game-folder:validate',
  gameFolderAutoDetect: 'game-folder:auto-detect',
  fileReadBase64: 'file:read-base64',
  appInfo: 'app:info',
  authBeginDiscord: 'auth:begin-discord',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

// ---------------------------------------------------------------------------
// The surface preload exposes as window.chrono

export type Unsubscribe = () => void;

export interface ChronoApi {
  settings: {
    get(): Promise<ChronoSettings>;
    set(patch: Partial<ChronoSettings>): Promise<ChronoSettings>;
    getAuthToken(): Promise<string | null>;
    setAuthToken(token: string | null): Promise<void>;
  };
  scan: {
    scanFolders(): Promise<FolderScanResult[]>;
    onProgress(cb: (progress: ScanProgress) => void): Unsubscribe;
  };
  preview: {
    getPreview(path: string): Promise<PreviewData | null>;
  };
  watch: {
    start(): Promise<void>;
    stop(): Promise<void>;
    onFilesChanged(cb: (event: FilesChangedEvent) => void): Unsubscribe;
  };
  quarantine: {
    quarantineFiles(paths: string[]): Promise<QuarantineResult>;
    undo(quarantineId: string): Promise<UndoResult>;
    list(): Promise<QuarantineSummary[]>;
    emptyQuarantine(): Promise<void>;
  };
  renderCache: {
    cacheRender(url: string, key: string): Promise<string>;
    getCached(key: string): Promise<string | null>;
    cacheSize(): Promise<number>;
    clear(): Promise<void>;
  };
  installMap(request: InstallMapRequest): Promise<InstallMapResult>;
  gameFolder: {
    validate(path: string): Promise<GameFolderValidation>;
    autoDetect(): Promise<string[]>;
  };
  /**
   * Read a scanned map file's bytes as base64 (contribute-upload primitive).
   * REFUSES paths outside the configured game folders and non-map extensions.
   */
  readFileBase64(path: string): Promise<string>;
  appInfo(): Promise<AppInfo>;
  auth: {
    /** Open Discord OAuth in the browser; capture the returned token via a loopback server. */
    beginDiscord(): Promise<{ token: string; handle: string } | null>;
  };
}
