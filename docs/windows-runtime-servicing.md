# Windows native runtime servicing

This is the maintenance procedure for Kreoda's current app-local native payload.
Release approval still requires the publisher to confirm its applicable Visual
Studio redistribution entitlement. A successful CI build does not establish that
entitlement. Microsoft describes redistribution under the product license terms
in its [redistribution guidance](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files?view=msvc-170).

## Payload and evidence

- The production core uses shared OCCT libraries and the release MSVC CRT beside
  `resources/kreoda-core.exe`. CMake takes the CRT from Visual Studio's Redist tree;
  Forge refuses missing required DLLs and debug CRTs.
- The installer gate verifies every installed native payload hash against the
  build output and runs the installed core self-test. It then generates
  `native-runtime-manifest.json`, retained as the `native-runtime-provenance`
  workflow artifact, with source commit, compiler version, file sizes/versions,
  SHA-256 values and required CRT signing information.
- Manifest generation refuses a required CRT without a valid Microsoft
  signature, a CRT version older than the compiler, and debug CRT payloads.
  Microsoft requires a runtime at least as recent as the build tools in its
  [supported runtime guidance](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist).
- The manifest describes packaged files. It does not inventory every DLL loaded
  by Windows, establish publisher rights, or prove installed desktop GUI startup.

## Update procedure

The project maintainer owns the app-local runtime update. Windows Update servicing
of a central runtime must not be assumed to replace Kreoda's private copies.
Microsoft [discourages local deployment because of servicing issues](https://learn.microsoft.com/en-us/cpp/windows/choosing-a-deployment-method?view=msvc-170).

Before every public release, and when a relevant Microsoft runtime security or
support notice is identified:

1. Use a supported, updated Visual Studio build environment. Rebuild the complete
   native dependency set when its toolchain changes; CI cache identity includes
   compiler, SDK, runner image and vcpkg identity.
2. Compare the new runtime manifest with the previous release. Review CRT versions,
   signatures and hashes; do not copy DLLs from System32 or replace only a user's
   installed runtime files by hand.
3. Run the complete regression, package, silent-install and installed-core gates.
   Exercise the packaged desktop on a clean supported Windows target. Retain the
   manifest and verification evidence with the release.
4. Publish the updated whole application package through the existing release
   channel. Keep the previous complete package available for rollback; release
   notes identify native runtime changes and any user update required.

This document creates no scheduled monitor or claim that an update has been
deployed. Until publisher entitlement and the release evidence are confirmed,
packaging remains validation work in the draft PR.
