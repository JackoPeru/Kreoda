export function HomeQuote() {
  return (
    <aside
      data-testid="home-quote"
      className="flex items-center gap-3 bg-slate-900/55 backdrop-blur-xl border border-white/10 rounded-2xl p-3 max-w-[260px]"
    >
      <span className="h-16 w-20 shrink-0 overflow-hidden rounded-lg">
        <img
          src={new URL("home/assets/quote-mountains.png", document.baseURI).href}
          alt=""
          draggable={false}
          className="h-full w-full object-cover"
        />
      </span>
      <p className="text-[13px] italic leading-snug text-[#e6ebf2]">
        &ldquo;Ogni spazio racconta una storia.&rdquo;
      </p>
    </aside>
  );
}
