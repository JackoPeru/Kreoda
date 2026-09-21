#pragma once

#include <string>

#if KREODA_WITH_OCCT
// NOTE: OCCT includes must stay OUTSIDE namespace kreoda.
#include <TopoDS_Shape.hxx>
#endif

namespace kreoda {

// Parametric hole (§20 Tier 5): cylindrical cut into a target solid through
// a persistent face reference. Position is face-local 2D (xMm, yMm) in the
// face plane frame (origin at the plane location, axes from the surface).
// depthMode "throughAll" ignores depthMm; "blind" cuts depthMm from the face.
// The face reference re-resolves on every rebuild (§3–§4); a vanished face
// is an explicit repair state, never a silent no-op.
bool CreateHoleFeature(const std::string& featureId,
                       const std::string& targetId,
                       const std::string& faceRole, double xMm, double yMm,
                       double diameterMm, const std::string& depthMode,
                       double depthMm, std::string* error);

// Slice 5 cumulative pattern: 1..4 holes in ONE OCAF transaction (one Undo
// step) committed as ONE "HolePattern" record advancing the target's body.
// Final shape is the sequential cut (shape0 = target,
// shapeN = Cut(shapeN-1, holeN)); the committed record (under featureIds[0])
// is the body tip carrying base-minus-ALL-tools. points and featureIds must
// still have the same size (1..4, wire-stable); trailing ids are validated
// (charset/availability/uniqueness) but create no records — no sub-feature
// bodies, no sub-feature viewport objects. paramsMm is [diameterMm, depthMm]
// (same slots as Hole); refExtra is the pattern codec below. On any failure
// nothing is created (atomic).
bool CreateHolePatternFeature(
    const std::string& targetId, const std::string& faceRole,
    const std::vector<std::pair<double, double>>& points, double diameterMm,
    const std::string& depthMode, double depthMm,
    const std::vector<std::string>& featureIds,
    std::vector<std::string>* createdIds, std::string* error);

// DAG recompute step (features/rebuild.cpp calls this).
bool RebuildHoleFromStore(const std::string& featureId, std::string* error);

// Slice 5: cumulative pattern recompute — replays the sequential cuts from
// the live target shape (downstream of plate edits, Slice-3 tip machinery).
bool RebuildHolePatternFromStore(const std::string& featureId,
                                 std::string* error);

#if KREODA_WITH_OCCT
// Pure build (no commit): target shape + face role + dims → holed solid.
bool BuildHoleShape(const TopoDS_Shape& target, const std::string& targetId,
                    const std::string& targetType, const std::string& faceRole,
                    double xMm, double yMm, double diameterMm,
                    const std::string& mode, double depthMm, TopoDS_Shape* out,
                    std::string* error);
#endif

// refExtra codec ("face=<role>;x=<x>;y=<y>;mode=<mode>"): shared by the
// evaluator and the preview path (no state touched).
bool DecodeHoleRef(const std::string& ref, std::string* faceRole, double* x,
                   double* y, std::string* mode);

}  // namespace kreoda
