import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig(({ mode }) => ({
  build: {
    target: 'es2022', outDir: 'dist/runtime', emptyOutDir: false, minify: false,
    lib: { entry: mode === 'spacelab' ? 'packages/adapters/spacelab/src/index.ts' : 'packages/runtime/src/index.ts', formats: ['es'], fileName: () => mode === 'spacelab' ? 'spacelab.js' : 'runtime.js' },
    sourcemap: false,
  },
  resolve: { alias: { '@actor-animator/types': fileURLToPath(new URL('./packages/project-types/src/index.ts', import.meta.url)) } },
}));
