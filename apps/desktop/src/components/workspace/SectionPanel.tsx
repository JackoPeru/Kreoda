import { useEffect, useMemo, useState } from "react";
import { useDocumentUiStore } from "../../stores";
import { useT } from "../../i18n";
import { createSectionPlane, SECTION_OFFSET_LIMIT_MM } from "../../section/plane";
import { useSectionStore } from "../../section/store";

type Axis = "x" | "y" | "z";
const AXIS_NORMAL: Record<Axis, [number, number, number]> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

export function SectionPanel() {
  const [open, setOpen] = useState(false);
  const t = useT();
  const meshes = useDocumentUiStore((state) => state.meshes);
  const enabled = useSectionStore((state) => state.enabled);
  const initialized = useSectionStore((state) => state.initialized);
  const plane = useSectionStore((state) => state.plane);
  const setEnabled = useSectionStore((state) => state.setEnabled);
  const setPlane = useSectionStore((state) => state.setPlane);
  const reset = useSectionStore((state) => state.reset);
  const [offsetInput, setOffsetInput] = useState(String(plane.offsetMm));

  const bounds = useMemo(() => {
    const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    let found = false;
    for (const mesh of Object.values(meshes)) {
      const box = mesh.bboxMm;
      if (!box || box.length < 6 || mesh.indices.length === 0) continue;
      if (!box.every(Number.isFinite)) continue;
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis]!, box[axis]!);
        max[axis] = Math.max(max[axis]!, box[axis + 3]!);
      }
      found = true;
    }
    return found ? { min, max } : null;
  }, [meshes]);

  useEffect(() => setOffsetInput(String(plane.offsetMm)), [plane.offsetMm]);

  const axis: Axis = plane.normal[0] === 1 ? "x" : plane.normal[1] === 1 ? "y" : "z";
  const midpoint = (value: Axis): number | null => {
    if (!bounds) return null;
    const index = value === "x" ? 0 : value === "y" ? 1 : 2;
    return (bounds.min[index]! + bounds.max[index]!) / 2;
  };
  const changeAxis = (value: Axis): void => {
    const offsetMm = midpoint(value);
    if (offsetMm === null) return;
    const next = createSectionPlane(AXIS_NORMAL[value], offsetMm, plane.inverted);
    if (next) setPlane(next);
  };
  const changeOffset = (raw: string): void => {
    setOffsetInput(raw);
    if (!raw.trim()) return;
    const offsetMm = Number(raw);
    if (!Number.isFinite(offsetMm) || Math.abs(offsetMm) > SECTION_OFFSET_LIMIT_MM) return;
    const next = createSectionPlane(plane.normal, offsetMm, plane.inverted);
    if (next) setPlane(next);
  };
  const resetView = (): void => {
    const offsetMm = midpoint("z");
    const next = offsetMm === null ? null : createSectionPlane([0, 0, 1], offsetMm, false);
    if (next) reset(next);
  };

  return (
    <div className="mt-1 border-t border-white/10 pt-1" data-testid="section-panel">
      <button
        type="button"
        data-testid="section-open"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-sm text-white/85 hover:bg-white/10"
      >
        {t("section.title")}
        <span className="text-[10px] text-white/45">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="space-y-1.5 px-2.5 pb-2 pt-1" data-testid="section-controls">
          <button
            type="button"
            data-testid="section-enable"
            aria-pressed={enabled}
            disabled={!bounds}
            onClick={() => {
              if (!enabled && !initialized) {
                const offsetMm = midpoint("z");
                const initial = offsetMm === null ? null : createSectionPlane([0, 0, 1], offsetMm, false);
                if (!initial) return;
                setPlane(initial);
              }
              setEnabled(!enabled);
            }}
            className="w-full rounded bg-white/10 px-2 py-1 text-left text-xs text-white/85 hover:bg-white/15 disabled:opacity-40"
          >
            {enabled ? t("section.disable") : t("section.enable")}
          </button>
          {!bounds && <p className="text-[11px] leading-snug text-white/45">{t("section.noModel")}</p>}
          <label className="flex items-center justify-between gap-2 text-xs text-white/70">
            {t("section.axis")}
            <select
              data-testid="section-axis"
              aria-label={t("section.axis")}
              value={axis}
              disabled={!enabled}
              onChange={(event) => changeAxis(event.currentTarget.value as Axis)}
              className="rounded border border-white/15 bg-[#171c25] px-1.5 py-1 text-xs text-white disabled:opacity-40"
            >
              <option value="x">X</option><option value="y">Y</option><option value="z">Z</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-white/70">
            {t("section.offset")}
            <input
              data-testid="section-offset"
              aria-label={t("section.offset")}
              type="number"
              min={-SECTION_OFFSET_LIMIT_MM}
              max={SECTION_OFFSET_LIMIT_MM}
              step="0.1"
              value={offsetInput}
              disabled={!enabled}
              onChange={(event) => changeOffset(event.currentTarget.value)}
              onBlur={() => {
                const value = Number(offsetInput);
                if (!offsetInput.trim() || !Number.isFinite(value) || Math.abs(value) > SECTION_OFFSET_LIMIT_MM) {
                  setOffsetInput(String(plane.offsetMm));
                }
              }}
              className="w-24 rounded border border-white/15 bg-[#171c25] px-1.5 py-1 text-right text-xs text-white disabled:opacity-40"
            />
          </label>
          <button
            type="button"
            data-testid="section-invert"
            aria-pressed={plane.inverted}
            disabled={!enabled}
            onClick={() => {
              const next = createSectionPlane(plane.normal, plane.offsetMm, !plane.inverted);
              if (next) setPlane(next);
            }}
            className="w-full rounded px-2 py-1 text-left text-xs text-white/70 hover:bg-white/10 disabled:opacity-40"
          >
            {plane.inverted ? t("section.inverted") : t("section.invert")}
          </button>
          <button
            type="button"
            data-testid="section-reset"
            disabled={!bounds}
            onClick={resetView}
            className="w-full rounded px-2 py-1 text-left text-xs text-white/70 hover:bg-white/10 disabled:opacity-40"
          >
            {t("section.reset")}
          </button>
        </div>
      )}
    </div>
  );
}
