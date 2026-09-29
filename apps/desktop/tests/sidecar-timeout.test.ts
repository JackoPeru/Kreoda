// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { CommandType, frameMessage } from "@kreoda/protocol";

const bridge = vi.hoisted(() => ({ process: null as unknown }));
vi.mock("electron", () => ({ app: { getAppPath: () => process.cwd() } }));
vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("node:child_process", () => ({ spawn: () => bridge.process }));
import { SidecarManager } from "../electron/sidecar";

const frame = (requestId: string, type: CommandType) => frameMessage(
  new TextEncoder().encode(JSON.stringify({ protocolVersion: 1, requestId, documentId: "test", type, lod: 2 })),
);

afterEach(() => vi.useRealTimers());

it("keeps a measured 155 s mesh request alive, correlates its reply and honors explicit deadlines", async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null,
    stdin: { write: (bytes: Uint8Array) => {
      const request = JSON.parse(new TextDecoder().decode(bytes.slice(4))) as { requestId: string; type: number };
      if (request.type === CommandType.GetCoreInfo) queueMicrotask(() => child.stdout.emit("data", Buffer.from(frame(request.requestId, CommandType.GetCoreInfo))));
    } },
    kill: () => {},
  });
  bridge.process = child;
  const manager = new SidecarManager();
  const starting = manager.start();
  await vi.advanceTimersByTimeAsync(100);
  await starting;
  let outcome = "pending";
  const mesh = manager.invoke(frame("slow-mesh", CommandType.RequestMesh))
    .then(reply => { outcome = "reply"; return reply; }, error => { outcome = "timeout"; return error; });
  await vi.advanceTimersByTimeAsync(155_000);
  expect(outcome).toBe("pending");
  child.stdout.emit("data", Buffer.from(frame("slow-mesh", CommandType.RequestMesh)));
  expect(await mesh).toBeInstanceOf(Uint8Array);
  expect(outcome).toBe("reply");
  const short = manager.invoke(frame("short-mesh", CommandType.RequestMesh), 10).catch(error => error);
  await vi.advanceTimersByTimeAsync(10);
  expect((await short).message).toBe("kreoda-core request timed out");
  const bounded = manager.invoke(frame("stalled-mesh", CommandType.RequestMesh)).catch(error => error);
  await vi.advanceTimersByTimeAsync(300_000);
  expect((await bounded).message).toBe("kreoda-core request timed out");
  manager.stop();
});
