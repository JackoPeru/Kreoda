// Rigid instance: placed live copy of a target solid (Phase 9d).

#include "features/instance/instance.h"

#include <cmath>

#include "model/commit.h"
#include "model/shapes.h"
#include "features/sketch/sketch_store.h"
#include "persistence/ocaf_live.h"

#if KREODA_WITH_OCCT
// NOTE: OCCT includes must stay OUTSIDE namespace kreoda.
#include <BRepBuilderAPI_Transform.hxx>
#include <Standard_Failure.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax1.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#endif

namespace kreoda {

#if KREODA_WITH_OCCT
namespace {

constexpr double kDegToRad = 3.141592653589793 / 180.0;

// Placement trsf: translate AFTER extrinsic ZYX rotation
// (R = Rz·Ry·Rx applied first, then T) — documented convention.
bool PlacementTrsf(const std::vector<double>& p, gp_Trsf* out,
                   std::string* error) {
  if (p.size() != 6) {
    if (error) *error = "placement needs 6 numbers (tx ty tz rx ry rz)";
    return false;
  }
  for (double v : p) {
    if (!std::isfinite(v)) {
      if (error) *error = "placement must be finite numbers";
      return false;
    }
  }
  for (int i = 0; i < 3; ++i) {
    if (p[static_cast<size_t>(i)] < -1000000.0 ||
        p[static_cast<size_t>(i)] > 1000000.0) {
      if (error) *error = "instance translation must be within ±1000000 mm";
      return false;
    }
  }
  try {
    gp_Trsf rx, ry, rz, t;
    rx.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0)),
                   p[3] * kDegToRad);
    ry.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0)),
                   p[4] * kDegToRad);
    rz.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)),
                   p[5] * kDegToRad);
    t.SetTranslation(gp_Vec(p[0], p[1], p[2]));
    gp_Trsf placement = t;
    placement.Multiply(rz);
    placement.Multiply(ry);
    placement.Multiply(rx);
    *out = placement;
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("placement failed: ") + f.what();
    return false;
  }
}

}  // namespace
#endif

#if KREODA_WITH_OCCT
bool BuildInstanceShape(const TopoDS_Shape& target,
                        const std::vector<double>& placement,
                        TopoDS_Shape* out, std::string* error) {
  if (target.IsNull()) {
    if (error) *error = "instance target has no shape";
    return false;
  }
  gp_Trsf trsf;
  if (!PlacementTrsf(placement, &trsf, error)) return false;
  try {
    BRepBuilderAPI_Transform mk(target, trsf, true);
    mk.Build();
    if (!mk.IsDone() || mk.Shape().IsNull()) {
      if (error) *error = "instance transform failed";
      return false;
    }
    *out = mk.Shape();
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("instance failed: ") + f.what();
    return false;
  }
}
#endif

bool CreateInstanceFeature(const std::string& featureId,
                           const std::string& targetId,
                           const std::vector<double>& placement,
                           std::string* error) {
  if (featureId.empty() || targetId.empty()) {
    if (error) *error = "featureId and targetId are required";
    return false;
  }
  if (!ShapeStore::ValidFeatureId(featureId)) {
    if (error) *error = "featureId must match [A-Za-z0-9_-]";
    return false;
  }
  if (featureId == targetId) {
    if (error) *error = "an instance cannot target itself";
    return false;
  }
  if (ShapeStore::instance().contains(featureId) ||
      SketchStore::instance().contains(featureId)) {
    if (error) *error = "id already exists: " + featureId;
    return false;
  }
#if KREODA_WITH_OCCT
  ShapeRecord target;
  if (!ShapeStore::instance().get(targetId, &target) ||
      target.shape.IsNull()) {
    if (error) *error = "unknown target " + targetId;
    return false;
  }
  if (target.type == "Instance") {
    if (error) *error = "nested instances are not supported (slice 1)";
    return false;
  }
  TopoDS_Shape shape;
  if (!BuildInstanceShape(target.shape, placement, &shape, error)) {
    return false;
  }
  if (!OcafLive::instance().BeginCommand(error)) return false;
  const bool ok = CommitShape(featureId, "Instance", placement, {targetId},
                              std::string(), shape, nullptr, true, error);
  if (!ok) {
    OcafLive::instance().AbortCommand();
    return false;
  }
  bool hadDelta = false;
  OcafLive::instance().CommitCommand(&hadDelta, nullptr);
  return true;
#else
  (void)placement;
  if (error) *error = "instances require OCCT (link via vcpkg)";
  return false;
#endif
}

bool RebuildInstanceFromStore(const std::string& featureId,
                              std::string* error) {
  ShapeRecord rec;
  if (!ShapeStore::instance().get(featureId, &rec)) {
    if (error) *error = "unknown feature " + featureId;
    return false;
  }
  if (rec.type != "Instance" || rec.paramsMm.size() != 6 ||
      rec.dependsOn.size() != 1) {
    if (error) *error = "cannot rebuild " + rec.type;
    return false;
  }
#if KREODA_WITH_OCCT
  ShapeRecord target;
  if (!ShapeStore::instance().get(rec.dependsOn[0], &target) ||
      target.shape.IsNull()) {
    if (error) {
      *error = "instance target vanished (needs repair): " + rec.dependsOn[0];
    }
    return false;
  }
  // C8: nesting must fail honestly, never stack transforms silently.
  if (target.type == "Instance") {
    if (error) *error = "nested instances are not supported (slice 1)";
    return false;
  }
  if (rec.dependsOn[0] == featureId) {
    if (error) *error = "an instance cannot target itself";
    return false;
  }
  TopoDS_Shape shape;
  if (!BuildInstanceShape(target.shape, rec.paramsMm, &shape, error)) {
    return false;
  }
  return CommitShape(featureId, rec.type, rec.paramsMm, rec.dependsOn,
                     rec.refExtra, shape, nullptr, false, error);
#else
  if (error) *error = "instances require OCCT (link via vcpkg)";
  return false;
#endif
}

}  // namespace kreoda
