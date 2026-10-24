import { defineConfig, devices } from '@playwright/test';
const port=Number(process.env.ANIMATOR_TEST_PORT);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Set owned ANIMATOR_TEST_PORT for release tests.');
export default defineConfig({
  testDir:'./tests/release',fullyParallel:true,workers:2,reporter:'list',timeout:60_000,
  outputDir:'playwright-report/release-tests',
  use:{baseURL:`http://127.0.0.1:${port}/2d-actor-animator/`,trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:'node scripts/serve-release.mjs',url:`http://127.0.0.1:${port}/2d-actor-animator/`,reuseExistingServer:false},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'firefox',use:{...devices['Desktop Firefox']}},{name:'webkit',use:{...devices['Desktop Safari']}}],
});
