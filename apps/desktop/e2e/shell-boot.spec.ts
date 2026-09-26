// Phase 0 E2E (§49, §61): app starts, sidecar answers, shell renders.
// Phase 1 extends this: create primitive → select face → change parameter →
// hole → Undo/Redo → save → reopen → identical geometry → export STEP/3MF.

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { HERE, MAIN } from "./helpers";

test("shell boots, core answers, beginner UI renders", async () => {
  const app = await electron.launch({
    args: [MAIN, "--no-sandbox", "--lang=en-US"],
  });
  try {
    const window = await app.firstWindow({ timeout: 30000 });
    await window.waitForLoadState("domcontentloaded");

    // Home (§home): boot lands on the home screen (riferimento UI/home.png).
    await expect(window.getByTestId("home-screen")).toBeVisible({
      timeout: 20000,
    });
    await window.getByTestId("home-new-project").click();

    // Beginner shell (§24)
    await expect(
      window.getByRole("button", { name: "Add", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await expect(window.getByTestId("viewport")).toBeVisible();
    await expect(
      window.getByPlaceholder(/What do you want to do/),
    ).toBeVisible();

    // Renderer → preload → main → sidecar → GetCoreInfo (§61 Task 6).
    // Status pill flips from "core offline" to "core 0.1.0" once answered.
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 20000,
    });

    await window.screenshot({
      path: path.join(HERE, "shell-boot.png"),
    });
  } finally {
    await app.close();
  }
});
