#pragma once

#include <string>

#if KREODA_WITH_OCCT
// NOTE: OCCT includes must stay OUTSIDE namespace kreoda.
#include <TopoDS_Shape.hxx>
#endif

namespace kreoda {

// Sketch-based revolution (§20 Tier 4): closed sketch face revolved around
// the sketch local X axis through the sketch origin, by angleDeg (360 full).
bool CreateRevolveFeature(const std::string& featureId,
                          const std::string& sketchId, double angleDeg,
                          std::string* error);

// DAG recompute step (features/rebuild.cpp calls this).
bool RebuildRevolveFromStore(const std::string& featureId,
                             std::string* error);

#if KREODA_WITH_OCCT
// Pure build (no commit): shared by create, recompute and preview paths.
bool BuildRevolveShape(const std::string& sketchId, double angleDeg,
                       TopoDS_Shape* out, std::string* error);
#endif

}  // namespace kreoda
