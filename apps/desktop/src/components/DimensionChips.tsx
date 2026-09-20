import { useEffect, useRef } from "react";
import { parseAngleToDeg, parseLengthToMm } from "@kreoda/units";
import { viewportProjectPoint } from "../viewport/viewportHandle";
import { useDocumentUiStore, useSelectionStore } from "../stores";
import { executeCommand } from "../commands/execute";

// Canonical mm slots per type for chip labels (mirrors PropertiesPanel).
const CHIP_SLOTS: Record<string, { param: string; short: string }[]> = {
  Box: [
    { param: "widthMm", short: "W" },
    { param: "heightMm", short: "H" },
    { param: "depthMm", short: "D" },
  ],
  Cylinder: [
    { param: "radiusMm", short: "R" },
    { param: "heightMm", short: "H" },
  ],
  Sphere: [{ param: "radiusMm", short: "R" }],
  Extrude: [{ param: "distanceMm", short: "D" }],
  Revolve: [{ param: "angleDeg", short: "A" }],
  Hole: [{ param: "diameterMm", short: "⌀" }],
  Fillet: [{ param: "radiusMm", short: "R" }],
  Chamfer: [{ param: "distanceMm", short: "C" }],
  // M4: Instance placement chips (signed, zero-tolerant).
  Instance: [
    { param: "txMm", short: "X" },
    { param: "tyMm", short: "Y" },
    { param: "tzMm", short: "Z" },
  ],
};

const CHIP_ANGLE = new Set(["angleDeg", "rxDeg", "ryDeg", "rzDeg"]);
const CHIP_SIGNED = new Set(["txMm", "tyMm", "tzMm", "rxDeg", "ryDeg", "rzDeg"]);

/** Face centroid in world mm from the committed mesh (display only). */
function faceCentroidWorld(
  featureId: string,
  persistentFaceId: string,
): [number, number, number] | null {
  const mesh = useDocumentUiStore.getState().meshes[featureId];
  if (!mesh) return null;
  const range = mesh.faces.find((f) => f.persistentFaceId === persistentFaceId);
  if (!range || range.triangleCount === 0) return null;
  let cx = 0,
    cy = 0,
    cz = 0,
    n = 0;
  const idx = mesh.indices;
  const pos = mesh.positions;
  const tris = Math.min(range.triangleCount, 8);
  for (let t = 0; t < tris; t++) {
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

/**
 * Visual dimensions (§22): DOM-overlay chips anchored to face centers,
 * positioned imperatively every frame (no React state at pointer frequency,
 * §15). Click a chip to type an exact value (same commit path as the panel).
 */
export function DimensionChips() {
  const layerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  // Node currently being typed into (inline editor): the tick must not
  // repaint its label while the user types.
  const editingRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    const tick = (): void => {
      rafRef.current = requestAnimationFrame(tick);
      // Imperative reads: no subscriptions, no re-render loop.
      const s = useDocumentUiStore.getState();
      const sel = useSelectionStore.getState().selectedIds;
      // Single-body affordance: bare body id, or the owner of a face/edge
      // selection (§16 contextual default).
      const first = sel[0];
      const body =
        first === undefined
          ? undefined
          : first.includes(":")
            ? first.slice(0, first.indexOf(":"))
            : first;
      const feature = body
        ? s.features.find((f) => f.featureId === body)
        : undefined;
      const slots = feature ? (CHIP_SLOTS[feature.type] ?? []) : [];
      const faces = body ? (s.meshes[body]?.faces ?? []) : [];

      while (layer.childElementCount > slots.length) {
        layer.removeChild(layer.lastChild!);
      }
      if (slots.length === 0 || !feature || !body) {
        while (layer.childElementCount > 0) {
          layer.removeChild(layer.lastChild!);
        }
        return;
      }
      slots.forEach((slot, i) => {
        let node = layer.children[i] as HTMLElement | undefined;
        if (!node) {
          node = document.createElement("button");
          node.className =
            "pointer-events-auto rounded-md bg-amber-500/90 px-2 py-0.5 font-mono text-[11px] text-black shadow hover:bg-amber-400";
          node.addEventListener("click", () => {
            // Inline editor (window.prompt is unsupported in Electron):
            // swap the label for an input; Enter commits, Esc cancels.
            if (editingRef.current === node) return;
            editingRef.current = node!;
            const param = node!.dataset.param!;
            const isAngle = CHIP_ANGLE.has(param);
            const signed = CHIP_SIGNED.has(param);
            node!.textContent = "";
            const input = document.createElement("input");
            input.value = "";
            input.placeholder = isAngle ? "deg" : "mm";
            input.className = "w-16 bg-transparent text-black outline-none";
            // M5: silent drops (typo 0/-5 vanishes, chip keeps old value)
            // become honest inline errors.
            const showInlineError = (msg: string): void => {
              input.value = "";
              input.placeholder = msg.slice(0, 12);
              input.title = msg;
              node!.title = msg;
            };
            input.addEventListener("keydown", (kev) => {
              kev.stopPropagation();
              if (kev.key === "Enter") {
                const raw = input.value;
                const fid = node!.dataset.feature!;
                editingRef.current = null;
                // Formula entry (Phase 9a): "=..." commits an expression,
                // anything else a bare dimension.
                if (raw.trimStart().startsWith("=")) {
                  const expr = raw.slice(raw.indexOf("=") + 1);
                  if (!expr.trim()) {
                    showInlineError("empty formula");
                    return;
                  }
                  void executeCommand("SetDimension", {
                    featureId: fid,
                    paramName: param,
                    expression: expr.trim(),
                  }).catch((e: unknown) => {
                    // Core reports unknown refs/cycles honestly; surface it.
                    node!.title = e instanceof Error ? e.message : "formula failed";
                  });
                  return;
                }
                let v: number;
                try {
                  v = isAngle
                    ? parseAngleToDeg(raw)
                    : parseLengthToMm(raw);
                } catch {
                  editingRef.current = null;
                  showInlineError("not a number");
                  return;
                }
                // M4: placement params accept 0/negatives; dimensions stay >0.
                if (!Number.isFinite(v) || (!signed && !(v > 0))) {
                  editingRef.current = null;
                  showInlineError(signed ? "not finite" : "must be > 0");
                  return;
                }
                void executeCommand("SetDimension", {
                  featureId: fid,
                  paramName: param,
                  valueMm: v,
                }).catch((e: unknown) => {
                  node!.title = e instanceof Error ? e.message : "edit failed";
                });
              } else if (kev.key === "Escape") {
                editingRef.current = null;
              }
            });
            input.addEventListener(
              "blur",
              () => {
                if (editingRef.current === node) editingRef.current = null;
              },
              { once: true },
            );
            node!.appendChild(input);
            input.focus();
          });
          layer.appendChild(node);
        }
        // Refresh identity every frame: nodes are recycled across bodies.
        node.dataset.param = slot.param;
        node.dataset.feature = feature.featureId;
        const want =
          slot.short === "W"
            ? "+X"
            : slot.short === "H"
              ? "+Y"
              : slot.short === "D"
                ? "+Z"
                : slot.short === "R" || slot.short === "⌀"
                  ? "wall"
                  : slot.short === "A" || slot.short === "C"
                    ? ""
                    : "";
        // Exact role-suffix match (endsWith): substring includes() would
        // mis-anchor ("wall" inside "sidewall"-style roles, "+X" inside…).
        const face = want
          ? faces.find((f) => f.persistentFaceId.endsWith(want))
          : undefined;
        const paramIndex = (CHIP_SLOTS[feature.type] ?? []).findIndex(
          (x) => x.param === slot.param,
        );
        const value = feature.paramsMm[paramIndex];
        if (editingRef.current !== node) {
          // Formula-driven params show a ƒ marker + the formula on hover.
          const expr = feature.expressions?.[slot.param];
          node.textContent =
            expr !== undefined ? `ƒ${slot.short} ${value ?? "?"}` : `${slot.short} ${value ?? "?"}`;
          node.title =
            expr !== undefined
              ? `${slot.param} = ${expr} (formula — edit with =...)`
              : `${slot.param} (type =formula to link)`;
        }
        const world =
          face && body ? faceCentroidWorld(body, face.persistentFaceId) : null;
        const anchor = world ? viewportProjectPoint(world) : null;
        if (anchor) {
          node.style.display = "";
          node.style.position = "absolute";
          node.style.left = "0";
          node.style.top = "0";
          node.style.transform = `translate(${anchor.x}px, ${anchor.y}px) translate(-50%,-140%)`;
        } else {
          node.style.display = "none";
        }
      });
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      data-testid="dimension-chips"
    />
  );
}
