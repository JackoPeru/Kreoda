import { defineConfig } from "@playwright/test";

// E2E against the real Electron shell (§49). Run AFTER building:
//   pnpm build:renderer && pnpm build:electron && pnpm test:e2e
export default defineConfig({
  testDir: "./e2e",
  timeout: 90000,
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
});
