// Dev harness: esbuild watch for main + preload, Vite dev server for the
// renderer, then Electron pointed at the dev server via VITE_DEV_SERVER_URL.
// Electron is relaunched whenever the main/preload bundles rebuild.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { context } from 'esbuild';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const sharedSrc = path.join(root, '..', '..', 'packages', 'shared', 'src');

// The electron package's main export is the path to the binary.
const electronPath = require('electron');

const vite = await createServer({ configFile: path.join(root, 'vite.config.ts') });
await vite.listen();
const devUrl =
  vite.resolvedUrls?.local[0] ?? `http://localhost:${vite.config.server.port}/`;
console.log(`[dev] renderer at ${devUrl}`);

/** @type {import('node:child_process').ChildProcess | null} */
let electron = null;
let shuttingDown = false;

function launchElectron() {
  if (electron) {
    electron.removeAllListeners('exit');
    electron.kill();
    electron = null;
  }
  electron = spawn(String(electronPath), ['.'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: devUrl },
  });
  electron.on('exit', (code) => {
    if (!shuttingDown) {
      void shutdown(code ?? 0);
    }
  });
}

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (electron) {
    electron.removeAllListeners('exit');
    electron.kill();
  }
  await vite.close().catch(() => {});
  process.exit(code);
}

const built = { main: false, preload: false };
let started = false;

/** @param {'main' | 'preload'} which */
function relaunchPlugin(which) {
  return {
    name: `relaunch-${which}`,
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length > 0) return;
        built[which] = true;
        if (!started && built.main && built.preload) {
          started = true;
          launchElectron();
        } else if (started) {
          console.log(`[dev] ${which} rebuilt — relaunching electron`);
          launchElectron();
        }
      });
    },
  };
}

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  alias: { '@antares/shared': sharedSrc },
  sourcemap: true,
  logLevel: 'info',
};

const mainCtx = await context({
  ...common,
  entryPoints: [path.join(root, 'src', 'main', 'main.ts')],
  outfile: path.join(root, 'dist', 'main.cjs'),
  plugins: [relaunchPlugin('main')],
});
const preloadCtx = await context({
  ...common,
  entryPoints: [path.join(root, 'src', 'main', 'preload.ts')],
  outfile: path.join(root, 'dist', 'preload.cjs'),
  plugins: [relaunchPlugin('preload')],
});

await mainCtx.watch();
await preloadCtx.watch();

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
