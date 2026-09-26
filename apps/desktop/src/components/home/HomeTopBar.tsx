import { useEffect, useState } from "react";
import {
  Atom,
  Box,
  ChevronDown,
  Folder,
  Flower2,
  Home,
  Settings,
} from "lucide-react";

function RenderGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

const ITEMS = [
  { key: "home", label: "Home", Icon: Home },
  { key: "progetti", label: "Progetti", Icon: Folder },
  { key: "modelli", label: "Modelli", Icon: Flower2 },
  { key: "materiali", label: "Materiali", Icon: Box },
  { key: "render", label: "Render", Icon: RenderGlyph },
  { key: "ai", label: "AI", Icon: Atom },
  { key: "impostazioni", label: "Impostazioni", Icon: Settings },
];

export function HomeTopBar({ onNavigate }: { onNavigate?: (key: string) => void }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const time = new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit", minute: "2-digit",
  }).format(now);
  const date = new Intl.DateTimeFormat("it-IT", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  }).format(now);

  return (
    <header
      data-testid="home-topbar"
      className="relative z-10 flex items-center justify-between px-5 py-3"
    >
      <div className="flex items-center gap-5">
        <svg aria-hidden="true" className="size-8 shrink-0" viewBox="0 0 32 34" fill="none">
          <path d="M3 2C3 1 4 0 5 0H9V34H5C4 34 3 33 3 32V2Z" fill="#DDE6FF" />
          <path d="M12 14L24 0H31L17 18L12 14Z" fill="#9BC2FF" />
          <path d="M12 20L17 16L31 34H24L12 20Z" fill="#A8AAFF" />
        </svg>
        <span className="leading-tight">
          <span className="block text-lg font-semibold tracking-[0.25em] text-white">
            KREODA
          </span>
          <span className="block text-[10px] tracking-[0.15em] text-white/50">
            IDEAS INTO REALITY
          </span>
        </span>
      </div>

      <nav className="flex items-center gap-7" aria-label="Navigazione principale">
        {ITEMS.map(({ key, label, Icon }) => {
          const active = key === "home";
          return (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate?.(key)}
              className={`relative flex flex-col items-center gap-1 pb-1.5 text-xs transition-colors ${
                active ? "text-white" : "text-white/60 hover:text-white/90"
              }`}
            >
              <Icon className={`size-[20px] ${active ? "text-blue-400" : ""}`} fill={active ? "currentColor" : "none"} />
              {label}
              {active && (
                <span className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-blue-500" />
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center gap-4">
        <div className="text-right leading-tight">
          <div className="text-2xl font-medium text-white">{time}</div>
          <div className="text-[11px] text-white/60 capitalize">{date}</div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate?.("profilo")}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pl-1 pr-2.5 backdrop-blur-md"
        >
          <span className="grid size-7 place-items-center rounded-full bg-slate-600 text-sm font-semibold text-white">
            M
          </span>
          <span className="text-xs text-white/80">
            Ciao, <span className="font-semibold text-white">Matteo</span>
          </span>
          <ChevronDown className="size-4 text-white/60" />
        </button>
      </div>
    </header>
  );
}
