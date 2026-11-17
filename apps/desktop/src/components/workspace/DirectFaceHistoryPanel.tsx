import { useEffect, useRef, useState } from "react";
import { coreClient, type DirectFaceCapture, type DirectFaceHistoryCommandId } from "../../ipc/coreClient";
import { executeCommand } from "../../commands/execute";
import { selectionKindOf, useDocumentUiStore, useSelectionStore } from "../../stores";
import { useT, type EnKey } from "../../i18n";

type Vec3 = { x: string; y: string; z: string };
const zero: Vec3 = { x: "0", y: "0", z: "0" };
const contextKey = (capture: DirectFaceCapture): string => {
  const c = capture.context;
  return `${c.documentId}:${c.sessionId}:${c.revision}:${c.epoch}:${c.connectionGeneration}`;
};
const number3 = (value: Vec3): { x: number; y: number; z: number } => {
  const result = { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
  if (![result.x, result.y, result.z].every(Number.isFinite)) throw new Error("Enter finite values");
  return result;
};

export function DirectFaceHistoryPanel() {
  const t = useT();
  const selectedIds = useSelectionStore(state => state.selectedIds);
  const documentId = useDocumentUiStore(state => state.documentId);
  const revision = useDocumentUiStore(state => state.revision);
  const epoch = useDocumentUiStore(state => state.epoch);
  const connectionGeneration = useDocumentUiStore(state => state.connectionGeneration);
  const coreRunning = useDocumentUiStore(state => state.coreRunning);
  const [operation, setOperation] = useState<DirectFaceHistoryCommandId>("CreateMoveFace");
  const [source, setSource] = useState<DirectFaceCapture | null>(null);
  const [support, setSupport] = useState<DirectFaceCapture | null>(null);
  const [translation, setTranslation] = useState<Vec3>(zero);
  const [rotation, setRotation] = useState<Vec3>(zero);
  const [pivot, setPivot] = useState<Vec3>(zero);
  const [distance, setDistance] = useState("1");
  const [captureBusy, setCaptureBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryBlocked, setRetryBlocked] = useState(false);
  const captureGeneration = useRef(0);
  const applyGeneration = useRef(0);

  useEffect(() => {
    captureGeneration.current += 1;
    setSource(null);
    setSupport(null);
    setError(null);
    setNotice(null);
    setRetryBlocked(false);
    setCaptureBusy(false);
  }, [documentId, revision, epoch, connectionGeneration, coreRunning]);

  useEffect(() => {
    applyGeneration.current += 1;
    setApplying(false);
  }, [documentId, epoch, connectionGeneration, coreRunning]);

  useEffect(() => () => {
    captureGeneration.current += 1;
    applyGeneration.current += 1;
  }, []);

  const capture = async (role: "source" | "support"): Promise<void> => {
    const pickId = selectedIds.length === 1 ? selectedIds[0]! : "";
    if (role === "source") setSource(null);
    else setSupport(null);
    setError(null);
    setNotice(null);
    if (!pickId || selectionKindOf(pickId) !== "face") {
      setError(t("directFaceHistory.selectFace"));
      return;
    }
    const token = ++captureGeneration.current;
    setCaptureBusy(true);
    try {
      const context = await coreClient.captureDirectFaceContext();
      const captured = await coreClient.captureDirectFaceSelection(pickId, context, role);
      const state = useDocumentUiStore.getState();
      if (token !== captureGeneration.current || state.documentId !== context.documentId ||
          state.revision !== context.revision || state.epoch !== context.epoch ||
          state.connectionGeneration !== context.connectionGeneration ||
          useSelectionStore.getState().selectedIds.length !== 1 ||
          useSelectionStore.getState().selectedIds[0] !== pickId) return;
      if (role === "source") {
        setSource(captured);
        setPivot({ x: String(captured.centroidMm[0]), y: String(captured.centroidMm[1]), z: String(captured.centroidMm[2]) });
      } else {
        setSupport(captured);
        if (source && contextKey(source) !== contextKey(captured)) setSource(null);
      }
    } catch (cause) {
      if (token === captureGeneration.current)
        setError(cause instanceof Error ? cause.message : t("directFaceHistory.captureFailed"));
    } finally {
      if (token === captureGeneration.current) setCaptureBusy(false);
    }
  };

  const cancel = (): void => {
    captureGeneration.current += 1;
    setSource(null);
    setSupport(null);
    setError(null);
    setNotice(null);
    setRetryBlocked(false);
    setCaptureBusy(false);
  };

  const apply = async (): Promise<void> => {
    if (!source || applying) return;
    setError(null);
    setNotice(null);
    const common = { sourceFeatureId: source.sourceFace.featureId,
      sourceFace: source.sourceFace, captureRevision: source.captureRevision };
    let parameters: Record<string, unknown>;
    try {
      switch (operation) {
        case "CreateMoveFace":
          parameters = { ...common, translationMm: number3(translation), rotationDeg: number3(rotation), pivotMm: number3(pivot) };
          break;
        case "CreateOffsetFace": {
          const distanceMm = Number(distance);
          if (!Number.isFinite(distanceMm) || distanceMm === 0) throw new Error(t("directFaceHistory.nonzeroOffset"));
          parameters = { ...common, distanceMm };
          break;
        }
        case "CreateDeleteFace":
          parameters = common;
          break;
        case "CreateReplaceFace":
          if (!support || contextKey(source) !== contextKey(support))
            throw new Error(t("directFaceHistory.supportRequired"));
          parameters = { ...common, replacementFace: support.sourceFace };
          break;
        default:
          throw new Error(t("directFaceHistory.applyFailed"));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("directFaceHistory.applyFailed"));
      return;
    }
    const token = ++applyGeneration.current;
    setApplying(true);
    try {
      const result = await executeCommand(operation, parameters, { directFaceContext: source.context });
      if (token !== applyGeneration.current) return;
      setSource(null);
      setSupport(null);
      if (result.kind === "created" && result.refreshError) setNotice(result.refreshError);
    } catch (cause) {
      if (token === applyGeneration.current) {
        setError(cause instanceof Error ? cause.message : t("directFaceHistory.applyFailed"));
        if (cause instanceof Error && cause.message.includes(t("directFaceHistory.outcomeUnknown")))
          setRetryBlocked(true);
      }
    } finally {
      if (token === applyGeneration.current) setApplying(false);
    }
  };

  const busy = captureBusy || applying;
  const sourceReady = !!source && source.captureRevision === source.context.revision;
  const supportReady = !!support && sourceReady && contextKey(source!) === contextKey(support);
  const applyReady = sourceReady && !retryBlocked && (!applying) &&
    (operation !== "CreateReplaceFace" || supportReady);
  const vectorInput = (
    label: string,
    testId: string,
    value: Vec3,
    setValue: (next: Vec3) => void,
    axis: keyof Vec3,
  ) => (
    <label key={testId} className="block text-xs text-white/70">
      {t(label as EnKey)} {t("common.unitMm")}
      <input data-testid={testId} type="number" step="any" value={value[axis]}
        onChange={event => setValue({ ...value, [axis]: event.target.value })}
        className="mt-1 w-full rounded-md bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:bg-white/10" />
    </label>
  );
  const owner = (capture: DirectFaceCapture | null) => capture?.sourceFace.featureId ?? t("directFaceHistory.none");

  return (
    <section className="mb-3 rounded-lg border border-white/10 bg-white/[0.025] p-3" data-testid="direct-face-history-panel">
      <h3 className="pb-2 text-xs font-semibold uppercase tracking-wide text-white/75">{t("directFaceHistory.title")}</h3>
      <label className="mb-3 block text-xs text-white/70">
        {t("directFaceHistory.operation")}
        <select data-testid="direct-operation" value={operation}
          onChange={event => setOperation(event.target.value as DirectFaceHistoryCommandId)}
          disabled={busy} className="mt-1 w-full rounded-md bg-[#111821] px-2 py-1.5 text-sm text-white">
          <option value="CreateMoveFace">{t("directFaceHistory.move")}</option>
          <option value="CreateOffsetFace">{t("directFaceHistory.offset")}</option>
          <option value="CreateDeleteFace">{t("directFaceHistory.delete")}</option>
          <option value="CreateReplaceFace">{t("directFaceHistory.replace")}</option>
        </select>
      </label>

      <div className="space-y-2">
        <div className="rounded-md bg-white/5 p-2 text-xs">
          <div className="text-white/55">{t("directFaceHistory.source")}</div>
          <div data-testid="direct-source-owner" className="truncate font-mono text-white/85">{owner(source)}</div>
          <button data-testid="direct-source-capture" onClick={() => void capture("source")} disabled={busy}
            className="mt-1 rounded bg-white/10 px-2 py-1 text-white hover:bg-white/15 disabled:opacity-50">
            {t("directFaceHistory.captureSource")}
          </button>
        </div>
        {operation === "CreateReplaceFace" ? (
          <div className="rounded-md bg-white/5 p-2 text-xs">
            <div className="text-white/55">{t("directFaceHistory.replaceSupport")}</div>
            <div data-testid="direct-support-owner" className="truncate font-mono text-white/85">{owner(support)}</div>
            <button data-testid="direct-support-capture" onClick={() => void capture("support")} disabled={busy}
              className="mt-1 rounded bg-white/10 px-2 py-1 text-white hover:bg-white/15 disabled:opacity-50">
              {t("directFaceHistory.captureSupport")}
            </button>
          </div>
        ) : null}
      </div>

      {operation === "CreateMoveFace" ? (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-medium text-white/70">{t("directFaceHistory.translation")}</div>
          <div className="grid grid-cols-3 gap-2">
            {(["x", "y", "z"] as const).map(axis => vectorInput(`directFaceHistory.axis${axis.toUpperCase()}`,
              `direct-translation-${axis}`, translation, setTranslation, axis))}
          </div>
          <details className="rounded-md bg-white/5 p-2">
            <summary className="cursor-pointer text-xs text-white/70">{t("directFaceHistory.rotationPivot")}</summary>
            <div className="mt-2 text-xs text-white/55">{t("directFaceHistory.rotation")}</div>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {(["x", "y", "z"] as const).map(axis => (
                <label key={axis} className="block text-xs text-white/70">
              {t(`directFaceHistory.axis${axis.toUpperCase()}` as EnKey)} {t("common.unitDeg")}
                  <input data-testid={`direct-rotation-${axis}`} type="number" step="any" value={rotation[axis]}
                    onChange={event => setRotation({ ...rotation, [axis]: event.target.value })}
                    className="mt-1 w-full rounded-md bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:bg-white/10" />
                </label>
              ))}
            </div>
            <div className="mt-2 text-xs text-white/55">{t("directFaceHistory.pivot")}</div>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {(["x", "y", "z"] as const).map(axis => vectorInput(`directFaceHistory.pivot${axis.toUpperCase()}`,
                `direct-pivot-${axis}`, pivot, setPivot, axis))}
            </div>
          </details>
        </div>
      ) : null}

      {operation === "CreateOffsetFace" ? (
        <label className="mt-3 block text-xs text-white/70">
          {t("directFaceHistory.distance")} {t("common.unitMm")}
          <input data-testid="direct-offset-distance" type="number" step="any" value={distance}
            onChange={event => setDistance(event.target.value)}
            className="mt-1 w-full rounded-md bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:bg-white/10" />
        </label>
      ) : null}

      {error && <div role="alert" className="mt-2 text-xs text-red-300">{error}</div>}
      {notice && <div role="status" className="mt-2 text-xs text-amber-200">{notice}</div>}
      <div className="mt-3 flex gap-2">
        <button data-testid="direct-apply" onClick={() => void apply()} disabled={!applyReady || busy}
          className="flex-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
          {applying ? t("directFaceHistory.applying") : t("common.apply")}
        </button>
        <button data-testid="direct-cancel" onClick={cancel} disabled={applying}
          className="rounded-md bg-white/10 px-2.5 py-1.5 text-sm text-white/80 hover:bg-white/15 disabled:opacity-50">
          {t("common.cancel")}
        </button>
      </div>
    </section>
  );
}
