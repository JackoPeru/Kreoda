// @kreoda/plugin-sdk — sandboxed JS plugins (§47).
// V1: no native loading, no fs/network capabilities. A plugin is a JS
// source string run inside a Web Worker with NOTHING global except the
// `kreoda` bridge object (see renderer loader for the shim). Plugins
// register commands that run plugin code and may invoke an allowlisted
// subset of typed core commands — every call goes through the central
// executeCommand path with availability gates intact.
//
// Plugin source contract:
/// kreoda.register({ id: "plugin.<author>.<name>", version: "0.1.0",
///   label: "...", capabilities: [], commands: [
///     { id: "plugin.<author>.<name>.pair", label: "Two boxes",
///       allowedCoreCommands: ["CreateBox"] }] });
/// kreoda.onCommand("plugin.<author>.<name>.pair", async (params) => {
///   await kreoda.invoke("CreateBox", { featureId: ..., ... });
///   return { made: 2 };
/// });

export interface PluginCommandDef {
  id: string;
  label: string;
  allowedCoreCommands: string[];
}

export interface PluginManifest {
  id: string;
  version: string;
  label: string;
  /** Granted capabilities. V1 supports none — must be []. */
  capabilities: string[];
  commands: PluginCommandDef[];
}

const ID_RE = /^plugin\.[a-z0-9]+(\.[a-z0-9]+)+$/;
const COMMAND_ID_RE = /^plugin\.[a-z0-9]+(\.[a-z0-9]+){2,}$/;
const VER_RE = /^\d+\.\d+\.\d+$/;

function fail(what: string): never {
  throw new Error(`bad plugin manifest: ${what}`);
}

/** Validate an unknown manifest object. Throws honestly on any deviation. */
export function validateManifest(raw: unknown): PluginManifest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail("manifest must be an object");
  }
  const o = raw as Record<string, unknown>;
  if (typeof o["id"] !== "string" || !ID_RE.test(o["id"])) {
    fail('id must look like "plugin.<author>.<name>" (lowercase)');
  }
  const id = o["id"] as string;
  if (typeof o["version"] !== "string" || !VER_RE.test(o["version"])) {
    fail('version must look like "0.1.0"');
  }
  if (typeof o["label"] !== "string" || o["label"].length === 0) {
    fail("label must be a non-empty string");
  }
  // M9: unbounded labels bloat the store + PluginsDialog — cap length.
  if ((o["label"] as string).length > 200) {
    fail("label must be ≤ 200 chars");
  }
  if (!Array.isArray(o["capabilities"])) fail("capabilities must be an array");
  for (const c of o["capabilities"] as unknown[]) {
    if (typeof c !== "string") fail("capabilities must be strings");
  }
  if ((o["capabilities"] as string[]).length > 0) {
    fail("no capabilities granted in V1 (fs/network unavailable to plugins)");
  }
  if (!Array.isArray(o["commands"]) || o["commands"].length === 0) {
    fail("commands must be a non-empty array");
  }
  const seen = new Set<string>();
  const commands: PluginCommandDef[] = [];
  for (const c of o["commands"] as unknown[]) {
    if (typeof c !== "object" || c === null || Array.isArray(c)) {
      fail("each command must be an object");
    }
    const co = c as Record<string, unknown>;
    // M9: suffix must be charset-clean, not just prefixed (prefix-only lets
    // "plugin.a.b.EVIL space" through). Full shape: plugin.<a>.<b>.<suffix…>.
    if (typeof co["id"] !== "string" || !COMMAND_ID_RE.test(co["id"] as string) || !(co["id"] as string).startsWith(id + ".")) {
      fail(`command id must start with "${id}." and look like "${id}.<name>" (lowercase a-z0-9 dots)`);
    }
    if (seen.has(co["id"])) fail(`duplicate command ${co["id"]}`);
    seen.add(co["id"]);
    if (typeof co["label"] !== "string" || co["label"].length === 0 || (co["label"] as string).length > 200) {
      fail("each command needs a label (1–200 chars)");
    }
    if (
      !Array.isArray(co["allowedCoreCommands"]) ||
      co["allowedCoreCommands"].length === 0
    ) {
      fail("each command needs a non-empty allowedCoreCommands list");
    }
    for (const a of co["allowedCoreCommands"] as unknown[]) {
      if (typeof a !== "string" || a.length === 0) {
        fail("allowedCoreCommands must be command-id strings");
      }
    }
    commands.push({
      id: co["id"],
      label: co["label"],
      allowedCoreCommands: [...(co["allowedCoreCommands"] as string[])],
    });
  }
  return {
    id,
    version: o["version"] as string,
    label: o["label"] as string,
    capabilities: [],
    commands,
  };
}
