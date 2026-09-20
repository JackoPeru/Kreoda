#pragma once

#include <string>
#include <vector>

#include "shapes.h"

#if INTENTCAD_WITH_OCCT
// NOTE: OCCT includes must stay OUTSIDE namespace intentcad.
#include <TopoDS_Shape.hxx>
#endif

namespace intentcad {

// Shared commit contract for every feature evaluator (§41/§9/§53/§3).
// Atomic: on mirror failure the previous record is restored (rebuild) or the
// feature is dropped (create), so store and OCAF never diverge.
// countRevision=false for DAG-internal steps (the outer command registers
// exactly once, §12). Callers own the OCAF transaction boundary.
#if INTENTCAD_WITH_OCCT
// Null-shape + BRepCheck gates; volume/bbox from the B-Rep; store + live
// OCAF mirror with TNaming evolution; DAG node registration.
bool CommitShape(const std::string& featureId, const std::string& type,
                 std::vector<double> params, std::vector<std::string> deps,
                 std::string refExtra, const TopoDS_Shape& shape,
                 const ShapeRecord* previous, bool countRevision,
                 std::string* error);
#else
// Analytic fallback (no kernel): caller supplies volume + bbox.
bool CommitShape(const std::string& featureId, const std::string& type,
                 std::vector<double> params, std::vector<std::string> deps,
                 double volumeMm3, const double* bboxMm,
                 std::string* error);
#endif

}  // namespace intentcad
