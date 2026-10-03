import { afterEach, expect, it, vi } from "vitest";

const draws = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("three", async (original) => ({
  ...await original<typeof import("three")>(),
  WebGLRenderer: class {
    domElement = document.createElement("canvas");
    render = draws.render;
    setPixelRatio() {}
    setSize() {}
    dispose() {}
  },
}));
import { CadViewport } from "../src/viewport/CadViewport";

afterEach(() => vi.unstubAllGlobals());

it("redraws after camera zoom even when hovering empty space leaves selection unchanged", () => {
  let frame: globalThis.FrameRequestCallback = () => {};
  vi.stubGlobal("requestAnimationFrame", (callback: globalThis.FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  draws.render.mockClear();
  const container = document.createElement("div");
  const viewport = new CadViewport(container, { onHover: () => {}, onSelect: () => {} });
  try {
    expect(draws.render).toHaveBeenCalledTimes(1);
    frame(0);
    expect(draws.render).toHaveBeenCalledTimes(1);
    container.querySelector("canvas")!.dispatchEvent(new WheelEvent("wheel", { deltaY: 60 }));
    frame(16);
    expect(draws.render).toHaveBeenCalledTimes(2);
    frame(32);
    expect(draws.render).toHaveBeenCalledTimes(2);
  } finally {
    viewport.dispose();
  }
});
