import { ActionOrbit } from "./ActionOrbit";
import { Home } from "./Home";
import { HomeHero } from "./HomeHero";
import { HomeQuote } from "./HomeQuote";
import { HomeTopBar } from "./HomeTopBar";
import { QuickStart } from "./QuickStart";
import { RecentProjects } from "./RecentProjects";
import { RunningTasks } from "./RunningTasks";

export function HomeScreen({ onEnterWorkspace }: { onEnterWorkspace: () => void }) {
  return (
    <Home header={<HomeTopBar onNavigate={(key) => {
        if (key !== "home") onEnterWorkspace();
      }} />}>
      <main className="home-layout">
        <div className="home-recent-slot">
          <RecentProjects onOpen={onEnterWorkspace} onSeeAll={onEnterWorkspace} />
        </div>
        <div className="home-hero-slot"><HomeHero /></div>
        <div className="home-quick-slot">
          <QuickStart
            onNew={onEnterWorkspace}
            onImport={onEnterWorkspace}
            onTemplate={onEnterWorkspace}
            onAI={onEnterWorkspace}
          />
        </div>
        <div className="home-orbit-slot"><ActionOrbit onAction={onEnterWorkspace} /></div>
        <div className="home-quote-slot"><HomeQuote /></div>
        <div className="home-tasks-slot"><RunningTasks onSeeAll={onEnterWorkspace} /></div>
      </main>
    </Home>
  );
}
