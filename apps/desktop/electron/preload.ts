// Preload — strict narrow typed API only (§48). No fs/child_process/shell.
import { contextBridge, ipcRenderer } from "electron";
import type { SessionModelSnapshot, SessionIncrementalDelta } from "@kreoda/protocol";
import type { SessionSnapshotRequired } from "./session";
import type { SessionConnectionStatus } from "./session-control-ui";

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
  // Authoritative incremental events and explicit snapshot recovery.
  onSessionDelta: (cb: (delta: SessionIncrementalDelta | SessionSnapshotRequired) => void) => () => void;
  sessionSnapshot: () => Promise<SessionModelSnapshot>;
  sessionConnectionStatus: () => Promise<SessionConnectionStatus>;
  sessionEnable: (host: string, port: number) => Promise<SessionConnectionStatus>;
  sessionDisable: () => Promise<SessionConnectionStatus>;
  sessionPair: () => Promise<{ token: string; expiresAt: string }>;
  sessionCancelPair: () => Promise<void>;
  sessionRevoke: (deviceId: string) => Promise<SessionConnectionStatus>;
  // Phase 11b: the renderer tells the session relay about mutations it
  // committed itself (toolbar/palette/AI paths bypass the relay socket), so
  // remote clients get the same delta broadcast.
  sessionNote: (
    documentId: string,
    revision: number,
    features?: unknown[],
    sketches?: unknown[],
  ) => Promise<void>;
}

const api: KreodaApi = {
  sessionConnectionStatus: () => ipcRenderer.invoke("kreoda:session-status") as Promise<SessionConnectionStatus>,
  sessionEnable: (host, port) => ipcRenderer.invoke("kreoda:session-enable", host, port) as Promise<SessionConnectionStatus>,
  sessionDisable: () => ipcRenderer.invoke("kreoda:session-disable") as Promise<SessionConnectionStatus>,
  sessionPair: () => ipcRenderer.invoke("kreoda:session-pair") as Promise<{ token: string; expiresAt: string }>,
  sessionCancelPair: () => ipcRenderer.invoke("kreoda:session-cancel-pair") as Promise<void>,
  sessionRevoke: (deviceId) => ipcRenderer.invoke("kreoda:session-revoke", deviceId) as Promise<SessionConnectionStatus>,
  sessionSnapshot: () => ipcRenderer.invoke("kreoda:session-snapshot") as Promise<SessionModelSnapshot>,
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
      // Retained call shape; the service reads canonical native state.
      features,
      sketches,
    ) as Promise<void>,
};

contextBridge.exposeInMainWorld("kreoda", api);

declare global {
  interface Window {
    kreoda: KreodaApi;
  }
}
