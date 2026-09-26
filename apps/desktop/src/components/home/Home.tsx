import { useLayoutEffect, useRef, type ReactNode } from "react";
import { HomeScene3D } from "./HomeScene3D";
import "./Home.css";

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
      <HomeScene3D />
      <div aria-hidden className="home-vignette" />
      <div className="home-content">
        {header}
        <div className="home-design">{children}</div>
      </div>
    </div>
  );
}
