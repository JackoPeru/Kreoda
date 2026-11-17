import * as fs from "node:fs";
import * as path from "node:path";

export interface StoredRecentProject {
  path: string;
  openedAt: number;
}

const MAX_RECENT = 20;
// 20 absolute Windows paths may each approach the 4096-character input limit.
// Keep the read bound above the largest file our own writer can create.
const MAX_FILE_BYTES = 256 * 1024;

/** UNC and device paths would make Windows authenticate to a remote host. */
function isNetworkPath(value: string): boolean {
  return /^[\\/]{2}/.test(value);
}

/** PC-owned recent projects. Only successful opens/saves should call record(). */
export class RecentProjectStore {
  private readonly filename: string;

  constructor(userDataDirectory: string) {
    this.filename = path.join(userDataDirectory, "recent-projects-v1.json");
  }

  list(): StoredRecentProject[] {
    try {
      if (fs.statSync(this.filename).size > MAX_FILE_BYTES) return [];
      const parsed: unknown = JSON.parse(fs.readFileSync(this.filename, "utf8"));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry): entry is StoredRecentProject =>
        !!entry && typeof entry.path === "string" && path.isAbsolute(entry.path) &&
        !isNetworkPath(entry.path) &&
        entry.path.length <= 4096 && path.extname(entry.path).toLowerCase() === ".icad" &&
        typeof entry.openedAt === "number" && Number.isSafeInteger(entry.openedAt) &&
        entry.openedAt > 0).slice(0, MAX_RECENT);
    } catch {
      return [];
    }
  }

  record(filePath: string): StoredRecentProject[] {
    if (typeof filePath !== "string" || !path.isAbsolute(filePath) ||
        isNetworkPath(filePath) || filePath.length > 4096 ||
        path.extname(filePath).toLowerCase() !== ".icad" ||
        !fs.statSync(filePath).isFile()) {
      throw new Error("Recent project must be an existing local .icad file");
    }
    const normalized = path.normalize(filePath);
    const updated = [
      { path: normalized, openedAt: Date.now() },
      ...this.list().filter(project => project.path.toLowerCase() !== normalized.toLowerCase()),
    ].slice(0, MAX_RECENT);
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    const temporary = this.filename + ".tmp";
    try {
      fs.writeFileSync(temporary, JSON.stringify(updated), { encoding: "utf8", flag: "w" });
      fs.renameSync(temporary, this.filename);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch { /* retain original store */ }
      throw error;
    }
    return updated;
  }
}
