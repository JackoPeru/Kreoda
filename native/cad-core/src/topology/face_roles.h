#pragma once

#include <string>
#include <vector>

#if KREODA_WITH_OCCT
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#endif

namespace kreoda {

// Phase-1 role classifier (§4, step 2: explicit feature-role reference).
// Derives a stable role string per face from geometry (type + orientation),
// so the id survives parameter edits. OCAF/TNaming becomes the primary
// mechanism in Phase 2 (§3); roles remain as the documented fallback.
// Order follows the explorer sequence of the tessellator call.
#if KREODA_WITH_OCCT
std::vector<std::string> ClassifyFaceRoles(const TopoDS_Shape& shape,
                                           const std::string& featureType,
                                           const std::string& featureId);

// Full persistent id is "<featureId>:<role>"; bare "<role>" also matches.
bool FindFaceByRole(const TopoDS_Shape& shape, const std::string& featureId,
                    const std::string& featureType, const std::string& role,
                    TopoDS_Face* out);

// Face plane frame in WORLD coords (§10 hole positioning): origin at the
// surface location, orthonormal x/y axes, outward normal. Only planar
// faces; returns false otherwise. Orientation-independent (geometric frame).
bool FaceFrameInfo(const TopoDS_Shape& shape, const std::string& featureId,
                   const std::string& featureType, const std::string& role,
                   double origin[3], double xAxis[3], double yAxis[3],
                   double normal[3]);

// Edge roles (§4): "<featureId>:edge.<curve>.<adjA>~<adjB>" where adj are the
// short roles of the adjacent faces (sorted), e.g. "edge.lin.box.+Z~box.+X".
// Seam/degenerate edges keep type + order fallback ("edge.seam.0").
struct EdgeRoleDto {
  std::string persistentEdgeId;
  TopoDS_Edge edge;
};
std::vector<EdgeRoleDto> ClassifyEdgeRoles(
    const TopoDS_Shape& shape, const std::string& featureType,
    const std::string& featureId);

// Full persistent id is "<featureId>:<edge role>"; bare role also matches.
bool FindEdgeByRole(const TopoDS_Shape& shape, const std::string& featureId,
                    const std::string& featureType, const std::string& role,
                    TopoDS_Edge* out);
#endif

}  // namespace kreoda
