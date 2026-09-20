// Preload — strict narrow typed API only (§48). No fs/child_process/shell.
import { contextBridge, ipcRenderer } from "electron";

export interface IntentCadApi {
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

const api: IntentCadApi = {
  invoke: (framedBase64: string) =>
    ipcRenderer.invoke("intentcad:invoke", framedBase64) as Promise<string>,
  coreInfo: () =>
    ipcRenderer.invoke("intentcad:core-info") as Promise<{
      running: boolean;
      pid?: number;
    }>,
  saveDialog: (filename: string) =>
    ipcRenderer.invoke("intentcad:save-dialog", filename) as Promise<
      string | null
    >,
  openDialog: () =>
    ipcRenderer.invoke("intentcad:open-dialog") as Promise<string | null>,
  recoveryPath: () =>
    ipcRenderer.invoke("intentcad:recovery-path") as Promise<string>,
  recoveryExists: () =>
    ipcRenderer.invoke("intentcad:recovery-exists") as Promise<boolean>,
  recoveryClear: () =>
    ipcRenderer.invoke("intentcad:recovery-clear") as Promise<void>,
  crashBundle: (snapshotJson, includeModel) =>
    ipcRenderer.invoke(
      "intentcad:crash-bundle",
      snapshotJson,
      includeModel ?? false,
    ) as Promise<{
      path: string;
      bytes: number;
      preview: string;
    }>,
  checkForUpdates: () =>
    ipcRenderer.invoke("intentcad:check-updates") as Promise<
      | { available: false; reason?: string }
      | { available: true; version: string }
    >,
  onUpdateAvailable: (cb) => {
    const listener = (
      _event: unknown,
      info: { version: string },
    ): void => cb(info);
    ipcRenderer.on(
      "intentcad:update-available",
      listener as (...args: unknown[]) => void,
    );
    return () =>
      ipcRenderer.removeListener(
        "intentcad:update-available",
        listener as (...args: unknown[]) => void,
      );
  },
  onCoreCrashed: (cb) => {
    const listener = (
      _event: unknown,
      info: { code: number | null },
    ): void => cb(info);
    ipcRenderer.on(
      "intentcad:core-crashed",
      listener as (...args: unknown[]) => void,
    );
    return () =>
      ipcRenderer.removeListener(
        "intentcad:core-crashed",
        listener as (...args: unknown[]) => void,
      );
  },
  onCoreRestarted: (cb) => {
    const listener = (): void => cb();
    ipcRenderer.on(
      "intentcad:core-restarted",
      listener as (...args: unknown[]) => void,
    );
    return () =>
      ipcRenderer.removeListener(
        "intentcad:core-restarted",
        listener as (...args: unknown[]) => void,
      );
  },
};

contextBridge.exposeInMainWorld("intentcad", api);

declare global {
  interface Window {
    intentcad: IntentCadApi;
  }
}
