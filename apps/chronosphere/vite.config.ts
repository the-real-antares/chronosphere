import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(here, 'src/renderer'),
  // Relative asset paths so dist/renderer/index.html works from file:// in prod.
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@antares/shared': path.join(here, '..', '..', 'packages', 'shared', 'src'),
    },
  },
  build: {
    outDir: path.join(here, 'dist', 'renderer'),
    emptyOutDir: true,
  },
  server: {
    port: 5178,
    strictPort: true,
  },
});
