import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { SessionDevices } from "../electron/session-devices";
import { sessionInterfaces, validateSessionListener } from "../electron/session-listener";

describe("private session device credentials", () => {
  async function isolated(run: (devices: SessionDevices, root: string, advance: (ms: number) => void) => Promise<void>) {
    const root = await mkdtemp(join(tmpdir(), "kreoda-devices-test-"));
    let now = Date.now();
    try {
      const devices = new SessionDevices(root, () => now);
      await devices.load();
      await run(devices, root, ms => { now += ms; });
    } finally {
      if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("kreoda-devices-test-")) throw new Error("invalid isolated cleanup target");
      await rm(root, { recursive: true, force: true });
    }
  }

  it("persists only credential digests and rotates session tokens after restart", async () => {
    await isolated(async (devices, root) => {
      const pairing = devices.beginPairing();
      expect(pairing.token.length).toBe(43);
      const paired = await devices.pair(pairing.token, "Quest 3");
      expect(devices.list()).toEqual([{ deviceId: paired.deviceId, name: "Quest 3", pairedAt: expect.any(String) }]);
      const saved = await readFile(join(root, "session-devices", "devices.json"), "utf8");
      expect(saved.includes(paired.credential)).toBe(false);
      expect(saved.includes(paired.sessionToken)).toBe(false);
      expect(saved.includes(pairing.token)).toBe(false);
      expect(JSON.parse(saved).devices[0].credentialDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(devices.authorize(paired.deviceId, paired.sessionToken)).toBe(true);
      const restarted = new SessionDevices(root);
      await restarted.load();
      expect(restarted.authorize(paired.deviceId, paired.sessionToken)).toBe(false);
      const auth = restarted.authenticate(paired.deviceId, paired.credential);
      expect(auth.sessionToken === paired.sessionToken).toBe(false);
      expect(restarted.authorize(paired.deviceId, auth.sessionToken)).toBe(true);
    });
  });

  it("consumes a pairing token once even for simultaneous exchanges", async () => {
    await isolated(async devices => {
      const pairing = devices.beginPairing();
      const outcomes = await Promise.allSettled([devices.pair(pairing.token, "one"), devices.pair(pairing.token, "two")]);
      expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
      expect(devices.list()).toHaveLength(1);
      await expect(devices.pair(pairing.token, "again")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  it("replacing a pairing window retires both the previous code and token", async () => {
    await isolated(async devices => {
      const old = devices.beginPairing();
      const current = devices.beginPairing();
      await expect(devices.pair(old.code, "old code")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(devices.pair(old.token, "old token")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(devices.pair(current.code, "Quest")).resolves.toMatchObject({ deviceId: expect.any(String) });
    });
  });

  it("counts concurrent wrong code guesses against the same five-attempt window", async () => {
    await isolated(async devices => {
      const pairing = devices.beginPairing();
      const wrongCode = `${(Number(pairing.code[0]) + 1) % 10}${pairing.code.slice(1)}`;
      const attempts = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => devices.pair(wrongCode, `Quest ${index}`)));
      expect(attempts.every(result => result.status === "rejected")).toBe(true);
      await expect(devices.pair(pairing.code, "Quest")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(devices.pair(pairing.token, "Quest")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  it("pairs with an eight digit code including leading zeroes and consumes both credentials", async () => {
    await isolated(async devices => {
      const originalRandomInt = crypto.randomInt;
      Object.defineProperty(crypto, "randomInt", { configurable: true, value: () => 7 });
      let pairing: ReturnType<SessionDevices["beginPairing"]>;
      try { pairing = devices.beginPairing(); }
      finally { Object.defineProperty(crypto, "randomInt", { configurable: true, value: originalRandomInt }); }
      expect(pairing.code === "00000007").toBe(true);
      expect(pairing.code).toMatch(/^\d{8}$/);
      const paired = await devices.pair(pairing.code, "Quest 3");
      expect(paired.deviceId).toMatch(/^device-/);
      await expect(devices.pair(pairing.token, "legacy fallback" )).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(devices.pair(pairing.code, "replay")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  it("locks both pairing values after five valid-shaped guesses", async () => {
    await isolated(async devices => {
      const pairing = devices.beginPairing();
      const wrongCode = `${(Number(pairing.code[0]) + 1) % 10}${pairing.code.slice(1)}`;
      for (let attempt = 0; attempt < 5; attempt++)
        await expect(devices.pair(wrongCode, "Quest")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(devices.pair(pairing.code, "Quest")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(devices.pair(pairing.token, "Quest")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  it("does not count malformed shapes as pairing guesses", async () => {
    await isolated(async devices => {
      const pairing = devices.beginPairing();
      for (let attempt = 0; attempt < 7; attempt++)
        await expect(devices.pair("not-a-code", "Quest")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(devices.pair(pairing.code, "Quest")).resolves.toMatchObject({ deviceId: expect.any(String) });
    });
  });

  it("expires/cancels pairing and revokes credentials durably", async () => {
    await isolated(async (devices, root, advance) => {
      const expired = devices.beginPairing(); advance(300000);
      await expect(devices.pair(expired.token, "expired")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(devices.pair(expired.code, "expired code")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      const cancelled = devices.beginPairing(); devices.cancelPairing();
      await expect(devices.pair(cancelled.token, "cancelled")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(devices.pair(cancelled.code, "cancelled code")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      const paired = await devices.pair(devices.beginPairing().token, "laptop");
      expect(() => devices.authenticate(paired.deviceId, "incorrect")).toThrow();
      await devices.revoke(paired.deviceId);
      expect(devices.authorize(paired.deviceId, paired.sessionToken)).toBe(false);
      expect(() => devices.authenticate(paired.deviceId, paired.credential)).toThrow();
      const restarted = new SessionDevices(root);await restarted.load();
      expect(restarted.list()).toHaveLength(0);
      expect(() => restarted.authenticate(paired.deviceId, paired.credential)).toThrow();
    });
  });

  it("failed atomic replacement never adopts a device or leaves a temporary file", async () => {
    await isolated(async (devices, root) => {
      const directory = join(root, "session-devices");
      await mkdir(join(directory, "devices.json"));
      const pairing = devices.beginPairing();
      await expect(devices.pair(pairing.token, "failed write")).rejects.toBeDefined();
      expect(devices.list()).toHaveLength(0);
      expect((await readdir(directory)).some(name => name.endsWith(".tmp"))).toBe(false);
      await expect(devices.pair(pairing.token, "retry")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  it("a corrupt store is rejected and its original bytes are preserved", async () => {
    await isolated(async (_devices, root) => {
      const file = join(root, "session-devices", "devices.json");
      await writeFile(file, '{"version":1,"devices":[null]}');
      await expect(new SessionDevices(root).load()).rejects.toThrow("invalid trusted device record");
      expect(await readFile(file, "utf8")).toBe('{"version":1,"devices":[null]}');
    });
  });
});

describe("explicit private listener binding", () => {
  const interfaces = {
    Ethernet: [{ address: "192.168.1.20", family: "IPv4", internal: false }],
    WiFi: [{ address: "10.0.0.7", family: "IPv4", internal: false }],
    Public: [{ address: "203.0.113.8", family: "IPv4", internal: false }],
  };
  it("allows loopback or an explicitly selected assigned private IPv4", () => {
    expect(validateSessionListener({ host: "127.0.0.1", port: 0 }, interfaces)).toEqual({ host: "127.0.0.1", port: 0 });
    expect(validateSessionListener({ host: "192.168.1.20", port: 9860 }, interfaces).host).toBe("192.168.1.20");
    expect(sessionInterfaces(interfaces).map(value => value.address)).toEqual(["127.0.0.1", "192.168.1.20", "10.0.0.7"]);
  });
  it("rejects wildcard, unassigned, public, multicast, unresolved hosts and invalid ports", () => {
    for (const host of ["0.0.0.0", "::", "192.168.1.21", "203.0.113.8", "224.0.0.1", "some-host", "::ffff:192.168.1.20"]) {
      expect(() => validateSessionListener({ host, port: 9860 }, interfaces)).toThrow();
    }
    for (const port of [-1, 65536, 1.5, NaN]) expect(() => validateSessionListener({ host: "127.0.0.1", port }, interfaces)).toThrow();
  });
});
