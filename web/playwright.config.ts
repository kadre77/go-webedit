import { defineConfig, devices } from "@playwright/test";

const port = process.env.E2E_PORT ?? "18080";
const baseURL = `http://localhost:${port}`;

// The tests drive the real binary, built with the frontend embedded, in test
// mode. `pnpm test:e2e` builds the frontend first.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  // Tests take about 3s; 15s fails a missing element fast instead of
  // waiting out the 30s default on every test of a red run.
  timeout: 15_000,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "web/e2e/serve.sh",
    cwd: "..",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: port,
      WEBEDIT_TEST_MODE: "1",
      WEBEDIT_BASE_URL: baseURL,
      WEBEDIT_OWNER_ACCOUNT_ID: "dbid:test-owner",
      WEBEDIT_SESSION_SECRET: "test-session-secret-0123456789abcdef",
      WEBEDIT_TOKEN_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      WEBEDIT_DATA_DIR: "/tmp/webedit-e2e",
    },
  },
});
