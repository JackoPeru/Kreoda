import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Home } from "../src/components/home/Home";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("resumes video after reduced motion cancels a pending play without reporting a media failure", async () => {
  let reduced = false;
  const preference = new EventTarget();
  Object.defineProperty(preference, "matches", { get: () => reduced });
  vi.stubGlobal("matchMedia", vi.fn(() => preference));
  let rejectPlay!: (reason: Error) => void;
  const pendingPlay = new Promise<void>((_resolve, reject) => { rejectPlay = reject; });
  const play = vi.spyOn(HTMLMediaElement.prototype, "play")
    .mockReturnValueOnce(pendingPlay).mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  render(<Home header={<span>Header</span>} />);
  await waitFor(() => expect(play).toHaveBeenCalledOnce());
  act(() => {
    reduced = true;
    preference.dispatchEvent(new Event("change"));
  });
  await act(async () => {
    rejectPlay(new DOMException("Play interrupted by pause", "AbortError"));
    await Promise.resolve();
  });
  expect(screen.getByTestId("home-screen").getAttribute("data-video-error")).toBeNull();
  act(() => {
    reduced = false;
    preference.dispatchEvent(new Event("change"));
  });
  await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId("home-background-video").getAttribute("data-reduced-motion")).toBe("false");
  expect((screen.getByTestId("home-background-video") as HTMLVideoElement).autoplay).toBe(true);
});
