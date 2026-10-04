// Electron main — window lifecycle, dialogs, updater, sidecar lifecycle (§7).
// Security: contextIsolation true, sandbox true, no Node in renderer (§48).

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { SidecarManager } from "./sidecar";
import { installRendererRecovery } from "./renderer-recovery";
import { SessionRelay, type SessionDelta } from "./session";
import { SessionDevices } from "./session-devices";
import { sessionInterfaces } from "./session-listener";
import type { SessionConnectionStatus } from "./session-control-ui";
import { FrameDecoder } from "@kreoda/protocol";
import {
  checkFeed,
  downloadPinned,
  verifyManifest,
} from "./updater";

let mainWindow: BrowserWindow | null = null;
let sidecar: SidecarManager | null = null;
// Phase 11b: unified session relay (Quest/agent/second-client front for the
// local authoritative core). Listener is optional; the service always exists.
let sessionRelay: SessionRelay | null = null;

const isDev = !app.isPackaged;

function createWindow(previous?: BrowserWindow): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "Kreoda",
    // Kreoda mark: .vite/build → apps/desktop/assets/icon.ico.
    icon: path.join(__dirname, "../../assets/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
    backgroundColor: "#0b0e13",
  });

  // Keep the native core alive while Electron replaces a crashed renderer.
  // The reloaded UI offers the persisted autosave through its normal path.
  const createdWindow = mainWindow;
  if (previous) {
    createdWindow.setBounds(previous.getBounds());
    if (previous.isMaximized()) createdWindow.maximize();
  }
  installRendererRecovery(createdWindow, () => {
    // Create first: destroying the only window would trigger app.quit().
    createWindow(createdWindow);
    createdWindow.destroy();
  }, () => sessionRelay?.onRendererDisconnected());
  createdWindow.webContents.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) sessionRelay?.onRendererDisconnected();
  });
  createdWindow.webContents.on("did-finish-load", () => sessionRelay?.onRendererConnected());

  if (isDev && process.env["VITE_DEV_SERVER_URL"]) {
    void mainWindow.loadURL(process.env["VITE_DEV_SERVER_URL"]);
  } else {
    // Production: renderer built by `vite build` into apps/desktop/dist.
    void mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  createdWindow.on("closed", () => {
    if (mainWindow === createdWindow) mainWindow = null;
  });
}

async function initSidecar(): Promise<void> {
  sidecar = new SidecarManager();
  sidecar.onCrash((code) => {
    // §51: freeze editing (renderer shows banner), restart the engine,
    // restore from autosave (Phase 8), rehydrate viewport.
    void mainWindow?.webContents.send("kreoda:core-crashed", { code });
    console.error(`[main] geometry engine exited (${code}) — restarting`);
    // Phase 11b: session clients drop in-flight state and resync by revision.
    sessionRelay?.onSidecarCrashed();
    void sidecar
      ?.start()
      .then(() => mainWindow?.webContents.send("kreoda:core-restarted", {}))
      .catch((err) => console.error("[main] sidecar restart failed", err));
  });
  try {
    await sidecar.start();
  } catch (err) {
    console.error("[main] sidecar failed to start", err);
  }
}

app.whenReady().then(async () => {
  let devices: SessionDevices | undefined;
  try {
    const storage = new SessionDevices(app.getPath("userData"));
    await storage.load();devices = storage;
  } catch { console.error("[session] trusted device storage unavailable"); }
  void initSidecar();
  sessionRelay = new SessionRelay(() => sidecar, (delta: SessionDelta) => {
    mainWindow?.webContents.send("kreoda:session-delta", delta);
  }, devices);
  // The local session service exists without a listener. Environment settings
  // enable the development/test network endpoint; production pairing follows.
  const sessionPort = Number(process.env["KREODA_SESSION_PORT"] ?? "");
  const testToken = process.env["KREODA_SESSION_TOKEN"];
  if (isDev && testToken && Number.isInteger(sessionPort) && sessionPort > 0) {
    try {
      await sessionRelay.enableListener({
        port: sessionPort,
        host: process.env["KREODA_SESSION_HOST"] ?? "127.0.0.1",
        token: testToken,
      });
    } catch (e) {
      console.error("[session] development listener failed to start");
    }
  }
  // Signed-update check runs after boot; inert without a feed (§61).
  setTimeout(() => {
    void maybeAutoUpdate();
  }, 5000);

  // Typed IPC routing main ⇄ sidecar (§7-§8). Renderer never spawns processes.
  ipcMain.handle("kreoda:session-snapshot", () => {
    if (!sessionRelay) throw new Error("session service not running");
    return sessionRelay.localSnapshot();
  });
  const connectionStatus = (): SessionConnectionStatus => ({
    ...sessionRelay!.connectionStatus(), interfaces: sessionInterfaces().map(item => ({ name: item.name, host: item.address })),
    devices: devices?.list() ?? [], pairingAvailable: !!devices,
  });
  // Serialize listener controls so overlapping clicks cannot reopen a
  // listener while another request is disabling it.
  let connectionQueue: Promise<void> = Promise.resolve();
  const control = <T>(run: () => Promise<T> | T): Promise<T> => {
    const pending = connectionQueue.then(run);
    connectionQueue = pending.then(() => {}, () => {});return pending;
  };
  ipcMain.handle("kreoda:session-status", () => control(connectionStatus));
  ipcMain.handle("kreoda:session-enable", (_event, host: unknown, port: unknown) => control(async () => {
    if (typeof host !== "string" || typeof port !== "number") throw new Error("invalid session address");
    if (!devices) throw new Error("trusted device storage unavailable");
    await sessionRelay!.enableListener({ host, port });return connectionStatus();
  }));
  ipcMain.handle("kreoda:session-disable", () => control(async () => {
    await sessionRelay!.disableListener();return connectionStatus();
  }));
  ipcMain.handle("kreoda:session-pair", () => control(() => {
    if (!devices || !sessionRelay!.connectionStatus().listener) throw new Error("enable a session listener first");
    return devices.beginPairing();
  }));
  ipcMain.handle("kreoda:session-cancel-pair", () => control(() => devices?.cancelPairing()));
  ipcMain.handle("kreoda:session-revoke", (_event, deviceId: unknown) => control(async () => {
    if (typeof deviceId !== "string") throw new Error("invalid device identity");
    await sessionRelay!.revokeDevice(deviceId);return connectionStatus();
  }));
  ipcMain.handle("kreoda:invoke", async (_event, framedBase64: string) => {
    if (!sessionRelay) throw new Error("session service not running");
    if (typeof framedBase64 !== "string" || framedBase64.length > Math.ceil((new FrameDecoder().maxFrameBytes + 4) / 3) * 4) throw new Error("invalid framed command");
    const bytes = Buffer.from(framedBase64, "base64");
    const response = await sessionRelay.invokeLocal(bytes);
    return Buffer.from(response).toString("base64");
  });
  ipcMain.handle("kreoda:session-cancel-edit", async (_event, featureId: unknown) => {
    if (typeof featureId !== "string" || !featureId || featureId.length > 128) throw new Error("invalid feature identity");
    await sessionRelay?.cancelLocalEdit(featureId);
  });

  ipcMain.handle("kreoda:core-info", async () => {
    if (!sidecar) return { running: false };
    return { running: sidecar.isRunning(), pid: sidecar.pid() };
  });

  // Signed updates (Phase 8 §61): inert unless KREODA_UPDATE_FEED points
  // at a manifest feed. Renderer can trigger a check; downloads only land
  // after Ed25519 verification + sha256 pinning (see updater.ts).
  ipcMain.handle("kreoda:check-updates", async () => {
    const feed = process.env["KREODA_UPDATE_FEED"];
    if (!feed) return { available: false as const, reason: "no-feed" };
    try {
      const { available, manifest } = await checkFeed(feed, app.getVersion());
      if (!available || !manifest) return { available: false as const };
      // C13: never announce an unverified manifest — the renderer banner is
      // a trust signal, so verification happens HERE, before availability.
      const pubkey = process.env["KREODA_UPDATE_PUBKEY"] ?? "";
      if (!pubkey || !verifyManifest(manifest, pubkey)) {
        console.error("[updater] check-updates: manifest unverified");
        return { available: false as const, reason: "unverified" };
      }
      return { available: true as const, version: manifest.version };
    } catch (err) {
      console.error(
        "[updater] check failed",
        err instanceof Error ? err.message : err,
      );
      return { available: false as const, reason: "check-failed" };
    }
  });

  async function maybeAutoUpdate(): Promise<void> {
    const feed = process.env["KREODA_UPDATE_FEED"];
    if (!feed || !mainWindow) return;
    try {
      const { available, manifest } = await checkFeed(feed, app.getVersion());
      if (!available || !manifest) return;
      const pubkey = process.env["KREODA_UPDATE_PUBKEY"] ?? "";
      if (!pubkey) {
        console.error(
          "[updater] feed set but no KREODA_UPDATE_PUBKEY — refusing unsigned update",
        );
        return;
      }
      if (!verifyManifest(manifest, pubkey)) {
        console.error("[updater] manifest signature INVALID — refusing");
        return;
      }
      mainWindow.webContents.send("kreoda:update-available", {
        version: manifest.version,
      });
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: "question",
        message: `Kreoda ${manifest.version} is available (signature verified).`,
        detail: "Download the verified installer now?",
        buttons: ["Download", "Later"],
        defaultId: 1,
      });
      if (response !== 0) return;
      const dest = await downloadPinned(
        manifest,
        path.join(app.getPath("userData"), "updates"),
      );
      mainWindow.webContents.send("kreoda:update-downloaded", {
        path: dest,
      });
      const { response: reveal } = await dialog.showMessageBox(mainWindow, {
        type: "info",
        message: `Verified update saved to ${dest}.`,
        detail: "Run the installer to update (auto-install arrives with the signed install pipeline).",
        buttons: ["Reveal file", "OK"],
        defaultId: 1,
      });
      if (reveal === 0) shell.showItemInFolder(dest);
    } catch (err) {
      console.error(
        "[updater] update failed",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Crash recovery (Phase 8): renderer-driven autosave snapshots. The main
  // process only owns the path — content flows through the typed core path
  // (Save/OpenDocument), never through fs in the renderer (§48).
  // KREODA_RECOVERY_DIR overrides the location (E2E isolation).
  const recoveryDir =
    process.env["KREODA_RECOVERY_DIR"] ||
    path.join(app.getPath("userData"), "recovery");
  const recoveryFile = path.join(recoveryDir, "autosave.icad");

  ipcMain.handle("kreoda:recovery-path", async () => {
    fs.mkdirSync(recoveryDir, { recursive: true });
    return recoveryFile;
  });

  ipcMain.handle("kreoda:recovery-exists", async () => fs.existsSync(recoveryFile));

  ipcMain.handle("kreoda:recovery-clear", async () => {
    try {
      fs.unlinkSync(recoveryFile);
    } catch {
      // Already gone — the invariant (no stale prompt) holds.
    }
  });

  // Plugin sources (§47, Phase 9b): the main process owns the plugins dir;  // the renderer never touches fs. Bounded: 20 files × 256 KiB, .js only.
  // KREODA_PLUGINS_DIR overrides the location (E2E isolation).
  ipcMain.handle("kreoda:plugins-list", async () => {
    const dir =
      process.env["KREODA_PLUGINS_DIR"] ||
      path.join(app.getPath("userData"), "plugins");
    let names: string[];
    try {
      names = fs
        .readdirSync(dir)
        .filter((n) => n.endsWith(".js"))
        .slice(0, 20);
    } catch {
      return [];
    }
    const out: { filename: string; source: string }[] = [];
    for (const name of names) {
      try {
        const full = path.join(dir, name);
        // M10: readdir basenames block ../ but a symlink evil.js → /etc/passwd
        // would still load via statSync (follows). Reject symlinks outright
        // and confine the real path to the plugins dir.
        const lst = fs.lstatSync(full);
        if (lst.isSymbolicLink()) continue;
        const real = fs.realpathSync(full);
        const realDir = fs.realpathSync(dir);
        if (real !== path.join(realDir, name)) continue;
        if (!real.startsWith(realDir + path.sep) && real !== path.join(realDir, name)) continue;
        const stat = fs.statSync(full);
        if (!stat.isFile() || stat.size > 256 * 1024) continue;
        out.push({ filename: name, source: fs.readFileSync(full, "utf8") });
      } catch {
        // One unreadable plugin must not block the rest.
      }
    }
    return out;
  });

  // Crash/support bundle (§61): versions + sidecar log tail + a MODEL-FREE
  // summary in one file the user can attach to a bug report. The snapshot
  // arrives as an opaque string — main never interprets model content, and
  // by default only counts/types flow into the bundle (M12: no silent PII).
  // Pass includeModel=true (explicit banner checkbox) to attach the full
  // summary for hard geometry bugs.
  ipcMain.handle(
    "kreoda:crash-bundle",
    async (_event, snapshotJson: string, includeModel?: boolean) => {
      let snapshot: unknown = null;
      try {
        snapshot = JSON.parse(snapshotJson);
      } catch {
        snapshot = { unparseable: true };
      }
      if (!includeModel && snapshot && typeof snapshot === "object") {
        const s = snapshot as {
          snapshot?: {
            bodies?: { type: string }[];
            sketches?: unknown[];
            revision?: number;
          };
          coreVersion?: unknown;
        };
        const bodies = s.snapshot?.bodies;
        snapshot = {
          redacted: true,
          bodies: Array.isArray(bodies) ? bodies.length : 0,
          bodyTypes: Array.isArray(bodies)
            ? [...new Set(bodies.map((b) => b?.type ?? "?"))]
            : [],
          sketches: Array.isArray(s.snapshot?.sketches)
            ? s.snapshot!.sketches!.length
            : 0,
          revision:
            typeof s.snapshot?.revision === "number"
              ? s.snapshot.revision
              : null,
          coreVersion: s.coreVersion ?? null,
        };
      }
      const scrub = (line: string): string => {
        // Home-dir paths in stderr would dox the reporter — collapse them.
        const home = app.getPath("home");
        return home ? line.split(home).join("~") : line;
      };
      const bundle = {
        app: "Kreoda",
        appVersion: app.getVersion(),
        electron: process.versions.electron ?? null,
        node: process.versions.node ?? null,
        platform: process.platform,
        arch: process.arch,
        createdAt: new Date().toISOString(),
        sidecar: {
          running: sidecar?.isRunning() ?? false,
          pid: sidecar?.pid() ?? null,
          stderrTail: (sidecar?.recentStderr() ?? []).map(scrub),
        },
        snapshot,
      };
      const dir = path.join(app.getPath("userData"), "crash-bundles");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(
        dir,
        `crash-bundle-${Date.now()}.json`,
      );
      const text = JSON.stringify(bundle, null, 2);
      fs.writeFileSync(file, text, "utf8");
      return { path: file, bytes: text.length, preview: text.slice(0, 2000) };
    },
  );

  ipcMain.handle("kreoda:save-dialog", async (_event, filename: string) => {
    const res = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: filename,
      filters: [
        { name: "Kreoda project", extensions: ["icad"] },
        { name: "STEP", extensions: ["step", "stp"] },
        { name: "3MF", extensions: ["3mf"] },
        { name: "STL", extensions: ["stl"] },
        { name: "OBJ", extensions: ["obj"] },
        { name: "glTF", extensions: ["gltf"] },
      ],
    });
    return res.filePath ?? null;
  });

  ipcMain.handle("kreoda:open-dialog", async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      filters: [
        { name: "Kreoda project", extensions: ["icad"] },
        { name: "STEP", extensions: ["step", "stp"] },
        { name: "3MF", extensions: ["3mf"] },
        { name: "STL", extensions: ["stl"] },
        { name: "OBJ", extensions: ["obj"] },
        { name: "glTF", extensions: ["gltf", "glb"] },
      ],
      properties: ["openFile"],
    });
    return res.filePaths[0] ?? null;
  });

  // Reference image import (§29 Stage A, Phase 9c): file → data URL.
  // Bounded (8 MiB); the renderer decodes dimensions itself. mime comes
  // from the picked extension, never sniffed.
  ipcMain.handle("kreoda:reference-import", async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "bmp"],
        },
      ],
      properties: ["openFile"],
    });
    const file = res.filePaths[0];
    if (!file) return null;
    const ext = path.extname(file).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".bmp"
          ? "image/bmp"
          : "image/jpeg";
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      return null;
    }
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024 || stat.size === 0) {
      return null;
    }
    const bytes = fs.readFileSync(file);
    return {
      name: path.basename(file),
      dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
    };
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    sessionRelay?.stop();
    sidecar?.stop();
    app.quit();
  }
});

app.on("before-quit", () => {
  sessionRelay?.stop();
  sidecar?.stop();
});
