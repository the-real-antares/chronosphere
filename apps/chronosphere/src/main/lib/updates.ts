import { app } from 'electron';
import updaterPkg from 'electron-updater';
import type { UpdateStatus } from '../../ipc.ts';

/**
 * User-initiated update checks over electron-updater.
 *
 * The startup `checkForUpdatesAndNotify()` in main.ts fires the same autoUpdater
 * events, so a `manualCheck` gate keeps this quiet unless the user actually
 * pressed "Check for updates" — no unsolicited "up to date" toast on every
 * launch. Only packaged builds have an update feed; in dev we short-circuit to
 * a `dev` status instead of surfacing the updater's "no app-update.yml" error.
 */

const { autoUpdater } = updaterPkg;

let wired = false;
let manualCheck = false;

export function registerUpdaterEvents(broadcast: (status: UpdateStatus) => void): void {
  if (wired) return;
  wired = true;

  autoUpdater.on('update-available', (info: { version: string }) => {
    if (!manualCheck) return;
    // Keep the gate open — autoDownload proceeds and 'update-downloaded' follows.
    broadcast({ kind: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', (info: { version: string }) => {
    if (!manualCheck) return;
    manualCheck = false;
    broadcast({ kind: 'not-available', version: info.version });
  });
  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    if (!manualCheck) return;
    manualCheck = false;
    broadcast({ kind: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', (err: Error) => {
    if (!manualCheck) return;
    manualCheck = false;
    broadcast({ kind: 'error', message: err?.message ?? String(err) });
  });
}

export async function checkForUpdatesManually(
  broadcast: (status: UpdateStatus) => void,
): Promise<void> {
  if (!app.isPackaged) {
    broadcast({ kind: 'dev' });
    return;
  }
  manualCheck = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    if (manualCheck) {
      manualCheck = false;
      broadcast({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }
}
