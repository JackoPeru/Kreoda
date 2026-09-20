#pragma once

#include <string>
#include <vector>

#include "../model/shapes.h"

namespace intentcad {

// DAG evaluation entry points (§53). Pure validation shared by commit and
// preview paths; node rebuilds used by FeatureGraph::recompute.

// Canonical per-type parameter slots (mm). Pure: no state touched.
bool ResolveParamsForEdit(const ShapeRecord& rec, const std::string& paramName,
                          double valueMm, std::vector<double>* out,
                          std::string* error);

// Single DAG recompute step: rebuild from CURRENT store params without a
// revision bump; the outer command registers exactly once (§12).
// Handles Box/Cylinder/Sphere/Sketch/Extrude/Revolve.
bool RebuildNodeFromStore(const std::string& featureId, std::string* error);

}  // namespace intentcad
