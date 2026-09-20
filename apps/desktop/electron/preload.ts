// Preload — strict narrow typed API only (§48). No fs/child_process/shell.
import { contextBridge, ipcRenderer } from "electron";

export interface KreodaApi {
  invoke: (framedBase64: string) => Promise<string>;
  coreInfo: () => Promise<{ running: boolean; pid?: number }>;
  saveDialog: (filename: string) => Promise<string | null>;
  openDialog: () => Promise<string | null>;
  recoveryPath: () => Promise<string>;
  recoveryExists: () => Promise<boolean>;
  recoveryClear: () => Promise<void>;
  crashBundle: (snapshotJson: string, includeModel?: boolean) => Promise<{
    path: string;
    bytes: number;
    preview: string;
  }>;
  pluginsList: () => Promise<{ filename: string; source: string }[]>;
  importReferenceImage: () => Promise<{
    name: string;
    dataUrl: string;
  } | null>;
  checkForUpdates: () => Promise<
    { available: false; reason?: string } | { available: true; version: string }
  >;
  onUpdateAvailable: (cb: (info: { version: string }) => void) => () => void;
  onCoreCrashed: (cb: (info: { code: number | null }) => void) => () => void;
  onCoreRestarted: (cb: () => void) => () => void;
  // Phase 11b: authoritative model deltas from other session clients
  // (Quest/agent/second desktop). The renderer applies them when their
  // revision is newer than the local projection (§11.6).
  onSessionDelta: (
    cb: (delta: {
      originClientId: string;
      documentId: string;
      revision: number;
      features: {
        featureId: string;
        type: string;
        paramsMm: number[];
        volumeMm3: number;
        dependsOn: string[];
        refExtra: string;
        expressions: Record<string, string>;
      }[];
      sketches: {
        featureId: string;
        planeKind: string;
        points: number;
        lines: number;
        circles: number;
        constraints: number;
      }[];
    }) => void,
  ) => () => void;
  // Phase 11b: the renderer tells the session relay about mutations it
  // committed itself (toolbar/palette/AI paths bypass the relay socket), so
  // remote clients get the same delta broadcast. No-op when disabled.
  sessionNote: (
    documentId: string,
    revision: number,
    features?: unknown[],
    sketches?: unknown[],
  ) => Promise<void>;
}

const api: KreodaApi = {
  invoke: (framedBase64: string) =>
    ipcRenderer.invoke("kreoda:invoke", framedBase64) as Promise<string>,
  coreInfo: () =>
    ipcRenderer.invoke("kreoda:core-info") as Promise<{
      running: boolean;
      pid?: number;
    }>,
  saveDialog: (filename: string) =>
    ipcRenderer.invoke("kreoda:save-dialog", filename) as Promise<
      string | null
    >,
  openDialog: () =>
    ipcRenderer.invoke("kreoda:open-dialog") as Promise<string | null>,
  recoveryPath: () =>
    ipcRenderer.invoke("kreoda:recovery-path") as Promise<string>,
  recoveryExists: () =>
    ipcRenderer.invoke("kreoda:recovery-exists") as Promise<boolean>,
  recoveryClear: () =>
    ipcRenderer.invoke("kreoda:recovery-clear") as Promise<void>,
  crashBundle: (snapshotJson, includeModel) =>
    ipcRenderer.invoke(
      "kreoda:crash-bundle",
      snapshotJson,
      includeModel ?? false,
    ) as Promise<{
      path: string;
      bytes: number;
      preview: string;
    }>,
  pluginsList: () =>
    ipcRenderer.invoke("kreoda:plugins-list") as Promise<
      { filename: string; source: string }[]
    >,
  importReferenceImage: () =>
    ipcRenderer.invoke("kreoda:reference-import") as Promise<{
      name: string;
      dataUrl: string;
    } | null>,
  checkForUpdates: () =>
    ipcRenderer.invoke("kreoda:check-updates") as Promise<
      | { available: false; reason?: string }
      | { available: true; version: string }
    >,
  onUpdateAvailable: (cb) => {
    const listener = (
      _event: unknown,
      info: { version: string },
    ): void => cb(info);
    ipcRenderer.on(
      "kreoda:update-available",
      listener as (...args: unknown[]) => void,
    );
    return () =>
      ipcRenderer.removeListener(
        "kreoda:update-available",
        listener as (...args: unknown[]) => void,
      );
  },
  onCoreCrashed: (cb) => {
    const listener = (
      _event: unknown,
      info: { code: number | null },
    ): void => cb(info);
    ipcRenderer.on(
      "kreoda:core-crashed",
      listener as (...args: unknown[]) => void,
    );
    return () =>
      ipcRenderer.removeListener(
        "kreoda:core-crashed",
        listener as (...args: unknown[]) => void,
      );
  },
  onCoreRestarted: (cb) => {
    const listener = (): void => cb();
    ipcRenderer.on(
      "kreoda:core-restarted",
      listener as (...args: unknown[]) => void,
    );
    return () =>
      ipcRenderer.removeListener(
        "kreoda:core-restarted",
        listener as (...args: unknown[]) => void,
      );
  },
  onSessionDelta: (cb) => {
    const listener = (_event: unknown, delta: Parameters<typeof cb>[0]): void =>
      cb(delta);
    ipcRenderer.on(
      "kreoda:session-delta",
      listener as (...args: unknown[]) => void,
    );
    return () =>
      ipcRenderer.removeListener(
        "kreoda:session-delta",
        listener as (...args: unknown[]) => void,
      );
  },
  sessionNote: (documentId, revision, features, sketches) =>
    ipcRenderer.invoke(
      "kreoda:session-note",
      documentId,
      revision,
      features ?? [],
      sketches ?? [],
    ) as Promise<void>,
};

contextBridge.exposeInMainWorld("kreoda", api);

declare global {
  interface Window {
    kreoda: KreodaApi;
  }
}
