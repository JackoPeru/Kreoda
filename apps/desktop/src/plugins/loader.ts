// Sandboxed plugin runtime (§47, Phase 9b): third-party JS runs in a Web
// Worker whose ONLY global is the `kreoda` bridge below — no DOM, no fetch,
// no fs, no core access except allowlisted typed commands validated and
// executed on this side through the central executeCommand path (gates
// intact). Manifests are validated with @kreoda/plugin-sdk; unknown
// capabilities are refused (V1 grants none).

import { COMMANDS } from "@kreoda/command-schema";
import { validateManifest, type PluginManifest } from "@kreoda/plugin-sdk";
import { create } from "zustand";
import { executeCommand } from "../commands/execute";

/** Largest plugin source accepted (DoS bound, like mesh caps). */
export const MAX_PLUGIN_BYTES = 256 * 1024;
/** Register handshake timeout: a silent plugin is a broken plugin. */
const REGISTER_TIMEOUT_MS = 5000;
/** One plugin command run may take a while (geometry commits). */
const RUN_TIMEOUT_MS = 60000;

// Plain-JS shim prepended to every plugin source: the ENTIRE plugin API.
// No imports, no DOM, no eval — just postMessage plumbing.
// C6: hostile globals are neutralised BEFORE plugin source runs (CSP stays
// as second layer; persistence APIs are denied in V1).
const SHIM_SOURCE = `
try { fetch = undefined; } catch (_) {}
try { importScripts = undefined; } catch (_) {}
try { XMLHttpRequest = undefined; } catch (_) {}
try { WebSocket = undefined; } catch (_) {}
try { indexedDB = undefined; } catch (_) {}
try { caches = undefined; } catch (_) {}
try { BroadcastChannel = undefined; } catch (_) {}
const __pending = new Map();
let __seq = 0;
const __handlers = new Map();
let __currentCommand = null;
const kreoda = {
  register(manifest) {
    postMessage({ type: "register", manifest });
  },
  onCommand(id, fn) {
    if (typeof id !== "string" || typeof fn !== "function") {
      throw new Error("onCommand(id, fn) needs a string id and a function");
    }
    __handlers.set(id, fn);
  },
  invoke(cmd, params) {
    const callId = "pc-" + (++__seq);
    return new Promise((resolve, reject) => {
      __pending.set(callId, { resolve, reject });
      postMessage({ type: "invoke", callId, cmd, params: params ?? {}, sourceCommand: __currentCommand });
    });
  },
  log(text) {
    postMessage({ type: "log", text: String(text) });
  },
};
onmessage = async (e) => {
  const m = e.data;
  if (!m || typeof m !== "object") return;
  if (m.type === "result") {
    const p = __pending.get(m.callId);
    if (!p) return;
    __pending.delete(m.callId);
    if (m.ok) p.resolve(m.value);
    else p.reject(new Error(typeof m.error === "string" ? m.error : "plugin call failed"));
  } else if (m.type === "run") {
    const fn = __handlers.get(m.commandId);
    if (!fn) {
      postMessage({ type: "run-result", runId: m.runId, ok: false, error: "unknown plugin command" });
      return;
    }
    __currentCommand = m.commandId;
    try {
      const value = await fn(m.params ?? {});
      postMessage({ type: "run-result", runId: m.runId, ok: true, value: value ?? null });
    } catch (err) {
      postMessage({ type: "run-result", runId: m.runId, ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      __currentCommand = null;
    }
  }
};
`;

export interface LoadedPlugin {
  manifest: PluginManifest;
  filename: string;
}

interface WorkerEntry {
  worker: Worker;
  manifest: PluginManifest;
  runs: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  runSeq: number;
}

const workers = new Map<string, WorkerEntry>();
const filenames = new Map<string, string>();

interface PluginUiState {
  plugins: LoadedPlugin[];
}

export const usePluginStore = create<PluginUiState>(() => ({ plugins: [] }));

function refreshStore(): void {
  usePluginStore.setState({
    plugins: [...workers.values()].map((w) => ({
      manifest: w.manifest,
      filename: filenames.get(w.manifest.id) ?? "",
    })),
  });
}

/** Load + handshake one plugin source. Throws honestly on any deviation. */
export async function loadPlugin(
  source: string,
  filename = "<hook>",
): Promise<PluginManifest> {
  if (typeof source !== "string" || source.length === 0) {
    throw new Error("empty plugin source");
  }
  if (source.length > MAX_PLUGIN_BYTES) {
    throw new Error(
      `plugin too large (${source.length} > ${MAX_PLUGIN_BYTES} bytes)`,
    );
  }
  const blob = new Blob([`${SHIM_SOURCE}\n;\n${source}`], {
    type: "text/javascript",
  });
  const url = URL.createObjectURL(blob);
  let worker: Worker;
  try {
    worker = new Worker(url);
  } catch (e) {
    URL.revokeObjectURL(url);
    throw new Error(
      `cannot spawn plugin worker: ${e instanceof Error ? e.message : e}`,
    );
  }
  const manifest = await new Promise<PluginManifest>((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(url);
      reject(new Error("plugin did not register in time"));
    }, REGISTER_TIMEOUT_MS);
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type?: unknown; manifest?: unknown };
      if (m?.type !== "register") return;
      clearTimeout(timer);
      try {
        resolve(validateManifest(m.manifest));
      } catch (err) {
        worker.terminate();
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    worker.onerror = (ev) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      reject(new Error(`plugin crashed on load: ${ev.message}`));
    };
  });
  if (workers.has(manifest.id)) {
    worker.terminate();
    URL.revokeObjectURL(url);
    throw new Error(`plugin already loaded: ${manifest.id}`);
  }
  for (const c of manifest.commands) {
    for (const coreId of c.allowedCoreCommands) {
      if (!COMMANDS.some((d) => d.id === coreId)) {
        worker.terminate();
        URL.revokeObjectURL(url);
        throw new Error(`unknown core command in allowlist: ${coreId}`);
      }
    }
  }
  const entry: WorkerEntry = { worker, manifest, runs: new Map(), runSeq: 0 };
  worker.onmessage = (e: MessageEvent) => onWorkerMessage(manifest.id, e);
  worker.onerror = (ev) => {
    // A throwing plugin must never take the app down: fail its in-flight
    // runs loudly, drop it, keep everything else running.
    console.error(`[plugin ${manifest.id}] worker error: ${ev.message}`);
    for (const [runId, p] of entry.runs) {
      clearTimeout(p.timer);
      p.reject(new Error(`plugin crashed: ${ev.message}`));
      entry.runs.delete(runId);
    }
    unloadPlugin(manifest.id);
  };
  workers.set(manifest.id, entry);
  filenames.set(manifest.id, filename);
  refreshStore();
  return manifest;
}

function onWorkerMessage(pluginId: string, e: MessageEvent): void {
  const entry = workers.get(pluginId);
  if (!entry) return;
  const m = e.data as {
    type?: unknown;
    callId?: unknown;
    cmd?: unknown;
    params?: unknown;
    runId?: unknown;
    ok?: unknown;
    value?: unknown;
    error?: unknown;
    text?: unknown;
    sourceCommand?: unknown;
  };
  if (!m || typeof m !== "object") return;
  if (m.type === "log") {
    console.debug(`[plugin ${pluginId}]`, String(m.text ?? ""));
    return;
  }
  if (m.type === "result" || m.type === "run-result") {
    // Invoke replies (callId) and run replies (runId) share the pending map
    // with disjoint key spaces ("pc-N" vs "run-N").
    const key = (m.type === "result" ? m.callId : m.runId) as unknown;
    const p = typeof key === "string" ? entry.runs.get(key) : undefined;
    if (!p) return;
    entry.runs.delete(key as string);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.value ?? null);
    else p.reject(new Error(typeof m.error === "string" ? m.error : "failed"));
    return;
  }
  if (m.type === "invoke") {
    void runCoreCall(entry, m);
    return;
  }
}

/** Worker → core bridge: allowlist + registry + availability, all enforced. */
async function runCoreCall(
  entry: WorkerEntry,
  m: { callId?: unknown; cmd?: unknown; params?: unknown; sourceCommand?: unknown },
): Promise<void> {
  const reply = (ok: boolean, value?: unknown, error?: string): void => {
    entry.worker.postMessage({ type: "result", callId: m.callId, ok, value, error });
  };
  if (typeof m.callId !== "string" || typeof m.cmd !== "string") {
    reply(false, undefined, "malformed invoke");
    return;
  }
  // Minor: allowlist is per-plugin-COMMAND, not per-plugin. A handler for a
  // CreateBox-only command must not reach CreateCylinder via a sibling's
  // allowlist — bind runId→commandId through sourceCommand from the shim.
  let def;
  if (typeof m.sourceCommand === "string" && m.sourceCommand.length > 0) {
    def = entry.manifest.commands.find((c) => c.id === m.sourceCommand);
    if (!def) {
      reply(false, undefined, `unknown plugin command: ${m.sourceCommand}`);
      return;
    }
    if (!def.allowedCoreCommands.includes(m.cmd as string)) {
      reply(false, undefined, `core command not allowed for ${def.id}: ${m.cmd}`);
      return;
    }
  } else {
    def = entry.manifest.commands.find((c) =>
      c.allowedCoreCommands.includes(m.cmd as string),
    );
  }
  if (!def || !COMMANDS.some((d) => d.id === m.cmd)) {
    reply(false, undefined, `core command not allowed for this plugin: ${m.cmd}`);
    return;
  }
  if (!m.params || typeof m.params !== "object") {
    reply(false, undefined, "params must be an object");
    return;
  }
  try {
    const result = await executeCommand(m.cmd, m.params);
    reply(true, JSON.parse(JSON.stringify(result ?? null)));
  } catch (e) {
    reply(false, undefined, e instanceof Error ? e.message : String(e));
  }
}

/** Run a plugin command (its code runs in the worker, core calls bridged). */
export async function runPluginCommand(
  pluginId: string,
  commandId: string,
  params: unknown = {},
): Promise<unknown> {
  const entry = workers.get(pluginId);
  if (!entry) throw new Error(`plugin not loaded: ${pluginId}`);
  if (!entry.manifest.commands.some((c) => c.id === commandId)) {
    throw new Error(`unknown plugin command: ${commandId}`);
  }
  if (!params || typeof params !== "object") {
    throw new Error("params must be an object");
  }
  const runId = `run-${++entry.runSeq}`;
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      // C4: a hung worker (while(true){}) never posts run-result — the host
      // promise alone rejecting would leave 100% CPU spinning forever and
      // the worker wedged for later runs. Terminate + unload + fail ALL
      // in-flight runs loudly.
      try {
        entry.worker.terminate();
      } catch {
        // Terminate is best-effort; unload below drops every handle anyway.
      }
      for (const [id, p] of entry.runs) {
        clearTimeout(p.timer);
        if (id === runId) {
          p.reject(new Error("plugin command timed out — worker terminated"));
        } else {
          p.reject(new Error("plugin unloaded (sibling run timed out)"));
        }
        entry.runs.delete(id);
      }
      workers.delete(pluginId);
      filenames.delete(pluginId);
      refreshStore();
    }, RUN_TIMEOUT_MS);
    entry.runs.set(runId, { resolve, reject, timer });
    entry.worker.postMessage({ type: "run", runId, commandId, params });
  });
}

/** Unload a plugin: terminate the worker, drop every handle. */
export function unloadPlugin(pluginId: string): void {
  const entry = workers.get(pluginId);
  if (!entry) return;
  for (const [, p] of entry.runs) {
    clearTimeout(p.timer);
    p.reject(new Error("plugin unloaded"));
  }
  entry.runs.clear();
  entry.worker.terminate();
  workers.delete(pluginId);
  filenames.delete(pluginId);
  refreshStore();
}

/** Test/diagnostics peek (metadata only — workers stay private). */
export function listPlugins(): LoadedPlugin[] {
  return usePluginStore.getState().plugins;
}

/** Boot auto-load from the host plugins dir (fire-and-forget per file). */
export async function loadPluginsFromHost(): Promise<string[]> {
  const errors: string[] = [];
  if (typeof window.kreoda?.pluginsList !== "function") return errors;
  let files: { filename: string; source: string }[];
  try {
    files = await window.kreoda.pluginsList();
  } catch (e) {
    console.warn("[plugins] host list failed", e);
    return [`host: ${e instanceof Error ? e.message : e}`];
  }
  for (const f of files) {
    try {
      await loadPlugin(f.source, f.filename);
    } catch (e) {
      errors.push(`${f.filename}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (errors.length > 0) console.warn("[plugins] skipped:", errors);
  return errors;
}
