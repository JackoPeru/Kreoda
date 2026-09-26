import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

afterEach(() => cleanup());

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

// No WebGL in jsdom: the home 3D lounge falls back to its CSS gradient.
// Stub getContext so jsdom stays silent (real browsers use real WebGL).
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

import { App } from "../src/app/App";

describe("beginner shell (§24)", () => {
  it("boots to the home screen (riferimento UI/home.png)", () => {
    render(<App />);
    expect(screen.getByTestId("home-screen")).toBeTruthy();
    expect(screen.getByTestId("home-topbar")).toBeTruthy();
    expect(screen.getByTestId("home-recent")).toBeTruthy();
    expect(screen.getByTestId("home-hero")).toBeTruthy();
    expect(screen.getByTestId("home-quickstart")).toBeTruthy();
    expect(screen.getByTestId("home-tasks")).toBeTruthy();
  });

  it("shows toolbar, viewport, command bar after entering the workspace", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("home-new-project"));
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
    expect(screen.getByTestId("viewport")).toBeTruthy();
    expect(
      screen.getByPlaceholderText(/What do you want to do/),
    ).toBeTruthy();
  });
});
