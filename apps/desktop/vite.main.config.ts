import { defineConfig } from "vite";
import { builtinModules } from "node:module";

// Main process: Node runtime. Keep Electron, Node builtins, workspace
// packages external so requires resolve at runtime (no browser shims).
export default defineConfig({
  build: {
    outDir: ".vite/build",
    emptyOutDir: false,
    target: "node22",
    lib: { entry: "electron/main.ts", formats: ["cjs"], fileName: () => "main.cjs" },
    rollupOptions: {
      // Bundle workspace JS (protocol/zod) but keep the host runtime's
      // Electron + Node builtins external — bundling node:path under a
      // browser-like lib target shims it to an empty object. `ws` stays
      // external too: bundling it resolves its browser stub, which throws
      // ("ws does not work in the browser") in the main process.
      external: [
        "electron",
        "ws",
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
  },
});
