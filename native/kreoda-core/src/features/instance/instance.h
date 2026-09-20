#pragma once

#include <string>
#include <vector>

#if KREODA_WITH_OCCT
// NOTE: OCCT includes must stay OUTSIDE namespace kreoda.
#include <TopoDS_Shape.hxx>
#endif

namespace kreoda {

// Rigid instance (Phase 9d): a live placed copy of another solid.
// Placement params (mm + degrees, extrinsic ZYX):
//   [txMm, tyMm, tzMm, rxDeg, ryDeg, rzDeg]
// The instance re-resolves its target on every rebuild, so it follows
// target edits through the DAG (dependsOn = [targetId]). No mating
// constraints in slice 1 — placement is explicit numbers only.
bool CreateInstanceFeature(const std::string& featureId,
                           const std::string& targetId,
                           const std::vector<double>& placement, std::string* error);

// DAG recompute step (features/rebuild.cpp calls this).
bool RebuildInstanceFromStore(const std::string& featureId,
                              std::string* error);

#if KREODA_WITH_OCCT
// Pure build (no commit): target shape + placement → placed solid.
bool BuildInstanceShape(const TopoDS_Shape& target,
                        const std::vector<double>& placement,
                        TopoDS_Shape* out, std::string* error);
#endif

}  // namespace kreoda
