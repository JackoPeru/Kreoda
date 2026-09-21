import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Viewport needs a real GPU (WebGL) — covered by Playwright E2E against
// Electron (§49). Unit tests mock the imperative viewport boundary.
vi.mock("../src/viewport/CadViewport", () => ({
  CadViewport: class {
    setHover = vi.fn();
    setSelected = vi.fn();
    setPickMode = vi.fn();
    syncMeshes = vi.fn();
    syncReferencePlanes = vi.fn();
    requestRender = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock("../src/ipc/coreClient", () => ({
  coreClient: { getCoreInfo: vi.fn().mockRejectedValue(new Error("offline")) },
}));

import { App } from "../src/app/App";

describe("beginner shell (§24)", () => {
  it("shows toolbar, viewport, command bar", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
    expect(screen.getByTestId("viewport")).toBeTruthy();
    expect(
      screen.getByPlaceholderText(/What do you want to do/),
    ).toBeTruthy();
  });
});
