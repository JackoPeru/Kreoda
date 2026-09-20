// Sidecar lifecycle (§7, §51): spawn kreoda-core.exe, binary framed IPC,
// crash detection + restart. Renderer thread never blocks on geometry (§40).

import { ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import {
  FrameDecoder,
  frameMessage,
  responseRequestId,
} from "@kreoda/protocol";

function resolveSidecarPath(): string {
  const exe =
    process.platform === "win32" ? "kreoda-core.exe" : "kreoda-core";
  const candidates = [
    // packaged extraResource
    process.resourcesPath
      ? path.join(process.resourcesPath, exe)
      : undefined,
    // dev: <repo>/native/... from the desktop package root
    path.join(app.getAppPath(), "..", "..", "native", "kreoda-core", "build", "Release", exe),
    path.join(process.cwd(), "..", "..", "native", "kreoda-core", "build", "Release", exe),
    path.join(process.cwd(), "native", "kreoda-core", "build", "Release", exe),
  ].filter((c): c is string => !!c);
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0]!;
}

interface Pending {
  resolve: (v: Uint8Array) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class SidecarManager {
  private proc: ChildProcess | null = null;
  private decoder = new FrameDecoder();
  private pending = new Map<string, Pending>();
  private crashHandlers: ((code: number | null) => void)[] = [];
  /** Bounded sidecar stderr tail for crash bundles (§61) — never unbounded. */
  private stderrTail: string[] = [];
  private static readonly STDERR_TAIL_MAX = 200;

  onCrash(cb: (code: number | null) => void): void {
    this.crashHandlers.push(cb);
  }

  async start(): Promise<void> {
    const exePath = resolveSidecarPath();
    this.proc = spawn(exePath, [], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout?.on("data", (chunk: Buffer) => this.handleStdout(chunk));
    this.proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      console.error("[kreoda-core]", text);
      for (const line of text.split(/\r?\n/)) {
        if (line.length === 0) continue;
        this.stderrTail.push(line.slice(0, 2000));
        while (this.stderrTail.length > SidecarManager.STDERR_TAIL_MAX) {
          this.stderrTail.shift();
        }
      }
    });
    this.proc.on("exit", (code) => {
      this.proc = null;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error(`geometry engine exited (${code})`));
      }
      this.pending.clear();
      for (const h of this.crashHandlers) h(code);
    });
    // Phase 0 acceptance: ping GetCoreInfo to prove the loop works.
    await this.ping();
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
  }

  isRunning(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }

  pid(): number | undefined {
    return this.proc?.pid;
  }

  /** Recent sidecar stderr (crash bundles); a copy, oldest first. */
  recentStderr(): string[] {
    return [...this.stderrTail];
  }

  /** Raw framed invoke: caller owns (de)serialization; response is one frame. */
  async invoke(frame: Uint8Array, timeoutMs = 30000): Promise<Uint8Array> {
    if (!this.proc?.stdin) throw new Error("geometry engine not running");
    // Correlate by the request's own requestId (C15): the core answers in
    // dispatch order today, but arrival order was never a contract — and
    // pipelined mesh hydration depends on it staying unordered-safe.
    const id = requestIdOfFrame(frame);
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("kreoda-core request timed out"));
      }, timeoutMs);
      if (this.pending.has(id)) {
        clearTimeout(timer);
        reject(new Error(`duplicate in-flight requestId: ${id}`));
        return;
      }
      this.pending.set(id, { resolve, reject, timer });
      this.proc!.stdin!.write(Buffer.from(frame));
    });
  }

  async ping(): Promise<void> {
    // Minimal GetCoreInfo envelope (JSON payload for Phase 0; FlatBuffers
    // codegen replaces the payload bytes once flatc bindings land — the
    // framing + requestId correlation stays identical).
    const payload = new TextEncoder().encode(
      JSON.stringify({
        protocolVersion: 1,
        requestId: `ping-${Date.now()}`,
        documentId: "",
        type: 1,
        payload: {},
      }),
    );
    try {
      await this.invoke(frameMessage(payload), 10000);
    } catch (err) {
      console.warn("[main] sidecar ping failed (expected before first build)", err);
    }
  }

  private handleStdout(chunk: Buffer): void {
    let frames: Uint8Array[];
    try {
      frames = this.decoder.push(new Uint8Array(chunk));
    } catch (err) {
      // M14: one corrupt/oversized frame must not take down the bridge —
      // fail every in-flight call loudly, reset the stream, keep running.
      console.error(
        "[main] sidecar frame error, resetting decoder",
        err instanceof Error ? err.message : err,
      );
      this.decoder = new FrameDecoder();
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("sidecar frame stream corrupted"));
        this.pending.delete(id);
      }
      return;
    }
    for (const f of frames) {
      const id = responseRequestId(f);
      if (!id) {
        console.error("[main] sidecar response without requestId — dropped");
        continue;
      }
      const p = this.pending.get(id);
      if (!p) continue;
      this.pending.delete(id);
      clearTimeout(p.timer);
      p.resolve(f);
    }
  }
}

/** requestId of an outgoing framed request (all requests are JSON). */
function requestIdOfFrame(frame: Uint8Array): string {
  // Framed envelope is [u32 LE len][JSON]: the payload must open with `{`.
  if (frame.length < 5 || frame[4] !== 0x7b) {
    throw new Error("sidecar request without JSON envelope");
  }
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(frame.slice(4)),
    ) as { requestId?: unknown };
    if (typeof parsed.requestId === "string" && parsed.requestId !== "") {
      return parsed.requestId;
    }
  } catch {
    // Fall through to the honest error below.
  }
  throw new Error("sidecar request without requestId");
}
