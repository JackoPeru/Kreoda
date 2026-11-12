import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { recentProjects, recordRecentProject, loadRecentProjects } from "../src/model/recent-projects";
import { RecentProjects } from "../src/components/home/RecentProjects";

beforeEach(() => { localStorage.clear(); Object.defineProperty(window, "kreoda", { configurable: true, value: {} }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("shows no fabricated projects when history is empty or corrupt", () => {
  render(<RecentProjects />);
  expect(screen.getByText("Nessun progetto salvato o aperto di recente.")).toBeTruthy();
  expect(screen.queryByText("Cucina_Villa_Costa")).toBeNull();
  cleanup();
  localStorage.setItem("kreoda.recent-projects.v1", "invalid-json");
  expect(recentProjects()).toEqual([]);
});

it("records only real paths, deduplicates and opens the selected path", async () => {
  vi.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValueOnce(200);
  await recordRecentProject("C:\\models\\part.icad");
  await recordRecentProject("C:\\MODELS\\part.icad");
  expect(recentProjects()).toHaveLength(1);
  const open = vi.fn().mockResolvedValue(null);
  render(<RecentProjects onOpen={open} />);
  fireEvent.click(screen.getByRole("button", { name: "Apri progetto part.icad" }));
  await waitFor(() => expect(open).toHaveBeenCalledWith("C:\\MODELS\\part.icad"));
});

it("reports failed opens without treating them as successful", async () => {
  await recordRecentProject("/models/missing.icad");
  render(<RecentProjects onOpen={async () => "File not found"} />);
  fireEvent.click(screen.getByRole("button", { name: "Apri progetto missing.icad" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("File not found"));
});

it("migrates verified legacy paths into the canonical main-process registry", async () => {
  await recordRecentProject("C:\\models\\existing.icad");
  await recordRecentProject("C:\\models\\stale.icad");
  const recorded = vi.fn(async (path: string) => {
    if (path.endsWith("stale.icad")) throw Error("missing file");
    return [{ path, openedAt: 50 }];
  });
  Object.defineProperty(window, "kreoda", { configurable: true, value: {
    recentProjectsList: vi.fn(async () => []), recentProjectsRecord: recorded,
  } });
  expect(await loadRecentProjects()).toEqual([{ path: "C:\\models\\existing.icad", openedAt: 50 }]);
  expect(recorded).toHaveBeenCalledTimes(2);
  expect(recentProjects()).toEqual([]);
});

it("does not create a local entry when canonical validation refuses a path", async () => {
  const record = vi.fn(async () => { throw Error("file does not exist"); });
  Object.defineProperty(window, "kreoda", { configurable: true, value: { recentProjectsRecord: record } });
  await recordRecentProject("C:\\models\\missing.icad");
  expect(record).toHaveBeenCalledOnce();
  expect(recentProjects()).toEqual([]);
});
