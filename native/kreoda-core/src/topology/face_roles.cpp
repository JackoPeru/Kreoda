#include "face_roles.h"

#if KREODA_WITH_OCCT
#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <Geom2dAdaptor_Curve.hxx>
#include <Geom2d_Curve.hxx>
#include <GeomAbs_CurveType.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <Precision.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <algorithm>
#include <cmath>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <map>
#include <set>

namespace kreoda {

namespace {

const char* axisRole(double nx, double ny, double nz, double tol,
                     const char* neg, const char* pos) {
  if (nx > 1 - tol && std::fabs(ny) < tol && std::fabs(nz) < tol) return pos;
  if (nx < -(1 - tol) && std::fabs(ny) < tol && std::fabs(nz) < tol) return neg;
  return nullptr;
}

}  // namespace

std::string ParameterBoundaryRole(const TopoDS_Edge& edge, const TopoDS_Face& face) {
  if (face.IsNull()) return {};
  Standard_Real first = 0, last = 0;
  const auto curve = BRep_Tool::CurveOnSurface(edge, face, first, last);
  if (curve.IsNull() || !std::isfinite(first) || !std::isfinite(last) ||
      Geom2dAdaptor_Curve(curve).GetType() != GeomAbs_Line) return {};
  double u0, u1, v0, v1;
  BRepTools::UVBounds(face, u0, u1, v0, v1);
  if (!std::isfinite(u0) || !std::isfinite(u1) ||
      !std::isfinite(v0) || !std::isfinite(v1)) return {};
  const auto a = curve->Value(first), b = curve->Value(last);
  const double tolerance = Precision::PConfusion();
  if (std::abs(a.X() - b.X()) <= tolerance) {
    if (std::abs(a.X() - u0) <= tolerance) return "uMin";
    if (std::abs(a.X() - u1) <= tolerance) return "uMax";
  }
  if (std::abs(a.Y() - b.Y()) <= tolerance) {
    if (std::abs(a.Y() - v0) <= tolerance) return "vMin";
    if (std::abs(a.Y() - v1) <= tolerance) return "vMax";
  }
  return {};
}

bool HasIndexedTopologyRole(const std::string& reference) {
  for (const auto* token : {"wall.", "face.", "free.", "ring.", "cone.", "sph."}) {
    const auto pos = reference.find(token);
    if (pos != std::string::npos) {
      const auto next = pos + std::char_traits<char>::length(token);
      if (next < reference.size() && reference[next] >= '0' && reference[next] <= '9') return true;
    }
  }
  return false;
}

std::vector<std::string> ClassifyFaceRoles(const TopoDS_Shape& shape,
                                           const std::string& featureType,
                                           const std::string& featureId) {
  std::vector<std::string> roles;
  std::vector<std::string> fallbackRoles;
  std::vector<std::string> supportRoles;
  std::vector<gp_Dir> supportNormals;
  std::vector<gp_Pnt> supportPoints;
  std::vector<double> supportTolerances;
  std::size_t solidCount = 0;
  TopoDS_Shape soleSolid;
  for (TopExp_Explorer ex(shape, TopAbs_SOLID); ex.More(); ex.Next()) {
    ++solidCount;
    if (solidCount == 1) soleSolid = ex.Current();
  }
  bool supportFilterEligible = false;
  if (solidCount == 1) {
    std::size_t shapeFaceCount = 0;
    std::size_t solidFaceCount = 0;
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next())
      ++shapeFaceCount;
    for (TopExp_Explorer ex(soleSolid, TopAbs_FACE); ex.More(); ex.Next())
      ++solidFaceCount;
    supportFilterEligible = shapeFaceCount == solidFaceCount;
  }
  int plain = 0, wall = 0, cap = 0;
  for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
    const TopoDS_Face& face = TopoDS::Face(ex.Current());
    BRepAdaptor_Surface adapt(face);
    const std::string fallbackRole = "face." + std::to_string(plain++);
    std::string role = fallbackRole;
    std::string supportRole;
    gp_Dir supportNormal;
    gp_Pnt supportPoint;
    double supportTolerance = Precision::Confusion();
    const GeomAbs_SurfaceType st = adapt.GetType();
    if (st == GeomAbs_Plane) {
      gp_Dir n = adapt.Plane().Axis().Direction();
      if (face.Orientation() == TopAbs_REVERSED) n.Reverse();
      const double tol = 1e-6;
      const double nx = n.X(), ny = n.Y(), nz = n.Z();
      const char* r = axisRole(nx, ny, nz, tol, "box.-X", "box.+X");
      if (!r) r = axisRole(ny, nx, nz, tol, "box.-Y", "box.+Y");
      if (!r) r = axisRole(nz, nx, ny, tol, "box.-Z", "box.+Z");
      if (featureType == "Cylinder") {
        // Axial caps keep +Z/-Z roles; any other plane is a side patch.
        if (r && (std::string(r) == "box.+Z" || std::string(r) == "box.-Z")) {
          role = "cyl." + std::string(r).substr(4);
          supportRole = r;
        } else {
          role = "cyl.side";
        }
      } else if (featureType == "Extrude") {
        // Prism caps: axis-aligned planes keep axis roles under the extrude
        // prefix (stable across distance edits); other planes are side walls.
        if (r) {
          role = "extrude." + std::string(r).substr(4);
          supportRole = r;
        } else {
          role = "extrude.side";
        }
      } else if (featureType == "Revolve") {
        if (r) {
          role = "revolve." + std::string(r).substr(4);
          supportRole = r;
        } else {
          role = "revolve.side";
        }
      } else if (r) {
        role = r;
        supportRole = r;
      }
      if (!supportRole.empty()) {
        supportNormal = n;
        supportPoint = adapt.Plane().Location();
        supportTolerance = std::max(Precision::Confusion(),
                                    BRep_Tool::Tolerance(face));
      }
    } else if (st == GeomAbs_Cylinder) {
      if (featureType == "Cylinder") {
        role = "cyl.wall";
      } else if (featureType == "Extrude") {
        role = "extrude.wall";
      } else if (featureType == "Revolve") {
        role = "revolve.wall";
      } else {
        role = "wall." + std::to_string(wall++);
      }
    } else if (st == GeomAbs_Sphere) {
      role = (featureType == "Sphere") ? "sph.all"
                                      : ("sph." + std::to_string(cap++));
    } else if (st == GeomAbs_Torus) {
      role = (featureType == "Revolve") ? "revolve.ring"
                                       : ("ring." + std::to_string(cap++));
    } else if (st == GeomAbs_Cone) {
      role = "cone." + std::to_string(cap++);
    } else {
      role = "free." + std::to_string(cap++);
    }
    roles.push_back(featureId + ":" + role);
    fallbackRoles.push_back(fallbackRole);
    supportRoles.push_back(supportRole);
    supportNormals.push_back(supportNormal);
    supportPoints.push_back(supportPoint);
    supportTolerances.push_back(supportTolerance);
  }
  if (supportFilterEligible) {
    // Axis roles tolerate near-axis normals; support filtering must only
    // compare parallel oriented planes and use translation-invariant offsets.
    for (std::size_t i = 0; i < roles.size(); ++i) {
      if (supportRoles[i].empty()) continue;
      for (std::size_t j = 0; j < roles.size(); ++j) {
        if (i == j || supportRoles[j] != supportRoles[i] ||
            !supportNormals[i].IsEqual(supportNormals[j], Precision::Angular()))
          continue;
        const double relativeSupport =
            supportNormals[i].X() * (supportPoints[j].X() - supportPoints[i].X()) +
            supportNormals[i].Y() * (supportPoints[j].Y() - supportPoints[i].Y()) +
            supportNormals[i].Z() * (supportPoints[j].Z() - supportPoints[i].Z());
        const double tolerance = std::max(
            {Precision::Confusion(), supportTolerances[i], supportTolerances[j]});
        if (relativeSupport > tolerance) {
          roles[i] = featureId + ":" + fallbackRoles[i];
          break;
        }
      }
    }
  }
  // Pure surface picks need distinct acquisition IDs; solid role collisions
  // remain visible to the established ambiguity checks and solid tools.
  if (solidCount != 0) return roles;
  std::map<std::string, std::size_t> counts;
  for (const auto& role : roles) ++counts[role];
  for (std::size_t i = 0; i < roles.size(); ++i)
    if (counts[roles[i]] > 1) roles[i] = featureId + ":face." + std::to_string(i);
  return roles;
}

bool FindFaceByRole(const TopoDS_Shape& shape, const std::string& featureId,
                    const std::string& featureType, const std::string& role,
                    TopoDS_Face* out) {
  const std::string full = featureId + ":" + role;
  const std::vector<std::string> roles =
      ClassifyFaceRoles(shape, featureType, featureId);
  size_t fi = 0;
  TopoDS_Face match;
  std::size_t matches = 0;
  for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More();
       ex.Next(), ++fi) {
    if (fi < roles.size() &&
        (roles[fi] == full || roles[fi] == role)) {
      match = TopoDS::Face(ex.Current());
      ++matches;
    }
  }
  if (matches != 1) return false;
  if (out) *out = match;
  return true;
}

std::vector<EdgeRoleDto> ClassifyEdgeRoles(
    const TopoDS_Shape& shape, const std::string& featureType,
    const std::string& featureId) {
  std::vector<EdgeRoleDto> out;
  // Faces with roles for adjacency naming.
  const std::vector<std::string> faceRoles =
      ClassifyFaceRoles(shape, featureType, featureId);
  std::vector<TopoDS_Face> faces;
  for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
    faces.push_back(TopoDS::Face(ex.Current()));
  }
  const auto shortRole = [&](const TopoDS_Face& f) -> std::string {
    for (size_t i = 0; i < faces.size() && i < faceRoles.size(); ++i) {
      if (faces[i].IsSame(f)) {
        const std::string& full = faceRoles[i];
        const size_t cut = full.find(':');
        return (cut == std::string::npos) ? full : full.substr(cut + 1);
      }
    }
    return "unknown";
  };
  TopTools_IndexedDataMapOfShapeListOfShape edgeFaces;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
  std::vector<TopoDS_Edge> seen;
  struct PendingRole { std::string role, curve; TopoDS_Edge edge; TopoDS_Face face; };
  std::vector<PendingRole> pending;
  std::map<std::string, std::size_t> roleCounts;
  int freeCount = 0;
  for (TopExp_Explorer ex(shape, TopAbs_EDGE); ex.More(); ex.Next()) {
    const TopoDS_Edge edge = TopoDS::Edge(ex.Current());
    bool duplicate = false;
    for (const auto& s : seen) {
      if (s.IsSame(edge)) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) continue;
    seen.push_back(edge);
    if (BRep_Tool::Degenerated(edge)) continue;  // poles, not pickable
    BRepAdaptor_Curve adapt(edge);
    const char* curve = "oth";
    switch (adapt.GetType()) {
      case GeomAbs_Line: curve = "lin"; break;
      case GeomAbs_Circle: curve = "cir"; break;
      case GeomAbs_Ellipse: curve = "ell"; break;
      case GeomAbs_Hyperbola: curve = "hyp"; break;
      case GeomAbs_Parabola: curve = "par"; break;
      case GeomAbs_BezierCurve: curve = "bez"; break;
      case GeomAbs_BSplineCurve: curve = "spl"; break;
      default: break;
    }
    std::vector<std::string> adj;
    if (edgeFaces.Contains(edge)) {
      for (TopTools_ListIteratorOfListOfShape it(
               edgeFaces.FindFromKey(edge));
           it.More(); it.Next()) {
        adj.push_back(shortRole(TopoDS::Face(it.Value())));
      }
    }
    std::sort(adj.begin(), adj.end());
    std::string role;
    if (adj.size() >= 2) {
      role = std::string("edge.") + curve + "." + adj[0] + "~" + adj[1];
    } else if (adj.size() == 1) {
      role = std::string("edge.") + curve + "." + adj[0];
    } else {
      role = std::string("edge.") + curve + ".free." +
             std::to_string(freeCount++);
    }
    ++roleCounts[role];
    TopoDS_Face parameterFace;
    if (adj.size() == 1 && !HasIndexedTopologyRole(adj.front()))
      parameterFace = TopoDS::Face(edgeFaces.FindFromKey(edge).First());
    pending.push_back({std::move(role), curve, edge, parameterFace});
  }
  if (TopExp_Explorer(shape, TopAbs_SOLID).More()) {
    for (const auto& item : pending) out.push_back({featureId + ":" + item.role, item.edge});
    return out;
  }
  for (auto& item : pending) {
    if (roleCounts[item.role] <= 1) continue;
    const auto boundary = ParameterBoundaryRole(item.edge, item.face);
    if (!boundary.empty()) item.role += "." + boundary;
  }
  roleCounts.clear();
  for (const auto& item : pending) ++roleCounts[item.role];
  std::set<std::string> used;
  for (const auto& item : pending)
    if (roleCounts[item.role] == 1) used.insert(item.role);
  out.reserve(pending.size());
  for (std::size_t i = 0; i < pending.size(); ++i) {
    const auto& item = pending[i];
    std::string role = item.role;
    if (roleCounts[role] > 1) {
      std::size_t index = i;
      do { role = "edge." + item.curve + ".free." + std::to_string(index++); }
      while (used.count(role));
      used.insert(role);
    }
    out.push_back({featureId + ":" + role, item.edge});
  }
  return out;
}

bool FindEdgeByRole(const TopoDS_Shape& shape, const std::string& featureId,
                    const std::string& featureType, const std::string& role,
                    TopoDS_Edge* out) {
  const std::string full = featureId + ":" + role;
  TopoDS_Edge match;
  std::size_t matches = 0;
  for (const auto& er : ClassifyEdgeRoles(shape, featureType, featureId)) {
    if (er.persistentEdgeId == full || er.persistentEdgeId == role) {
      if (TopExp_Explorer(shape, TopAbs_SOLID).More()) {
        if (out) *out = er.edge;
        return true;
      }
      match = er.edge;
      ++matches;
    }
  }
  if (matches != 1) return false;
  if (out) *out = match;
  return true;
}

bool FaceFrameInfo(const TopoDS_Shape& shape, const std::string& featureId,
                   const std::string& featureType, const std::string& role,
                   double origin[3], double xAxis[3], double yAxis[3],
                   double normal[3]) {
  TopoDS_Face face;
  if (!FindFaceByRole(shape, featureId, featureType, role, &face)) {
    return false;
  }
  return FaceFrameInfo(face,origin,xAxis,yAxis,normal);
}

bool FaceFrameInfo(const TopoDS_Face& face,double origin[3],double xAxis[3],
                   double yAxis[3],double normal[3]) {
  BRepAdaptor_Surface adapt(face);
  if (adapt.GetType() != GeomAbs_Plane) return false;
  const gp_Pln pln = adapt.Plane();
  const gp_Pnt loc = pln.Location();
  origin[0] = loc.X();
  origin[1] = loc.Y();
  origin[2] = loc.Z();
  const gp_Dir nx = pln.XAxis().Direction();
  const gp_Dir ny = pln.YAxis().Direction();
  xAxis[0] = nx.X();
  xAxis[1] = nx.Y();
  xAxis[2] = nx.Z();
  yAxis[0] = ny.X();
  yAxis[1] = ny.Y();
  yAxis[2] = ny.Z();
  gp_Dir n = pln.Axis().Direction();
  if (face.Orientation() == TopAbs_REVERSED) n.Reverse();
  normal[0] = n.X();
  normal[1] = n.Y();
  normal[2] = n.Z();
  return true;
}

}  // namespace kreoda
#endif
