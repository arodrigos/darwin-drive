import { defineConfig } from "@playwright/test";

// Con BASE_URL (smoke contra un despliegue) no se levanta servidor local.
const BASE_URL_EXTERNA = process.env.BASE_URL;

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.(e2e|spec)\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  retries: 0,
  use: {
    serviceWorkers: "block",
    baseURL: BASE_URL_EXTERNA ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: BASE_URL_EXTERNA
    ? undefined
    : { command: "npm run start", url: "http://127.0.0.1:3000", reuseExistingServer: true, timeout: 120000 },
});
