export function RunningTasks({ onSeeAll }: { onSeeAll?: () => void }) {
  return (
    <div
      data-testid="home-tasks"
      className="bg-slate-900/75 backdrop-blur-md border border-white/10 rounded-2xl p-4 w-[320px] min-h-[190px]"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Task in corso</h3>
        <button
          type="button"
          onClick={onSeeAll}
          className="text-xs text-sky-300 hover:text-sky-200 cursor-pointer"
        >
          Apri workspace →
        </button>
      </div>
      <p data-testid="home-tasks-empty" className="text-xs text-white/50">
        Nessun task in corso.
      </p>
      <p className="mt-2 text-[11px] leading-snug text-white/35">
        Render, export e operazioni lunghe compaiono qui quando avviati dal workspace.
      </p>
    </div>
  );
}
