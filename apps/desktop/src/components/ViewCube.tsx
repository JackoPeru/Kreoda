import { viewportSetView, type ViewName } from "../viewport/viewportHandle";
import { useT, type EnKey } from "../i18n";

/** Screen-space view cube (§23): preset views, no Euler angles exposed. */
export function ViewCube() {
  const t = useT();
  const faces: { name: ViewName; label: string; title: EnKey }[] = [
    { name: "top", label: "T", title: "cube.top" },
    { name: "front", label: "F", title: "cube.front" },
    { name: "right", label: "R", title: "cube.right" },
    { name: "iso", label: "⌂", title: "cube.iso" },
  ];
  return (
    <div
      className="pointer-events-auto absolute right-3 top-[68px] flex flex-col gap-1 rounded-md bg-black/60 p-1"
      data-testid="view-cube"
    >
      {faces.map((f) => (
        <button
          key={f.name}
          title={t(f.title)}
          aria-label={t(f.title)}
          onClick={() => viewportSetView(f.name)}
          className="h-7 w-7 rounded text-xs text-white/80 hover:bg-white/15 hover:text-white"
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
