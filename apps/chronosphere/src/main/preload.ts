import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC,
  type AppInfo,
  type ChronoApi,
  type ChronoSettings,
  type FilesChangedEvent,
  type FolderScanResult,
  type GameFolderValidation,
  type InstallMapRequest,
  type InstallMapResult,
  type PreviewData,
  type QuarantineResult,
  type QuarantineSummary,
  type ScanProgress,
  type UndoResult,
  type Unsubscribe,
  type UpdateStatus,
} from '../ipc.ts';

/** The typed bridge the renderer sees as window.chrono. */

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_event: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const chrono: ChronoApi = {
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<ChronoSettings>,
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch) as Promise<ChronoSettings>,
    getAuthToken: async () => {
      const settings = (await ipcRenderer.invoke(IPC.settingsGet)) as ChronoSettings;
      return settings.authToken;
    },
    setAuthToken: async (token) => {
      await ipcRenderer.invoke(IPC.settingsSet, { authToken: token });
    },
  },
  scan: {
    scanFolders: () => ipcRenderer.invoke(IPC.scanFolders) as Promise<FolderScanResult[]>,
    onProgress: (cb) => subscribe<ScanProgress>(IPC.scanProgress, cb),
  },
  preview: {
    getPreview: (path) => ipcRenderer.invoke(IPC.previewGet, path) as Promise<PreviewData | null>,
  },
  watch: {
    start: () => ipcRenderer.invoke(IPC.watchStart) as Promise<void>,
    stop: () => ipcRenderer.invoke(IPC.watchStop) as Promise<void>,
    onFilesChanged: (cb) => subscribe<FilesChangedEvent>(IPC.filesChanged, cb),
  },
  quarantine: {
    quarantineFiles: (paths) =>
      ipcRenderer.invoke(IPC.quarantineFiles, paths) as Promise<QuarantineResult>,
    undo: (quarantineId) => ipcRenderer.invoke(IPC.quarantineUndo, quarantineId) as Promise<UndoResult>,
    list: () => ipcRenderer.invoke(IPC.quarantineList) as Promise<QuarantineSummary[]>,
    emptyQuarantine: () => ipcRenderer.invoke(IPC.quarantineEmpty) as Promise<void>,
  },
  renderCache: {
    cacheRender: (url, key) => ipcRenderer.invoke(IPC.renderCachePut, url, key) as Promise<string>,
    getCached: (key) => ipcRenderer.invoke(IPC.renderCacheGet, key) as Promise<string | null>,
    cacheSize: () => ipcRenderer.invoke(IPC.renderCacheSize) as Promise<number>,
    clear: () => ipcRenderer.invoke(IPC.renderCacheClear) as Promise<void>,
  },
  installMap: (request: InstallMapRequest) =>
    ipcRenderer.invoke(IPC.installMap, request) as Promise<InstallMapResult>,
  gameFolder: {
    validate: (path) =>
      ipcRenderer.invoke(IPC.gameFolderValidate, path) as Promise<GameFolderValidation>,
    autoDetect: () => ipcRenderer.invoke(IPC.gameFolderAutoDetect) as Promise<string[]>,
  },
  readFileBase64: (path) => ipcRenderer.invoke(IPC.fileReadBase64, path) as Promise<string>,
  appInfo: () => ipcRenderer.invoke(IPC.appInfo) as Promise<AppInfo>,
  auth: {
    beginDiscord: () =>
      ipcRenderer.invoke(IPC.authBeginDiscord) as Promise<{ token: string; handle: string } | null>,
  },
  updates: {
    check: () => ipcRenderer.invoke(IPC.updatesCheck) as Promise<void>,
    onStatus: (cb) => subscribe<UpdateStatus>(IPC.updatesStatus, cb),
  },
};

contextBridge.exposeInMainWorld('chrono', chrono);
