# Phase 9b (sandboxed plugins) → handoff

Third-party JS runs in a Web Worker whose only global is the `kreoda`
bridge — no DOM, fetch, fs or direct core access. Manifests declare an
allowlist of core commands per plugin command; every call crosses into the
central `executeCommand` path with availability gates intact. Unknown
capabilities are refused (V1 grants none). Host `userData/plugins/*.js`
auto-load at boot; UI lists/runs via PluginsDialog.

## What landed

- `packages/plugin-sdk`: manifest types + strict validation (id prefix +
  namespace scoping, semver, empty-capabilities rule, per-command
  allowlists, duplicates), unit-tested.
- `apps/desktop/src/plugins/loader.ts`: Blob-worker spawn (shim + source),
  5 s register handshake, duplicate/unknown-command rejection, run bridge
  with timeouts, worker crash isolation (in-flight runs fail loudly, app
  survives), unload, host auto-load (20 files × 256 KiB, per-file errors).
- `electron/main.ts` `kreoda:plugins-list` (+ `KREODA_PLUGINS_DIR` test
  override) + preload; `index.html` gains `worker-src blob:` (script-src
  untouched — no new script capability).
- `PluginsDialog` (list + JSON params + Run + inline errors), Toolbar
  puzzle button, boot auto-load effect, `loadPluginSource`/`runPlugin`
  test hooks.
- E2E `phase9-plugins.spec.ts`: generator builds real geometry, escape
  outside the allowlist refused, throwing plugin isolated, bad manifests
  never load.

## Verified

- `pnpm -r lint/test/build` green (SDK 2, desktop 46); Playwright 19/19.

## Hard-won notes (do not regress)

- Workspace deps resolve from `packages/*/dist`: rebuild after touching
  `plugin-sdk`/`command-schema`/`protocol` or the renderer runs stale code.
- The CSP needs `worker-src blob:` — without it workers die silently-ish
  (register timeout). Never add `unsafe-eval`: the shim is plain JS.
- Core mints feature ids (§10): plugins MUST NOT assume their ids stick —
  match results by volume/type, not id (E2E does).
- `executeCommand` (not the validated bypass) backs plugin calls, so
  selection-gated commands fail honestly without UI selection.
- Results cross the bridge JSON-only (structured clone); BigInt/functions
  are stripped or throw honestly.
- Remaining Phase 9: reference Stage A (9c), assemblies (9d).
