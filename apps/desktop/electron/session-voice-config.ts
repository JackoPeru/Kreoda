import { constants as fsConstants } from "node:fs";
import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn as spawnProcess, type SpawnOptions } from "node:child_process";
import { win32 as path } from "node:path";
import type { SessionVoiceOptions } from "./session-voice";

const CONFIG_NAME = "kreoda-voice-service.json";
const BRIDGE_ENDPOINT = "http://127.0.0.1:9843";
const MAX_JSON_BYTES = 16 * 1024;
const START_TIMEOUT_MS = 360_000;
const POLL_MS = 500;
const BACKOFF_MS = [2_000, 10_000, 30_000, 60_000] as const;
const REQUIRED_ROLES = [
  "bridge", "hermes", "stt", "tts", "hermes-forward", "stt-forward", "tts-forward", "mcp-reverse",
] as const;
const FAILURE_CODES = new Set([
  "ensure_busy", "bridge_unknown_owner", "local_unknown_owner", "remote_unknown_owner", "remote_unavailable",
  "startup_preflight_failed", "startup_failed", "readiness_failed", "unsafe_configuration",
  "internal_failure",
]);

export interface PrivateVoiceFileInfo {
  regular: boolean;
  symbolicLink: boolean;
  size: number;
}

export interface PrivateVoiceFileBoundary {
  inspect(file: string): Promise<PrivateVoiceFileInfo>;
  readBounded(file: string, maxBytes: number): Promise<Uint8Array>;
}

export interface PrivateVoiceStartup {
  readonly voiceOptions: SessionVoiceOptions;
  readonly ready: boolean;
  start(): Promise<void>;
  stop(): void;
}

export type PrivateVoicePreparation =
  | { state: "absent" | "invalid"; startup?: undefined }
  | { state: "configured"; startup: PrivateVoiceStartup };

export interface PrivateVoiceDependencies {
  files?: PrivateVoiceFileBoundary;
  spawn?: (command: string, args: readonly string[], options: SpawnOptions) =>
    Pick<ReturnType<typeof spawnProcess>, "unref"> & {
      once?(event: "error", listener: (error: Error) => void): unknown;
    };
  fetch?: typeof globalThis.fetch;
  powershellExecutable?: string;
  randomUUID?: typeof randomUUID;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  now?: () => number;
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

interface VoiceConfig {
  pcId: string;
  voiceTokenFile: string;
  startScript: string;
  bridgeExecutable: string;
}

function defaultFiles(): PrivateVoiceFileBoundary {
  return {
    async inspect(file) {
      const stat = await fs.lstat(file);
      return { regular: stat.isFile(), symbolicLink: stat.isSymbolicLink(), size: stat.size };
    },
    async readBounded(file, maxBytes) {
      const before = await fs.lstat(file);
      if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw new Error("invalid file");
      const noFollow = process.platform === "win32" ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
      const handle = await fs.open(file, fsConstants.O_RDONLY | noFollow);
      try {
        const opened = await handle.stat();
        const after = await fs.lstat(file);
        if (!opened.isFile() || after.isSymbolicLink() || opened.dev !== after.dev || opened.ino !== after.ino ||
            opened.size > maxBytes || after.size > maxBytes) throw new Error("invalid file");
        const buffer = Buffer.alloc(maxBytes + 1);
        let total = 0;
        while (total < buffer.length) {
          const result = await handle.read(buffer, total, buffer.length - total, null);
          if (result.bytesRead === 0) break;
          total += result.bytesRead;
        }
        if (total > maxBytes) throw new Error("oversized file");
        return buffer.subarray(0, total);
      } finally {
        await handle.close();
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function localAbsolutePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 2 && value.length <= 2048 &&
    !/[\x00-\x1f\x7f]/.test(value) && /^[a-z]:[\\/]/i.test(value) &&
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !value.startsWith("\\\\") && !value.startsWith("//") &&
    path.isAbsolute(path.normalize(value));
}

function isValidPcId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: unknown }).code === "ENOENT";
}

async function readJson(file: string, files: PrivateVoiceFileBoundary): Promise<unknown> {
  const info = await files.inspect(file);
  if (!info.regular || info.symbolicLink || !Number.isSafeInteger(info.size) || info.size < 0 ||
      info.size > MAX_JSON_BYTES) throw new Error("invalid file");
  const bytes = await files.readBounded(file, MAX_JSON_BYTES);
  if (bytes.byteLength > MAX_JSON_BYTES) throw new Error("oversized file");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function parseVoiceConfig(value: unknown): VoiceConfig | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "pcId", "voiceTokenFile", "startScript", "bridgeExecutable",
  ]) || value["version"] !== 1 || !isValidPcId(value["pcId"]) ||
      !localAbsolutePath(value["voiceTokenFile"]) || !localAbsolutePath(value["startScript"]) ||
      !localAbsolutePath(value["bridgeExecutable"])) return null;
  if (path.extname(value["startScript"]).toLowerCase() !== ".ps1" ||
      path.basename(value["startScript"]).toLowerCase() !== "ensure-kreodavoiceservices.ps1" ||
      path.extname(value["bridgeExecutable"]).toLowerCase() !== ".exe" ||
      path.basename(value["bridgeExecutable"]).toLowerCase() !== "kreoda.hermesbridge.exe") return null;
  return {
    pcId: value["pcId"],
    voiceTokenFile: path.normalize(value["voiceTokenFile"]),
    startScript: path.normalize(value["startScript"]),
    bridgeExecutable: path.normalize(value["bridgeExecutable"]),
  };
}

function parseToken(value: unknown): string | null {
  if (!isRecord(value) || !hasExactKeys(value, ["endpoint", "token"]) ||
      value["endpoint"] !== BRIDGE_ENDPOINT || typeof value["token"] !== "string" ||
      value["token"].length < 16 || value["token"].length > 4096 || !/^[\x21-\x7e]+$/.test(value["token"])) return null;
  return value["token"];
}

function powerShellPath(dependencies: PrivateVoiceDependencies): string | null {
  if (dependencies.powershellExecutable) return dependencies.powershellExecutable;
  const systemRoot = process.env["SystemRoot"];
  if (!systemRoot || !localAbsolutePath(systemRoot + "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")) return null;
  return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function validReadyReport(value: unknown, attemptId: string): "ready" | "failed" | null {
  const allowed = ["version", "attemptId", "status", "observedAt", "services", "failureCode"];
  if (!isRecord(value) || allowed.some(key => !Object.prototype.hasOwnProperty.call(value, key)) ||
      Object.keys(value).some(key => !allowed.includes(key)) ||
      value["version"] !== 1 || value["attemptId"] !== attemptId ||
      typeof value["observedAt"] !== "string" || !Number.isFinite(Date.parse(value["observedAt"])) ||
      !Array.isArray(value["services"])) return null;
  if (value["status"] === "failed" && typeof value["failureCode"] === "string" &&
      FAILURE_CODES.has(value["failureCode"])) return "failed";
  if (value["status"] !== "ready" || value["failureCode"] !== null) return null;
  const roles = new Set<string>();
  for (const service of value["services"]) {
    if (!isRecord(service) || !hasExactKeys(service, ["role", "pid", "state"]) ||
        typeof service["role"] !== "string" || !Number.isSafeInteger(service["pid"]) ||
        (service["pid"] as number) < 1 || service["state"] !== "ready") return null;
    roles.add(service["role"]);
  }
  return REQUIRED_ROLES.every(role => roles.has(role)) && roles.size === REQUIRED_ROLES.length ? "ready" : null;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("stopped"));
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = (): void => {
      globalThis.clearTimeout(timer);
      reject(new Error("stopped"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function createStartup(
  config: VoiceConfig,
  token: string,
  dependencies: PrivateVoiceDependencies,
  files: PrivateVoiceFileBoundary,
): PrivateVoiceStartup | null {
  const powershell = powerShellPath(dependencies);
  if (!powershell) return null;
  const spawn = dependencies.spawn ?? spawnProcess;
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const makeId = dependencies.randomUUID ?? randomUUID;
  const setTimer = dependencies.setTimeout ?? globalThis.setTimeout;
  const clearTimer = dependencies.clearTimeout ?? globalThis.clearTimeout;
  const now = dependencies.now ?? Date.now;
  const wait = dependencies.delay ?? delay;
  const reports = path.join(path.dirname(config.startScript), "runtime", "reports");
  let ready = false;
  let stopped = false;
  let active = false;
  let backoffIndex = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activeController: AbortController | undefined;
  let activePromise: Promise<void> | undefined;

  const gatedFetch: typeof globalThis.fetch = async (input, init) => {
    if (!ready || stopped) {
      return new Response(JSON.stringify({ error: "Voice setup is not ready", stage: "startup" }), {
        status: 503, headers: { "content-type": "application/json" },
      });
    }
    try {
      return await fetchImpl(input, init);
    } catch (error) {
      if (!stopped && !init?.signal?.aborted) {
        ready = false;
        scheduleRetry();
      }
      throw error;
    }
  };

  async function waitForReport(reportPath: string, attemptId: string, signal: AbortSignal): Promise<"ready" | "failed"> {
    const deadline = now() + START_TIMEOUT_MS;
    while (!signal.aborted && now() <= deadline) {
      try {
        const result = validReadyReport(await readJson(reportPath, files), attemptId);
        if (!result) throw new Error("invalid report");
        return result;
      } catch (error) {
        if (!isNotFound(error)) throw new Error("startup report unavailable");
      }
      if (now() >= deadline) break;
      await wait(POLL_MS, signal);
    }
    throw new Error("startup timed out");
  }

  function scheduleRetry(): void {
    if (stopped || ready || timer) return;
    const milliseconds = BACKOFF_MS[Math.min(backoffIndex, BACKOFF_MS.length - 1)];
    backoffIndex++;
    timer = setTimer(() => {
      timer = undefined;
      void start();
    }, milliseconds);
  }

  async function runAttempt(): Promise<void> {
    if (stopped || ready || active) return;
    active = true;
    const attemptId = makeId();
    if (!/^[a-f0-9-]{36}$/i.test(attemptId)) {
      active = false;
      scheduleRetry();
      return;
    }
    const reportPath = path.join(reports, "desktop-voice-" + attemptId + ".json");
    const controller = new AbortController();
    activeController = controller;
    let retry = false;
    try {
      // Windows PowerShell must resolve its own modules, not an inherited PowerShell 7 path.
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "psmodulepath"));
      const child = spawn(powershell!, [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-File", config.startScript,
        "-BridgeExecutable", config.bridgeExecutable, "-AttemptId", attemptId, "-ResultPath", reportPath,
      ], { detached: false, windowsHide: true, shell: false, stdio: "ignore", env });
      child.once?.("error", () => controller.abort());
      child.unref();
      const outcome = await waitForReport(reportPath, attemptId, controller.signal);
      if (controller.signal.aborted) throw new Error("startup stopped");
      if (outcome === "ready") {
        ready = true;
        backoffIndex = 0;
      } else {
        retry = true;
      }
    } catch {
      retry = true;
    } finally {
      activeController = undefined;
      active = false;
      if (retry && !stopped && !ready) scheduleRetry();
    }
  }

  const start = (): Promise<void> => {
    if (stopped || ready || timer) return Promise.resolve();
    if (activePromise) return activePromise;
    activePromise = runAttempt().finally(() => { activePromise = undefined; });
    return activePromise;
  };

  return {
    voiceOptions: { token, fetch: gatedFetch },
    get ready() { return ready && !stopped; },
    start,
    stop() {
      stopped = true;
      ready = false;
      if (timer) clearTimer(timer);
      timer = undefined;
      activeController?.abort();
    },
  };
}

export async function preparePrivateVoiceStartup(
  userDataPath: string,
  pcId: string | undefined,
  options: { backgroundTest?: boolean; dependencies?: PrivateVoiceDependencies } = {},
): Promise<PrivateVoicePreparation> {
  if (options.backgroundTest || !isValidPcId(pcId) || !localAbsolutePath(userDataPath))
    return { state: "absent" };
  const files = options.dependencies?.files ?? defaultFiles();
  const configPath = path.join(userDataPath, CONFIG_NAME);
  let rawConfig: unknown;
  try {
    rawConfig = await readJson(configPath, files);
  } catch (error) {
    return isNotFound(error) ? { state: "absent" } : { state: "invalid" };
  }
  const config = parseVoiceConfig(rawConfig);
  if (!config || config.pcId !== pcId) return { state: "invalid" };
  try {
    for (const file of [config.voiceTokenFile, config.startScript, config.bridgeExecutable]) {
      const info = await files.inspect(file);
      if (!info.regular || info.symbolicLink || info.size < 0) return { state: "invalid" };
    }
    const token = parseToken(await readJson(config.voiceTokenFile, files));
    if (!token) return { state: "invalid" };
    const startup = createStartup(config, token, options.dependencies ?? {}, files);
    return startup ? { state: "configured", startup } : { state: "invalid" };
  } catch {
    return { state: "invalid" };
  }
}
