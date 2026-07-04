import { watch, type FSWatcher } from 'node:fs';

/**
 * fs.watch over each game folder's scanned dirs, debounced per folder.
 * Recursive watch is supported on macOS/Windows and on Linux since Node 20;
 * failures to establish a watcher are tolerated (renderer can still rescan).
 */

const DEBOUNCE_MS = 500;

interface FolderWatch {
  watchers: FSWatcher[];
  timer: NodeJS.Timeout | null;
}

export class WatchManager {
  private readonly folders = new Map<string, FolderWatch>();

  constructor(private readonly onChange: (folder: string) => void) {}

  /** (Re)start watching: `dirsByFolder` maps game folder -> scanned dirs. */
  start(dirsByFolder: Map<string, string[]>): void {
    this.stop();
    for (const [folder, dirs] of dirsByFolder) {
      const entry: FolderWatch = { watchers: [], timer: null };
      for (const dir of dirs) {
        try {
          const watcher = watch(dir, { recursive: true, persistent: false }, () => {
            this.bump(folder, entry);
          });
          watcher.on('error', () => {});
          entry.watchers.push(watcher);
        } catch {
          // Directory vanished or recursive watch unsupported — skip this dir.
        }
      }
      this.folders.set(folder, entry);
    }
  }

  stop(): void {
    for (const entry of this.folders.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      for (const watcher of entry.watchers) watcher.close();
    }
    this.folders.clear();
  }

  private bump(folder: string, entry: FolderWatch): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      this.onChange(folder);
    }, DEBOUNCE_MS);
  }
}
