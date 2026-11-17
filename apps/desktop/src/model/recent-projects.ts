export interface RecentProject { path: string; openedAt: number }
const KEY = "kreoda.recent-projects.v1";

export function recentProjects(): RecentProject[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is RecentProject => !!item && typeof item.path === "string" &&
      item.path.length > 0 && typeof item.openedAt === "number" && Number.isFinite(item.openedAt)).slice(0, 20);
  } catch { return []; }
}

export async function recordRecentProject(path: string): Promise<void> {
  if (!path.trim()) return;
  if (window.kreoda?.recentProjectsRecord) {
    try {
      await window.kreoda.recentProjectsRecord(path);
      return;
    } catch {
      // A failed canonical write must not create fictitious history.
      return;
    }
  }
  const next = [{ path, openedAt: Date.now() }, ...recentProjects().filter(item => item.path.toLowerCase() !== path.toLowerCase())].slice(0, 20);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* optional preference storage */ }
}

export async function loadRecentProjects(): Promise<RecentProject[]> {
  const legacy = recentProjects();
  if (!window.kreoda?.recentProjectsList) return legacy;
  try {
    let canonical = await window.kreoda.recentProjectsList();
    if (window.kreoda.recentProjectsRecord) {
      // Only migrate existing .icad paths. Main validates existence and file type.
      for (const entry of [...legacy].reverse()) {
        if (canonical.some(saved => saved.path.toLowerCase() === entry.path.toLowerCase())) continue;
        try { canonical = await window.kreoda.recentProjectsRecord(entry.path); } catch { /* stale legacy path */ }
      }
      try { localStorage.removeItem(KEY); } catch { /* migration can safely retry */ }
    }
    return canonical;
  } catch { return legacy; }
}
