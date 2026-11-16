// Mirror: a placed mirrored copy of a target solid across a principal plane.

#include "features/mirror/mirror.h"

#include <cmath>

#include "model/commit.h"
#include "model/geometry_availability.h"
#include "model/shapes.h"

#if KREODA_WITH_OCCT
// NOTE: OCCT includes must stay OUTSIDE namespace kreoda.
#include <BRepBuilderAPI_Transform.hxx>
#include <Standard_Failure.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#endif

namespace kreoda {

#if KREODA_WITH_OCCT
bool BuildMirrorTransform(const std::string& planeKind, gp_Trsf* out,
                          std::string* error) {
  if (!out) {
    if (error) *error = "mirror transform output is required";
    return false;
  }
  try {
    gp_Dir normal;
    if (planeKind == "XY") normal = gp_Dir(0, 0, 1);
    else if (planeKind == "XZ") normal = gp_Dir(0, 1, 0);
    else if (planeKind == "YZ") normal = gp_Dir(1, 0, 0);
    else {
      if (error) *error = "planeKind must be XY, XZ or YZ";
      return false;
    }
    out->SetMirror(gp_Ax2(gp_Pnt(0, 0, 0), normal));
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("mirror transform failed: ") + f.what();
    return false;
  }
}

bool BuildMirrorShape(const TopoDS_Shape& target, const std::string& planeKind,
                      TopoDS_Shape* out, std::string* error) {
  if (target.IsNull()) {
    if (error) *error = "mirror target has no shape";
    return false;
  }
  gp_Trsf trsf;
  if (!BuildMirrorTransform(planeKind, &trsf, error)) return false;
  try {
    BRepBuilderAPI_Transform mk(target, trsf, true);
    mk.Build();
    if (!mk.IsDone() || mk.Shape().IsNull()) {
      if (error) *error = "mirror transform failed";
      return false;
    }
    *out = mk.Shape();
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("mirror failed: ") + f.what();
    return false;
  }
}
#endif

bool CreateMirrorFeature(const std::string& featureId,
                         const std::string& targetId,
                         const std::string& planeKind, std::string* error) {
  if (featureId.empty() || targetId.empty()) {
    if (error) *error = "featureId and targetId are required";
    return false;
  }
  if (!CheckNewId(featureId, error)) return false;
  if (featureId == targetId) {
    if (error) *error = "a mirror cannot target itself";
    return false;
  }
#if KREODA_WITH_OCCT
  ShapeRecord target;
  if (!GetCurrentShapeRecord(targetId, &target, error)) return false;
  if (target.shape.IsNull()) {
    if (error) *error = "unknown target " + targetId;
    return false;
  }
  TopoDS_Shape shape;
  if (!BuildMirrorShape(target.shape, planeKind, &shape, error)) return false;
  return CommitSingleFeature(featureId, "Mirror", {}, {targetId}, planeKind,
                             shape, error);
#else
  (void)planeKind;
  if (error) *error = "mirror requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool RebuildMirrorFromStore(const std::string& featureId, std::string* error) {
  ShapeRecord rec;
  if (!ShapeStore::instance().get(featureId, &rec)) {
    if (error) *error = "unknown feature " + featureId;
    return false;
  }
  if (rec.type != "Mirror" || rec.dependsOn.size() != 1) {
    if (error) *error = "cannot rebuild " + rec.type;
    return false;
  }
#if KREODA_WITH_OCCT
  ShapeRecord target;
  if (!GetCurrentShapeRecord(rec.dependsOn[0], &target, error)) return false;
  if (target.shape.IsNull()) {
    if (error) {
      *error = "mirror target vanished (needs repair): " + rec.dependsOn[0];
    }
    return false;
  }
  if (rec.dependsOn[0] == featureId) {
    if (error) *error = "a mirror cannot target itself";
    return false;
  }
  TopoDS_Shape shape;
  if (!BuildMirrorShape(target.shape, rec.refExtra, &shape, error)) {
    return false;
  }
  return CommitShape(featureId, rec.type, rec.paramsMm, rec.dependsOn,
                     rec.refExtra, shape, nullptr, false, error);
#else
  if (error) *error = "mirror requires OCCT (link via vcpkg)";
  return false;
#endif
}

}  // namespace kreoda
