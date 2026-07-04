import path from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { disposeServices, registerIpcHandlers } from './ipc-handlers.ts';

// Bundled to dist/main.cjs (CommonJS) — __dirname is dist/.

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

  win.once('ready-to-show', () => {
    win.show();
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

void app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
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
