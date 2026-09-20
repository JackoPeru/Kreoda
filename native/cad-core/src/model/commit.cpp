#include "commit.h"

#include "document/document_store.h"
#include "model/feature_graph.h"

#if INTENTCAD_WITH_OCCT
#include <BRepBndLib.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>

#include "persistence/ocaf_live.h"
#endif

namespace intentcad {

#if INTENTCAD_WITH_OCCT
bool CommitShape(const std::string& featureId, const std::string& type,
                 std::vector<double> params, std::vector<std::string> deps,
                 std::string refExtra, const TopoDS_Shape& shape,
                 const ShapeRecord* previous, bool countRevision,
                 std::string* error) {
  if (shape.IsNull()) {
    if (error) *error = type + ": kernel returned null shape";
    return false;
  }
  BRepCheck_Analyzer analyzer(shape);
  if (!analyzer.IsValid(shape)) {
    if (error) *error = type + ": BRepCheck validation failed";
    return false;
  }
  GProp_GProps props;
  BRepGProp::VolumeProperties(shape, props);
  Bnd_Box box;
  BRepBndLib::Add(shape, box);
  double xmin, ymin, zmin, xmax, ymax, zmax;
  box.Get(xmin, ymin, zmin, xmax, ymax, zmax);
  const bool isNew = !ShapeStore::instance().contains(featureId);
  ShapeRecord rec;
  rec.featureId = featureId;
  rec.type = type;
  rec.paramsMm = std::move(params);
  rec.dependsOn = std::move(deps);
  rec.refExtra = std::move(refExtra);
  rec.shape = shape;
  rec.volumeMm3 = props.Mass();
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
  return true;
}
#endif

}  // namespace intentcad
