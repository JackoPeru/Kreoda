import { FolderUp, LayoutGrid, Plus, Sparkles } from "lucide-react";

type Props = {
  onNew?: () => void;
  onImport?: () => void;
  onTemplate?: () => void;
  onAI?: () => void;
};

export function QuickStart({ onNew, onImport, onTemplate, onAI }: Props) {
  return (
    <div
      data-testid="home-quickstart"
      className="bg-slate-900/55 backdrop-blur-xl border border-white/10 rounded-2xl p-4 w-[320px]"
    >
      <h3 className="text-sm font-semibold text-white mb-3">Inizia da qui</h3>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          data-testid="home-new-project"
          onClick={onNew}
          className="rounded-xl border border-sky-400/20 bg-sky-950/20 hover:bg-sky-900/30 p-4 flex flex-col items-center gap-1 text-center cursor-pointer transition-colors"
        >
          <span className="w-10 h-10 rounded-lg bg-sky-500/20 flex items-center justify-center">
            <Plus className="w-5 h-5 text-sky-300" />
          </span>
          <span className="text-sm font-semibold text-white">Nuovo Progetto</span>
          <span className="text-[11px] text-white/50">Parti da zero</span>
        </button>
        <button
          type="button"
          data-testid="home-import"
          onClick={onImport}
          className="rounded-xl border border-sky-400/20 bg-sky-950/20 hover:bg-sky-900/30 p-4 flex flex-col items-center gap-1 text-center cursor-pointer transition-colors"
        >
          <span className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <FolderUp className="w-5 h-5 text-emerald-300" />
          </span>
          <span className="text-sm font-semibold text-white">Importa</span>
          <span className="text-[11px] text-white/50">File 3D, CAD, immagini</span>
        </button>
        <button
          type="button"
          data-testid="home-template"
          onClick={onTemplate}
          className="rounded-xl border border-sky-400/20 bg-sky-950/20 hover:bg-sky-900/30 p-4 flex flex-col items-center gap-1 text-center cursor-pointer transition-colors"
        >
          <span className="w-10 h-10 rounded-lg bg-sky-500/20 flex items-center justify-center">
            <LayoutGrid className="w-5 h-5 text-sky-300" />
          </span>
          <span className="text-sm font-semibold text-white">Template</span>
          <span className="text-[11px] text-white/50">Scene pronte</span>
        </button>
        <button
          type="button"
          data-testid="home-ai"
          onClick={onAI}
          className="rounded-xl border border-sky-400/20 bg-sky-950/20 hover:bg-sky-900/30 p-4 flex flex-col items-center gap-1 text-center cursor-pointer transition-colors"
        >
          <span className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-violet-300" />
          </span>
          <span className="text-sm font-semibold text-white">AI Assistant</span>
          <span className="text-[11px] text-white/50">Trasforma le idee in modelli</span>
        </button>
      </div>
    </div>
  );
}
