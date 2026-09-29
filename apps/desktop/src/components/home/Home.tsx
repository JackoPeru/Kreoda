import { Suspense, lazy, useLayoutEffect, useRef, type ReactNode } from "react";
import "./Home.css";

// The 3D lounge pulls three + addons (≈500 KiB): deferred so the home chrome
// paints on the initial bundle, the lounge fades in when its chunk lands.
const HomeScene3D = lazy(() =>
  import("./HomeScene3D").then((m) => ({ default: m.HomeScene3D })),
);

export function Home({ header, children }: { header: ReactNode; children?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const fit = (): void => {
      const scale = window.innerWidth <= 980
        ? 1
        : Math.min(window.innerWidth / 1536, window.innerHeight / 1024);
      root.current?.style.setProperty("--home-scale", String(scale));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  return (
    <div ref={root} data-testid="home-screen" className="home-root">
      <Suspense fallback={null}>
        <HomeScene3D />
      </Suspense>
      <div aria-hidden className="home-vignette" />
      <div className="home-content">
        {header}
        <div className="home-design">{children}</div>
      </div>
    </div>
  );
}
