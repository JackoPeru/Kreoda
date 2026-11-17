#include "shell.h"

#include <cmath>
#include <sstream>

#include "document/document_store.h"
#include "features/fillet/fillet.h"
#include "model/commit.h"
#include "model/geometry_availability.h"
#include "model/feature_graph.h"
#include "model/shapes.h"
#include "topology/face_roles.h"

#if KREODA_WITH_OCCT
#include <BRepCheck_Analyzer.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <Standard_Failure.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>

#include "persistence/ocaf_live.h"
#endif

namespace kreoda {

#if KREODA_WITH_OCCT
namespace {

std::string JoinIds(const std::vector<std::string>& ids) {
  std::ostringstream os;
  for (size_t i = 0; i < ids.size(); ++i) {
    if (i) os << ",";
    os << ids[i];
  }
  return os.str();
}

bool ResolveFaces(const TopoDS_Shape& target, const std::string& targetId,
                  const std::string& targetType,
                  const std::vector<std::string>& faceIds,
                  std::vector<TopoDS_Face>* faces, std::string* error) {
  for (const auto& id : faceIds) {
    std::string role = id;
    const size_t cut = id.find(':');
    if (cut != std::string::npos) {
      const std::string owner = id.substr(0, cut);
      if (owner != targetId) {
        if (error) {
          *error = "face belongs to another feature (needs repair): " + id;
        }
        return false;
      }
      role = id.substr(cut + 1);
    }
    TopoDS_Face face;
    if (!FindFaceByRole(target, targetId, targetType, role, &face)) {
      if (error) {
        *error = "face vanished (needs repair): " + id +
                 " - edit to pick new faces";
      }
      return false;
    }
    faces->push_back(face);
  }
  return true;
}

bool ShellShape(const TopoDS_Shape& target, const std::string& targetId,
                const std::string& targetType,
                const std::vector<std::string>& faceIds, double thickness,
                TopoDS_Shape* out, std::string* error) {
  std::vector<TopoDS_Face> faces;
  if (!ResolveFaces(target, targetId, targetType, faceIds, &faces, error)) {
    return false;
  }
  try {
    TopTools_ListOfShape openings;
    for (const auto& face : faces) openings.Append(face);
    BRepOffsetAPI_MakeThickSolid mk;
    // Negative offset hollows inward; the listed faces stay open.
    mk.MakeThickSolidByJoin(target, openings, -thickness, 1.0e-3);
    mk.Build();
    if (!mk.IsDone()) return false;  // caller maps to a safe-range error
    TopoDS_Shape result = mk.Shape();
    if (result.IsNull() || !BRepCheck_Analyzer(result).IsValid(result)) {
      return false;
    }
    *out = result;
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("Shell: kernel exception: ") + f.what();
    return false;
  }
}

// Bounded binary search for the largest stable wall thickness in
// (0, requested]. Mirrors the fillet safe-range reporting so oversized
// requests get an actionable maximum instead of a bare failure.
bool FailsafeThickness(const TopoDS_Shape& target, const std::string& targetId,
                       const std::string& targetType,
                       const std::vector<std::string>& faceIds, double requested,
                       double* safeMax, std::string* error) {
  TopoDS_Shape probe;
  std::string dummy;
  if (!ShellShape(target, targetId, targetType, faceIds, 0.1, &probe, &dummy)) {
    if (error) {
      *error = "Shell could not be created even at 0.1 mm "
               "(faces may not support hollowing)";
    }
    return false;
  }
  double lo = 0.1;
  double hi = requested;
  for (int i = 0; i < 12; ++i) {
    const double mid = (lo + hi) / 2.0;
    TopoDS_Shape tmp;
    if (ShellShape(target, targetId, targetType, faceIds, mid, &tmp, &dummy)) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < 0.05) break;
  }
  *safeMax = lo;
  return lo > 0.1;
}

}  // namespace

bool BuildShellShape(const TopoDS_Shape& target, const std::string& targetId,
                     const std::string& targetType,
                     const std::vector<std::string>& faceIds, double thickness,
                     TopoDS_Shape* out, std::string* error) {
  return ShellShape(target, targetId, targetType, faceIds, thickness, out, error);
}

#endif

#if KREODA_WITH_OCCT

bool CreateShellFeature(const std::string& featureId, const std::string& targetId,
                        const std::vector<std::string>& faceIds,
                        double thicknessMm, std::string* error) {
  if (featureId.empty() || targetId.empty() || faceIds.empty()) {
    if (error) *error = "featureId, targetId and faceIds are required";
    return false;
  }
  if (!CheckNewId(featureId, error)) return false;
  for (const auto& id : faceIds) {
    if (id.find('|') != std::string::npos || id.find(',') != std::string::npos) {
      if (error) *error = "invalid face id characters: " + id;
      return false;
    }
  }
  if (!(thicknessMm > 0 && thicknessMm <= 100000)) {
    if (error) *error = "thickness must be in (0, 100000] mm";
    return false;
  }
  ShapeRecord target;
  if (!GetCurrentShapeRecord(targetId, &target, error)) return false;
  if (target.shape.IsNull()) {
    if (error) *error = "unknown target " + targetId;
    return false;
  }
  TopoDS_Shape shape;
  if (!BuildShellShape(target.shape, targetId, target.type, faceIds, thicknessMm,
                       &shape, nullptr)) {
    double safeMax = 0;
    if (FailsafeThickness(target.shape, targetId, target.type, faceIds,
                          thicknessMm, &safeMax, nullptr)) {
      if (error) {
        *error = "Shell could not be created at " + std::to_string(thicknessMm) +
                 " mm. Maximum stable value appears to be approximately " +
                 std::to_string(safeMax) + " mm.";
      }
    } else {
      if (error) {
        *error = "Shell could not be created at " + std::to_string(thicknessMm) +
                 " mm.";
      }
    }
    return false;
  }
  return CommitSingleFeature(featureId, "Shell", {thicknessMm}, {targetId},
                             JoinIds(faceIds), shape, error);
}

bool RebuildShellFromStore(const std::string& featureId, std::string* error) {
  ShapeRecord rec;
  if (!ShapeStore::instance().get(featureId, &rec)) {
    if (error) *error = "unknown feature " + featureId;
    return false;
  }
  if (rec.type != "Shell" || rec.paramsMm.size() != 1 ||
      rec.dependsOn.size() != 1) {
    if (error) *error = "cannot rebuild " + rec.type;
    return false;
  }
  if (!std::isfinite(rec.paramsMm[0]) ||
      !(rec.paramsMm[0] > 0 && rec.paramsMm[0] <= 100000)) {
    if (error) *error = "thickness must be in (0, 100000] mm";
    return false;
  }
  ShapeRecord target;
  if (!GetCurrentShapeRecord(rec.dependsOn[0], &target, error)) return false;
  if (target.shape.IsNull()) {
    if (error) {
      *error = "shell target vanished (needs repair): " + rec.dependsOn[0];
    }
    return false;
  }
  const std::vector<std::string> faceIds = SplitEdgeIds(rec.refExtra);
  TopoDS_Shape shape;
  if (!BuildShellShape(target.shape, target.featureId, target.type, faceIds,
                       rec.paramsMm[0], &shape, error)) {
    return false;
  }
  return CommitShape(featureId, rec.type, rec.paramsMm, rec.dependsOn,
                     rec.refExtra, shape, nullptr, false, error);
}

#else

bool CreateShellFeature(const std::string&, const std::string&,
                        const std::vector<std::string>&, double,
                        std::string* error) {
  if (error) *error = "shell requires OCCT (link via vcpkg)";
  return false;
}

bool RebuildShellFromStore(const std::string&, std::string* error) {
  if (error) *error = "shell requires OCCT (link via vcpkg)";
  return false;
}

#endif

}  // namespace kreoda
