// DAG recompute dispatch (§53): one entry point rebuilding any B-Rep node
// from its current store params, without a revision bump. Keeps feature
// evaluators decoupled from each other (primitives never include extrude).

#include "features/primitives/primitives.h"

#include "features/booleans/boolean.h"
#include "features/extrusion/extrude.h"
#include "features/fillet/fillet.h"
#include "features/hole/hole.h"
#include "features/instance/instance.h"
#include "features/revolve/revolve.h"
#include "features/sketch/sketch_store.h"
#include "model/commit.h"
#include "model/shapes.h"

#if KREODA_WITH_OCCT
#include <TopoDS_Shape.hxx>
#endif

namespace kreoda {

bool RebuildNodeFromStore(const std::string& featureId, std::string* error) {
#if KREODA_WITH_OCCT
  // Sketch nodes live in SketchStore (no B-Rep of their own): re-validate
  // by re-solving; dependent solids rebuild in their own steps (§53).
  if (SketchStore::instance().contains(featureId)) {
    SolveResult r = SolveStoredSketch(featureId, SolveOptions{}, error);
    return r.ok;
  }
  ShapeRecord rec;
  if (!ShapeStore::instance().get(featureId, &rec)) {
    if (error) *error = "unknown feature " + featureId;
    return false;
  }
  if (rec.type == "Extrude") {
    return RebuildExtrudeFromStore(featureId, error);
  }
  if (rec.type == "Revolve") {
    return RebuildRevolveFromStore(featureId, error);
  }
  if (rec.type == "Union" || rec.type == "Subtract" ||
      rec.type == "Intersect") {
    return RebuildBooleanFromStore(featureId, error);
  }
  if (rec.type == "Hole") {
    return RebuildHoleFromStore(featureId, error);
  }
  if (rec.type == "Fillet" || rec.type == "Chamfer") {
    return RebuildFilletFromStore(featureId, error);
  }
  if (rec.type == "Instance") {
    return RebuildInstanceFromStore(featureId, error);
  }
  TopoDS_Shape shape;
  bool built = false;
  if (rec.type == "Box" && rec.paramsMm.size() == 3) {
    built = BuildBoxShape(rec.paramsMm[0], rec.paramsMm[1], rec.paramsMm[2],
                          &shape, error);
  } else if (rec.type == "Cylinder" && rec.paramsMm.size() == 2) {
    built = BuildCylinderShape(rec.paramsMm[0], rec.paramsMm[1], &shape,
                               error);
  } else if (rec.type == "Sphere" && rec.paramsMm.size() == 1) {
    built = BuildSphereShape(rec.paramsMm[0], &shape, error);
  } else {
    if (error) *error = "cannot rebuild " + rec.type;
    return false;
  }
  if (!built) return false;  // old geometry untouched on failure (§41)
  return CommitShape(featureId, rec.type, rec.paramsMm, rec.dependsOn, rec.refExtra, shape,
                     nullptr, false, error);
#else
  (void)featureId;
  if (error) *error = "rebuild requires OCCT (link via vcpkg)";
  return false;
#endif
}

}  // namespace kreoda
