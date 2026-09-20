import { defineConfig } from "vite";

// Preload: runs with Electron externals only; keep output CJS (.cjs) because
// the desktop package is "type": "module".
export default defineConfig({
  build: {
    outDir: ".vite/build",
    emptyOutDir: false,
    lib: { entry: "electron/preload.ts", formats: ["cjs"], fileName: () => "preload.cjs" },
    rollupOptions: { external: ["electron"] },
  },
});
