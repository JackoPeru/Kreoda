import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const targetFramework = "netstandard2.1";
const configuration = "Release";
const projectFiles = [
  ["Kreoda.Protocol", "packages/protocol/csharp/Kreoda.Protocol.csproj"],
  ["Kreoda.SessionClient", "clients/session-dotnet/src/Kreoda.SessionClient/Kreoda.SessionClient.csproj"],
  ["Kreoda.QuestFoundation", "clients/session-dotnet/src/Kreoda.QuestFoundation/Kreoda.QuestFoundation.csproj"],
];
const unityProvided = new Set([
  "system.memory.dll",
  "system.buffers.dll",
  "system.numerics.vectors.dll",
  "system.threading.tasks.extensions.dll",
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function outputArgument() {
  const index = process.argv.indexOf("--output");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || !isAbsolute(value)) {
    fail("Usage: node scripts/build-quest-managed.mjs --output <absolute-empty-destination>");
  }
  const destination = resolve(value);
  if (existsSync(destination)) fail("Output already exists: " + destination);
  return destination;
}

function dotnet(args, capture = false) {
  const result = spawnSync("dotnet", args, {
    cwd: repo,
    windowsHide: true,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture) {
      process.stderr.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    throw new Error("dotnet " + args.join(" ") + " failed with exit " + (result.status ?? "unknown"));
  }
  return capture ? (result.stdout ?? "").trim() : "";
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function targetPath(projectFile) {
  const value = dotnet([
    "msbuild",
    projectFile,
    "-getProperty:TargetPath",
    "-p:TargetFramework=" + targetFramework,
    "-p:Configuration=" + configuration,
    "--nologo",
  ], true);
  if (!value || !existsSync(value)) throw new Error("MSBuild TargetPath is missing: " + projectFile);
  return value;
}

function packageAssets(projectName, projectFile) {
  const assetsPath = join(repo, dirname(projectFile), "obj", "project.assets.json");
  const assets = JSON.parse(readFileSync(assetsPath, "utf8"));
  const target = assets.targets[targetFramework];
  if (!target) throw new Error(projectName + " assets lack " + targetFramework + ": " + assetsPath);

  const packageGraph = [];
  const assemblies = [];
  const excluded = [];
  for (const [libraryKey, entry] of Object.entries(target)) {
    if (entry.type !== "package") continue;
    const library = assets.libraries[libraryKey];
    if (!library?.path) throw new Error("Missing package path in MSBuild assets: " + libraryKey);
    const [id, version] = libraryKey.split("/");
    const runtimeAssets = Object.keys(entry.runtime ?? {}).filter(asset => asset.toLowerCase().endsWith(".dll"));
    packageGraph.push({ id, version, runtimeAssets: runtimeAssets.sort() });

    for (const asset of runtimeAssets) {
      const fileName = basename(asset);
      const source = Object.keys(assets.packageFolders)
        .map(folder => resolve(folder, library.path, asset))
        .find(existsSync);
      if (!source) throw new Error("MSBuild runtime asset not found: " + libraryKey + "/" + asset);
      const item = {
        fileName,
        source,
        origin: "nuget:" + libraryKey + "/" + asset.replaceAll("\\", "/"),
      };
      if (unityProvided.has(fileName.toLowerCase())) {
        excluded.push({ library: libraryKey, asset, reason: "Unity-provided BCL assembly" });
      } else {
        assemblies.push(item);
      }
    }
  }

  packageGraph.sort((a, b) => a.id.localeCompare(b.id));
  return { packageGraph, assemblies, excluded };
}

function pluginMeta(fileName) {
  const guid = createHash("sha256").update("kreoda-managed-plugin:" + fileName.toLowerCase()).digest("hex").slice(0, 32);
  return [
    "fileFormatVersion: 2",
    "guid: " + guid,
    "PluginImporter:",
    "  externalObjects: {}",
    "  serializedVersion: 2",
    "  iconMap: {}",
    "  executionOrder: {}",
    "  defineConstraints: []",
    "  isPreloaded: 0",
    "  isOverridable: 0",
    "  isExplicitlyReferenced: 0",
    "  validateReferences: 1",
    "  platformData:",
    "  - first:",
    "      Any:",
    "    second:",
    "      enabled: 0",
    "      settings: {}",
    "  - first:",
    "      Editor: Editor",
    "    second:",
    "      enabled: 1",
    "      settings:",
    "        DefaultValueInitialized: true",
    "        CPU: AnyCPU",
    "  - first:",
    "      Android: Android",
    "    second:",
    "      enabled: 1",
    "      settings:",
    "        CPU: ARM64",
    "  userData:",
    "  assetBundleName:",
    "  assetBundleVariant:",
    "",
  ].join("\n");
}

function main() {
  const destination = outputArgument();
  const projects = projectFiles.map(([name, file]) => ({ name, file }));
  for (const project of projects) {
    dotnet(["build", project.file, "-c", configuration, "-f", targetFramework, "--nologo", "--verbosity", "minimal"]);
  }

  const coreAssemblies = projects.map(project => {
    const source = targetPath(project.file);
    return {
      fileName: basename(source),
      source,
      origin: "msbuild:" + relative(repo, source).replaceAll("\\", "/"),
    };
  });
  const packageGraphs = projects.map(project => ({
    project: project.name,
    ...packageAssets(project.name, project.file),
  }));
  const explicitVersions = new Map(packageGraphs.flatMap(graph => graph.packageGraph.map(item => [item.id, item.version])));
  for (const [id, version] of [["Google.FlatBuffers", "25.2.10"], ["System.Text.Json", "8.0.6"]]) {
    if (explicitVersions.get(id) !== version) throw new Error("Expected pinned " + id + " " + version + ", found " + (explicitVersions.get(id) ?? "missing"));
  }

  const candidates = [...coreAssemblies, ...packageGraphs.flatMap(graph => graph.assemblies)];
  const byName = new Map();
  for (const item of candidates) {
    const key = item.fileName.toLowerCase();
    const existing = byName.get(key);
    if (existing && sha256(existing.source) !== sha256(item.source)) {
      throw new Error("Different runtime assemblies share a filename: " + item.fileName);
    }
    if (!existing) byName.set(key, item);
  }
  const assemblies = [...byName.values()].sort((a, b) => a.fileName.localeCompare(b.fileName));
  for (const required of ["Kreoda.Protocol.dll", "Kreoda.SessionClient.dll", "Kreoda.QuestFoundation.dll"]) {
    if (!byName.has(required.toLowerCase())) throw new Error("Missing product assembly: " + required);
  }
  for (const excludedName of unityProvided) {
    if (byName.has(excludedName)) throw new Error("Unity-provided assembly must not be staged: " + excludedName);
  }

  const destinationParent = dirname(destination);
  mkdirSync(destinationParent, { recursive: true });
  const temporary = mkdtempSync(join(destinationParent, "." + basename(destination) + ".tmp-"));
  try {
    const linkSource = join(repo, "clients/session-dotnet/unity/link.xml");
    const linkDestination = join(temporary, "link.xml");
    copyFileSync(linkSource, linkDestination);

    for (const item of assemblies) {
      const output = join(temporary, item.fileName);
      copyFileSync(item.source, output);
      writeFileSync(output + ".meta", pluginMeta(item.fileName), "utf8");
    }

    const files = [
      ...assemblies.flatMap(item => [
        { file: item.fileName, sha256: sha256(join(temporary, item.fileName)), origin: item.origin },
        { file: item.fileName + ".meta", sha256: sha256(join(temporary, item.fileName + ".meta")), origin: "generated Unity PluginImporter settings" },
      ]),
      { file: "link.xml", sha256: sha256(linkDestination), origin: "clients/session-dotnet/unity/link.xml" },
    ].sort((a, b) => a.file.localeCompare(b.file));
    const manifest = {
      targetFramework,
      configuration,
      packageGraph: packageGraphs.map(({ project, packageGraph }) => ({ project, packages: packageGraph })),
      excludedUnityProvidedAssemblies: packageGraphs.flatMap(graph =>
        graph.excluded.map(item => ({ project: graph.project, ...item }))),
      files,
    };
    writeFileSync(join(temporary, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
    renameSync(temporary, destination);
    process.stdout.write("Staged " + assemblies.length + " managed DLLs at " + destination + "\n");
    process.stdout.write("Excluded " + manifest.excludedUnityProvidedAssemblies.length + " Unity-provided BCL DLLs; wrote SHA-256 manifest.json\n");
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}


