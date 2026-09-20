import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";

// Packaging only — renderer/main/preload are built by `vite build` scripts
// below (Vite 8). Forge makers handle Squirrel/ZIP distribution (§59).
const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // Product identity: installers and executables ship as Kreoda.
    name: "Kreoda",
    // Kreoda mark (apps/desktop/assets/icon.ico + platform siblings).
    icon: "./assets/icon",
    extraResource: ["../../native/kreoda-core/build/Release/kreoda-core.exe"],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ setupIcon: "./assets/icon.ico" }),
    new MakerZIP({}, ["darwin", "linux", "win32"]),
  ],
  plugins: [new AutoUnpackNativesPlugin({})],
};

export default config;
