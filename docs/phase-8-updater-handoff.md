# Phase 8 (updater slice) → handoff

Signed updates are wired end to end up to the honest boundary: feed fetch,
Ed25519 manifest verification, version compare, sha256-pinned download.
Install itself stays manual (verified bits revealed to the user) — silent
auto-install without a signed install pipeline would be theater. Inert
without `KREODA_UPDATE_FEED`; unsigned feeds always refused.

## What landed

- `src/updater/manifest.ts` (pure, unit-tested): manifest parse/validate
  (version X.Y.Z, https URLs with loopback-only http exception, 64-hex
  sha256, mandatory signature), numeric `isNewer`, deterministic signed bytes.
- `electron/updater.ts` (Node-only: https/crypto/fs, no electron imports):
  `fetchManifest` (15 s timeout, 64 KiB cap, https-or-loopback), Ed25519
  `verifyManifest` (PEM SPKI, must be ed25519), `checkFeed`, `downloadPinned`
  (2 GiB cap, sha256 pin, 0600 file mode, `..` filename guard).
- `main.ts`: `kreoda:check-updates` handler + 5 s delayed auto-check when
  a feed is configured; verified-version dialog → download → reveal flow;
  missing pubkey / bad signature refuse with logged errors, never install.
- `preload.ts`: `checkForUpdates` + `onUpdateAvailable`; App status bar
  shows "update X ready" (`update-note`).
- `tests/updater-manifest.test.ts`: validation rejects, numeric compare,
  signed bytes (8 tests).

## Verified

- Unit 43 (manifest 8); lint clean; boot/UX E2E green (no-feed path inert).
- Temp loopback probe (deleted after): ephemeral Ed25519 keys, happy path
  (check→verify→download bytes match), same-version negative, tampered
  manifest refused, wrong-key refused, non-loopback http refused, 404 honest.
  The probe caught a REAL bug pre-ship: `createVerify("SHA256")` pre-hashes,
  but Ed25519 is pure — one-shot `verify(null, …)` is the correct call.

## Hard-won notes (do not regress)

- Node's `createVerify` REQUIRES a string algorithm (throws on null) — for
  Ed25519 use one-shot `verify(null, data, key, sig)`, not the object form.
- Trust anchor is env-only (`KREODA_UPDATE_PUBKEY`, PEM SPKI) — no dev
  key shipped. Production still needs: release key provisioning, HTTPS feed
  hosting, and a signed install pipeline (Squirrel/NSIS); the verify-then-
  reveal flow is ready for it.
- `electron/updater.ts` must stay electron-free so the path stays probeable
  (esbuild bundle + plain node); main.ts owns all dialogs/shell calls.
- Remaining Phase 8: final bug-hunt + full verification (everything else —
  STEP/3MF/STL/OBJ/glTF, flatc, recovery, crash bundle, perf, topology
  tests, licenses, telemetry — is done).
