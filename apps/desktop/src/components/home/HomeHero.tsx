export function HomeHero() {
  return (
    <div
      data-testid="home-hero"
      className="flex flex-col items-center text-center select-none"
    >
      <h1 className="sr-only">KREODA</h1>
      {/* The video already carries the visible wordmark and strapline. Keep
          their vertical band so the value proposition stays in place. */}
      <div aria-hidden className="home-hero-lockup-space" />
      <div aria-hidden className="home-hero-tagline-space h-[295px]" />

      <p className="home-hero-primary text-xl text-white">
        Progetta · Visualizza · Realizza
      </p>
      <p className="home-hero-supporting text-sm text-white/60 mt-1">
        Dalla tua idea al mondo reale
      </p>
    </div>
  );
}
