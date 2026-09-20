// @intentcad/plugin-sdk — sandboxed JS plugins (§47).
// V1: no native loading. Plugins register commands/panels/generators and
// invoke only the typed core API. No fs/network unless capability granted.

export interface PluginContext {
  core: {
    invoke<T = unknown>(commandId: string, params: unknown): Promise<T>;
  };
}

export interface PluginCommand {
  id: string;
  label: string;
  execute: (ctx: PluginContext, params: unknown) => Promise<unknown>;
}

const registry = new Map<string, PluginCommand>();

export function registerCommand(cmd: PluginCommand): void {
  if (registry.has(cmd.id)) throw new Error(`duplicate command ${cmd.id}`);
  registry.set(cmd.id, cmd);
}

export function listCommands(): PluginCommand[] {
  return [...registry.values()];
}
