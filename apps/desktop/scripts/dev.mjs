// Dev launcher: starts `vite` (renderer, :5173) then Electron with the
// VITE_DEV_SERVER_URL env var. No Node in the renderer (§48) — this script
// runs in the developer's shell only.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
// .cmd shims need a shell on Windows (spawn EINVAL otherwise).
const shell = process.platform === "win32";
const viteBin = path.join(root, "..", "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
const electronBin = path.join(root, "..", "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");

const vite = spawn(viteBin, [], { cwd: root, stdio: "inherit", shell });
vite.on("error", (e) => {
  console.error("failed to start vite", e);
  process.exit(1);
});

// Give vite a moment to bind :5173, then launch Electron.
setTimeout(() => {
  const electron = spawn(
    electronBin,
    [".vite/build/main.cjs"],
    {
      cwd: root,
      stdio: "inherit",
      shell,
      env: { ...process.env, VITE_DEV_SERVER_URL: "http://localhost:5173" },
    },
  );
  electron.on("exit", (code) => {
    vite.kill();
    process.exit(code ?? 0);
  });
}, 3500);
