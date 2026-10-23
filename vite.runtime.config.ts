import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  build: {
    target: 'es2022', outDir: 'dist/runtime', emptyOutDir: false, minify: false,
    lib: { entry: 'packages/runtime/src/index.ts', formats: ['es'], fileName: () => 'runtime.js' },
    sourcemap: false,
  },
  resolve: { alias: { '@actor-animator/types': fileURLToPath(new URL('./packages/project-types/src/index.ts', import.meta.url)) } },
});
