#include "revolve.h"

#include <cmath>

#include "document/document_store.h"
#include "model/commit.h"
#include "model/feature_graph.h"
#include "model/shapes.h"
#include "features/sketch/sketch_store.h"

#if KREODA_WITH_OCCT
#include <BRepBndLib.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <Standard_Failure.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax1.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>

#include "features/sketch/sketch_face.h"
#include "features/sketch/sketch_store.h"
#include "persistence/ocaf_live.h"
#endif

namespace kreoda {

#if KREODA_WITH_OCCT
bool BuildRevolveShape(const std::string& sketchId, double angleDeg,
                       TopoDS_Shape* out, std::string* error) {
  SketchFeature sketch;
  if (!SketchStore::instance().get(sketchId, &sketch)) {
    if (error) *error = "unknown sketch " + sketchId;
    return false;
  }
  TopoDS_Face face;
  if (!BuildFaceFromSketch(sketch, &face, error)) return false;
  try {
    // Axis = sketch local X through the sketch origin (documented).
    const gp_Ax1 axis(
        gp_Pnt(sketch.plane.origin[0], sketch.plane.origin[1],
               sketch.plane.origin[2]),
        gp_Dir(sketch.plane.xAxis[0], sketch.plane.xAxis[1],
               sketch.plane.xAxis[2]));
    const double angleRad = angleDeg * std::acos(-1.0) / 180.0;
    BRepPrimAPI_MakeRevol mk(face, axis, angleRad, false);
    mk.Build();
    if (!mk.IsDone()) {
      if (error) *error = "Revolve: MakeRevol failed";
      return false;
    }
    *out = mk.Shape();
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("Revolve: kernel exception: ") + f.what();
    return false;
  }
}

bool CreateRevolveFeature(const std::string& featureId,
                          const std::string& sketchId, double angleDeg,
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
  if (!(angleDeg > 0 && angleDeg <= 360)) {
    if (error) *error = "revolve angle must be in (0, 360] deg";
    return false;
  }
  TopoDS_Shape shape;
  if (!BuildRevolveShape(sketchId, angleDeg, &shape, error)) return false;
  if (!OcafLive::instance().BeginCommand(error)) return false;
  const bool ok = CommitShape(featureId, "Revolve", {angleDeg}, {sketchId}, std::string(),
                              shape, nullptr, true, error);
  if (!ok) {
    OcafLive::instance().AbortCommand();
    return false;
  }
  bool hadDelta = false;
  OcafLive::instance().CommitCommand(&hadDelta, nullptr);
  return true;
}

// DAG recompute step (evaluate.cpp calls this).
bool RebuildRevolveFromStore(const std::string& featureId, std::string* error) {
  ShapeRecord rec;
  if (!ShapeStore::instance().get(featureId, &rec)) {
    if (error) *error = "unknown feature " + featureId;
    return false;
  }
  if (rec.type != "Revolve" || rec.paramsMm.size() != 1 ||
      rec.dependsOn.size() != 1) {
    if (error) *error = "cannot rebuild " + rec.type;
    return false;
  }
  // M2: formulas must not bypass the create-time (0,360] gate.
  if (!(rec.paramsMm[0] > 0 && rec.paramsMm[0] <= 360)) {
    if (error) *error = "revolve angle must be in (0, 360] deg";
    return false;
  }
  TopoDS_Shape shape;
  if (!BuildRevolveShape(rec.dependsOn[0], rec.paramsMm[0], &shape, error)) {
    return false;
  }
  return CommitShape(featureId, rec.type, rec.paramsMm, rec.dependsOn, rec.refExtra, shape,
                     nullptr, false, error);
}

#else

bool CreateRevolveFeature(const std::string&, const std::string&, double,
                          std::string* error) {
  if (error) *error = "revolve requires OCCT (link via vcpkg)";
  return false;
}

#endif

}  // namespace kreoda
