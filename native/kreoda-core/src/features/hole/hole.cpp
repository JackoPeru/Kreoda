#include "hole.h"

#include <cmath>
#include <iomanip>
#include <set>
#include <sstream>
#include <utility>
#include <vector>

#include "document/document_store.h"
#include "model/body.h"
#include "model/commit.h"
#include "model/feature_graph.h"
#include "model/shapes.h"
#include "topology/face_roles.h"
#include "features/sketch/sketch_store.h"

#if KREODA_WITH_OCCT
#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepBndLib.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Plane.hxx>
#include <Standard_Failure.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include "persistence/ocaf_live.h"
#endif

namespace kreoda {

// Pure string codec (no OCCT): available in all configs for previews.
namespace {

std::string toPrec(double v) {
  std::ostringstream os;
  os << std::setprecision(17) << v;
  return os.str();
}

}  // namespace

bool DecodeHoleRef(const std::string& ref, std::string* faceRole, double* x,
                   double* y, std::string* mode) {
  auto field = [&](const char* key, std::string* v) {
    const std::string k = std::string(key) + "=";
    const size_t p = ref.find(k);
    if (p == std::string::npos) return false;
    const size_t e = ref.find(';', p + k.size());
    *v = ref.substr(p + k.size(),
                    e == std::string::npos ? e : e - p - k.size());
    return true;
  };
  std::string xs, ys;
  if (!field("face", faceRole) || !field("x", &xs) || !field("y", &ys) ||
      !field("mode", mode)) {
    return false;
  }
  try {
    *x = std::stod(xs);
    *y = std::stod(ys);
  } catch (...) {
    return false;
  }
  return true;
}

#if KREODA_WITH_OCCT
namespace {

// refExtra layout for holes: "face=<role>;x=<x>;y=<y>;mode=<mode>"
bool EncodeHoleRef(const std::string& faceRole, double x, double y,
                   const std::string& mode, std::string* out) {
  if (faceRole.find('|') != std::string::npos ||
      faceRole.find(',') != std::string::npos) {
    return false;
  }
  *out = "face=" + faceRole + ";x=" + toPrec(x) + ";y=" + toPrec(y) +
         ";mode=" + mode;
  return true;
}

}  // namespace (EncodeHoleRef stays local)

// Slice 5 cumulative-pattern codec. refExtra layout (no '|' anywhere — OCAF
// splits label comments on it, ocaf_live.cpp DecodeParams; ',' is free
// inside @ref, and face roles already exclude '|' and ','):
//   "pattern:face=<role>;mode=<mode>;pts=<x0>,<y0>,<x1>,<y1>,..."
// paramsMm stays [diameterMm, depthMm] (same slots as Hole); the point list
// mirrors the type-25 wire flat array. ';' separates fields (roles with ';'
// were already unencodable for single holes — same exposure, no regression).
bool EncodeHolePatternRef(
    const std::string& faceRole,
    const std::vector<std::pair<double, double>>& points,
    const std::string& mode, std::string* out) {
  if (faceRole.find('|') != std::string::npos ||
      faceRole.find(',') != std::string::npos ||
      faceRole.find(';') != std::string::npos) {
    return false;
  }
  std::ostringstream os;
  os << "pattern:face=" << faceRole << ";mode=" << mode << ";pts=";
  bool first = true;
  for (const auto& [x, y] : points) {
    if (!first) os << ",";
    first = false;
    os << toPrec(x) << "," << toPrec(y);
  }
  *out = os.str();
  return true;
}

bool DecodeHolePatternRef(const std::string& ref, std::string* faceRole,
                          std::vector<std::pair<double, double>>* points,
                          std::string* mode) {
  const std::string kPrefix = "pattern:";
  if (ref.rfind(kPrefix, 0) != 0) return false;
  std::string face, md, pts;
  std::string rest = ref.substr(kPrefix.size());
  while (!rest.empty()) {
    const size_t semi = rest.find(';');
    const std::string tok =
        semi == std::string::npos ? rest : rest.substr(0, semi);
    rest = semi == std::string::npos ? "" : rest.substr(semi + 1);
    const size_t eq = tok.find('=');
    if (eq == std::string::npos) return false;
    const std::string key = tok.substr(0, eq);
    const std::string val = tok.substr(eq + 1);
    if (key == "face") {
      face = val;
    } else if (key == "mode") {
      md = val;
    } else if (key == "pts") {
      pts = val;
    } else {
      return false;
    }
  }
  if (face.empty() || md.empty() || pts.empty()) return false;
  std::vector<double> nums;
  std::string cur;
  for (size_t i = 0; i <= pts.size(); ++i) {
    const char c = i < pts.size() ? pts[i] : ',';
    if ((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.' ||
        c == 'e' || c == 'E') {
      cur.push_back(c);
    } else if (c == ',') {
      if (cur.empty()) return false;
      try {
        nums.push_back(std::stod(cur));
      } catch (...) {
        return false;
      }
      cur.clear();
    } else {
      return false;
    }
  }
  if (nums.size() < 2 || nums.size() > 8 || nums.size() % 2 != 0) return false;
  std::vector<std::pair<double, double>> out;
  for (size_t i = 0; i < nums.size(); i += 2) {
    out.emplace_back(nums[i], nums[i + 1]);
  }
  if (faceRole) *faceRole = face;
  if (points) *points = out;
  if (mode) *mode = md;
  return true;
}

bool BuildHoleShape(const TopoDS_Shape& target, const std::string& targetId,
                    const std::string& targetType, const std::string& faceRole,
                    double xMm, double yMm, double diameterMm,
                    const std::string& mode, double depthMm, TopoDS_Shape* out,
                    std::string* error) {
  TopoDS_Face face;
  if (!FindFaceByRole(target, targetId, targetType, faceRole, &face)) {
    if (error) {
      *error = "hole face vanished (needs repair): " + faceRole +
               " — edit the hole to pick a new face";
    }
    return false;
  }
  BRepAdaptor_Surface adapt(face);
  if (adapt.GetType() != GeomAbs_Plane) {
    if (error) *error = "hole needs a planar face";
    return false;
  }
  const gp_Pln pln = adapt.Plane();
  const gp_Pnt loc = pln.Location();
  const gp_Dir nx = pln.XAxis().Direction();
  const gp_Dir ny = pln.YAxis().Direction();
  gp_Dir normal = pln.Axis().Direction();
  if (face.Orientation() == TopAbs_REVERSED) normal.Reverse();
  // Face-local point: location + x*nx + y*ny.
  const gp_Pnt center(loc.XYZ() + nx.XYZ() * xMm + ny.XYZ() * yMm);
  const double radius = diameterMm / 2.0;
  Bnd_Box bbox;
  BRepBndLib::Add(target, bbox);
  double xmin, ymin, zmin, xmax, ymax, zmax;
  bbox.Get(xmin, ymin, zmin, xmax, ymax, zmax);
  const double diag =
      std::sqrt((xmax - xmin) * (xmax - xmin) + (ymax - ymin) * (ymax - ymin) +
                (zmax - zmin) * (zmax - zmin));
  gp_Pnt base;
  double height = 0;
  if (mode == "throughAll") {
    // Start outside on the +normal side, drill past the far side.
    base = gp_Pnt(center.XYZ() + normal.XYZ() * (diag + 1.0));
    height = 2.0 * (diag + 1.0);
  } else if (mode == "blind") {
    if (!(depthMm > 0 && depthMm <= 100000)) {
      if (error) *error = "blind depth must be in (0, 100000] mm";
      return false;
    }
    base = gp_Pnt(center.XYZ() + normal.XYZ() * 0.5);
    height = depthMm + 0.5;
  } else {
    if (error) *error = "depthMode must be throughAll|blind";
    return false;
  }
  try {
    // Cylinder axis points INTO the solid (-normal), base above the face.
    const gp_Dir inward = normal.Reversed();
    BRepPrimAPI_MakeCylinder mk(gp_Ax2(base, inward), radius, height);
    mk.Build();
    if (!mk.IsDone()) {
      if (error) *error = "Hole: tool cylinder failed";
      return false;
    }
    BRepAlgoAPI_Cut cut(target, mk.Shape());
    cut.Build();
    if (!cut.IsDone()) {
      if (error) *error = "Hole: boolean cut failed";
      return false;
    }
    TopoDS_Shape result = cut.Shape();
    if (result.IsNull() || !BRepCheck_Analyzer(result).IsValid(result)) {
      if (error) *error = "Hole: result failed validation";
      return false;
    }
    // Miss guard (§41): compare against the TOOL volume, not the part —
    // a micro-hole in a giant part removes little in absolute terms, but
    // essentially all of the tool cylinder must intersect the solid.
    {
      const gp_Dir axisDir(gp_Vec(base, center));
      BRepPrimAPI_MakeCylinder toolProbe(gp_Ax2(base, axisDir), radius,
                                         height);
      toolProbe.Build();
      double toolVol = 0.0;
      if (toolProbe.IsDone()) {
        GProp_GProps tp;
        BRepGProp::VolumeProperties(toolProbe.Shape(), tp);
        toolVol = tp.Mass();
      }
      GProp_GProps before, after;
      BRepGProp::VolumeProperties(target, before);
      BRepGProp::VolumeProperties(result, after);
      if (!(before.Mass() - after.Mass() > 1e-3 * toolVol)) {
        if (error) {
          *error = "Hole misses the solid (position outside the face?)";
        }
        return false;
      }
    }
    *out = result;
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("Hole: kernel exception: ") + f.what();
    return false;
  }
}

bool CreateHoleFeature(const std::string& featureId,
                       const std::string& targetId,
                       const std::string& faceRole, double xMm, double yMm,
                       double diameterMm, const std::string& depthMode,
                       double depthMm, std::string* error) {
  if (featureId.empty() || targetId.empty() || faceRole.empty()) {
    if (error) *error = "featureId, targetId and faceRole are required";
    return false;
  }
  if (!CheckNewId(featureId, error)) return false;
  if (!(diameterMm > 0 && diameterMm <= 100000)) {
    if (error) *error = "hole diameter must be in (0, 100000] mm";
    return false;
  }
  if (depthMode != "throughAll" && depthMode != "blind") {
    if (error) *error = "depthMode must be throughAll|blind";
    return false;
  }
  ShapeRecord target;
  if (!ShapeStore::instance().get(targetId, &target) ||
      target.shape.IsNull()) {
    if (error) *error = "unknown target " + targetId;
    return false;
  }
  TopoDS_Shape shape;
  if (!BuildHoleShape(target.shape, targetId, target.type, faceRole, xMm, yMm,
                      diameterMm, depthMode, depthMm, &shape, error)) {
    return false;
  }
  std::string ref;
  if (!EncodeHoleRef(faceRole, xMm, yMm, depthMode, &ref)) {
    if (error) *error = "invalid face role characters";
    return false;
  }
  return CommitSingleFeature(featureId, "Hole", {diameterMm, depthMm},
                             {targetId}, ref, shape, error);
}

bool CreateHolePatternFeature(
    const std::string& targetId, const std::string& faceRole,
    const std::vector<std::pair<double, double>>& points, double diameterMm,
    const std::string& depthMode, double depthMm,
    const std::vector<std::string>& featureIds,
    std::vector<std::string>* createdIds, std::string* error) {
  if (targetId.empty() || faceRole.empty()) {
    if (error) *error = "targetId and faceRole are required";
    return false;
  }
  if (points.empty() || points.size() > 4) {
    if (error) *error = "hole pattern needs 1..4 points";
    return false;
  }
  if (featureIds.size() != points.size()) {
    if (error) *error = "featureIds must match points (1..4)";
    return false;
  }
  if (!(diameterMm > 0 && diameterMm <= 100000)) {
    if (error) *error = "hole diameter must be in (0, 100000] mm";
    return false;
  }
  if (depthMode != "throughAll" && depthMode != "blind") {
    if (error) *error = "depthMode must be throughAll|blind";
    return false;
  }
  if (depthMode == "blind" && !(depthMm > 0 && depthMm <= 100000)) {
    if (error) *error = "blind depth must be in (0, 100000] mm";
    return false;
  }
  for (const auto& fid : featureIds) {
    if (fid.empty()) {
      if (error) *error = "featureId is required";
      return false;
    }
    if (!ShapeStore::ValidFeatureId(fid)) {
      if (error) *error = "featureId must match [A-Za-z0-9_-]: " + fid;
      return false;
    }
    if (ShapeStore::instance().contains(fid) ||
        SketchStore::instance().contains(fid)) {
      if (error) *error = "id already exists: " + fid;
      return false;
    }
  }
  {
    std::set<std::string> seen;
    for (const auto& fid : featureIds) {
      if (!seen.insert(fid).second) {
        if (error) *error = "duplicate featureId in pattern: " + fid;
        return false;
      }
    }
  }
  for (const auto& [x, y] : points) {
    if (!std::isfinite(x) || !std::isfinite(y)) {
      if (error) *error = "hole position must be finite numbers";
      return false;
    }
  }
#if KREODA_WITH_OCCT
  ShapeRecord target;
  if (!ShapeStore::instance().get(targetId, &target) ||
      target.shape.IsNull()) {
    if (error) *error = "unknown target " + targetId;
    return false;
  }
  // Slice 5 cumulative: shape0 = target, shapeN = Cut(shapeN-1, holeN).
  // Pure builds run BEFORE the transaction opens — a failure anywhere
  // aborts with nothing created (atomic, no partial records to roll back).
  TopoDS_Shape current = target.shape;
  for (const auto& [x, y] : points) {
    TopoDS_Shape next;
    if (!BuildHoleShape(current, targetId, target.type, faceRole, x, y,
                        diameterMm, depthMode, depthMm, &next, error)) {
      return false;
    }
    current = next;
  }
  std::string ref;
  if (!EncodeHolePatternRef(faceRole, points, depthMode, &ref)) {
    if (error) *error = "invalid face role characters";
    return false;
  }
  // ONE HolePattern record as the body tip (committed under featureIds[0]).
  // One OCAF command stays the vehicle for one Undo step (as M11).
  if (!OcafLive::instance().BeginCommand(error)) return false;
  const bool ok = CommitShape(featureIds[0], "HolePattern",
                              {diameterMm, depthMm}, {targetId}, ref, current,
                              nullptr, false, error);
  if (!ok) {
    OcafLive::instance().AbortCommand();
    // M4: the aborted Upsert already inserted a label map entry — Abort
    // rolls back the document but not the in-memory maps. Resync rebuilds
    // them; if THAT fails, erase the never-committed id explicitly.
    {
      std::string rsErr;
      if (!OcafLive::instance().ResyncStore(&rsErr)) {
        OcafLive::instance().ForgetFeatures({featureIds[0]});
        if (error) {
          *error += " (resync failed: " + rsErr + ")";
        }
      }
    }
    return false;
  }
  bool hadDelta = false;
  OcafLive::instance().CommitCommand(&hadDelta, nullptr);
  DocumentStore::instance().commit();
  if (createdIds) *createdIds = {featureIds[0]};
  return true;
#else
  (void)points;
  (void)featureIds;
  (void)createdIds;
  if (error) *error = "holes require OCCT (link via vcpkg)";
  return false;
#endif
}

bool RebuildHoleFromStore(const std::string& featureId, std::string* error) {
  ShapeRecord rec;
  if (!ShapeStore::instance().get(featureId, &rec)) {
    if (error) *error = "unknown feature " + featureId;
    return false;
  }
  if (rec.type != "Hole" || rec.paramsMm.size() != 2 ||
      rec.dependsOn.size() != 1) {
    if (error) *error = "cannot rebuild " + rec.type;
    return false;
  }
  std::string faceRole, mode;
  double x = 0, y = 0;
  if (!DecodeHoleRef(rec.refExtra, &faceRole, &x, &y, &mode)) {
    if (error) *error = "hole record corrupted (needs repair)";
    return false;
  }
  ShapeRecord target;
  if (!ShapeStore::instance().get(rec.dependsOn[0], &target) ||
      target.shape.IsNull()) {
    if (error) {
      *error = "hole target vanished (needs repair): " + rec.dependsOn[0];
    }
    return false;
  }
  TopoDS_Shape shape;
  if (!BuildHoleShape(target.shape, target.featureId, target.type, faceRole,
                      x, y, rec.paramsMm[0], mode, rec.paramsMm[1], &shape,
                      error)) {
    return false;
  }
  return CommitShape(featureId, rec.type, rec.paramsMm, rec.dependsOn,
                     rec.refExtra, shape, nullptr, false, error);
}

bool RebuildHolePatternFromStore(const std::string& featureId,
                                 std::string* error) {
  ShapeRecord rec;
  if (!ShapeStore::instance().get(featureId, &rec)) {
    if (error) *error = "unknown feature " + featureId;
    return false;
  }
  if (rec.type != "HolePattern" || rec.paramsMm.size() != 2 ||
      rec.dependsOn.size() != 1) {
    if (error) *error = "cannot rebuild " + rec.type;
    return false;
  }
  std::string faceRole, mode;
  std::vector<std::pair<double, double>> points;
  if (!DecodeHolePatternRef(rec.refExtra, &faceRole, &points, &mode)) {
    if (error) *error = "hole pattern record corrupted (needs repair)";
    return false;
  }
  ShapeRecord target;
  if (!ShapeStore::instance().get(rec.dependsOn[0], &target) ||
      target.shape.IsNull()) {
    if (error) {
      *error =
          "hole pattern target vanished (needs repair): " + rec.dependsOn[0];
    }
    return false;
  }
  // Replay the sequential cuts from the live target (plate edits reflow).
  TopoDS_Shape current = target.shape;
  for (const auto& [x, y] : points) {
    TopoDS_Shape next;
    if (!BuildHoleShape(current, target.featureId, target.type, faceRole, x,
                        y, rec.paramsMm[0], mode, rec.paramsMm[1], &next,
                        error)) {
      return false;
    }
    current = next;
  }
  return CommitShape(featureId, rec.type, rec.paramsMm, rec.dependsOn,
                     rec.refExtra, current, nullptr, false, error);
}

#else

bool CreateHoleFeature(const std::string&, const std::string&,
                       const std::string&, double, double, double,
                       const std::string&, double, std::string* error) {
  if (error) *error = "holes require OCCT (link via vcpkg)";
  return false;
}

bool RebuildHoleFromStore(const std::string&, std::string* error) {
  if (error) *error = "holes require OCCT (link via vcpkg)";
  return false;
}

#endif

}  // namespace kreoda
