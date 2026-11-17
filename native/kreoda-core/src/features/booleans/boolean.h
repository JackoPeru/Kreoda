#pragma once

#include <string>
#include <vector>

#if KREODA_WITH_OCCT
#include <TopoDS_Shape.hxx>
#endif

namespace kreoda {

#if KREODA_WITH_OCCT
bool BuildBooleanShape(const std::string& op, const TopoDS_Shape& target,
                       const TopoDS_Shape& tool, TopoDS_Shape* out,
                       std::string* error);
#endif

// Boolean composition (§20 Tier 3): Fuse (combine), Cut (subtract), Common
// (keep overlap) of exactly two existing solids. Multi-input DAG deps;
// downstream features rebuild when either input changes (§53).
// op must be "fuse", "cut" or "common".
bool CreateBooleanFeature(const std::string& featureId, const std::string& op,
                          const std::string& targetId,
                          const std::string& toolId, std::string* error);

// DAG recompute step (features/rebuild.cpp calls this).
bool RebuildBooleanFromStore(const std::string& featureId, std::string* error);

}  // namespace kreoda
