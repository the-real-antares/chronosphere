import path from 'node:path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import updaterPkg from 'electron-updater';
import { IPC } from '../ipc.ts';
import { disposeServices, registerIpcHandlers } from './ipc-handlers.ts';

// Bundled to dist/main.cjs (CommonJS) — __dirname is dist/.

const DEEP_LINK_SCHEME = 'chronosphere';

/** The live window (focused + messaged on a deep link). */
let mainWindow: BrowserWindow | null = null;
/**
 * A deep-link slug captured before the renderer could subscribe — set on a
 * cold start (URL in argv / early macOS open-url) and pulled once via
 * consumePendingDeepLink so the very first launch-by-link is never dropped.
 */
let pendingDeepLink: string | null = null;

/** Parse chronosphere://map/<slug> → the slug, or null for anything else. */
function slugFromDeepLink(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${DEEP_LINK_SCHEME}:` || url.hostname !== 'map') return null;
  const seg = url.pathname.replace(/^\/+/, '').split('/')[0] ?? '';
  let slug: string;
  try {
    slug = decodeURIComponent(seg).trim();
  } catch {
    slug = seg.trim();
  }
  return slug.length > 0 ? slug : null;
}

/** First chronosphere:// argument in an argv (Windows/Linux carry the URL here). */
function deepLinkSlugFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.startsWith(`${DEEP_LINK_SCHEME}://`)) {
      const slug = slugFromDeepLink(arg);
      if (slug !== null) return slug;
    }
  }
  return null;
}

/** Route a resolved slug: focus + push it live if the renderer is up, else stash it. */
function routeDeepLink(slug: string | null): void {
  if (slug === null) return;
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send(IPC.deepLink, slug);
    return;
  }
  // No live window: stash for the renderer to pull on boot. If the app is
  // already running (e.g. macOS with every window closed), spin one up now;
  // before `ready`, whenReady() will create it. Either way boot pulls the slug.
  pendingDeepLink = slug;
  if (app.isReady()) createWindow();
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    // Small enough that the <1120px narrow layout is reachable by resizing.
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#070504',
    title: 'Chronosphere',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;

  win.once('ready-to-show', () => {
    win.show();
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  // No in-app windows, ever — web links (map pages, tutorials, Discord OAuth)
  // open in the system browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  }
  return win;
}

// Register chronosphere:// as this app's protocol so installers/OS route links
// back to us. In `electron .` dev runs the executable is Electron itself, so we
// must hand it the script path for the registration to resolve to this app.
if (process.defaultApp) {
  const scriptArg = process.argv[1];
  if (scriptArg !== undefined) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [path.resolve(scriptArg)]);
  }
} else {
  app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
}

// Single-instance: a second launch (e.g. clicking a chronosphere:// link) hands
// its argv to the primary instance instead of spawning a rival window.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  // A cold start on Windows/Linux carries the URL in our own argv.
  pendingDeepLink = deepLinkSlugFromArgv(process.argv);

  app.on('second-instance', (_event, argv) => {
    routeDeepLink(deepLinkSlugFromArgv(argv));
    if (mainWindow !== null && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // macOS delivers deep links here (can fire before or after `ready`).
  app.on('open-url', (event, url) => {
    event.preventDefault();
    routeDeepLink(slugFromDeepLink(url));
  });

  void app.whenReady().then(() => {
    registerIpcHandlers();
    // The pending-deep-link store lives here (main.ts), so serve the pull here.
    ipcMain.handle(IPC.deepLinkConsumePending, () => {
      const slug = pendingDeepLink;
      pendingDeepLink = null;
      return slug;
    });
    createWindow();
    // Auto-update from the generic feed at the-real-antares.com/updates (packaged
    // builds only). Downloads in the background and installs on the next quit.
    if (app.isPackaged) {
      void updaterPkg.autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    disposeServices();
  });
}
