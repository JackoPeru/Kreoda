import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createSocket } from "node:dgram";
import { SessionDevices } from "../electron/session-devices";
import { SessionDiscovery, AutomaticSessionHost, privatePeer } from "../electron/session-discovery";

describe("automatic local pairing", () => {
  it("owns interface changes and closes both services before disable completes", async () => {
    vi.useFakeTimers();
    let addresses: string[] = [];
    const events: string[] = [];
    const relay = { enableListener: async ({ host }: { host: string }) => { events.push("listen:" + host); },
      disableListener: async () => { events.push("disable"); }, connectionStatus: () => ({ listener: { host: "fixture", port: 9876 } }) };
    const host = new AutomaticSessionHost({} as SessionDevices, relay as never, "Studio", false, {
      addresses: () => [...addresses], discovery: address => ({ start: async () => { events.push("discover:" + address); },
        stop: async () => { events.push("stop-discovery"); } }),
    });
    try {
      await host.start();expect(events).toEqual([]);
      addresses = ["192.168.1.8"];
      await vi.advanceTimersByTimeAsync(5000);
      addresses = ["192.168.1.9"];
      await vi.advanceTimersByTimeAsync(5000);
      await host.stop();
      expect(events).toEqual(["listen:192.168.1.8", "discover:192.168.1.8", "stop-discovery", "disable",
        "listen:192.168.1.9", "discover:192.168.1.9", "stop-discovery", "disable"]);
      addresses = ["192.168.1.10"];await vi.advanceTimersByTimeAsync(10000);
      expect(events).toHaveLength(8);
    } finally { await host.stop();vi.useRealTimers(); }
  });

  it("limits production discovery to private IPv4 peers", () => {
    for (const address of ["0.0.0.0", "8.8.8.8", "127.0.0.1", "100.94.223.14", "::1", "192.168.1.1.evil"])
      expect(privatePeer(address)).toBe(false);
    for (const address of ["192.168.1.8", "10.2.3.4", "172.16.0.1", "::ffff:192.168.1.8"])
      expect(privatePeer(address)).toBe(true);
  });
  it("discovers, pairs after consent, persists identity, and respects revocation", async () => {
    const root = await mkdtemp(join(tmpdir(), "kreoda-auto-pair-"));
    const devices = new SessionDevices(root);
    let service: SessionDiscovery | undefined;
    const socket = createSocket("udp4");
    try {
      await devices.load();
      // New installations need PC-user consent; reconnects must not ask again.
      let approvals = 0;
      service = new SessionDiscovery(devices, "Studio", { host: "127.0.0.1", sessionPort: 9876, discoveryPort: 0, allowLoopback: true,
        authorizePair: async () => { approvals++; return true; },
        isKnownPair: installation => devices.hasAutomatic(installation) });
      await service.start();
      const nonce = randomUUID();
      const received = new Promise<Buffer>(resolve => socket.once("message", resolve));
      socket.send(JSON.stringify({ protocol: "kreoda-discovery", version: 1, nonce }), service.port, "127.0.0.1");
      const reply = JSON.parse((await received).toString());
      expect(reply).toMatchObject({ nonce, pcId: devices.pcId, name: "Studio", sessionPort: 9876 });
      expect(JSON.stringify(reply)).not.toMatch(/credential|sessionToken|deviceId/);
      const installationId = randomUUID();
      const credential = randomBytes(32).toString("base64url");
      const request = () => fetch(`http://127.0.0.1:${reply.bootstrapPort}/pair`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, pcId: reply.pcId, installationId, credential, name: "Quest 3" }),
      });
      const response = await request();
      expect(response.ok).toBe(true);
      const paired = await response.json() as { deviceId: string };
      expect(devices.authenticate(paired.deviceId, credential).deviceId).toBe(paired.deviceId);
      const identify = async (proofVersion?: number) => {
        const response = await fetch(`http://127.0.0.1:${reply.bootstrapPort}/identify`, {
          method: "POST", body: JSON.stringify({ version: 1, pcId: reply.pcId, deviceId: paired.deviceId, nonce, proofVersion }),
        });
        return { status: response.status, value: await response.json() as Record<string, unknown> };
      };
      const signed = (parts: string[]) => createHmac("sha256", createHash("sha256").update(credential).digest())
        .update(JSON.stringify(parts)).digest("hex");
      const legacy = await identify();
      expect(legacy.value.proof).toBe(signed([reply.pcId, paired.deviceId, nonce]));
      const bound = await identify(2);
      expect(bound.value.proofVersion).toBe(2);
      expect(bound.value.proof).toBe(signed([reply.pcId, paired.deviceId, nonce, "127.0.0.1", "9876", String(reply.bootstrapPort)]));
      expect((await identify(99)).status).toBe(400);
      expect((await request()).ok).toBe(true);
      expect(approvals).toBe(1);
      expect(devices.list()).toHaveLength(1);
      const restarted = new SessionDevices(root);
      await restarted.load();
      expect(restarted.pcId).toBe(devices.pcId);
      expect(restarted.authenticate(paired.deviceId, credential).deviceId).toBe(paired.deviceId);
      await devices.revoke(paired.deviceId);
      expect((await request()).status).toBe(403);
      const revoked = new SessionDevices(root);
      await revoked.load();
      await expect(revoked.pairAutomatic(installationId, credential, "Quest 3")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally { socket.close(); await service?.stop(); await rm(root, { recursive: true, force: true }); }
  }, 30000);

  it("denies LAN auto-enrollment until the PC user approves the device", async () => {
    const root = await mkdtemp(join(tmpdir(), "kreoda-auto-deny-"));
    const devices = new SessionDevices(root);
    let service: SessionDiscovery | undefined;
    try {
      await devices.load();
      let asked = "";
      service = new SessionDiscovery(devices, "Studio", { host: "127.0.0.1", sessionPort: 9876, discoveryPort: 0, allowLoopback: true,
        authorizePair: async name => { asked = name; return false; },
        isKnownPair: installation => devices.hasAutomatic(installation) });
      await service.start();
      const response = await fetch(`http://127.0.0.1:${service.bootstrapPort}/pair`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, pcId: devices.pcId, installationId: randomUUID(),
          credential: randomBytes(32).toString("base64url"), name: "Unknown Quest" }),
      });
      expect(response.status).toBe(403);
      expect(asked).toBe("Unknown Quest");
      expect(devices.list()).toHaveLength(0);
    } finally { await service?.stop(); await rm(root, { recursive: true, force: true }); }
  }, 30000);

  it("serializes LAN pairing consent so one dialog cannot be stacked", async () => {
    const root = await mkdtemp(join(tmpdir(), "kreoda-auto-consent-"));
    const devices = new SessionDevices(root);
    let service: SessionDiscovery | undefined;
    let release!: (approved: boolean) => void;
    let begun!: () => void;
    const gate = new Promise<boolean>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { begun = resolve; });
    try {
      await devices.load();
      service = new SessionDiscovery(devices, "Studio", { host: "127.0.0.1", sessionPort: 9876, discoveryPort: 0, allowLoopback: true,
        authorizePair: async () => { begun(); return gate; }, isKnownPair: () => false });
      await service.start();
      const url = `http://127.0.0.1:${service.bootstrapPort}/pair`;
      const request = () => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, pcId: devices.pcId, installationId: randomUUID(),
          credential: randomBytes(32).toString("base64url"), name: "Quest" }) });
      const first = request();
      await started;
      expect((await request()).status).toBe(429);
      release(false);
      expect((await first).status).toBe(403);
      expect(devices.list()).toHaveLength(0);
    } finally {
      release?.(false);
      await service?.stop();
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);

  it("rejects browser origins, oversized bodies and mismatched PC identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "kreoda-auto-pair-"));
    const devices = new SessionDevices(root);
    let service: SessionDiscovery | undefined;
    try {
      await devices.load();
      service = new SessionDiscovery(devices, "Studio", { host: "127.0.0.1", sessionPort: 9876, discoveryPort: 0, allowLoopback: true });
      await service.start();
      const url = `http://127.0.0.1:${service.bootstrapPort}/pair`;
      expect((await fetch(url, { method: "POST", headers: { Origin: "https://example.com" }, body: "{}" })).status).toBe(403);
      expect((await fetch(url, { method: "POST", body: "a".repeat(8193) })).status).toBe(413);
      expect((await fetch(url, { method: "POST", body: JSON.stringify({ version: 1, pcId: randomUUID() }) })).status).toBe(400);
      expect(devices.list()).toHaveLength(0);
    } finally { await service?.stop(); await rm(root, { recursive: true, force: true }); }
  }, 30000);
});
