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
  checkForUpdates: () => Promise<
    { available: false; reason?: string } | { available: true; version: string }
  >;
  onUpdateAvailable: (cb: (info: { version: string }) => void) => () => void;
  onCoreCrashed: (cb: (info: { code: number | null }) => void) => () => void;
  onCoreRestarted: (cb: () => void) => () => void;
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
};

contextBridge.exposeInMainWorld("kreoda", api);

declare global {
  interface Window {
    kreoda: KreodaApi;
  }
}
