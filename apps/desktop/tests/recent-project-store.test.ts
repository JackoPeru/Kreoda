import { afterEach, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { RecentProjectStore } from "../electron/recent-project-store";

const owned: string[] = [];
function fixture(): { root: string; project: string; store: RecentProjectStore } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kreoda-recents-"));
  owned.push(root);
  const project = path.join(root, "sample.icad");
  fs.writeFileSync(project, "verified-file");
  return { root, project, store: new RecentProjectStore(root) };
}
afterEach(() => {
  for (const directory of owned.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

it("persists only successfully recorded existing icad paths, across restarts", () => {
  const { root, project, store } = fixture();
  expect(store.list()).toEqual([]);
  expect(store.record(project)).toHaveLength(1);
  expect(new RecentProjectStore(root).list()).toEqual(store.list());
  expect(store.record(project)).toHaveLength(1);
  expect(() => store.record(path.join(root, "nonexistent.icad"))).toThrow();
  expect(() => store.record(path.join(root, "sample.step"))).toThrow();
  expect(store.list()).toHaveLength(1);
});

it("rejects a corrupt or oversized store without interpreting it as a project", () => {
  const { root, project, store } = fixture();
  const file = path.join(root, "recent-projects-v1.json");
  fs.writeFileSync(file, "[{\"path\":42}]");
  expect(store.list()).toEqual([]);
  fs.writeFileSync(file, "x".repeat(262145));
  expect(store.list()).toEqual([]);
  expect(store.record(project)).toHaveLength(1);
  expect(fs.existsSync(file + ".tmp")).toBe(false);
});

it("preserves last good history on a failed atomic replacement", () => {
  const { root, project, store } = fixture();
  store.record(project);
  const previous = fs.readFileSync(path.join(root, "recent-projects-v1.json"), "utf8");
  fs.mkdirSync(path.join(root, "recent-projects-v1.json.tmp"));
  expect(() => store.record(project)).toThrow();
  expect(fs.readFileSync(path.join(root, "recent-projects-v1.json"), "utf8")).toBe(previous);
});
