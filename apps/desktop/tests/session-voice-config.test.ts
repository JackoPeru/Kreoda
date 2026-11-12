import { describe, expect, it, vi } from "vitest";
import type { SpawnOptions } from "node:child_process";
import { win32 as path } from "node:path";
import {
  preparePrivateVoiceStartup,
  type PrivateVoiceDependencies,
  type PrivateVoiceFileBoundary,
} from "../electron/session-voice-config";

const USER_DATA = "C:\\Users\\fixture\\AppData\\Roaming\\Kreoda";
const PC_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PC_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "private-fixture-token-123456";
const CONFIG_PATH = path.join(USER_DATA, "kreoda-voice-service.json");
const TOKEN_PATH = "C:\\Kreoda\\.private\\voice-token.json";
const HELPER_PATH = "C:\\Kreoda\\.artifacts\\Codex-tools\\kreoda-hermes-g1-20261027-1\\Ensure-KreodaVoiceServices.ps1";
const BRIDGE_PATH = "C:\\Kreoda\\.artifacts\\Codex-tools\\kreoda-hermes-g1-20261027-1\\bridge-resident-voice-20261028-1\\Kreoda.HermesBridge.exe";
const READY_ROLES = [
  "bridge", "hermes", "stt", "tts", "hermes-forward", "stt-forward", "tts-forward", "mcp-reverse",
];
type SpawnCall = {
  command: string;
  args: readonly string[];
  options: SpawnOptions;
  errorListenerRegistered: boolean;
  unrefCalled: boolean;
};

type FakeFile = { bytes: Uint8Array; regular?: boolean; symbolicLink?: boolean };

function jsonBytes(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1, pcId: PC_ID, voiceTokenFile: TOKEN_PATH,
    startScript: HELPER_PATH, bridgeExecutable: BRIDGE_PATH, ...overrides,
  };
}

function tokenFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { endpoint: "http://127.0.0.1:9843", token: TOKEN, ...overrides };
}

function makeFiles(values: Record<string, FakeFile> = {}): {
  files: PrivateVoiceFileBoundary;
  entries: Map<string, FakeFile>;
  inspected: string[];
  read: string[];
} {
  const entries = new Map<string, FakeFile>(Object.entries(values));
  const inspected: string[] = [];
  const read: string[] = [];
  const missing = (): never => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); };
  const files: PrivateVoiceFileBoundary = {
    async inspect(file) {
      inspected.push(file);
      const entry = entries.get(file);
      if (!entry) return missing();
      return {
        regular: entry.regular !== false,
        symbolicLink: entry.symbolicLink === true,
        size: entry.bytes.byteLength,
      };
    },
    async readBounded(file, maxBytes) {
      read.push(file);
      const entry = entries.get(file);
      if (!entry) return missing();
      return entry.bytes.byteLength > maxBytes ? entry.bytes : entry.bytes.slice();
    },
  };
  return { files, entries, inspected, read };
}

function validFiles(): ReturnType<typeof makeFiles> {
  return makeFiles({
    [CONFIG_PATH]: { bytes: jsonBytes(config()) },
    [TOKEN_PATH]: { bytes: jsonBytes(tokenFile()) },
    [HELPER_PATH]: { bytes: Buffer.from("fixture helper") },
    [BRIDGE_PATH]: { bytes: Buffer.from("fixture executable") },
  });
}

function readyReport(attemptId: string): unknown {
  return {
    version: 1, attemptId, status: "ready", observedAt: new Date().toISOString(), failureCode: null,
    services: READY_ROLES.map((role, index) => ({ role, pid: 2000 + index, state: "ready" })),
  };
}

function failedReport(attemptId: string): unknown {
  return {
    version: 1, attemptId, status: "failed", observedAt: new Date().toISOString(),
    failureCode: "remote_unavailable", services: [],
  };
}

function fakeDependencies(
  fixture: ReturnType<typeof makeFiles>,
  report: (attemptId: string) => unknown = readyReport,
  additions: Partial<PrivateVoiceDependencies> = {},
): PrivateVoiceDependencies & { spawnCalls: SpawnCall[] } {
  const spawnCalls: SpawnCall[] = [];
  let id = 0;
  const spawn: NonNullable<PrivateVoiceDependencies["spawn"]> = (command, args, options) => {
    const call: SpawnCall = { command, args, options, errorListenerRegistered: false, unrefCalled: false };
    spawnCalls.push(call);
    const attemptId = args[args.indexOf("-AttemptId") + 1];
    const reportPath = args[args.indexOf("-ResultPath") + 1];
    fixture.entries.set(reportPath, { bytes: jsonBytes(report(attemptId)) });
    return {
      once(event, listener) {
        call.errorListenerRegistered = event === "error" && typeof listener === "function";
      },
      unref() { call.unrefCalled = true; },
    };
  };
  return {
    files: fixture.files,
    spawn,
    fetch: vi.fn(async () => new Response("forwarded")),
    powershellExecutable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    randomUUID: () => {
      id++;
      return ("33333333-3333-4333-8333-" + String(id).padStart(12, "0")) as ReturnType<NonNullable<PrivateVoiceDependencies["randomUUID"]>>;
    },
    ...additions,
    spawnCalls,
  };
}

describe("private Desktop voice setup", () => {
  it("does no config, token, or process work in background test mode", async () => {
    const fixture = makeFiles();
    const deps = fakeDependencies(fixture);
    const result = await preparePrivateVoiceStartup(USER_DATA, PC_ID, {
      backgroundTest: true, dependencies: deps,
    });
    expect(result.state).toBe("absent");
    expect(fixture.inspected).toEqual([]);
    expect(fixture.read).toEqual([]);
    expect(deps.spawnCalls).toHaveLength(0);
  });

  it("treats missing config as unconfigured without reading token or starting helper", async () => {
    const fixture = makeFiles();
    const deps = fakeDependencies(fixture);
    const result = await preparePrivateVoiceStartup(USER_DATA, PC_ID, { dependencies: deps });
    expect(result.state).toBe("absent");
    expect(fixture.inspected).toEqual([CONFIG_PATH]);
    expect(fixture.read).toEqual([]);
    expect(deps.spawnCalls).toHaveLength(0);
  });

  it("rejects oversized profile before reading it", async () => {
    const fixture = makeFiles({
      [CONFIG_PATH]: { bytes: new Uint8Array(16 * 1024 + 1) },
    });
    const deps = fakeDependencies(fixture);
    const result = await preparePrivateVoiceStartup(USER_DATA, PC_ID, { dependencies: deps });
    expect(result.state).toBe("invalid");
    expect(fixture.read).toEqual([]);
    expect(deps.spawnCalls).toHaveLength(0);
  });

  it("rejects symlinked trust files and oversized token before launch", async () => {
    for (const file of [CONFIG_PATH, TOKEN_PATH, HELPER_PATH, BRIDGE_PATH]) {
      const fixture = validFiles();
      fixture.entries.get(file)!.symbolicLink = true;
      const deps = fakeDependencies(fixture);
      const result = await preparePrivateVoiceStartup(USER_DATA, PC_ID, { dependencies: deps });
      expect(result.state).toBe("invalid");
      expect(deps.spawnCalls).toHaveLength(0);
      expect(JSON.stringify(result)).not.toContain(TOKEN);
      expect(JSON.stringify(result)).not.toContain(TOKEN_PATH);
    }

    const fixture = validFiles();
    fixture.entries.set(TOKEN_PATH, { bytes: new Uint8Array(16 * 1024 + 1) });
    const deps = fakeDependencies(fixture);
    const result = await preparePrivateVoiceStartup(USER_DATA, PC_ID, { dependencies: deps });
    expect(result.state).toBe("invalid");
    expect(fixture.read).toEqual([CONFIG_PATH]);
    expect(deps.spawnCalls).toHaveLength(0);
  });

  it("checks PC identity before inspecting or reading token file", async () => {
    const fixture = makeFiles({
      [CONFIG_PATH]: { bytes: jsonBytes(config({ pcId: OTHER_PC_ID })) },
    });
    const deps = fakeDependencies(fixture);
    const result = await preparePrivateVoiceStartup(USER_DATA, PC_ID, { dependencies: deps });
    expect(result.state).toBe("invalid");
    expect(fixture.inspected).toEqual([CONFIG_PATH]);
    expect(fixture.read).toEqual([CONFIG_PATH]);
    expect(deps.spawnCalls).toHaveLength(0);
  });

  it("rejects unknown config fields and URL or UNC command paths", async () => {
    for (const badConfig of [
      config({ unexpected: true }),
      config({ startScript: "https://host/Ensure-KreodaVoiceServices.ps1" }),
      config({ startScript: "\\\\server\\share\\Ensure-KreodaVoiceServices.ps1" }),
    ]) {
      const fixture = makeFiles({
        [CONFIG_PATH]: { bytes: jsonBytes(badConfig) },
        [TOKEN_PATH]: { bytes: jsonBytes(tokenFile()) },
      });
      const deps = fakeDependencies(fixture);
      const result = await preparePrivateVoiceStartup(USER_DATA, PC_ID, { dependencies: deps });
      expect(result.state).toBe("invalid");
      expect(fixture.inspected).toEqual([CONFIG_PATH]);
      expect(deps.spawnCalls).toHaveLength(0);
      expect(JSON.stringify(result)).not.toContain(TOKEN);
      expect(JSON.stringify(result)).not.toContain(TOKEN_PATH);
    }
  });

  it("requires exact bridge endpoint and existing printable voice token limits", async () => {
    for (const badToken of [
      tokenFile({ endpoint: "http://127.0.0.1:9843/other" }),
      tokenFile({ endpoint: "http://user@127.0.0.1:9843" }),
      tokenFile({ token: "short" }),
      tokenFile({ token: "x".repeat(4097) }),
      tokenFile({ token: "token contains spaces" }),
    ]) {
      const fixture = makeFiles({
        [CONFIG_PATH]: { bytes: jsonBytes(config()) },
        [TOKEN_PATH]: { bytes: jsonBytes(badToken) },
        [HELPER_PATH]: { bytes: Buffer.from("fixture helper") },
        [BRIDGE_PATH]: { bytes: Buffer.from("fixture executable") },
      });
      const deps = fakeDependencies(fixture);
      const result = await preparePrivateVoiceStartup(USER_DATA, PC_ID, { dependencies: deps });
      expect(result.state).toBe("invalid");
      expect(deps.spawnCalls).toHaveLength(0);
      expect(JSON.stringify(result)).not.toContain(TOKEN);
      expect(JSON.stringify(result)).not.toContain(TOKEN_PATH);
    }
  });

  it("gates private fetch until hidden helper report and filters only child environment", async () => {
    const fixture = validFiles();
    const deps = fakeDependencies(fixture);
    const result = await preparePrivateVoiceStartup(USER_DATA, PC_ID, { dependencies: deps });
    expect(result.state).toBe("configured");
    if (result.state !== "configured") return;
    const { startup } = result;
    const modulePathKeys = ["PSModulePath", "psmodulepath", "pSmOdUlEpAtH"];
    const originalModulePaths = modulePathKeys.map(key => process.env[key]);
    const sentinelKey = "KREODA_PRIVATE_VOICE_ENV_FIXTURE";
    const originalSentinel = process.env[sentinelKey];
    const sentinelValue = "keep-child-environment";
    try {
      for (const key of modulePathKeys) process.env[key] = "inherited-module-path";
      process.env[sentinelKey] = sentinelValue;
      const parentBefore = {
        modulePaths: modulePathKeys.map(key => process.env[key]),
        temp: process.env["TEMP"],
        sentinel: process.env[sentinelKey],
      };
      const early = await startup.voiceOptions.fetch!("http://127.0.0.1:9843/voice/turn", {
        headers: { authorization: "Bearer " + TOKEN },
      });
      expect(early.status).toBe(503);
      expect(await early.text()).not.toContain(TOKEN);
      expect(deps.fetch).not.toHaveBeenCalled();

      await startup.start();
      expect(startup.ready).toBe(true);
      expect(deps.spawnCalls).toHaveLength(1);
      const [child] = deps.spawnCalls;
      const childEnv = child.options.env ?? {};
      expect({
        detached: child.options.detached,
        windowsHide: child.options.windowsHide,
        shell: child.options.shell,
        stdio: child.options.stdio,
        childModulePathKeys: Object.keys(childEnv).filter(key => key.toLowerCase() === "psmodulepath"),
        childTemp: childEnv["TEMP"],
        childSentinel: childEnv[sentinelKey],
      }).toEqual({
        detached: false,
        windowsHide: true,
        shell: false,
        stdio: "ignore",
        childModulePathKeys: [],
        childTemp: parentBefore.temp,
        childSentinel: sentinelValue,
      });
      expect({
        modulePaths: modulePathKeys.map(key => process.env[key]),
        temp: process.env["TEMP"],
        sentinel: process.env[sentinelKey],
      }).toEqual(parentBefore);
      expect(child.errorListenerRegistered).toBe(true);
      expect(child.unrefCalled).toBe(true);
      expect(child.args).toContain("-NoProfile");
      expect(child.args).toContain("-NonInteractive");
      expect(JSON.stringify(child.args)).not.toContain(TOKEN);
      expect(JSON.stringify(child.args)).not.toContain("-ExecutionPolicy");

      const forwarded = await startup.voiceOptions.fetch!("http://127.0.0.1:9843/voice/turn");
      expect(forwarded.status).toBe(200);
      expect(deps.fetch).toHaveBeenCalledTimes(1);
      expect(startup.ready).toBe(true);
      expect(deps.spawnCalls).toHaveLength(1);
    } finally {
      startup.stop();
      modulePathKeys.forEach((key, index) => {
        const value = originalModulePaths[index];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      });
      if (originalSentinel === undefined) delete process.env[sentinelKey];
      else process.env[sentinelKey] = originalSentinel;
    }
    expect(startup.ready).toBe(false);
  });

  it("backs off after failed ensure, coalesces attempts, and shutdown clears retry only", async () => {
    const fixture = validFiles();
    const timers: { callback: () => void; milliseconds: number; cleared: boolean }[] = [];
    const setTimer = ((callback: (...args: never[]) => void, milliseconds?: number) => {
      const timer = { callback: () => callback(), milliseconds: milliseconds ?? 0, cleared: false };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    const clearTimer = ((handle: ReturnType<typeof setTimeout>) => {
      const timer = handle as unknown as { cleared: boolean };
      timer.cleared = true;
    }) as typeof clearTimeout;
    const deps = fakeDependencies(fixture, failedReport, { setTimeout: setTimer, clearTimeout: clearTimer });
    const result = await preparePrivateVoiceStartup(USER_DATA, PC_ID, { dependencies: deps });
    expect(result.state).toBe("configured");
    if (result.state !== "configured") return;
    await result.startup.start();
    expect(deps.spawnCalls).toHaveLength(1);
    expect(timers.map(timer => timer.milliseconds)).toEqual([2_000]);
    await result.startup.start();
    expect(deps.spawnCalls).toHaveLength(1);
    result.startup.stop();
    expect(timers[0].cleared).toBe(true);
    expect(result.startup.ready).toBe(false);
  });

  it("handles asynchronous spawn failure without leaving startup pending", async () => {
    const fixture = validFiles();
    let spawnError: ((error: Error) => void) | undefined;
    const timers: (() => void)[] = [];
    const deps = fakeDependencies(fixture, readyReport, {
      spawn: (() => ({ unref() {}, once(_event: string, listener: (error: Error) => void) {
        spawnError = listener;
        return this;
      } })) as NonNullable<PrivateVoiceDependencies["spawn"]>,
      setTimeout: ((callback: () => void) => {
        timers.push(callback);
        return timers.length;
      }) as unknown as typeof setTimeout,
      clearTimeout: vi.fn(),
    });
    const prepared = await preparePrivateVoiceStartup(USER_DATA, PC_ID, { dependencies: deps });
    expect(prepared.state).toBe("configured");
    if (prepared.state !== "configured") return;
    const pending = prepared.startup.start();
    try {
      await vi.waitFor(() => expect(spawnError).toBeTypeOf("function"));
      spawnError!(new Error("fixture executable unavailable"));
      await pending;
      expect(prepared.startup.ready).toBe(false);
      expect(timers).toHaveLength(1);
    } finally {
      prepared.startup.stop();
      await pending;
    }
  });

  it("closes the private gate and schedules recovery after a lost service connection", async () => {
    const fixture = validFiles();
    const timers: (() => void)[] = [];
    const deps = fakeDependencies(fixture, readyReport, {
      fetch: vi.fn(async () => { throw new Error("fixture connection refused"); }),
      setTimeout: ((callback: () => void) => {
        timers.push(callback);
        return timers.length;
      }) as unknown as typeof setTimeout,
      clearTimeout: vi.fn(),
    });
    const prepared = await preparePrivateVoiceStartup(USER_DATA, PC_ID, { dependencies: deps });
    expect(prepared.state).toBe("configured");
    if (prepared.state !== "configured") return;
    try {
      await prepared.startup.start();
      await expect(prepared.startup.voiceOptions.fetch!("http://127.0.0.1:9843/health"))
        .rejects.toThrow("fixture connection refused");
      expect(prepared.startup.ready).toBe(false);
      expect(timers).toHaveLength(1);
      expect((await prepared.startup.voiceOptions.fetch!("http://127.0.0.1:9843/health")).status).toBe(503);
      expect(deps.fetch).toHaveBeenCalledTimes(1);
    } finally {
      prepared.startup.stop();
    }
  });
});
