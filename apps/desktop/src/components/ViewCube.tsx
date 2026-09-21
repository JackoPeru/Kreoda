import { viewportSetView, type ViewName } from "../viewport/viewportHandle";

/** Screen-space view cube (§23): preset views, no Euler angles exposed. */
export function ViewCube() {
  const faces: { name: ViewName; label: string; title: string }[] = [
    { name: "top", label: "T", title: "Top view" },
    { name: "front", label: "F", title: "Front view" },
    { name: "right", label: "R", title: "Right view" },
    { name: "iso", label: "⌂", title: "Isometric view" },
  ];
  return (
    <div
      className="pointer-events-auto absolute right-3 top-[68px] flex flex-col gap-1 rounded-md bg-black/60 p-1"
      data-testid="view-cube"
    >
      {faces.map((f) => (
        <button
          key={f.name}
          title={f.title}
          aria-label={f.title}
          onClick={() => viewportSetView(f.name)}
          className="h-7 w-7 rounded text-xs text-white/80 hover:bg-white/15 hover:text-white"
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
