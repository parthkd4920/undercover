import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/test-results",
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:15173" },
  webServer: [
    {
      command: "uv run -m e2e.server",
      url: "http://127.0.0.1:18000/api/health",
      reuseExistingServer: false,
    },
    {
      command: "npx vite dashboard --host 127.0.0.1 --port 15173 --strictPort",
      url: "http://127.0.0.1:15173",
      env: { UNDERCOVER_API_URL: "http://127.0.0.1:18000" },
      reuseExistingServer: false,
    },
  ],
});
