// Circular body pattern: rotated copies of a target solid as one new body.

#include "features/pattern/circular_body_pattern.h"

#include <cmath>
#include <vector>

#include "model/commit.h"
#include "model/geometry_availability.h"
#include "model/geometry_kind.h"
#include "model/shapes.h"

#if KREODA_WITH_OCCT
// NOTE: OCCT includes must stay OUTSIDE namespace kreoda.
#include <BRepBuilderAPI_Transform.hxx>
#include <BRep_Builder.hxx>
#include <Standard_Failure.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax1.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#endif

namespace kreoda {

namespace {

constexpr double kPi = 3.14159265358979323846;

bool ValidateCircularPatternArgs(const std::string& axis, int count,
                                 double totalAngleDeg, std::string* error) {
  if (axis != "X" && axis != "Y" && axis != "Z") {
    if (error) *error = "axis must be X, Y or Z";
    return false;
  }
  if (count < 2 || count > 64) {
    if (error) *error = "count must be between 2 and 64";
    return false;
  }
  if (!std::isfinite(totalAngleDeg) || totalAngleDeg <= 0 ||
      totalAngleDeg > 360) {
    if (error) *error = "angleDeg must be finite and between 0 and 360";
    return false;
  }
  return true;
}

}  // namespace

#if KREODA_WITH_OCCT
bool BuildCircularBodyPatternShape(const TopoDS_Shape& target,
                                   const std::string& axis, int count,
                                   double totalAngleDeg, TopoDS_Shape* out,
                                   std::string* error) {
  if (!out) {
    if (error) *error = "circular pattern output is required";
    return false;
  }
  if (target.IsNull()) {
    if (error) *error = "circular pattern target has no shape";
    return false;
  }
  if (!ValidateCircularPatternArgs(axis, count, totalAngleDeg, error)) {
    return false;
  }
  try {
    const bool fullCircle = totalAngleDeg >= 360.0 - 1e-9;
    const double stepDeg =
        fullCircle ? totalAngleDeg / static_cast<double>(count)
                   : totalAngleDeg / static_cast<double>(count - 1);
    const gp_Dir direction = axis == "X" ? gp_Dir(1, 0, 0)
                             : axis == "Y" ? gp_Dir(0, 1, 0)
                                           : gp_Dir(0, 0, 1);
    const gp_Ax1 rotationAxis(gp_Pnt(0, 0, 0), direction);
    BRep_Builder builder;
    TopoDS_Compound compound;
    builder.MakeCompound(compound);
    for (int i = 0; i < count; ++i) {
      const double angleRad =
          stepDeg * static_cast<double>(i) * kPi / 180.0;
      gp_Trsf trsf;
      trsf.SetRotation(rotationAxis, angleRad);
      BRepBuilderAPI_Transform copy(target, trsf, true);
      copy.Build();
      if (!copy.IsDone() || copy.Shape().IsNull()) {
        if (error) *error = "circular pattern copy failed";
        return false;
      }
      builder.Add(compound, copy.Shape());
    }
    *out = compound;
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("circular pattern failed: ") + f.what();
    return false;
  }
}
#endif

bool CreateCircularBodyPatternFeature(const std::string& featureId,
                                      const std::string& targetId,
                                      const std::string& axis, int count,
                                      double totalAngleDeg, std::string* error) {
  if (featureId.empty() || targetId.empty()) {
    if (error) *error = "featureId and targetId are required";
    return false;
  }
  if (!CheckNewId(featureId, error)) return false;
  if (featureId == targetId) {
    if (error) *error = "a circular pattern cannot target itself";
    return false;
  }
  if (!ValidateCircularPatternArgs(axis, count, totalAngleDeg, error)) {
    return false;
  }
#if KREODA_WITH_OCCT
  ShapeRecord target;
  if (!GetCurrentShapeRecord(targetId, &target, error)) return false;
  if (target.shape.IsNull()) {
    if (error) *error = "unknown target " + targetId;
    return false;
  }
  if (!IsKnownSolidFeatureType(target.type)) {
    if (error) *error = "circular pattern target is not a solid body: " + targetId;
    return false;
  }
  TopoDS_Shape shape;
  if (!BuildCircularBodyPatternShape(target.shape, axis, count, totalAngleDeg,
                                     &shape, error)) {
    return false;
  }
  return CommitSingleFeature(featureId, "CircularBodyPattern",
                             {static_cast<double>(count), totalAngleDeg},
                             {targetId}, axis, shape, error);
#else
  if (error) *error = "circular pattern requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool RebuildCircularBodyPatternFromStore(const std::string& featureId,
                                         std::string* error) {
  ShapeRecord rec;
  if (!ShapeStore::instance().get(featureId, &rec)) {
    if (error) *error = "unknown feature " + featureId;
    return false;
  }
  if (rec.type != "CircularBodyPattern" || rec.dependsOn.size() != 1 ||
      rec.paramsMm.size() != 2) {
    if (error) *error = "cannot rebuild " + rec.type;
    return false;
  }
  if (!std::isfinite(rec.paramsMm[0]) || rec.paramsMm[0] < 2 ||
      rec.paramsMm[0] > 64) {
    if (error) *error = "circular pattern count must be between 2 and 64";
    return false;
  }
  const int count = static_cast<int>(rec.paramsMm[0]);
  if (static_cast<double>(count) != rec.paramsMm[0]) {
    if (error) *error = "circular pattern count must be an integer";
    return false;
  }
  if (!ValidateCircularPatternArgs(rec.refExtra, count, rec.paramsMm[1],
                                   error)) {
    return false;
  }
#if KREODA_WITH_OCCT
  ShapeRecord target;
  if (!GetCurrentShapeRecord(rec.dependsOn[0], &target, error)) return false;
  if (target.shape.IsNull()) {
    if (error) {
      *error = "circular pattern target vanished (needs repair): " +
               rec.dependsOn[0];
    }
    return false;
  }
  if (!IsKnownSolidFeatureType(target.type)) {
    if (error) *error = "circular pattern target is not a solid body";
    return false;
  }
  if (rec.dependsOn[0] == featureId) {
    if (error) *error = "a circular pattern cannot target itself";
    return false;
  }
  TopoDS_Shape shape;
  if (!BuildCircularBodyPatternShape(target.shape, rec.refExtra, count,
                                     rec.paramsMm[1], &shape, error)) {
    return false;
  }
  return CommitShape(featureId, rec.type, rec.paramsMm, rec.dependsOn,
                     rec.refExtra, shape, nullptr, false, error);
#else
  if (error) *error = "circular pattern requires OCCT (link via vcpkg)";
  return false;
#endif
}

}  // namespace kreoda
