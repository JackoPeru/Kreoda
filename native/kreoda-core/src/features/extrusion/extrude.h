#pragma once

#include <string>

#if KREODA_WITH_OCCT
// NOTE: OCCT includes must stay OUTSIDE namespace kreoda.
#include <TopoDS_Shape.hxx>
#endif

namespace kreoda {

// Sketch-based prism (§20 Tier 4): closed sketch face pulled along its
// normal by distanceMm (blind, one-sided). The sketch is a DAG dependency;
// sketch edits re-run this evaluator through the recompute path.
bool CreateExtrudeFeature(const std::string& featureId,
                          const std::string& sketchId, double distanceMm,
                          std::string* error);

// DAG recompute step (features/rebuild.cpp calls this).
bool RebuildExtrudeFromStore(const std::string& featureId,
                             std::string* error);

#if KREODA_WITH_OCCT
// Pure build (no commit): shared by create, recompute and preview paths.
bool BuildExtrudeShape(const std::string& sketchId, double distanceMm,
                       TopoDS_Shape* out, std::string* error);
#endif

}  // namespace kreoda
