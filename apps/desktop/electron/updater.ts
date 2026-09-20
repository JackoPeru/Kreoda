// Signed updater, main-process half (Phase 8 §61). No electron imports:
// pure Node (https/crypto/fs) so the fetch→verify→download path stays
// testable outside Electron. Trust model: manifests are Ed25519-signed;
// the public key comes from INTENTCAD_UPDATE_PUBKEY (PEM SPKI) — no key,
// no update, ever. Downloads are sha256-pinned. Install itself stays manual
// (verified bits revealed to the user) until a signed install pipeline
// exists — silent auto-install without one would be theater, not security.

import { createHash, createPublicKey, verify } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import { get as httpsGet } from "node:https";
import { get as httpGet } from "node:http";
import * as path from "node:path";
import {
  isNewer,
  parseManifest,
  signedPayloadBytes,
  type UpdateManifest,
} from "../src/updater/manifest";

export type { UpdateManifest };

const FETCH_TIMEOUT_MS = 15000;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;

function fetchStream(
  url: string,
  maxBytes: number,
  onChunk: (chunk: Buffer) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error("not a URL"));
      return;
    }
    const loopback =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1";
    const getter = parsed.protocol === "https:" ? httpsGet : httpGet;
    if (parsed.protocol !== "https:" && !loopback) {
      reject(new Error("https required (http only for loopback)"));
      return;
    }
    const req = getter(url, (res) => {
      const code = res.statusCode ?? 0;
      // No redirect following (minor): a feed that moves must be re-pinned,
      // never silently followed — downgrade protection by construction.
      if (code !== 200) {
        res.resume();
        reject(
          new Error(
            code >= 300 && code < 400
              ? `feed redirects not followed (${code}) — re-pin the feed URL`
              : `feed answered ${code}`,
          ),
        );
        return;
      }
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          res.destroy();
          reject(new Error("response too large"));
          return;
        }
        onChunk(c);
      });
      res.on("end", () => resolve());
      res.on("error", reject);
    });
    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy(new Error("feed timed out"));
    });
    req.on("error", reject);
  });
}

/** Fetch + validate the feed manifest (no trust implied yet). */
export async function fetchManifest(feedUrl: string): Promise<UpdateManifest> {
  const chunks: Buffer[] = [];
  await fetchStream(feedUrl, MAX_MANIFEST_BYTES, (c) => chunks.push(c));
  const bytes = Buffer.concat(chunks);
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("feed manifest is not JSON");
  }
  return parseManifest(raw);
}

/** Ed25519-verify the manifest against a PEM SPKI public key. */
export function verifyManifest(
  manifest: UpdateManifest,
  publicKeyPem: string,
): boolean {
  let key;
  try {
    key = createPublicKey(publicKeyPem);
  } catch {
    throw new Error("update public key is not a PEM SPKI key");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("update key must be Ed25519");
  }
  const payload = signedPayloadBytes(manifest);
  // Strict base64 first: Buffer.from silently skips whitespace/garbage,
  // which would turn a malformed signature into a different 64 bytes.
  if (!/^[A-Za-z0-9+/]{86}==$/.test(manifest.signature)) return false;
  const signature = Buffer.from(manifest.signature, "base64");
  if (signature.length !== 64) return false;
  try {
    // Ed25519 is a pure scheme: one-shot verify with null algorithm.
    return verify(
      null,
      Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength),
      key,
      signature,
    );
  } catch {
    return false;
  }
}

/**
 * Check a feed for a newer release. Returns the manifest when the feed
 * names a strictly newer version (signature NOT checked here — callers
 * must verifyManifest before downloading or installing anything).
 */
export async function checkFeed(
  feedUrl: string,
  currentVersion: string,
): Promise<{ available: boolean; manifest?: UpdateManifest }> {
  const manifest = await fetchManifest(feedUrl);
  if (!isNewer(currentVersion, manifest.version)) {
    return { available: false };
  }
  return { available: true, manifest };
}

/** Download the manifest URL and pin it against the manifest sha256. */
export async function downloadPinned(
  manifest: UpdateManifest,
  destDir: string,
): Promise<string> {
  await fs.mkdir(destDir, { recursive: true });
  // Strict filename allowlist (minor): basename already strips directories,
  // but Windows device names (`CON`, `NUL`, `COM1`…) and separators must go.
  const rawName = path.basename(new URL(manifest.url).pathname);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(exe|msi|dmg|pkg|AppImage|zip)$/.test(rawName)) {
    throw new Error("unsafe download filename");
  }
  const dest = path.join(destDir, rawName);
  // Stream to a partial file with an incremental digest (C14): the full
  // payload never sits in RAM, and only a hash-matched file is renamed in.
  const partial = `${dest}.partial`;
  const hash = createHash("sha256");
  const out = createWriteStream(partial, { mode: 0o600 });
  try {
    // NOTE: socket backpressure is not applied chunk-by-chunk; the byte cap
    // still bounds total memory through the socket buffer.
    await fetchStream(manifest.url, MAX_DOWNLOAD_BYTES, (chunk) => {
      hash.update(chunk);
      out.write(chunk);
    });
  } catch (e) {
    try {
      out.destroy();
      await fs.unlink(partial);
    } catch {
      // Cleanup is best-effort; the .partial suffix never executes.
    }
    throw e;
  }
  await new Promise<void>((resolve, reject) => {
    out.on("error", reject);
    out.on("finish", resolve);
    out.end();
  });
  const digest = hash.digest("hex");
  if (digest !== manifest.sha256) {
    await fs.unlink(partial).catch(() => {});
    throw new Error("download hash mismatch — discarded");
  }
  // fsync durability is best-effort here; the hash gate is the guarantee.
  await fs.rename(partial, dest);
  return dest;
}
