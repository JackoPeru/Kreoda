import { ActionOrbit } from "./ActionOrbit";
import { Home } from "./Home";
import { HomeHero } from "./HomeHero";
import { HomeQuote } from "./HomeQuote";
import { HomeTopBar } from "./HomeTopBar";
import { QuickStart } from "./QuickStart";
import { RecentProjects } from "./RecentProjects";
import { RunningTasks } from "./RunningTasks";

export function HomeScreen({
  onEnterWorkspace,
  onOpenRecent,
  onOpenProject,
  onImport,
  onTemplate,
  onDraw,
  onMeasure,
  onExport,
  onSettings,
}: {
  onEnterWorkspace: () => void;
  onOpenRecent?: (path: string) => Promise<string | null>;
  onOpenProject?: () => void;
  onImport?: () => void;
  onTemplate?: () => void;
  onDraw?: () => void;
  onMeasure?: () => void;
  onExport?: () => void;
  onSettings?: () => void;
}) {
  const navigate = (key: string): void => {
    if (key === "home") return;
    if (key === "progetti" || key === "modelli") {
      onOpenProject?.();
      return;
    }
    if (key === "export") {
      onExport?.();
      return;
    }
    if (key === "impostazioni") {
      onSettings?.();
      return;
    }
    onEnterWorkspace();
  };
  const action = (key: string): void => {
    if (key === "draw") {
      onDraw?.();
      return;
    }
    if (key === "measure") {
      onMeasure?.();
      return;
    }
    if (key === "render") {
      onExport?.();
      return;
    }
    onEnterWorkspace();
  };
  return (
    <Home header={<HomeTopBar onNavigate={navigate} />}>
      <main className="home-layout">
        <div className="home-recent-slot">
          <RecentProjects onOpen={onOpenRecent} />
        </div>
        <div className="home-hero-slot"><HomeHero /></div>
        <div className="home-quick-slot">
          <QuickStart
            onNew={onEnterWorkspace}
            onImport={onImport ?? onEnterWorkspace}
            onTemplate={onTemplate ?? onEnterWorkspace}
            onAI={onEnterWorkspace}
          />
        </div>
        <div className="home-orbit-slot"><ActionOrbit onAction={action} /></div>
        <div className="home-quote-slot"><HomeQuote /></div>
        <div className="home-tasks-slot"><RunningTasks onSeeAll={onEnterWorkspace} /></div>
      </main>
    </Home>
  );
}
