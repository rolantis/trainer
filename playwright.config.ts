import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 90_000,
	fullyParallel: true,
	reporter: [['list']],
	use: {
		...devices['Pixel 7'],
		baseURL: 'http://localhost:4173',
		trace: 'retain-on-failure'
	},
	// Tests run against the production build, service worker included.
	webServer: {
		command: 'npm run build && npm run preview -- --port 4173 --strictPort',
		url: 'http://localhost:4173',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	}
});
