import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  build: {
    target: 'es2022', outDir: 'dist/runtime', emptyOutDir: false, minify: false,
    lib: { entry: {
      runtime: 'packages/runtime/src/index.ts', spacelab: 'packages/adapters/spacelab/src/index.ts',
      canvas2d: 'packages/adapters/canvas2d/src/index.ts', webgl2: 'packages/adapters/webgl2/src/index.ts',
    }, formats: ['es'], fileName: (_format, name) => `${name}.js` },
    rollupOptions: { output: { chunkFileNames: '[name].js', manualChunks(id) {
      if (id.includes('/packages/actor-tools/')) return 'core';
      if (id.includes('/packages/adapters/rendering/')) return 'render-resources';
    } } },
    sourcemap: false,
  },
  resolve: { alias: { '@actor-animator/types': fileURLToPath(new URL('./packages/project-types/src/index.ts', import.meta.url)) } },
});
