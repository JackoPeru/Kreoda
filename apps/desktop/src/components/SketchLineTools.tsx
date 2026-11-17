import { useEffect, useMemo, useState } from "react";
import type { SketchModel } from "@kreoda/protocol";
import { useT } from "../i18n";
import { transformSketchLines, trimExtendSketchLine, type SketchLineTransform, type TrimExtendCandidate } from "../model/advanced-sketch";

type Mode = "trim" | "extend" | "mirror" | "pattern";

function newPrefix(kind: string): string {
  return `${kind}-${Math.random().toString(36).slice(2, 8)}`;
}

export function SketchLineTools({
  model,
  selectedLineIds,
  onSelectionChange,
  onTrimPreview,
  onTrim,
  onTransform,
  onActivate,
  onCancel,
  disabled,
}: {
  model: SketchModel | null;
  selectedLineIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onTrimPreview: (candidate: TrimExtendCandidate | null) => void;
  onTrim: (candidate: TrimExtendCandidate) => Promise<boolean>;
  onTransform: (candidate: SketchModel) => Promise<boolean>;
  onActivate: () => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const tt = useT();
  const [mode, setMode] = useState<Mode>("trim");
  const [targetLineId, setTargetLineId] = useState("");
  const [boundaryLineId, setBoundaryLineId] = useState("");
  const [moveStart, setMoveStart] = useState(true);
  const [mirrorAxis, setMirrorAxis] = useState("x");
  const [spacingX, setSpacingX] = useState("10");
  const [spacingY, setSpacingY] = useState("0");
  const [copies, setCopies] = useState("2");
  const [localError, setLocalError] = useState<string | null>(null);

  const lineLabels = useMemo(() => new Map((model?.lines ?? []).map((line, index) => [
    line.id, tt("sketch.lineTools.segment", { n: index + 1 }),
  ])), [model, tt]);
  const trimResult = useMemo(() => {
    if (!model || !targetLineId || !boundaryLineId) return { candidate: null, error: null };
    try {
      return { candidate: trimExtendSketchLine(model, targetLineId, boundaryLineId, moveStart, mode === "extend"), error: null };
    } catch (error) {
      return { candidate: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [model, targetLineId, boundaryLineId, moveStart, mode]);
  const candidate = mode === "trim" || mode === "extend" ? trimResult.candidate : null;

  useEffect(() => { onTrimPreview(candidate); }, [candidate, onTrimPreview]);

  const sources = selectedLineIds.filter(id => model?.lines.some(line => line.id === id));
  const mirrorLineId = mirrorAxis.startsWith("line:") ? mirrorAxis.slice(5) : null;
  const transformSources = sources.filter(id => !(mode === "mirror" && mirrorLineId === id));
  const numericSpacingX = Number(spacingX);
  const numericSpacingY = Number(spacingY);
  const numericCopies = Number(copies);
  const validPattern = spacingX.trim().length > 0 && spacingY.trim().length > 0 &&
    Number.isFinite(numericSpacingX) && Number.isFinite(numericSpacingY) &&
    Number.isInteger(numericCopies) && numericCopies >= 1 && numericCopies <= 64;
  const selectedLabels = transformSources.map(id => lineLabels.get(id)).filter((label): label is string => Boolean(label));
  const axisLabel = mirrorAxis === "x" ? tt("sketch.lineTools.axisX")
    : mirrorAxis === "y" ? tt("sketch.lineTools.axisY")
    : lineLabels.get(mirrorLineId ?? "") ?? tt("sketch.lineTools.axisLine");
  const hasDraft = mode !== "trim" || targetLineId !== "" || boundaryLineId !== "" ||
    selectedLineIds.length > 0 || spacingX !== "10" || spacingY !== "0" || copies !== "2" || mirrorAxis !== "x";

  const clearDrafts = (cancel = true): void => {
    setMode("trim");
    setTargetLineId("");
    setBoundaryLineId("");
    setMoveStart(true);
    setMirrorAxis("x");
    setSpacingX("10");
    setSpacingY("0");
    setCopies("2");
    setLocalError(null);
    onSelectionChange([]);
    onTrimPreview(null);
    if (cancel) onCancel();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || !hasDraft) return;
      event.preventDefault();
      event.stopPropagation();
      clearDrafts();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [hasDraft, onSelectionChange, onTrimPreview, onCancel]);

  const apply = async (): Promise<void> => {
    if (disabled || !model) return;
    onActivate();
    if (mode === "trim" || mode === "extend") {
      if (!candidate) return;
      if (await onTrim(candidate)) clearDrafts(false);
      return;
    }
    if (!transformSources.length || (mode === "pattern" && !validPattern)) return;
    try {
      let transform: SketchLineTransform;
      if (mode === "pattern") {
        transform = { kind: "pattern", spacingX: numericSpacingX, spacingY: numericSpacingY, copies: numericCopies };
      } else {
        transform = {
          kind: "mirror",
          axis: mirrorAxis === "x" || mirrorAxis === "y"
            ? { kind: mirrorAxis }
            : { kind: "line", lineId: mirrorLineId! },
        };
      }
      const result = transformSketchLines(model, transformSources, newPrefix(mode), transform);
      if (await onTransform(result)) clearDrafts(false);
    } catch (error) {
      // Keep the current choices visible so a rejected operation can be corrected.
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  const chooseMode = (next: Mode): void => { onActivate(); setMode(next); setLocalError(null); };
  const toggleLine = (id: string): void => {
    onSelectionChange(selectedLineIds.includes(id)
      ? selectedLineIds.filter(selected => selected !== id)
      : [...selectedLineIds, id]);
  };

  return (
    <section data-testid="sketch-line-tools" className="mb-2 min-w-0 rounded bg-white/5 p-2 text-xs">
      <div className="mb-1 text-[11px] uppercase tracking-wide text-white/45">{tt("sketch.lineTools.title")}</div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={tt("sketch.lineTools.title")}>
        {(["trim", "extend", "mirror", "pattern"] as const).map(tool => (
          <button key={tool} type="button" disabled={disabled} aria-pressed={mode === tool}
            onClick={() => chooseMode(tool)} className="rounded bg-slate-700 px-2 py-1 disabled:opacity-40">
            {tt(`sketch.lineTools.${tool}`)}
          </button>
        ))}
      </div>

      {(mode === "trim" || mode === "extend") && (
        <div className="mt-2 flex min-w-0 flex-wrap items-end gap-2">
          <label className="grid min-w-36 gap-1 text-white/60">{tt("sketch.lineTools.trimTarget")}
            <select aria-label={tt("sketch.lineTools.trimTarget")} value={targetLineId} disabled={disabled}
              onChange={event => { onActivate(); setTargetLineId(event.target.value); }} className="max-w-full bg-slate-900 p-1 text-white">
              <option value="">{tt("sketch.lineTools.chooseSegment")}</option>
              {(model?.lines ?? []).map((line, index) => <option key={line.id} value={line.id}>{tt("sketch.lineTools.segment", { n: index + 1 })}</option>)}
            </select>
          </label>
          <label className="grid min-w-36 gap-1 text-white/60">{tt("sketch.lineTools.trimBoundary")}
            <select aria-label={tt("sketch.lineTools.trimBoundary")} value={boundaryLineId} disabled={disabled}
              onChange={event => { onActivate(); setBoundaryLineId(event.target.value); }} className="max-w-full bg-slate-900 p-1 text-white">
              <option value="">{tt("sketch.lineTools.chooseSegment")}</option>
              {(model?.lines ?? []).map((line, index) => <option key={line.id} value={line.id}>{tt("sketch.lineTools.segment", { n: index + 1 })}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-white/60">{tt("sketch.lineTools.endpoint")}
            <select aria-label={tt("sketch.lineTools.endpoint")} value={moveStart ? "start" : "end"} disabled={disabled}
              onChange={event => { onActivate(); setMoveStart(event.target.value === "start"); }} className="bg-slate-900 p-1 text-white">
              <option value="start">{tt("sketch.lineTools.start")}</option>
              <option value="end">{tt("sketch.lineTools.end")}</option>
            </select>
          </label>
          {candidate && <div data-testid="trim-intersection-preview" aria-live="polite" className="min-w-0 text-amber-200">
            {tt("sketch.lineTools.intersection", { x: candidate.x.toFixed(3), y: candidate.y.toFixed(3) })}
            {candidate.affectedLineIds.length > 1 && <div>{tt("sketch.lineTools.affected", {
              segments: candidate.affectedLineIds.map(id => lineLabels.get(id)).filter(Boolean).join(", "),
            })}</div>}
          </div>}
          {trimResult.error && <div className="text-rose-300" role="status">{trimResult.error}</div>}
        </div>
      )}

      {mode === "mirror" && <div className="mt-2 flex min-w-0 flex-wrap items-end gap-2">
        <label className="grid gap-1 text-white/60">{tt("sketch.lineTools.axis")}
          <select aria-label={tt("sketch.lineTools.axis")} value={mirrorAxis} disabled={disabled}
            onChange={event => { onActivate(); setMirrorAxis(event.target.value); }}
            className="max-w-full bg-slate-900 p-1 text-white">
            <option value="x">{tt("sketch.lineTools.axisX")}</option>
            <option value="y">{tt("sketch.lineTools.axisY")}</option>
            {(model?.lines ?? []).map((line, index) => <option key={line.id} value={`line:${line.id}`}>{tt("sketch.lineTools.segment", { n: index + 1 })}</option>)}
          </select>
        </label>
        <span data-testid="mirror-chosen-axis" className="text-white/65">{tt("sketch.lineTools.chosenAxis", { axis: axisLabel })}</span>
      </div>}

      {mode === "pattern" && <div className="mt-2 flex min-w-0 flex-wrap items-end gap-2">
        <label className="grid gap-1 text-white/60">{tt("sketch.lineTools.spacingX")}
          <input aria-label={tt("sketch.lineTools.spacingX")} inputMode="decimal" value={spacingX} disabled={disabled}
            onChange={event => { onActivate(); setSpacingX(event.target.value); }} className="w-20 bg-slate-900 p-1 text-white" />
        </label>
        <label className="grid gap-1 text-white/60">{tt("sketch.lineTools.spacingY")}
          <input aria-label={tt("sketch.lineTools.spacingY")} inputMode="decimal" value={spacingY} disabled={disabled}
            onChange={event => { onActivate(); setSpacingY(event.target.value); }} className="w-20 bg-slate-900 p-1 text-white" />
        </label>
        <label className="grid gap-1 text-white/60">{tt("sketch.lineTools.copies")}
          <input aria-label={tt("sketch.lineTools.copies")} inputMode="numeric" value={copies} disabled={disabled}
            onChange={event => { onActivate(); setCopies(event.target.value); }} className="w-20 bg-slate-900 p-1 text-white" />
        </label>
        {!validPattern && <span role="status" className="text-rose-300">{tt("sketch.lineTools.patternRange")}</span>}
      </div>}

      {(mode === "mirror" || mode === "pattern") && <div className="mt-2 grid gap-1 text-white/60">
        <span>{tt("sketch.lineTools.selectionHint")}</span>
        <span data-testid="sketch-line-selection" aria-live="polite">
          {tt("sketch.lineTools.selectedCount", { n: transformSources.length })}
          {selectedLabels.length ? ` · ${tt("sketch.lineTools.selectedSegments")}: ${selectedLabels.join(", ")}` : ""}
        </span>
      </div>}

      {localError && <div role="status" className="mt-2 text-rose-300">{localError}</div>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={disabled || !model ||
          ((mode === "trim" || mode === "extend") ? !candidate : !transformSources.length || (mode === "pattern" && !validPattern))}
          onClick={() => void apply()} className="rounded bg-emerald-700 px-2 py-1 disabled:opacity-40">
          {tt("sketch.lineTools.apply")}
        </button>
        <button type="button" disabled={!model || !hasDraft} onClick={() => clearDrafts()}
          className="rounded bg-slate-700 px-2 py-1 disabled:opacity-40">{tt("sketch.lineTools.cancel")}</button>
      </div>
    </section>
  );
}
