// Localized view over the static command registry
// (@kreoda/command-schema stays locale-free; the renderer translates).
import { t, type EnKey } from "./index";

const LABELS: Record<string, { label: EnKey; beginner: EnKey; desc: EnKey }> = {
  CreateBox: { label: "cmd.box", beginner: "cmd.boxBeginner", desc: "cmd.boxDesc" },
  CreateCylinder: {
    label: "cmd.cylinder",
    beginner: "cmd.cylinderBeginner",
    desc: "cmd.cylinderDesc",
  },
  CreateSphere: {
    label: "cmd.sphere",
    beginner: "cmd.sphereBeginner",
    desc: "cmd.sphereDesc",
  },
  SetDimension: {
    label: "cmd.setDimension",
    beginner: "cmd.setDimensionBeginner",
    desc: "cmd.setDimensionDesc",
  },
  CreateSketch: {
    label: "cmd.sketch",
    beginner: "cmd.sketchBeginner",
    desc: "cmd.sketchDesc",
  },
  CreateExtrude: {
    label: "cmd.extrude",
    beginner: "cmd.extrudeBeginner",
    desc: "cmd.extrudeDesc",
  },
  CreateBoolean: {
    label: "cmd.boolean",
    beginner: "cmd.booleanBeginner",
    desc: "cmd.booleanDesc",
  },
  CreateHole: { label: "cmd.hole", beginner: "cmd.holeBeginner", desc: "cmd.holeDesc" },
  CreateHolePattern: {
    label: "cmd.holePattern",
    beginner: "cmd.holePatternBeginner",
    desc: "cmd.holePatternDesc",
  },
  CreateFillet: {
    label: "cmd.fillet",
    beginner: "cmd.filletBeginner",
    desc: "cmd.filletDesc",
  },
  CreateChamfer: {
    label: "cmd.chamfer",
    beginner: "cmd.chamferBeginner",
    desc: "cmd.chamferDesc",
  },
  CreateInstance: {
    label: "cmd.instance",
    beginner: "cmd.instanceBeginner",
    desc: "cmd.instanceDesc",
  },
  Undo: { label: "cmd.undo", beginner: "cmd.undo", desc: "cmd.undoDesc" },
  Redo: { label: "cmd.redo", beginner: "cmd.redo", desc: "cmd.redoDesc" },
};

/** Localized label/beginnerLabel/description for a registry command id. */
export function commandText(
  id: string,
  fallback: { label: string; beginnerLabel: string; description: string },
): { label: string; beginnerLabel: string; description: string } {
  const keys = LABELS[id];
  if (!keys) return fallback;
  return {
    label: t(keys.label),
    beginnerLabel: t(keys.beginner),
    description: t(keys.desc),
  };
}

/** Map the registry's fixed English availability reasons to the locale. */
export function localizeReason(reason: string | undefined): string | undefined {
  switch (reason) {
    case "Select a sketch first":
      return t("cmd.reasonSketch");
    case "Select two solids first":
      return t("cmd.reasonTwoSolids");
    case "Select a face first":
      return t("cmd.reasonFace");
    case "Select a solid body first":
      return t("cmd.reasonBody");
    case "Select an edge first":
      return t("cmd.reasonEdge");
    case "unknown command":
      return t("cmd.reasonUnknown");
    case "geometry engine not running":
      return t("cmd.engineOff");
    default:
      return reason;
  }
}
