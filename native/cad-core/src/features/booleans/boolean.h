#pragma once

#include <string>
#include <vector>

namespace intentcad {

// Boolean composition (§20 Tier 3): Fuse (combine), Cut (subtract), Common
// (keep overlap) of exactly two existing solids. Multi-input DAG deps;
// downstream features rebuild when either input changes (§53).
// op must be "fuse", "cut" or "common".
bool CreateBooleanFeature(const std::string& featureId, const std::string& op,
                          const std::string& targetId,
                          const std::string& toolId, std::string* error);

// DAG recompute step (features/rebuild.cpp calls this).
bool RebuildBooleanFromStore(const std::string& featureId, std::string* error);

}  // namespace intentcad
