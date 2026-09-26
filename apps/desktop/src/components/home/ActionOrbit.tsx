import { Box, Camera, Eye, PenLine, Ruler } from "lucide-react";

type Props = {
  onAction?: (key: string) => void;
};

const ACTIONS = [
  { key: "draw", label: "Disegna", Icon: PenLine, pos: "left-[58px] top-[32px]" },
  { key: "model", label: "Modella", Icon: Box, pos: "left-1/2 top-0 -translate-x-1/2" },
  { key: "view", label: "Visualizza", Icon: Eye, pos: "right-[54px] top-[32px]" },
  { key: "measure", label: "Misura", Icon: Ruler, pos: "left-0 top-[125px]" },
  { key: "render", label: "Renderizza", Icon: Camera, pos: "right-4 top-[125px]" },
] as const;

export function ActionOrbit({ onAction }: Props) {
  return (
    <div data-testid="home-orbit" className="relative w-[420px] h-[190px]">
      {/* Connector thread (reference: Modella wired to the oval). */}
      <div
        aria-hidden
        className="absolute left-1/2 top-[72px] h-[20px] w-px -translate-x-1/2 bg-gradient-to-b from-sky-400/70 to-sky-400/10"
      />
      <div
        data-testid="home-orbit-center"
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-400/60 bg-sky-950/40 shadow-[0_0_40px_rgba(56,189,248,0.45)] text-sky-300 text-sm px-8 py-4 whitespace-nowrap"
      >
        Cosa vuoi fare oggi?
      </div>

      {ACTIONS.map(({ key, label, Icon, pos }) => (
        <button
          key={key}
          type="button"
          onClick={() => onAction?.(key)}
          className={`absolute ${pos} rounded-2xl bg-slate-900/60 border border-white/10 px-3 py-2 text-xs text-white flex flex-col items-center gap-1 cursor-pointer hover:bg-slate-800/70 transition-colors`}
        >
          <Icon className="w-4 h-4 text-sky-300" />
          {label}
        </button>
      ))}
    </div>
  );
}
