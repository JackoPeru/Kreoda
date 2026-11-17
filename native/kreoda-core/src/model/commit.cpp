#include "commit.h"

#include "body.h"
#include "document/document_store.h"
#include "features/sketch/sketch_store.h"
#include "features/datum/datum_store.h"
#include "model/feature_graph.h"
#include "model/geometry_availability.h"
#include "model/geometry_kind.h"

#if KREODA_WITH_OCCT
#include <BRepBndLib.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>

#include "persistence/ocaf_live.h"
#endif

namespace kreoda {

bool CheckNewId(const std::string& featureId, std::string* error) {
  if (featureId.empty()) {
    if (error) *error = "featureId is required";
    return false;
  }
  if (!ShapeStore::ValidFeatureId(featureId)) {
    if (error) *error = "featureId must match [A-Za-z0-9_-]";
    return false;
  }
  if (ShapeStore::instance().contains(featureId) ||
      SketchStore::instance().contains(featureId) ||
      DatumStore::instance().contains(featureId)) {
    if (error) *error = "id already exists: " + featureId;
    return false;
  }
  return true;
}

#if KREODA_WITH_OCCT
bool CommitShape(const std::string& featureId, const std::string& type,
                 std::vector<double> params, std::vector<std::string> deps,
                 std::string refExtra, const TopoDS_Shape& shape,
                 const ShapeRecord* previous, bool countRevision,
                 std::string* error) {
  for (const auto& dependency : deps)
    if (!EnsureGeometryAvailable(dependency, error)) return false;
  if (shape.IsNull()) {
    if (error) *error = type + ": kernel returned null shape";
    return false;
  }
  bool surface = IsSurfaceFeatureType(type);
  if (type == "Instance" && deps.size() == 1) {
    ShapeRecord prototype;
    surface = ShapeStore::instance().get(deps.front(), &prototype) &&
              IsSurfaceGeometry(prototype);
  }
  if (surface && !HasSurfaceTopology(shape)) {
    if (error) *error = type + ": expected face/shell surface topology without solids";
    return false;
  }
  if (!surface && IsKnownSolidFeatureType(type)) {
    if (!HasSolidTopology(shape) || HasMixedSolidSurfaceTopology(shape)) {
      if (error) *error = type + ": expected solid topology without free surface faces";
      return false;
    }
    if (type == "SurfaceSewnSolid") {
      for (const auto& dependency : deps) {
        ShapeRecord source;
        if (!ShapeStore::instance().get(dependency, &source) ||
            !HasSurfaceTopology(source.shape) ||
            HasSolidTopology(source.shape)) {
          if (error) *error = type + ": solid conversion requires surface dependencies";
          return false;
        }
      }
    } else if (type == "SurfaceThicken") {
      ShapeRecord source;
      if (deps.size() != 1 || !ShapeStore::instance().get(deps.front(), &source) ||
          !IsSurfaceGeometry(source) || !HasSurfaceTopology(source.shape) ||
          HasSolidTopology(source.shape)) {
        if (error) *error = type + ": solid conversion requires one surface dependency";
        return false;
      }
    } else if (type != "Instance") {
      for (const auto& dependency : deps) {
        ShapeRecord source;
        if (ShapeStore::instance().get(dependency, &source) &&
            (!HasSolidTopology(source.shape) ||
             HasMixedSolidSurfaceTopology(source.shape))) {
          if (error) *error = type + ": solid operation requires solid dependencies";
          return false;
        }
      }
    }
  }
  double volumeMm3 = 0;
  double xmin = 0, ymin = 0, zmin = 0, xmax = 0, ymax = 0, zmax = 0;
  try {
    BRepCheck_Analyzer analyzer(shape);
    if (!analyzer.IsValid(shape)) {
      if (error) *error = type + ": BRepCheck validation failed";
      return false;
    }
    GProp_GProps props;
    if (!surface) BRepGProp::VolumeProperties(shape, props);
    volumeMm3 = surface ? 0 : props.Mass();
    Bnd_Box box;
    if (surface) BRepBndLib::AddOptimal(shape, box, false, false);
    else BRepBndLib::Add(shape, box);
    box.Get(xmin, ymin, zmin, xmax, ymax, zmax);
  } catch (const Standard_Failure& f) {
    if (error) {
      *error = type + ": BRep validation/metrics failed: " + f.what();
    }
    return false;
  }
  const bool isNew = !ShapeStore::instance().contains(featureId);
  ShapeRecord rec;
  rec.featureId = featureId;
  rec.type = type;
  rec.paramsMm = std::move(params);
  rec.dependsOn = std::move(deps);
  rec.refExtra = std::move(refExtra);
  rec.shape = shape;
  rec.volumeMm3 = volumeMm3;
  rec.bboxMm[0] = xmin;
  rec.bboxMm[1] = ymin;
  rec.bboxMm[2] = zmin;
  rec.bboxMm[3] = xmax;
  rec.bboxMm[4] = ymax;
  rec.bboxMm[5] = zmax;
  ShapeStore::instance().put(rec);
  if (!OcafLive::instance().UpsertFeature(rec, isNew, error)) {
    if (previous) {
      ShapeStore::instance().put(*previous);  // rebuild rolled back
    } else {
      ShapeStore::instance().remove(featureId);  // create rolled back
    }
    return false;
  }
  if (isNew) {
    TheFeatureGraph().addFeature(featureId, rec.dependsOn);
    TheFeatureGraph().clearDirty(featureId);  // computed now, not pending
  }
  if (countRevision) {
    DocumentStore::instance().registerFeature(featureId, type);
  } else {
    DocumentStore::instance().noteFeature(featureId, type);
  }
  // Slice 2: body hook AFTER the OCAF mirror succeeded (atomicity preserved —
  // the early return above leaves bodies untouched on mirror failure).
  // Rebuilds (isNew=false) are idempotent no-ops inside noteCommitted.
  BodyStore::instance().noteCommitted(featureId, type, rec.dependsOn, isNew);
  return true;
}

bool CommitSingleFeature(const std::string& featureId, const std::string& type,
                         std::vector<double> params,
                         std::vector<std::string> deps, std::string refExtra,
                         const TopoDS_Shape& shape, std::string* error) {
  if (!OcafLive::instance().BeginCommand(error)) return false;
  const bool ok = CommitShape(featureId, type, std::move(params),
                              std::move(deps), std::move(refExtra), shape,
                              nullptr, true, error);
  if (!ok) {
    OcafLive::instance().AbortCommand();
    return false;
  }
  bool hadDelta = false;
  OcafLive::instance().CommitCommand(&hadDelta, nullptr);
  return true;
}
#else
bool CommitShape(const std::string& featureId, const std::string& type,
                 std::vector<double> params, std::vector<std::string> deps,
                 double volumeMm3, const double* bboxMm, std::string* error) {
  if (featureId.empty()) {
    if (error) *error = "featureId is required";
    return false;
  }
  ShapeRecord rec;
  rec.featureId = featureId;
  rec.type = type;
  rec.paramsMm = std::move(params);
  rec.dependsOn = std::move(deps);
  rec.volumeMm3 = volumeMm3;
  for (int i = 0; i < 6; ++i) rec.bboxMm[i] = bboxMm[i];
  ShapeStore::instance().put(rec);
  TheFeatureGraph().addFeature(featureId, rec.dependsOn);
  TheFeatureGraph().clearDirty(featureId);
  DocumentStore::instance().registerFeature(featureId, type);
  BodyStore::instance().noteCommitted(featureId, type, rec.dependsOn, true);
  return true;
}
#endif

}  // namespace kreoda
