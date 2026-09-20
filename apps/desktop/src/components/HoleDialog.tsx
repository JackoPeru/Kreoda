import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { parseLengthToMm } from "@kreoda/units";
import { executeCommand } from "../commands/execute";
import { coreClient } from "../ipc/coreClient";
import { useDocumentUiStore, useSelectionStore } from "../stores";

/** Face centroid in world coords (default hole position). */
function faceCentroid(
  featureId: string,
  faceId: string,
): [number, number, number] | null {
  const mesh = useDocumentUiStore.getState().meshes[featureId];
  if (!mesh) return null;
  const range = mesh.faces.find((f) => f.persistentFaceId === faceId);
  if (!range || range.triangleCount === 0) return null;
  let cx = 0,
    cy = 0,
    cz = 0,
    n = 0;
  const idx = mesh.indices;
  const pos = mesh.positions;
  for (let t = 0; t < Math.min(range.triangleCount, 64); t++) {
    for (let k = 0; k < 3; k++) {
      const vi = idx[(range.triangleStart + t) * 3 + k]!;
      cx += pos[vi * 3]!;
      cy += pos[vi * 3 + 1]!;
      cz += pos[vi * 3 + 2]!;
      n++;
    }
  }
  if (n === 0) return null;
  return [cx / n, cy / n, cz / n];
}

/** World point → face-local (x, y) through the core face frame (§10). */
async function toFaceLocal(
  featureId: string,
  role: string,
  world: [number, number, number],
): Promise<{ x: number; y: number } | null> {
  try {
    const frame = await coreClient.requestFaceInfo(featureId, role);
    const dx = [
      world[0] - frame.originMm[0],
      world[1] - frame.originMm[1],
      world[2] - frame.originMm[2],
    ];
    const dot = (a: number[], b: [number, number, number]): number =>
      a[0]! * b[0] + a[1]! * b[1] + a[2]! * b[2];
    return { x: dot(dx, frame.xAxis), y: dot(dx, frame.yAxis) };
  } catch {
    return null;
  }
}

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
        const c = faceCentroid(target.featureId, faceId!);
        if (!c) throw new Error("Cannot read the face position");
        const local = await toFaceLocal(target.featureId, target.role, c);
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
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/3 w-80 -translate-x-1/2 rounded-lg border border-white/15 bg-[#141922] p-4">
          <Dialog.Title className="text-sm font-semibold">
            Make hole
          </Dialog.Title>
          <Dialog.Description className="pb-3 text-xs text-white/55">
            {target
              ? `On ${target.role} — position defaults to face center.`
              : "Select a face first."}
          </Dialog.Description>
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
          {error && <div className="pb-2 text-xs text-red-300">{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-white/70 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              onClick={() => void submit()}
              disabled={busy || !target}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
            >
              {busy ? "Cutting…" : "Cut hole"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
