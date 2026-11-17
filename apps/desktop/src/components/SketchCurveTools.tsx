import { useT } from "../i18n";

export type SketchCurveTool = "ellipse" | "ellipticalArc" | "controlSpline" | "interpolatingSpline";

export function SketchCurveTools({
  activeTool,
  onToolChange,
  onRectangle,
  onClear,
  disabled,
  closed,
  onClosedChange,
  minorRadius,
  onMinorRadiusChange,
  startAngle,
  onStartAngleChange,
  sweepAngle,
  onSweepAngleChange,
  hint,
  pointCount,
  canFinish,
  onFinish,
  onCancel,
}: {
  activeTool: SketchCurveTool | null;
  onToolChange: (tool: SketchCurveTool) => void;
  onRectangle: () => void;
  onClear: () => void;
  disabled: boolean;
  closed: boolean;
  onClosedChange: (closed: boolean) => void;
  minorRadius: string;
  onMinorRadiusChange: (value: string) => void;
  startAngle: string;
  onStartAngleChange: (value: string) => void;
  sweepAngle: string;
  onSweepAngleChange: (value: string) => void;
  hint: string;
  pointCount: number;
  canFinish: boolean;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const tt = useT();
  const tools: { id: SketchCurveTool; label: string }[] = [
    { id: "ellipse", label: tt("sketch.curve.ellipse") },
    { id: "ellipticalArc", label: tt("sketch.curve.ellipticalArc") },
    { id: "controlSpline", label: tt("sketch.curve.controlSpline") },
    { id: "interpolatingSpline", label: tt("sketch.curve.interpolatingSpline") },
  ];

  return (
    <section data-testid="sketch-curve-tools" className="mb-2 rounded bg-white/5 p-2 text-xs">
      <div className="mb-1 text-[11px] uppercase tracking-wide text-white/45">{tt("sketch.curve.tools")}</div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={tt("sketch.curve.tools")}>
        {tools.map((tool) => (
          <button key={tool.id} type="button" disabled={disabled}
            aria-pressed={activeTool === tool.id} onClick={() => onToolChange(tool.id)}
            className="rounded bg-slate-700 px-2 py-1 disabled:opacity-40">
            {tool.label}
          </button>
        ))}
        <button type="button" disabled={disabled} onClick={onRectangle}
          className="rounded bg-slate-700 px-2 py-1 disabled:opacity-40">{tt("sketch.curve.rectangle")}</button>
        <button type="button" disabled={disabled} onClick={onClear}
          className="rounded bg-slate-700 px-2 py-1 disabled:opacity-40">{tt("sketch.curve.clear")}</button>
      </div>
      {activeTool && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          {(activeTool === "ellipse" || activeTool === "ellipticalArc") && (
            <>
              <label className="grid gap-1 text-white/60">{tt("sketch.curve.minorRadius")}
                <input aria-label={tt("sketch.curve.minorRadius")} inputMode="decimal" type="number" step="any"
                  value={minorRadius} onChange={(event) => onMinorRadiusChange(event.target.value)}
                  className="w-20 bg-slate-900 p-1 text-white" />
              </label>
              {activeTool === "ellipticalArc" && <>
                <label className="grid gap-1 text-white/60">{tt("sketch.curve.startAngle")}
                  <input aria-label={tt("sketch.curve.startAngle")} inputMode="decimal" type="number" step="any"
                    value={startAngle} onChange={(event) => onStartAngleChange(event.target.value)}
                    className="w-20 bg-slate-900 p-1 text-white" />
                </label>
                <label className="grid gap-1 text-white/60">{tt("sketch.curve.sweepAngle")}
                  <input aria-label={tt("sketch.curve.sweepAngle")} inputMode="decimal" type="number" step="any"
                    value={sweepAngle} onChange={(event) => onSweepAngleChange(event.target.value)}
                    className="w-20 bg-slate-900 p-1 text-white" />
                </label>
              </>}
            </>
          )}
          {(activeTool === "controlSpline" || activeTool === "interpolatingSpline") && (
            <label className="flex items-center gap-1 text-white/70">
              <input aria-label={tt("sketch.curve.closed")} type="checkbox" checked={closed}
                onChange={(event) => onClosedChange(event.target.checked)} />
              {tt("sketch.curve.closed")}
            </label>
          )}
          <span className="flex-1 text-white/55" aria-live="polite">{hint}</span>
          {(activeTool === "controlSpline" || activeTool === "interpolatingSpline") && (
            <>
              <span aria-label={tt("sketch.curve.pointCount")}>{pointCount}/256</span>
              <button type="button" disabled={disabled || !canFinish} onClick={onFinish}
                className="rounded bg-emerald-700 px-2 py-1 disabled:opacity-40">{tt("sketch.curve.finish")}</button>
            </>
          )}
          <button type="button" disabled={disabled} onClick={onCancel}
            className="rounded bg-slate-700 px-2 py-1 disabled:opacity-40">{tt("sketch.curve.cancel")}</button>
        </div>
      )}
    </section>
  );
}
