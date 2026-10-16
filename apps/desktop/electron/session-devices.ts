import crypto from "node:crypto";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, lstat, realpath, mkdir, readFile, rename, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface TrustedSessionDevice { deviceId: string; name: string; pairedAt: string }
interface DeviceRecord extends TrustedSessionDevice { credentialDigest: string }
const DEVICE_ID = /^device-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const PAIRING_CODE = /^\d{8}$/;
const runFile = promisify(execFile);
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const secret = (): string => randomBytes(32).toString("base64url");
const unauthorized = (): Error => Object.assign(new Error("device authentication failed"), { code: "UNAUTHORIZED" });
function sameDigest(value: string, expectedDigest: string): boolean {
  return timingSafeEqual(Buffer.from(digest(value), "hex"), Buffer.from(expectedDigest, "hex"));
}
function sameSecret(value: unknown, expectedDigest: string): boolean {
  return typeof value === "string" && OPAQUE_TOKEN.test(value) && sameDigest(value, expectedDigest);
}
function pairingSecretShape(value: unknown): value is string {
  return typeof value === "string" && (OPAQUE_TOKEN.test(value) || PAIRING_CODE.test(value));
}

async function protect(path: string, directory: boolean): Promise<void> {
  if (process.platform !== "win32") { await chmod(path, directory ? 0o700 : 0o600); return; }
  const home = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0");
  // Replace the DACL on this app-owned path only. No path interpolation and
  // no inherited group access; atomic files inherit the protected directory.
  const script = `$ErrorActionPreference='Stop'
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=if($env:KREODA_SESSION_ACL_KIND -eq 'directory'){[System.Security.AccessControl.DirectorySecurity]::new()}else{[System.Security.AccessControl.FileSecurity]::new()}
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true,$false)
$inherit=if($env:KREODA_SESSION_ACL_KIND -eq 'directory'){[System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit}else{[System.Security.AccessControl.InheritanceFlags]::None}
$rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,[System.Security.AccessControl.FileSystemRights]::FullControl,$inherit,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow)
$acl.AddAccessRule($rule)
if($env:KREODA_SESSION_ACL_KIND -eq 'directory'){[System.IO.Directory]::SetAccessControl($env:KREODA_SESSION_ACL_PATH,$acl)}else{[System.IO.File]::SetAccessControl($env:KREODA_SESSION_ACL_PATH,$acl)}`;
  try {
    await runFile(join(home, "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true, timeout: 10000,
      env: { ...process.env, KREODA_SESSION_ACL_PATH: path, KREODA_SESSION_ACL_KIND: directory ? "directory" : "file" },
    });
  } catch (error) { throw Object.assign(new Error("cannot protect session device storage", { cause: error }), { code: "SESSION_STORAGE" }); }
}

/** Device credentials persist as digests; pairing/session tokens exist in memory only. */
export class SessionDevices {
  private readonly directory: string;
  private readonly file: string;
  private readonly userData: string;
  private records = new Map<string, DeviceRecord>();
  private sessionTokens = new Map<string, { value: string; digest: string }>();
  private pairing: { tokenDigest: string; codeDigest: string; expiresAt: number; failures: number } | null = null;
  private pairingTimer: NodeJS.Timeout | null = null;
  private queue: Promise<void> = Promise.resolve();
  private loaded = false;
  constructor(userData: string, private readonly now: () => number = Date.now) {
    this.userData = userData;
    this.directory = join(userData, "session-devices");this.file = join(this.directory, "devices.json");
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(run);this.queue = pending.then(() => {}, () => {});return pending;
  }
  private ready(): void { if (!this.loaded) throw Object.assign(new Error("session device storage not loaded"), { code: "SESSION_STORAGE" }); }
  load(): Promise<void> {
    return this.serial(async () => {
      if (this.loaded) return;
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const info = await lstat(this.directory);
      const expected = join(await realpath(this.userData), "session-devices");
      const actual = await realpath(this.directory);
      const canonical = (value: string): string => process.platform === "win32" ? value.toLowerCase() : value;
      if (!info.isDirectory() || info.isSymbolicLink() || canonical(actual) !== canonical(expected)) throw new Error("session device directory must not be a symbolic link");
      await protect(this.directory, true);
      let text: string;
      try {
        const fileInfo = await lstat(this.file);
        if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) throw new Error("session device store must be a regular file");
        await protect(this.file, false);text = await readFile(this.file, "utf8");
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { this.loaded = true;return; } throw error; }
      const value = JSON.parse(text) as { version?: unknown; devices?: unknown };
      if (value === null || typeof value !== "object" || value.version !== 1 || !Array.isArray(value.devices)) throw new Error("invalid session device storage");
      const records = new Map<string, DeviceRecord>();
      for (const raw of value.devices as unknown[]) {
        if (raw === null || typeof raw !== "object") throw new Error("invalid trusted device record");
        const rec = raw as DeviceRecord;
        if (typeof rec.deviceId !== "string" || !DEVICE_ID.test(rec.deviceId) || typeof rec.name !== "string" || !rec.name.trim() || rec.name.length > 80 || /[\x00-\x1f\x7f]/.test(rec.name) || typeof rec.credentialDigest !== "string" || !/^[a-f0-9]{64}$/.test(rec.credentialDigest) || typeof rec.pairedAt !== "string" || !Number.isFinite(Date.parse(rec.pairedAt)) || records.has(rec.deviceId)) throw new Error("invalid trusted device record");
        records.set(rec.deviceId, { deviceId: rec.deviceId, name: rec.name, credentialDigest: rec.credentialDigest, pairedAt: rec.pairedAt });
      }
      this.records = records;this.loaded = true;
    });
  }
  list(): TrustedSessionDevice[] {
    this.ready();return [...this.records.values()].map(({ deviceId, name, pairedAt }) => ({ deviceId, name, pairedAt }));
  }
  beginPairing(): { token: string; code: string; expiresAt: string } {
    this.cancelPairing();
    this.ready();const token = secret();const code = String(crypto.randomInt(0, 100000000)).padStart(8, "0");
    if (!PAIRING_CODE.test(code)) throw new Error("pairing code generator returned an invalid value");
    const expiresAt = this.now() + 300000;
    this.pairing = { tokenDigest: digest(token), codeDigest: digest(code), expiresAt, failures: 0 };
    this.pairingTimer = setTimeout(() => this.cancelPairing(), 300000);
    this.pairingTimer.unref?.();
    return { token, code, expiresAt: new Date(expiresAt).toISOString() };
  }
  /** Count a failed, correctly-shaped guess even when another field made the request fail schema validation. */
  noteFailedPairingGuess(value: unknown): void {
    if (!pairingSecretShape(value)) return;
    const pairing = this.pairing;
    if (!pairing) return;
    if (this.now() >= pairing.expiresAt) { this.cancelPairing();return; }
    const matchesToken = OPAQUE_TOKEN.test(value) && sameDigest(value, pairing.tokenDigest);
    const matchesCode = PAIRING_CODE.test(value) && sameDigest(value, pairing.codeDigest);
    if (matchesToken || matchesCode) return;
    pairing.failures++;
    if (pairing.failures >= 5) this.cancelPairing();
  }
  cancelPairing(): void {
    this.pairing = null;
    if (this.pairingTimer) clearTimeout(this.pairingTimer);
    this.pairingTimer = null;
  }
  rotateSessionTokens(): void { this.sessionTokens.clear();this.cancelPairing(); }
  private token(deviceId: string): string {
    let token = this.sessionTokens.get(deviceId);
    if (!token) { const value = secret();token = { value, digest: digest(value) };this.sessionTokens.set(deviceId, token); }
    return token.value;
  }
  private async persist(records: Map<string, DeviceRecord>): Promise<void> {
    const temporary = join(this.directory, `devices-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify({ version: 1, devices: [...records.values()] }));await file.sync();
      } finally { await file.close(); }
      await protect(temporary, false);await rename(temporary, this.file);
    }
    finally { await rm(temporary, { force: true }); }
  }
  pair(token: string, name: string): Promise<{ deviceId: string; credential: string; sessionToken: string }> {
    return this.serial(async () => {
      this.ready();
      if (typeof name !== "string" || !name.trim() || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) {
        this.noteFailedPairingGuess(token);
        throw Object.assign(new Error("deviceName must contain 1 to 80 printable characters"), { code: "BAD_PARAMS" });
      }
      const pairing = this.pairing;
      if (!pairing || this.now() >= pairing.expiresAt || !pairingSecretShape(token)) {
        if (pairing && this.now() >= pairing.expiresAt) this.cancelPairing();
        throw unauthorized();
      }
      const matchesToken = OPAQUE_TOKEN.test(token) && sameDigest(token, pairing.tokenDigest);
      const matchesCode = PAIRING_CODE.test(token) && sameDigest(token, pairing.codeDigest);
      if (!matchesToken && !matchesCode) {
        this.noteFailedPairingGuess(token);
        throw unauthorized();
      }
      this.cancelPairing();
      const deviceId = `device-${randomUUID()}`;const credential = secret();
      const records = new Map(this.records);
      records.set(deviceId, { deviceId, name: name.trim(), credentialDigest: digest(credential), pairedAt: new Date(this.now()).toISOString() });
      await this.persist(records);this.records = records;
      return { deviceId, credential, sessionToken: this.token(deviceId) };
    });
  }
  authenticate(deviceId: string, credential: string): { deviceId: string; sessionToken: string } {
    this.ready();const record = this.records.get(deviceId);
    if (!record || !sameSecret(credential, record.credentialDigest)) throw unauthorized();
    return { deviceId, sessionToken: this.token(deviceId) };
  }
  authorize(deviceId: string, token: string): boolean {
    if (!this.loaded || !this.records.has(deviceId)) return false;
    const expected = this.sessionTokens.get(deviceId);return !!expected && sameSecret(token, expected.digest);
  }
  isTrusted(deviceId: string): boolean { return this.loaded && this.records.has(deviceId); }
  revoke(deviceId: string): Promise<void> {
    return this.serial(async () => {
      this.ready();if (!this.records.has(deviceId)) throw Object.assign(new Error("unknown trusted device"), { code: "NOT_FOUND" });
      const records = new Map(this.records);records.delete(deviceId);await this.persist(records);
      this.records = records;this.sessionTokens.delete(deviceId);
    });
  }
}
