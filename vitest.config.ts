import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@actor-animator/types': fileURLToPath(new URL('./packages/project-types/src/index.ts', import.meta.url)) } },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node', pool: 'threads', maxWorkers: 2, isolate: false, testTimeout: 15000, hookTimeout: 30000 },
});
