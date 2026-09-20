#pragma once

#include <string>
#include <vector>

#if INTENTCAD_WITH_OCCT
// NOTE: OCCT includes must stay OUTSIDE namespace intentcad.
#include <TopoDS_Shape.hxx>
#endif

namespace intentcad {

// Rounded edges (§20 Tier 3): constant-radius fillet over persistent edge
// references. Edge ids are full persistent ids ("<target>:edge.…", comma
// joined in refExtra); they re-resolve on every rebuild. Oversize radii
// report an actionable safe range instead of a bare failure (§41).
bool CreateFilletFeature(const std::string& featureId,
                         const std::string& targetId,
                         const std::vector<std::string>& edgeIds,
                         double radiusMm, std::string* error);

// Cut corners (§20 Tier 3): symmetric chamfer (single distance) over
// persistent edge references. Same reference semantics as fillet.
bool CreateChamferFeature(const std::string& featureId,
                          const std::string& targetId,
                          const std::vector<std::string>& edgeIds,
                          double distanceMm, std::string* error);

// DAG recompute steps (features/rebuild.cpp calls these).
bool RebuildFilletFromStore(const std::string& featureId, std::string* error);
bool RebuildChamferFromStore(const std::string& featureId, std::string* error);

#if INTENTCAD_WITH_OCCT
// Pure builds (no commit): shared by create, recompute and preview paths.
bool BuildFilletShape(const TopoDS_Shape& target, const std::string& targetId,
                      const std::string& targetType,
                      const std::vector<std::string>& edgeIds, double radius,
                      TopoDS_Shape* out, std::string* error);
bool BuildChamferShape(const TopoDS_Shape& target, const std::string& targetId,
                       const std::string& targetType,
                       const std::vector<std::string>& edgeIds, double dis,
                       TopoDS_Shape* out, std::string* error);
#endif

// refExtra codec (comma-joined full edge ids): pure, all configs.
std::vector<std::string> SplitEdgeIds(const std::string& s);

}  // namespace intentcad
