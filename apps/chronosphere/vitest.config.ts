import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@antares/shared': path.join(here, '..', '..', 'packages', 'shared', 'src'),
    },
  },
  test: {
    environment: 'node',
    // Main-process services + the renderer's pure libs (reconcile/format).
    include: ['src/main/**/*.test.ts', 'src/renderer/lib/**/*.test.ts'],
  },
});
