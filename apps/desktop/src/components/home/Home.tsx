import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "./Home.css";

const VIDEO_URL = `${import.meta.env.BASE_URL}home/assets/reference-home.mp4`;
const POSTER_URL = `${import.meta.env.BASE_URL}home/assets/reference-home-poster.png`;

export function Home({ header, children }: { header: ReactNode; children?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [videoError, setVideoError] = useState(false);

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

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (reducedMotion || videoError) {
      element.pause();
      return;
    }
    void element.play().catch(() => setVideoError(true));
  }, [reducedMotion, videoError]);

  return (
    <div
      ref={root}
      data-testid="home-screen"
      data-video-error={videoError ? "true" : undefined}
      className="home-root"
    >
      <video
        ref={video}
        className="home-background-video"
        data-testid="home-background-video"
        data-reduced-motion={reducedMotion ? "true" : "false"}
        src={VIDEO_URL}
        poster={POSTER_URL}
        muted
        autoPlay={!reducedMotion && !videoError}
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
        onError={() => setVideoError(true)}
      />
      <div aria-hidden className="home-vignette" />
      <div className="home-content">
        {header}
        <div className="home-design">{children}</div>
      </div>
    </div>
  );
}
