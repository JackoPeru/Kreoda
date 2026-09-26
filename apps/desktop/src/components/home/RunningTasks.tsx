export function RunningTasks({ onSeeAll }: { onSeeAll?: () => void }) {
  return (
    <div
      data-testid="home-tasks"
      className="bg-slate-900/55 backdrop-blur-xl border border-white/10 rounded-2xl p-4 w-[320px]"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Task in corso</h3>
        <button
          type="button"
          onClick={onSeeAll}
          className="text-xs text-sky-300 hover:text-sky-200 cursor-pointer"
        >
          Vedi tutti →
        </button>
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
            <span className="text-sm text-white/90 truncate flex-1">Render Cucina_Villa_Costa</span>
            <span className="text-[11px] text-white/50">78%</span>
          </div>
          <div className="h-1 rounded bg-white/10 mt-1.5 ml-[18px]">
            <div className="h-1 rounded bg-blue-500" style={{ width: "78%" }} />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
            <span className="text-sm text-white/90 truncate flex-1">AI Generazione Varianti</span>
            <span className="text-[11px] text-white/50">In coda</span>
          </div>
          <div className="h-1 rounded bg-white/10 mt-1.5 ml-[18px]">
            <div className="h-1 rounded bg-green-500" style={{ width: "0%" }} />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-400 shrink-0" />
            <span className="text-sm text-white/90 truncate flex-1">Esportazione DXF</span>
            <span className="text-[11px] text-white/50">In coda</span>
          </div>
          <div className="h-1 rounded bg-white/10 mt-1.5 ml-[18px]">
            <div className="h-1 rounded bg-orange-400" style={{ width: "0%" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
