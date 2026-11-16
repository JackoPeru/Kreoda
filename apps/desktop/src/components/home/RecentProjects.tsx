import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { loadRecentProjects, recentProjects } from "../../model/recent-projects";

export function RecentProjects({ onOpen }: {
  onOpen?: (path: string) => Promise<string | null>;
}) {
  const [projects, setProjects] = useState(recentProjects);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void loadRecentProjects().then(list => { if (active) setProjects(list); });
    return () => { active = false; };
  }, []);
  return (
    <section data-testid="home-recent" className="bg-slate-900/75 backdrop-blur-md border border-white/10 rounded-2xl p-4 w-[300px]">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-[var(--kreoda-text-primary)]">Progetti recenti</h2>
        {projects.length > 5 && <button type="button" onClick={() => setExpanded(value => !value)} className="text-sky-400 text-xs hover:text-sky-300 transition-colors">{expanded ? "Mostra meno" : "Vedi tutti →"}</button>}
      </header>
      {projects.length === 0 && <p className="text-xs text-white/50">Nessun progetto salvato o aperto di recente.</p>}
      {error && <p role="alert" className="mb-2 text-xs text-red-300">{error}</p>}
      <ul className="flex flex-col gap-1">
        {(expanded ? projects : projects.slice(0, 5)).map(({ path, openedAt }) => {
          const name = path.split(/[\\/]/).pop() || path;
          return <li key={path}>
            <button type="button" disabled={busy} aria-label={`Apri progetto ${name}`} title={path}
              onClick={() => { if (!onOpen) return; setError(null); setBusy(true);
                void onOpen(path).then(async result => { if (result) setError(result); else setProjects(await loadRecentProjects()); })
                  .catch(e => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false)); }}
              className="w-full flex items-center gap-3 rounded-xl p-2 text-left hover:bg-white/5 transition-colors disabled:opacity-50">
              <FolderOpen size={26} className="shrink-0 text-sky-300" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-[var(--kreoda-text-primary)]">{name}</span>
                <span className="block text-xs text-white/60">{new Date(openedAt).toLocaleDateString("it-IT")}</span>
              </span>
            </button>
          </li>;
        })}
      </ul>
    </section>
  );
}
