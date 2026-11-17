// Mirror: a placed mirrored copy of a target solid across a principal plane
// at the origin or an existing DatumPlane.

#include "features/mirror/mirror.h"

#include <cmath>
#include <vector>

#include "features/datum/datum_store.h"
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
bool BuildMirrorTransform(const std::string& planeKind,
                          const std::string& datumId, gp_Trsf* out,
                          std::string* error) {
  if (!out) {
    if (error) *error = "mirror transform output is required";
    return false;
  }
  if (!planeKind.empty() && !datumId.empty()) {
    if (error) *error = "use either planeKind or datumId, not both";
    return false;
  }
  try {
    gp_Pnt origin(0, 0, 0);
    gp_Dir normal;
    if (!datumId.empty()) {
      DatumRecord datum;
      if (!DatumStore::instance().get(datumId, &datum)) {
        if (error) *error = "unknown mirror datum " + datumId;
        return false;
      }
      if (datum.kind != DatumKind::Plane) {
        if (error) *error = "mirror datum must be a DatumPlane: " + datumId;
        return false;
      }
      if (datum.status != "ok") {
        if (error) *error = "mirror datum is not valid: " + datum.error;
        return false;
      }
      origin = gp_Pnt(datum.plane.origin[0], datum.plane.origin[1],
                      datum.plane.origin[2]);
      normal = gp_Dir(datum.plane.normal[0], datum.plane.normal[1],
                      datum.plane.normal[2]);
    } else {
      const std::string kind = planeKind.empty() ? "XY" : planeKind;
      if (kind == "XY") normal = gp_Dir(0, 0, 1);
      else if (kind == "XZ") normal = gp_Dir(0, 1, 0);
      else if (kind == "YZ") normal = gp_Dir(1, 0, 0);
      else {
        if (error) *error = "planeKind must be XY, XZ or YZ";
        return false;
      }
    }
    out->SetMirror(gp_Ax2(origin, normal));
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("mirror transform failed: ") + f.what();
    return false;
  }
}

bool BuildMirrorShape(const TopoDS_Shape& target, const std::string& planeKind,
                      const std::string& datumId, TopoDS_Shape* out,
                      std::string* error) {
  if (target.IsNull()) {
    if (error) *error = "mirror target has no shape";
    return false;
  }
  gp_Trsf trsf;
  if (!BuildMirrorTransform(planeKind, datumId, &trsf, error)) return false;
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
                         const std::string& planeKind,
                         const std::string& datumId, std::string* error) {
  if (featureId.empty() || targetId.empty()) {
    if (error) *error = "featureId and targetId are required";
    return false;
  }
  if (!CheckNewId(featureId, error)) return false;
  if (featureId == targetId) {
    if (error) *error = "a mirror cannot target itself";
    return false;
  }
  if (!planeKind.empty() && !datumId.empty()) {
    if (error) *error = "use either planeKind or datumId, not both";
    return false;
  }
  const std::string effectivePlane =
      planeKind.empty() && datumId.empty() ? "XY" : planeKind;
#if KREODA_WITH_OCCT
  ShapeRecord target;
  if (!GetCurrentShapeRecord(targetId, &target, error)) return false;
  if (target.shape.IsNull()) {
    if (error) *error = "unknown target " + targetId;
    return false;
  }
  TopoDS_Shape shape;
  if (!BuildMirrorShape(target.shape, effectivePlane, datumId, &shape, error)) {
    return false;
  }
  std::vector<std::string> dependsOn{targetId};
  if (!datumId.empty()) dependsOn.push_back(datumId);
  const std::string refExtra =
      datumId.empty() ? effectivePlane : "datum:" + datumId;
  return CommitSingleFeature(featureId, "Mirror", {}, dependsOn, refExtra,
                             shape, error);
#else
  (void)effectivePlane;
  (void)datumId;
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
  if (rec.type != "Mirror" || rec.dependsOn.empty()) {
    if (error) *error = "cannot rebuild " + rec.type;
    return false;
  }
  std::string planeKind;
  std::string datumId;
  const std::string datumPrefix = "datum:";
  if (rec.refExtra.rfind(datumPrefix, 0) == 0) {
    datumId = rec.refExtra.substr(datumPrefix.size());
  } else {
    planeKind = rec.refExtra;
  }
  if (planeKind.empty() && datumId.empty()) {
    if (error) *error = "mirror plane reference is missing";
    return false;
  }
  if (!datumId.empty() && rec.dependsOn.size() < 2) {
    if (error) *error = "mirror datum dependency is missing";
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
  if (!BuildMirrorShape(target.shape, planeKind, datumId, &shape, error)) {
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
