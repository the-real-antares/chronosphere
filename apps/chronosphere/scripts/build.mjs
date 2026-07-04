// Production build: esbuild bundles the Electron main + preload processes to
// CommonJS (dist/main.cjs, dist/preload.cjs), then Vite builds the renderer
// into dist/renderer.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const sharedSrc = path.join(root, '..', '..', 'packages', 'shared', 'src');

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

await build({
  ...common,
  entryPoints: [path.join(root, 'src', 'main', 'main.ts')],
  outfile: path.join(root, 'dist', 'main.cjs'),
});

await build({
  ...common,
  entryPoints: [path.join(root, 'src', 'main', 'preload.ts')],
  outfile: path.join(root, 'dist', 'preload.cjs'),
});

const { build: viteBuild } = await import('vite');
await viteBuild({ configFile: path.join(root, 'vite.config.ts') });

console.log('build complete: dist/main.cjs, dist/preload.cjs, dist/renderer/');
