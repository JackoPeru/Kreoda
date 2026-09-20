#include "extrude.h"

#include <cmath>

#include "document/document_store.h"
#include "model/commit.h"
#include "model/feature_graph.h"
#include "model/shapes.h"
#include "features/sketch/sketch_store.h"

#if INTENTCAD_WITH_OCCT
#include <BRepBndLib.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <Standard_Failure.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Vec.hxx>

#include "features/sketch/sketch_face.h"
#include "features/sketch/sketch_store.h"
#include "persistence/ocaf_live.h"
#endif

namespace intentcad {

#if INTENTCAD_WITH_OCCT
bool BuildExtrudeShape(const std::string& sketchId, double distanceMm,
                       TopoDS_Shape* out, std::string* error) {
  if (!(distanceMm > 0 && distanceMm <= 100000)) {
    if (error) *error = "extrude distance must be in (0, 100000] mm";
    return false;
  }
  SketchFeature sketch;
  if (!SketchStore::instance().get(sketchId, &sketch)) {
    if (error) *error = "unknown sketch " + sketchId;
    return false;
  }
  TopoDS_Face face;
  if (!BuildFaceFromSketch(sketch, &face, error)) return false;
  try {
    const gp_Vec prismVec(sketch.plane.normal[0] * distanceMm,
                          sketch.plane.normal[1] * distanceMm,
                          sketch.plane.normal[2] * distanceMm);
    BRepPrimAPI_MakePrism mk(face, prismVec, false, true);
    mk.Build();
    if (!mk.IsDone()) {
      if (error) *error = "Extrude: MakePrism failed";
      return false;
    }
    *out = mk.Shape();
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("Extrude: kernel exception: ") + f.what();
    return false;
  }
}
#endif

bool CreateExtrudeFeature(const std::string& featureId,
                          const std::string& sketchId, double distanceMm,
                          std::string* error) {
  if (featureId.empty() || sketchId.empty()) {
    if (error) *error = "featureId and sketchId are required";
    return false;
  }
  if (!ShapeStore::ValidFeatureId(featureId)) {
    if (error) *error = "featureId must match [A-Za-z0-9_-]";
    return false;
  }
  if (ShapeStore::instance().contains(featureId) ||
      SketchStore::instance().contains(featureId)) {
    if (error) *error = "id already exists: " + featureId;
    return false;
  }
#if INTENTCAD_WITH_OCCT
  TopoDS_Shape shape;
  if (!BuildExtrudeShape(sketchId, distanceMm, &shape, error)) return false;
  if (!OcafLive::instance().BeginCommand(error)) return false;
  const bool ok =
      CommitShape(featureId, "Extrude", {distanceMm}, {sketchId}, std::string(), shape,
                  nullptr, true, error);
  if (!ok) {
    OcafLive::instance().AbortCommand();
    return false;
  }
  bool hadDelta = false;
  OcafLive::instance().CommitCommand(&hadDelta, nullptr);
  return true;
#else
  (void)distanceMm;
  if (error) *error = "extrude requires OCCT (link via vcpkg)";
  return false;
#endif
}

// DAG recompute step (features/rebuild.cpp calls this).
bool RebuildExtrudeFromStore(const std::string& featureId, std::string* error) {
#if INTENTCAD_WITH_OCCT
  ShapeRecord rec;
  if (!ShapeStore::instance().get(featureId, &rec)) {
    if (error) *error = "unknown feature " + featureId;
    return false;
  }
  if (rec.type != "Extrude" || rec.paramsMm.size() != 1 ||
      rec.dependsOn.size() != 1) {
    if (error) *error = "cannot rebuild " + rec.type;
    return false;
  }
  TopoDS_Shape shape;
  if (!BuildExtrudeShape(rec.dependsOn[0], rec.paramsMm[0], &shape, error)) {
    return false;
  }
  return CommitShape(featureId, rec.type, rec.paramsMm, rec.dependsOn, rec.refExtra, shape,
                     nullptr, false, error);
#else
  (void)featureId;
  if (error) *error = "extrude requires OCCT (link via vcpkg)";
  return false;
#endif
}

}  // namespace intentcad
