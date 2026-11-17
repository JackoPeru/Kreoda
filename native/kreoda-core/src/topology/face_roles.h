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
// Unique geometric roles survive parameter edits. When every face belongs to
// the sole solid, axis roles identify outer support faces; pure-surface
// collisions use indexed picks persisted through OCAF/TNaming. Multi-solid
// collisions stay ambiguous.
// Order follows the explorer sequence of the tessellator call.
#if KREODA_WITH_OCCT
// Ordinal roles can silently change owners when topology is inserted.
bool HasIndexedTopologyRole(const std::string& reference);
// Exact isoparametric boundary identity, or empty for other edges.
std::string ParameterBoundaryRole(const TopoDS_Edge& edge, const TopoDS_Face& face);
std::vector<std::string> ClassifyFaceRoles(const TopoDS_Shape& shape,
                                           const std::string& featureType,
                                           const std::string& featureId);

// Full persistent id is "<featureId>:<role>"; bare "<role>" also matches.
// Face lookup succeeds only when the requested role matches exactly one face.
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
bool FaceFrameInfo(const TopoDS_Face& face,double origin[3],double xAxis[3],
                   double yAxis[3],double normal[3]);

// Edge roles (§4): "<featureId>:edge.<curve>.<adjA>~<adjB>" where adj are the
// short roles of the adjacent faces (sorted), e.g. "edge.lin.box.+Z~box.+X".
// On pure surfaces, colliding free boundaries can use exact uMin/uMax/vMin/vMax
// identities on a uniquely named face; others use edge.<curve>.free.<index>.
struct EdgeRoleDto {
  std::string persistentEdgeId;
  TopoDS_Edge edge;
};
std::vector<EdgeRoleDto> ClassifyEdgeRoles(
    const TopoDS_Shape& shape, const std::string& featureType,
    const std::string& featureId);

// Full persistent id is "<featureId>:<edge role>"; bare role also matches.
// Pure surface references require exactly one match; solid lookup is unchanged.
bool FindEdgeByRole(const TopoDS_Shape& shape, const std::string& featureId,
                    const std::string& featureType, const std::string& role,
                    TopoDS_Edge* out);
#endif

}  // namespace kreoda
