import http from 'node:http';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
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
import { checkForUpdatesManually, registerUpdaterEvents } from './lib/updates.ts';
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

  // --- auto-update (electron-updater; packaged builds only) --------------------
  // Attach the updater event listeners once, then let the renderer trigger a
  // user-initiated check. The startup auto-check in main.ts shares these events
  // but is gated out (manualCheck) so it stays silent.

  registerUpdaterEvents((status) => broadcast(IPC.updatesStatus, status));
  ipcMain.handle(IPC.updatesCheck, () =>
    checkForUpdatesManually((status) => broadcast(IPC.updatesStatus, status)),
  );

  // --- Discord sign-in (loopback token handshake) -----------------------------
  // Open the browser to the web OAuth with a one-shot local port; the web
  // callback redirects the Bearer token back to 127.0.0.1:<port>, which we
  // capture and store. Browsers can't reach this port from the internet.

  ipcMain.handle(
    IPC.authBeginDiscord,
    async (): Promise<{ token: string; handle: string } | null> => {
      const settings = await readSettings(settingsFile);
      const apiBase = settings.apiBase.replace(/\/+$/, '');
      return await new Promise((resolve) => {
        let settled = false;
        let server: http.Server;
        let timer: ReturnType<typeof setTimeout>;
        const finish = (result: { token: string; handle: string } | null): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          server.close();
          resolve(result);
        };
        server = http.createServer((req, res) => {
          const u = new URL(req.url ?? '/', 'http://127.0.0.1');
          if (u.pathname !== '/') {
            res.writeHead(404);
            res.end();
            return;
          }
          const token = u.searchParams.get('token') ?? '';
          const handle = u.searchParams.get('handle') ?? '';
          const ok = /^[0-9a-f]{64}$/.test(token);
          res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
          res.end(
            `<!doctype html><meta charset="utf-8"><title>Chronosphere</title><body style="font-family:system-ui;background:#070504;color:#f2eae2;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:20px;font-weight:800;color:${ok ? '#f0b64f' : '#ff8a6a'}">${ok ? 'Signed in ✓' : 'Sign-in failed'}</div><div style="margin-top:8px;color:#b9a79a">You can close this tab and return to Chronosphere.</div></div>`,
          );
          if (ok) {
            void writeSettings(settingsFile, mergeSettings(settings, { authToken: token })).then(() =>
              finish({ token, handle }),
            );
          } else {
            finish(null);
          }
        });
        server.on('error', () => finish(null));
        timer = setTimeout(() => finish(null), 5 * 60 * 1000);
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          const port = typeof addr === 'object' && addr ? addr.port : 0;
          if (!port) {
            finish(null);
            return;
          }
          void shell.openExternal(`${apiBase}/api/auth/discord?app=${port}`);
        });
      });
    },
  );
}
