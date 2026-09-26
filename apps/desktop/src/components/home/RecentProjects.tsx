import { MoreHorizontal } from "lucide-react";

type Project = {
  name: string;
  date: string;
};

const PROJECTS: Project[] = [
  { name: "Cucina_Villa_Costa", date: "21 Set 2026" },
  { name: "Top_Bagno_Rossi", date: "19 Set 2026" },
  { name: "Scale_Moderne", date: "17 Set 2026" },
  { name: "Rivestimento_Hotel", date: "15 Set 2026" },
  { name: "Camino_Pietra", date: "12 Set 2026" },
];
const thumbnails = new URL("home/assets/project-thumbnails.png", document.baseURI).href;

export function RecentProjects({
  onOpen,
  onSeeAll,
}: {
  onOpen?: (name: string) => void;
  onSeeAll?: () => void;
}) {
  return (
    <section
      data-testid="home-recent"
      className="bg-slate-900/55 backdrop-blur-xl border border-white/10 rounded-2xl p-4 w-[300px]"
    >
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-[#e6ebf2]">Progetti recenti</h2>
        <button
          type="button"
          onClick={onSeeAll}
          className="text-sky-400 text-xs hover:text-sky-300 transition-colors"
        >
          Vedi tutti &rarr;
        </button>
      </header>
      <ul className="flex flex-col gap-1">
        {PROJECTS.map(({ name, date }, index) => (
          <li key={name}>
            <button
              type="button"
              aria-label={`Apri progetto ${name.replaceAll("_", " ")}`}
              onClick={() => onOpen?.(name)}
              className="w-full flex items-center gap-3 rounded-xl p-1 text-left hover:bg-white/5 transition-colors"
            >
              <span className="relative h-14 w-[88px] shrink-0 overflow-hidden rounded-lg border border-white/15">
                <img
                  src={thumbnails}
                  alt=""
                  draggable={false}
                  className="absolute top-1/2 max-w-none -translate-y-1/2"
                  style={{ width: "500%", left: `-${index * 100}%` }}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-[#e6ebf2]">
                  {name}
                </span>
                <span className="block text-xs text-white/60">{date}</span>
              </span>
              <MoreHorizontal size={16} className="shrink-0 text-white/80" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
