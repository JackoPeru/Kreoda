import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let vite;

try {
  const electronExe = createRequire(import.meta.url)("electron");
  vite = await createServer({
    configFile: path.join(desktopRoot, "vite.config.ts"),
    root: desktopRoot,
    server: { host: "127.0.0.1" },
  });
  await vite.listen();
  const url = vite.resolvedUrls?.local[0];
  if (!url) throw new Error("Vite did not report a local URL.");
  vite.printUrls();

  const electron = spawn(electronExe, [path.join(desktopRoot, ".vite", "build", "main.cjs")], {
    cwd: desktopRoot,
    stdio: "inherit",
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    electron.once("error", reject);
    electron.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
} catch (error) {
  console.error("Kreoda dev startup failed:", error);
  process.exitCode = 1;
} finally {
  await vite?.close();
}
