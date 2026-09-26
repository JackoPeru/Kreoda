export function HomeHero() {
  return (
    <div
      data-testid="home-hero"
      className="flex flex-col items-center text-center select-none"
    >
      <h1 className="tracking-[0.35em] text-white/90 text-2xl font-semibold pl-[0.35em]">
        KREODA
      </h1>
      <p className="tracking-[0.25em] text-xs text-white/60 mt-1 pl-[0.25em]">
        IDEAS INTO REALITY
      </p>

      {/* Spacer reserving the 3D marble K band (HomeScene3D): the tagline
          below lands on the dark rock front, like the reference. */}
      <div aria-hidden className="h-[295px]" />

      <p className="text-xl text-white">Progetta · Visualizza · Realizza</p>
      <p className="text-sm text-white/60 mt-1">
        Dalla tua idea al mondo reale
      </p>
    </div>
  );
}
