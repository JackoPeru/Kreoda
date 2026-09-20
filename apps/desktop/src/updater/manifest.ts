// Update manifest: pure validation + version compare (Phase 8 updater).
// No Node APIs here — this module is unit-tested in the renderer harness.
// Signature verification and download live in electron/updater.ts (Node).

export interface UpdateManifest {
  version: string;
  url: string;
  sha256: string;
  signature: string;
}

/** Exact bytes covered by the manifest signature (Ed25519, see updater.ts). */
export function signedPayloadBytes(m: UpdateManifest): Uint8Array {
  return new TextEncoder().encode(`${m.version}\n${m.url}\n${m.sha256}`);
}

function isVersion(s: unknown): s is string {
  return (
    typeof s === "string" && /^\d+\.\d+\.\d+$/.test(s) &&
    s.split(".").every((p) => {
      const n = Number(p);
      return Number.isSafeInteger(n) && n >= 0 && String(n) === p;
    })
  );
}

/** Parse + validate an unknown feed document. Throws honestly on garbage. */
export function parseManifest(raw: unknown): UpdateManifest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("update manifest must be a JSON object");
  }
  const o = raw as Record<string, unknown>;
  const { version, url, sha256, signature } = o;
  if (!isVersion(version)) {
    throw new Error("update manifest needs version like \"0.2.0\"");
  }
  if (typeof url !== "string" || url.length === 0 || url.length > 2048) {
    throw new Error("update manifest needs a url");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("update manifest url is not a URL");
  }
  // HTTPS everywhere; plain HTTP only for loopback dev/probe feeds.
  const loopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error("update manifest url must be https (http only for loopback)");
  }
  if (typeof sha256 !== "string" || !/^[0-9a-fA-F]{64}$/.test(sha256)) {
    throw new Error("update manifest needs a 64-hex sha256");
  }
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("update manifest needs a signature (unsigned updates refused)");
  }
  return { version, url, sha256: sha256.toLowerCase(), signature };
}

/** Numeric X.Y.Z compare: true when candidate is strictly newer. */
export function isNewer(current: string, candidate: string): boolean {
  const parse = (v: string): [number, number, number] | null => {
    if (!isVersion(v)) return null;
    const [a, b, c] = v.split(".").map(Number);
    return [a!, b!, c!];
  };
  const a = parse(current);
  const b = parse(candidate);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (b[i]! !== a[i]!) return b[i]! > a[i]!;
  }
  return false;
}
