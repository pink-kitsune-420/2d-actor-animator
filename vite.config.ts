import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: 'apps/web', base: './',
  resolve: { alias: { '@actor-animator/types': fileURLToPath(new URL('./packages/project-types/src/index.ts', import.meta.url)) } },
  build: { outDir: '../../dist', emptyOutDir: true, modulePreload: { polyfill: false },
    rollupOptions: { input: { main: 'apps/web/index.html', legacy: 'apps/web/actor-tools.html' } } },
});
