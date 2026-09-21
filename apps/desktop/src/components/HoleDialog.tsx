import { useMemo, useState } from "react";
import { parseLengthToMm } from "@kreoda/units";
import { executeCommand } from "../commands/execute";
import { coreClient } from "../ipc/coreClient";
import { useDocumentUiStore, useSelectionStore } from "../stores";
import { faceCentroid, faceLocalFromWorld } from "../interaction/pull";
import { CadActions, CadDialog } from "./CadDialog";

/** Parametric hole on the selected face (§62 Scenario A). */
export function HoleDialog({ onClose }: { onClose: () => void }) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const features = useDocumentUiStore((s) => s.features);
  const faceId = selectedIds.find((id) => id.includes(":")) ?? null;
  const [diameter, setDiameter] = useState("8");
  const [depthMode, setDepthMode] = useState<"throughAll" | "blind">(
    "throughAll",
  );
  const [depth, setDepth] = useState("10");
  const [x, setX] = useState<string | null>(null);
  const [y, setY] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const target = useMemo(() => {
    if (!faceId) return null;
    const cut = faceId.indexOf(":");
    const bare = faceId.slice(0, cut);
    const feature = features.find((f) => f.featureId === bare);
    if (!feature) return null;
    return { featureId: bare, role: faceId.slice(cut + 1) };
  }, [faceId, features]);

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      if (!target) throw new Error("Select a face first");
      const diameterMm = parseLengthToMm(diameter);
      // Default position: world centroid mapped into the face frame via the
      // core plane frame — exact center on any planar face (§10).
      let xMm: number;
      let yMm: number;
      if (x === null || y === null) {
        const mesh = useDocumentUiStore.getState().meshes[target.featureId];
        const c = mesh ? faceCentroid(mesh, faceId!, 64) : null;
        if (!c) throw new Error("Cannot read the face position");
        let local: { x: number; y: number } | null = null;
        try {
          const frame = await coreClient.requestFaceInfo(
            target.featureId,
            target.role,
          );
          local = faceLocalFromWorld(frame, c);
        } catch {
          local = null;
        }
        if (!local) throw new Error("Cannot read the face frame");
        xMm = x === null ? local.x : parseLengthToMm(x);
        yMm = y === null ? local.y : parseLengthToMm(y);
      } else {
        xMm = parseLengthToMm(x);
        yMm = parseLengthToMm(y);
      }
      const depthMm =
        depthMode === "blind" ? parseLengthToMm(depth) : 0;
      await executeCommand("CreateHole", {
        targetId: target.featureId,
        faceRole: target.role,
        xMm,
        yMm,
        diameterMm,
        depthMode,
        depthMm,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "hole failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CadDialog
      title="Make hole"
      description={
        target
          ? `On ${target.role} — position defaults to face center.`
          : "Select a face first."
      }
      onClose={onClose}
      error={error}
      actions={
        <CadActions
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          busyLabel="Cutting…"
          label="Cut hole"
          disabled={!target}
        />
      }
    >
      <label className="mb-2 block text-xs text-white/70">
        Diameter (mm)
        <input
          defaultValue={diameter}
          onChange={(e) => setDiameter(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:bg-white/10"
        />
      </label>
      <div className="mb-2 flex gap-2 text-xs">
        {(["throughAll", "blind"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setDepthMode(m)}
            className={`rounded-md px-2.5 py-1.5 ${depthMode === m ? "bg-white/15" : "bg-white/5 hover:bg-white/10"}`}
          >
            {m === "throughAll" ? "Through" : "Blind"}
          </button>
        ))}
      </div>
      {depthMode === "blind" && (
        <label className="mb-2 block text-xs text-white/70">
          Depth (mm)
          <input
            defaultValue={depth}
            onChange={(e) => setDepth(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:bg-white/10"
          />
          <span className="text-white/40">
            Deeper than the part exits the far side (still valid).
          </span>
        </label>
      )}
      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="block text-xs text-white/70">
          X on face (mm)
          <input
            placeholder="center"
            onChange={(e) => setX(e.target.value || null)}
            className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:bg-white/10"
          />
        </label>
        <label className="block text-xs text-white/70">
          Y on face (mm)
          <input
            placeholder="center"
            onChange={(e) => setY(e.target.value || null)}
            className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:bg-white/10"
          />
        </label>
      </div>
    </CadDialog>
  );
}
