// Linear body pattern: translated copies of a target solid as one new body.

#include "features/pattern/body_pattern.h"

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
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#endif

namespace kreoda {

namespace {

bool ValidateBodyPatternArgs(const std::string& axis, int count,
                             double spacingMm, std::string* error) {
  if (axis != "X" && axis != "Y" && axis != "Z") {
    if (error) *error = "axis must be X, Y or Z";
    return false;
  }
  if (count < 2 || count > 64) {
    if (error) *error = "count must be between 2 and 64";
    return false;
  }
  if (!std::isfinite(spacingMm) || std::abs(spacingMm) < 1e-6 ||
      std::abs(spacingMm) > 100000.0) {
    if (error) *error = "spacingMm must be finite, non-zero and at most 100000";
    return false;
  }
  return true;
}

}  // namespace

#if KREODA_WITH_OCCT
bool BuildBodyPatternShape(const TopoDS_Shape& target, const std::string& axis,
                           int count, double spacingMm, TopoDS_Shape* out,
                           std::string* error) {
  if (!out) {
    if (error) *error = "body pattern output is required";
    return false;
  }
  if (target.IsNull()) {
    if (error) *error = "body pattern target has no shape";
    return false;
  }
  if (!ValidateBodyPatternArgs(axis, count, spacingMm, error)) return false;
  try {
    BRep_Builder builder;
    TopoDS_Compound compound;
    builder.MakeCompound(compound);
    for (int i = 0; i < count; ++i) {
      const double distance = static_cast<double>(i) * spacingMm;
      gp_Vec translation = axis == "X" ? gp_Vec(distance, 0, 0)
                           : axis == "Y" ? gp_Vec(0, distance, 0)
                                         : gp_Vec(0, 0, distance);
      gp_Trsf trsf;
      trsf.SetTranslation(translation);
      BRepBuilderAPI_Transform copy(target, trsf, true);
      copy.Build();
      if (!copy.IsDone() || copy.Shape().IsNull()) {
        if (error) *error = "body pattern copy failed";
        return false;
      }
      builder.Add(compound, copy.Shape());
    }
    *out = compound;
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("body pattern failed: ") + f.what();
    return false;
  }
}
#endif

bool CreateBodyPatternFeature(const std::string& featureId,
                              const std::string& targetId,
                              const std::string& axis, int count,
                              double spacingMm, std::string* error) {
  if (featureId.empty() || targetId.empty()) {
    if (error) *error = "featureId and targetId are required";
    return false;
  }
  if (!CheckNewId(featureId, error)) return false;
  if (featureId == targetId) {
    if (error) *error = "a body pattern cannot target itself";
    return false;
  }
  if (!ValidateBodyPatternArgs(axis, count, spacingMm, error)) return false;
#if KREODA_WITH_OCCT
  ShapeRecord target;
  if (!GetCurrentShapeRecord(targetId, &target, error)) return false;
  if (target.shape.IsNull()) {
    if (error) *error = "unknown target " + targetId;
    return false;
  }
  if (!IsKnownSolidFeatureType(target.type)) {
    if (error) *error = "body pattern target is not a solid body: " + targetId;
    return false;
  }
  TopoDS_Shape shape;
  if (!BuildBodyPatternShape(target.shape, axis, count, spacingMm, &shape,
                             error)) {
    return false;
  }
  return CommitSingleFeature(featureId, "BodyPattern",
                             {static_cast<double>(count), spacingMm},
                             {targetId}, axis, shape, error);
#else
  if (error) *error = "body pattern requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool RebuildBodyPatternFromStore(const std::string& featureId,
                                 std::string* error) {
  ShapeRecord rec;
  if (!ShapeStore::instance().get(featureId, &rec)) {
    if (error) *error = "unknown feature " + featureId;
    return false;
  }
  if (rec.type != "BodyPattern" || rec.dependsOn.size() != 1 ||
      rec.paramsMm.size() != 2) {
    if (error) *error = "cannot rebuild " + rec.type;
    return false;
  }
  if (!std::isfinite(rec.paramsMm[0]) || rec.paramsMm[0] < 2 ||
      rec.paramsMm[0] > 64) {
    if (error) *error = "body pattern count must be between 2 and 64";
    return false;
  }
  const int count = static_cast<int>(rec.paramsMm[0]);
  if (static_cast<double>(count) != rec.paramsMm[0]) {
    if (error) *error = "body pattern count must be an integer";
    return false;
  }
  if (!ValidateBodyPatternArgs(rec.refExtra, count, rec.paramsMm[1], error)) {
    return false;
  }
#if KREODA_WITH_OCCT
  ShapeRecord target;
  if (!GetCurrentShapeRecord(rec.dependsOn[0], &target, error)) return false;
  if (target.shape.IsNull()) {
    if (error) {
      *error = "body pattern target vanished (needs repair): " +
               rec.dependsOn[0];
    }
    return false;
  }
  if (!IsKnownSolidFeatureType(target.type)) {
    if (error) *error = "body pattern target is not a solid body";
    return false;
  }
  if (rec.dependsOn[0] == featureId) {
    if (error) *error = "a body pattern cannot target itself";
    return false;
  }
  TopoDS_Shape shape;
  if (!BuildBodyPatternShape(target.shape, rec.refExtra, count, rec.paramsMm[1],
                             &shape, error)) {
    return false;
  }
  return CommitShape(featureId, rec.type, rec.paramsMm, rec.dependsOn,
                     rec.refExtra, shape, nullptr, false, error);
#else
  if (error) *error = "body pattern requires OCCT (link via vcpkg)";
  return false;
#endif
}

}  // namespace kreoda
