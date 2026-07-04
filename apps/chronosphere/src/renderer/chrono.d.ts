import type { ChronoApi } from '../ipc.ts';

declare global {
  interface Window {
    /** Typed IPC surface exposed by src/main/preload.ts via contextBridge. */
    chrono: ChronoApi;
  }
}

export {};
