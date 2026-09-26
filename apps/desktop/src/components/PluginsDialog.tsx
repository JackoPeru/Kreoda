// Plugins dialog (§47): installed sandboxed plugins, their commands,
// JSON params entry + run. Errors surface inline, never silently.
import { useState } from "react";
import { runPluginCommand, usePluginStore } from "../plugins/loader";
import { t, useT } from "../i18n";

export function PluginsDialog({ onClose }: { onClose: () => void }) {
  const plugins = usePluginStore((s) => s.plugins);
  const [paramsText, setParamsText] = useState("{}");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tt = useT();

  const run = async (pluginId: string, commandId: string): Promise<void> => {
    setStatus(null);
    setError(null);
    let params: unknown = {};
    try {
      params = JSON.parse(paramsText);
    } catch {
      setError(tt("plugins.errJson"));
      return;
    }
    try {
      const result = await runPluginCommand(pluginId, commandId, params);
      setStatus(tt("plugins.done", { r: JSON.stringify(result ?? null).slice(0, 200) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("plugins.errFailed"));
    }
  };

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60"
      data-testid="plugins-dialog"
    >
      <div className="w-[26rem] max-w-[90vw] rounded-xl border border-white/15 bg-[#141922] p-5 shadow-2xl">
        <div className="pb-2 text-sm font-semibold">{tt("plugins.title")}</div>
        {plugins.length === 0 && (
          <div className="pb-2 text-xs text-white/50">
            {tt("plugins.empty")}
          </div>
        )}
        {plugins.map((p) => (
          <div key={p.manifest.id} className="border-t border-white/10 py-2">
            <div className="text-xs font-medium text-white/85">
              {p.manifest.label}{" "}
              <span className="font-mono text-white/40">
                {p.manifest.id} · {p.manifest.version}
              </span>
            </div>
            {p.manifest.commands.map((c) => (
              <div key={c.id} className="flex items-center gap-2 pt-1.5">
                <span className="flex-1 text-xs text-white/70">{c.label}</span>
                <button
                  onClick={() => void run(p.manifest.id, c.id)}
                  className="rounded-md bg-white/10 px-2 py-0.5 text-xs hover:bg-white/15"
                >
                  {tt("plugins.run")}
                </button>
              </div>
            ))}
          </div>
        ))}
        <div className="pt-2">
          <div className="pb-1 text-[11px] text-white/45">
            {tt("plugins.params")}
          </div>
          <textarea
            value={paramsText}
            onChange={(e) => setParamsText(e.target.value)}
            rows={3}
            spellCheck={false}
            className="w-full rounded-md bg-white/5 px-2 py-1 font-mono text-xs outline-none focus:bg-white/10"
            data-testid="plugins-params"
          />
        </div>
        {status && <div className="pt-2 text-xs text-white/60">{status}</div>}
        {error && <div className="pt-2 text-xs text-red-300">{error}</div>}
        <button
          onClick={onClose}
          className="mt-3 rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
        >
          {tt("common.close")}
        </button>
      </div>
    </div>
  );
}
