#include "face_roles.h"

#if KREODA_WITH_OCCT
#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRep_Tool.hxx>
#include <GeomAbs_CurveType.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <algorithm>
#include <cmath>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>

namespace kreoda {

namespace {

const char* axisRole(double nx, double ny, double nz, double tol,
                     const char* neg, const char* pos) {
  if (nx > 1 - tol && std::fabs(ny) < tol && std::fabs(nz) < tol) return pos;
  if (nx < -(1 - tol) && std::fabs(ny) < tol && std::fabs(nz) < tol) return neg;
  return nullptr;
}

}  // namespace

std::vector<std::string> ClassifyFaceRoles(const TopoDS_Shape& shape,
                                           const std::string& featureType,
                                           const std::string& featureId) {
  std::vector<std::string> roles;
  int plain = 0, wall = 0, cap = 0;
  for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
    const TopoDS_Face& face = TopoDS::Face(ex.Current());
    BRepAdaptor_Surface adapt(face);
    std::string role = "face." + std::to_string(plain++);
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
        role = (r && (std::string(r) == "box.+Z" || std::string(r) == "box.-Z"))
                   ? ("cyl." + std::string(r).substr(4))
                   : "cyl.side";
      } else if (featureType == "Extrude") {
        // Prism caps: axis-aligned planes keep axis roles under the extrude
        // prefix (stable across distance edits); other planes are side walls.
        role = r ? ("extrude." + std::string(r).substr(4)) : "extrude.side";
      } else if (featureType == "Revolve") {
        role = r ? ("revolve." + std::string(r).substr(4)) : "revolve.side";
      } else if (r) {
        role = r;
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
  }
  return roles;
}

bool FindFaceByRole(const TopoDS_Shape& shape, const std::string& featureId,
                    const std::string& featureType, const std::string& role,
                    TopoDS_Face* out) {
  const std::string full = featureId + ":" + role;
  const std::vector<std::string> roles =
      ClassifyFaceRoles(shape, featureType, featureId);
  size_t fi = 0;
  for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More();
       ex.Next(), ++fi) {
    if (fi < roles.size() &&
        (roles[fi] == full || roles[fi] == role)) {
      if (out) *out = TopoDS::Face(ex.Current());
      return true;
    }
  }
  return false;
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
    out.push_back({featureId + ":" + role, edge});
  }
  return out;
}

bool FindEdgeByRole(const TopoDS_Shape& shape, const std::string& featureId,
                    const std::string& featureType, const std::string& role,
                    TopoDS_Edge* out) {
  const std::string full = featureId + ":" + role;
  for (const auto& er : ClassifyEdgeRoles(shape, featureType, featureId)) {
    if (er.persistentEdgeId == full || er.persistentEdgeId == role) {
      if (out) *out = er.edge;
      return true;
    }
  }
  return false;
}

bool FaceFrameInfo(const TopoDS_Shape& shape, const std::string& featureId,
                   const std::string& featureType, const std::string& role,
                   double origin[3], double xAxis[3], double yAxis[3],
                   double normal[3]) {
  TopoDS_Face face;
  if (!FindFaceByRole(shape, featureId, featureType, role, &face)) {
    return false;
  }
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
