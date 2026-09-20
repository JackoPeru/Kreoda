// Central command execution (§19): toolbar, context menu, palette,
// shortcuts, AI tools and plugins invoke THIS — one definition, one path.
// Every call validates params (zod), checks selection availability, runs the
// typed core command, then re-syncs the read-only projection (§9).

import {
  COMMANDS,
  type CommandContext,
} from "@kreoda/command-schema";
import {
  coreClient,
  type CreatedFeature,
  type FeatureSummary,
} from "../ipc/coreClient";
import type { CoreMeshData } from "@kreoda/protocol";
import {
  pullFeatureMesh,
  syncFromCoreList,
  updateFeatureSummary,
} from "../model/sync";
import {
  selectionKindOf,
  isSketchId,
  useDocumentUiStore,
  usePreferencesStore,
  useSelectionStore,
} from "../stores";
import type { SketchModel } from "@kreoda/protocol";

function commandContext(): CommandContext {
  const sel = useSelectionStore.getState();
  return {
    selection: sel.selectedIds.map((id) => {
      const kind = selectionKindOf(id);
      const mapped =
        kind === "body" && isSketchId(id)
          ? "sketch"
          : kind === "body"
            ? "body"
            : kind === "face"
              ? "face"
              : "edge";
      return { kind: mapped, persistentId: id };
    }),
    beginnerMode: usePreferencesStore.getState().beginnerMode,
  };
}

function appendFeature(entry: FeatureSummary, revision: number): void {
  const s = useDocumentUiStore.getState();
  s.setFeatures(
    [...s.features.filter((f) => f.featureId !== entry.featureId), entry],
    revision,
  );
}

async function pullAndAppend(created: CreatedFeature): Promise<void> {
  await pullFeatureMesh(created.featureId, created.revision);
  appendFeature(
    {
      featureId: created.featureId,
      type: created.type,
      paramsMm: created.paramsMm,
      dependsOn: created.dependsOn ?? [],
      refExtra: created.refExtra ?? "",
      volumeMm3: created.volumeMm3,
    },
    created.revision,
  );
}

export type CommandResult =
  | { kind: "created"; feature: CreatedFeature }
  | { kind: "mesh"; mesh: CoreMeshData }
  | { kind: "list"; features: FeatureSummary[]; revision: number }
  | { kind: "ok" };

export async function executeCommand(
  id: string,
  params: unknown,
): Promise<CommandResult> {
  if (!useDocumentUiStore.getState().coreRunning) {
    throw new Error("geometry engine not running");
  }
  const def = COMMANDS.find((c) => c.id === id);
  if (!def) throw new Error(`unknown command ${id}`);
  const availability = def.availability(commandContext());
  if (!availability.available) {
    throw new Error(availability.reason ?? `${id} unavailable here`);
  }
  const p = def.parameterSchema.parse(params) as Record<string, unknown>;
  return dispatchCommand(id, p);
}

/**
 * Validated dispatch without a selection-availability check — for plan
 * expansion (provider.ts) and other callers that resolve context EXPLICITLY
 * (target/face/edge ids in hand). Params are still zod-validated here, so
 * the single typed path (§0.4) is preserved; only the UI-context gate is
 * the caller's responsibility.
 * SAFETY: only provider.ts may call this — any other caller bypasses the
 * beginnerMode/selection gates. The caller MUST have resolved
 * targetId/faceRole/edgeIds/featureId explicitly.
 */
export async function executeValidatedCommand(
  id: string,
  params: unknown,
): Promise<CommandResult> {
  if (!useDocumentUiStore.getState().coreRunning) {
    throw new Error("geometry engine not running");
  }
  const def = COMMANDS.find((c) => c.id === id);
  if (!def) throw new Error(`unknown command ${id}`);
  const p = def.parameterSchema.parse(params) as Record<string, unknown>;
  return dispatchCommand(id, p);
}

async function dispatchCommand(
  id: string,
  p: Record<string, unknown>,
): Promise<CommandResult> {
  switch (id) {
    case "CreateBox": {
      const created = await coreClient.createBox(
        p as { widthMm: number; heightMm: number; depthMm: number },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "CreateCylinder": {
      const created = await coreClient.createCylinder(
        p as { radiusMm: number; heightMm: number },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "CreateSphere": {
      const created = await coreClient.createSphere(
        p as { radiusMm: number },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "CreateSketch": {
      const { planeKind } = p as { planeKind: "XY" | "XZ" | "YZ" };
      const { featureId, revision } = await coreClient.createSketch({
        planeKind: planeKind ?? "XY",
        model: emptySketchModel(),
      });
      const full = await coreClient.requestSketch(featureId);
      useDocumentUiStore.getState().upsertSketch({
        featureId,
        planeKind: full.planeKind,
        points: full.points.length,
        lines: full.lines.length,
        circles: full.circles.length,
        constraints: full.constraints.length,
        model: full,
      });
      useDocumentUiStore.getState().setFeatures(
        useDocumentUiStore.getState().features,
        revision,
      );
      return { kind: "ok" };
    }
    case "CreateExtrude": {
      const created = await coreClient.createExtrude(
        p as { sketchId: string; distanceMm: number },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "CreateBoolean": {
      const created = await coreClient.createBoolean(
        p as { op: "fuse" | "cut" | "common"; targetId: string; toolId: string },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "CreateHole": {
      const created = await coreClient.createHole(
        p as {
          targetId: string;
          faceRole: string;
          xMm: number;
          yMm: number;
          diameterMm: number;
          depthMode: "throughAll" | "blind";
          depthMm: number;
        },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "CreateFillet": {
      const created = await coreClient.createFillet(
        p as { targetId: string; edgeIds: string[]; radiusMm: number },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "CreateChamfer": {
      const created = await coreClient.createChamfer(
        p as { targetId: string; edgeIds: string[]; distanceMm: number },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "SetDimension": {
      const { featureId, paramName, valueMm } = p as {
        featureId: string;
        paramName: string;
        valueMm: number;
      };
      const updated = await coreClient.setFeatureParameter(
        featureId,
        paramName,
        valueMm,
      );
      if ("positions" in updated) {
        // Preview meshes never commit — no store update by design (§13).
        return { kind: "mesh", mesh: updated };
      }
      await pullFeatureMesh(featureId, updated.revision);
      updateFeatureSummary(
        featureId,
        {
          paramsMm: updated.paramsMm,
          dependsOn: updated.dependsOn ?? [],
          refExtra: updated.refExtra ?? "",
          volumeMm3: updated.volumeMm3,
        },
        updated.revision,
      );
      return { kind: "created", feature: updated };
    }
    case "Undo": {
      const { features, sketches, revision } = await coreClient.undo();
      await syncFromCoreList(features, revision, sketches);
      return { kind: "list", features, revision };
    }
    case "Redo": {
      const { features, sketches, revision } = await coreClient.redo();
      await syncFromCoreList(features, revision, sketches);
      return { kind: "list", features, revision };
    }
    default:
      // Registered but not yet implemented (e.g. future Phase 8 ops).
      // Honest Phase-8 pointer, not jargon (§63.10).
      throw new Error(`${id} is registered but has no executor yet — try the toolbar, or short commands (export arrives in Phase 8)`);
  }
}

/** Registry entries visible in the current UI mode (drives the toolbar). */
export function visibleCommands() {
  const beginner = usePreferencesStore.getState().beginnerMode;
  return COMMANDS.filter((c) =>
    beginner ? c.beginnerVisible : c.advancedVisible,
  );
}

/** Availability of one command in the current selection context. */
export function commandAvailability(id: string): {
  available: boolean;
  reason?: string;
} {
  // Crashed/restarting engine (M11): every mutating command is unavailable
  // with one honest reason — buttons grey out instead of committing into a
  // fresh empty engine while the user restores.
  if (!useDocumentUiStore.getState().coreRunning) {
    return { available: false, reason: "geometry engine not running" };
  }
  const def = COMMANDS.find((c) => c.id === id);
  if (!def) return { available: false, reason: "unknown command" };
  return def.availability(commandContext());
}

function emptySketchModel(): SketchModel {
  return { points: [], lines: [], circles: [], arcs: [], constraints: [] };
}
