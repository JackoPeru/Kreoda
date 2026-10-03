import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.dirname(fileURLToPath(import.meta.url));
const nativeBuildDir = path.resolve(
  desktopRoot,
  "../../native/kreoda-core/build",
);
const nativeReleaseDir = path.join(nativeBuildDir, "Release");

function getWindowsCoreResources(): string[] {
  if (process.platform !== "win32") {
    throw new Error("Windows packaging requires the Windows OCCT core build.");
  }

  const cachePath = path.join(nativeBuildDir, "CMakeCache.txt");
  if (!fs.existsSync(cachePath)) {
    throw new Error(`Native core build cache not found: ${cachePath}`);
  }
  const cache = fs.readFileSync(cachePath, "utf8");
  if (/^KREODA_CRASH_TEST_BARRIERS:BOOL=ON$/m.test(cache)) {
    throw new Error("Refusing to package a core built with crash test barriers.");
  }
  if (
    !/^WITH_OCCT:BOOL=ON$/m.test(cache) ||
    !/^KREODA_ALLOW_STUB_CORE:BOOL=OFF$/m.test(cache)
  ) {
    throw new Error(
      "Refusing to package Kreoda without the real OCCT core " +
        "(WITH_OCCT=ON and KREODA_ALLOW_STUB_CORE=OFF are required).",
    );
  }

  const corePath = path.join(nativeReleaseDir, "kreoda-core.exe");
  if (!fs.existsSync(corePath)) {
    throw new Error(`Real native core executable not found: ${corePath}`);
  }

  const runtimeDlls = fs
    .readdirSync(nativeReleaseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".dll"))
    .map((entry) => path.join(nativeReleaseDir, entry.name))
    .sort();
  const requiredOcctDlls = [
    "TKernel.dll",
    "TKBRep.dll",
    "TKGeomAlgo.dll",
    "TKFillet.dll",
  ];
  const requiredMsvcDlls = [
    "msvcp140.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
  ];
  const runtimeNames = new Set(
    runtimeDlls.map((dllPath) => path.basename(dllPath).toLowerCase()),
  );
  const missingRuntimeDlls = [...requiredOcctDlls, ...requiredMsvcDlls].filter(
    (name) => !runtimeNames.has(name.toLowerCase()),
  );
  if (missingRuntimeDlls.length > 0) {
    throw new Error(
      `Required OCCT/MSVC runtime DLLs not found in ${nativeReleaseDir}: ` +
        missingRuntimeDlls.join(", "),
    );
  }
  const debugMsvcDlls = runtimeDlls
    .map((dllPath) => path.basename(dllPath))
    .filter((name) => /^(msvcp|vcruntime|concrt)140.*d\.dll$/i.test(name));
  if (debugMsvcDlls.length > 0) {
    throw new Error(
      `Refusing to package debug MSVC runtime DLLs: ${debugMsvcDlls.join(", ")}`,
    );
  }

  return [corePath, ...runtimeDlls];
}

// Packaging only — renderer/main/preload are built by `vite build` scripts
// below (Vite 8). Forge makers handle Squirrel/ZIP distribution (§59).
const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // pnpm's isolated linker uses Windows junctions for package entries.
    // Copy their targets into the bundle instead of recreating restricted links.
    derefSymlinks: true,
    // Product identity: installers and executables ship as Kreoda.
    name: "Kreoda",
    // Kreoda mark (apps/desktop/assets/icon.ico + platform siblings).
    icon: "./assets/icon",
    // Keep the sidecar and its OCCT/runtime DLL set beside each other in resources/.
    // The guard rejects a missing or explicitly stub-configured native build.
    extraResource: getWindowsCoreResources(),
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: "kreoda",
      authors: "Kreoda",
      description:
        "Kreoda — hybrid native/web desktop CAD with an OpenCascade geometry engine.",
      setupIcon: "./assets/icon.ico",
    }),
    // This checkout currently ships a real Windows OCCT sidecar only.
    new MakerZIP({}, ["win32"]),
  ],
  plugins: [new AutoUnpackNativesPlugin({})],
};

export default config;
