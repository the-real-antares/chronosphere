import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import {
  IPC,
  type AppInfo,
  type ChronoSettings,
  type FilesChangedEvent,
  type FolderScanResult,
  type InstallMapRequest,
  type ScanProgress,
} from '../ipc.ts';
import {
  autoDetectGameFolders,
  demoFolderCandidates,
  validateGameFolder,
} from './lib/game-folder.ts';
import { installMap } from './lib/install.ts';
import { getPreview } from './lib/preview.ts';
import {
  emptyQuarantine,
  listQuarantine,
  quarantineFiles,
  undoQuarantine,
} from './lib/quarantine.ts';
import {
  cacheRender,
  clearRenderCache,
  getCachedRender,
  renderCacheSize,
} from './lib/render-cache.ts';
import { readFileBase64Within } from './lib/read-file.ts';
import { loadScanCache, saveScanCache, type ScanCache } from './lib/scan-cache.ts';
import { resolveScanRoots, scanGameFolder } from './lib/scanner.ts';
import { mergeSettings, readSettings, writeSettings } from './lib/settings.ts';
import { WatchManager } from './lib/watcher.ts';

/** All main-process services behind the typed IPC surface. */

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

let watchManager: WatchManager | null = null;

export function disposeServices(): void {
  watchManager?.stop();
  watchManager = null;
}

export function registerIpcHandlers(): void {
  const userData = app.getPath('userData');
  const settingsFile = path.join(userData, 'settings.json');
  const scanCacheFile = path.join(userData, 'scan-cache.json');
  const quarantineRoot = path.join(userData, 'quarantine');
  const renderCacheDir = path.join(userData, 'render-cache');

  // --- settings ------------------------------------------------------------

  ipcMain.handle(IPC.settingsGet, async (): Promise<ChronoSettings> => readSettings(settingsFile));

  ipcMain.handle(
    IPC.settingsSet,
    async (_event, patch: Partial<ChronoSettings>): Promise<ChronoSettings> => {
      const current = await readSettings(settingsFile);
      const next = mergeSettings(current, patch ?? {});
      await writeSettings(settingsFile, next);
      return next;
    },
  );

  // --- scan ----------------------------------------------------------------

  let scanInFlight: Promise<FolderScanResult[]> | null = null;

  async function runScan(): Promise<FolderScanResult[]> {
    const settings = await readSettings(settingsFile);
    const prevCache = await loadScanCache(scanCacheFile);
    const nextCache: ScanCache = {};
    const results: FolderScanResult[] = [];
    for (const gameFolder of settings.gameFolders) {
      const onProgress = (progress: ScanProgress): void => {
        broadcast(IPC.scanProgress, progress);
      };
      results.push(await scanGameFolder(gameFolder.path, prevCache, nextCache, onProgress));
    }
    await saveScanCache(scanCacheFile, nextCache);
    return results;
  }

  ipcMain.handle(IPC.scanFolders, (): Promise<FolderScanResult[]> => {
    scanInFlight ??= runScan().finally(() => {
      scanInFlight = null;
    });
    return scanInFlight;
  });

  // --- preview ---------------------------------------------------------------

  ipcMain.handle(IPC.previewGet, (_event, filePath: string) => getPreview(filePath));

  // --- watch -----------------------------------------------------------------

  ipcMain.handle(IPC.watchStart, async (): Promise<void> => {
    const settings = await readSettings(settingsFile);
    const dirsByFolder = new Map<string, string[]>();
    for (const gameFolder of settings.gameFolders) {
      const { dirs } = await resolveScanRoots(gameFolder.path);
      dirsByFolder.set(gameFolder.path, dirs);
    }
    watchManager ??= new WatchManager((folder) => {
      const event: FilesChangedEvent = { folder };
      broadcast(IPC.filesChanged, event);
    });
    watchManager.start(dirsByFolder);
  });

  ipcMain.handle(IPC.watchStop, (): void => {
    watchManager?.stop();
  });

  // --- quarantine ------------------------------------------------------------

  ipcMain.handle(IPC.quarantineFiles, (_event, paths: string[]) =>
    quarantineFiles(quarantineRoot, Array.isArray(paths) ? paths : []),
  );
  ipcMain.handle(IPC.quarantineUndo, (_event, id: string) => undoQuarantine(quarantineRoot, id));
  ipcMain.handle(IPC.quarantineList, () => listQuarantine(quarantineRoot));
  ipcMain.handle(IPC.quarantineEmpty, () => emptyQuarantine(quarantineRoot));

  // --- render cache ----------------------------------------------------------

  ipcMain.handle(IPC.renderCachePut, (_event, url: string, key: string) =>
    cacheRender(renderCacheDir, url, key),
  );
  ipcMain.handle(IPC.renderCacheGet, (_event, key: string) => getCachedRender(renderCacheDir, key));
  ipcMain.handle(IPC.renderCacheSize, () => renderCacheSize(renderCacheDir));
  ipcMain.handle(IPC.renderCacheClear, () => clearRenderCache(renderCacheDir));

  // --- install ---------------------------------------------------------------

  ipcMain.handle(IPC.installMap, (_event, request: InstallMapRequest) => installMap(request));

  // --- game folders ----------------------------------------------------------

  ipcMain.handle(IPC.gameFolderValidate, (_event, folder: string) => validateGameFolder(folder));

  ipcMain.handle(IPC.gameFolderAutoDetect, () =>
    autoDetectGameFolders({
      platform: process.platform,
      home: app.getPath('home'),
      env: process.env,
      extraCandidates: app.isPackaged
        ? []
        : demoFolderCandidates(app.getAppPath(), process.cwd()),
    }),
  );

  // --- file bytes (contribute upload) ------------------------------------------

  ipcMain.handle(IPC.fileReadBase64, async (_event, filePath: string): Promise<string> => {
    const settings = await readSettings(settingsFile);
    return readFileBase64Within(
      settings.gameFolders.map((f) => f.path),
      filePath,
    );
  });

  // --- app info (splash self-test) --------------------------------------------

  ipcMain.handle(IPC.appInfo, (): AppInfo => {
    return {
      userDataPath: userData,
      appVersion: app.getVersion(),
      platform: process.platform,
      electronVersion: process.versions.electron ?? 'unknown',
    };
  });
}
