#include "primitives.h"

#include <cmath>

#include "document/document_store.h"
#include "expressions/expressions.h"
#include "model/body.h"
#include "model/commit.h"
#include "model/feature_graph.h"
#include "model/shapes.h"
#include "features/extrusion/extrude.h"
#include "features/fillet/fillet.h"
#include "features/hole/hole.h"
#include "features/instance/instance.h"
#include "features/revolve/revolve.h"
#include "features/sketch/sketch_store.h"

#include <map>

#if KREODA_WITH_OCCT
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <Standard_Failure.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>

#include "persistence/ocaf_live.h"
#endif

namespace kreoda {

namespace {

constexpr double kMaxDimMm = 100000.0;

bool checkPositive(double v, const char* what, std::string* error) {
  if (v > 0 && v <= kMaxDimMm) return true;
  if (error) {
    *error = std::string(what) + " must be in (0, 100000] mm";
  }
  return false;
}

}  // namespace

#if KREODA_WITH_OCCT
bool BuildBoxShape(double w, double h, double d, TopoDS_Shape* out,
                   std::string* error) {
  if (!checkPositive(w, "width", error) || !checkPositive(h, "height", error) ||
      !checkPositive(d, "depth", error)) {
    return false;
  }
  try {
    // OCCT 8 evaluates construction lazily: Build() must run before IsDone()
    // is meaningful (see docs/phase-1-handoff.md hard-won notes).
    BRepPrimAPI_MakeBox mk(w, h, d);
    mk.Build();
    if (!mk.IsDone()) {
      if (error) *error = "Box: BRepPrimAPI_MakeBox failed";
      return false;
    }
    *out = mk.Solid();
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("Box: kernel exception: ") + f.what();
    return false;
  }
}

bool BuildCylinderShape(double r, double h, TopoDS_Shape* out,
                        std::string* error) {
  if (!checkPositive(r, "radius", error) || !checkPositive(h, "height", error)) {
    return false;
  }
  try {
    // Base center at origin, axis +Z (documented convention, Phase 1).
    BRepPrimAPI_MakeCylinder mk(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), r,
                                h);
    mk.Build();
    if (!mk.IsDone()) {
      if (error) *error = "Cylinder: BRepPrimAPI_MakeCylinder failed";
      return false;
    }
    *out = mk.Shape();
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("Cylinder: kernel exception: ") + f.what();
    return false;
  }
}

bool BuildSphereShape(double r, TopoDS_Shape* out, std::string* error) {
  if (!checkPositive(r, "radius", error)) return false;
  try {
    BRepPrimAPI_MakeSphere mk(r);
    mk.Build();
    if (!mk.IsDone()) {
      if (error) *error = "Sphere: BRepPrimAPI_MakeSphere failed";
      return false;
    }
    *out = mk.Shape();
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("Sphere: kernel exception: ") + f.what();
    return false;
  }
}
#endif

bool CreateBoxFeature(const std::string& featureId, double widthMm,
                      double heightMm, double depthMm, std::string* error) {
  if (!CheckNewId(featureId, error)) return false;
#if KREODA_WITH_OCCT
  TopoDS_Shape shape;
  if (!BuildBoxShape(widthMm, heightMm, depthMm, &shape, error)) return false;
  return CommitSingleFeature(featureId, "Box", {widthMm, heightMm, depthMm},
                             {}, std::string(), shape, error);
#else
  if (!checkPositive(widthMm, "width", error) ||
      !checkPositive(heightMm, "height", error) ||
      !checkPositive(depthMm, "depth", error)) {
    return false;
  }
  const double bbox[6] = {0, 0, 0, widthMm, heightMm, depthMm};
  return CommitShape(featureId, "Box", {widthMm, heightMm, depthMm}, {},
                     widthMm * heightMm * depthMm, bbox, error);
#endif
}

bool CreateCylinderFeature(const std::string& featureId, double radiusMm,
                           double heightMm, std::string* error) {
  if (!CheckNewId(featureId, error)) return false;
#if KREODA_WITH_OCCT
  TopoDS_Shape shape;
  if (!BuildCylinderShape(radiusMm, heightMm, &shape, error)) return false;
  return CommitSingleFeature(featureId, "Cylinder", {radiusMm, heightMm}, {},
                             std::string(), shape, error);
#else
  if (!checkPositive(radiusMm, "radius", error) ||
      !checkPositive(heightMm, "height", error)) {
    return false;
  }
  const double bbox[6] = {-radiusMm, -radiusMm, 0, radiusMm, radiusMm,
                          heightMm};
  const double kPi = std::acos(-1.0);
  return CommitShape(featureId, "Cylinder", {radiusMm, heightMm}, {},
                     kPi * radiusMm * radiusMm * heightMm, bbox, error);
#endif
}

bool CreateSphereFeature(const std::string& featureId, double radiusMm,
                         std::string* error) {
  if (!CheckNewId(featureId, error)) return false;
#if KREODA_WITH_OCCT
  TopoDS_Shape shape;
  if (!BuildSphereShape(radiusMm, &shape, error)) return false;
  return CommitSingleFeature(featureId, "Sphere", {radiusMm}, {},
                             std::string(), shape, error);
#else
  if (!checkPositive(radiusMm, "radius", error)) return false;
  const double bbox[6] = {-radiusMm, -radiusMm, -radiusMm,
                          radiusMm,  radiusMm,  radiusMm};
  const double kPi = std::acos(-1.0);
  return CommitShape(featureId, "Sphere", {radiusMm}, {},
                     4.0 / 3.0 * kPi * radiusMm * radiusMm * radiusMm, bbox,
                     error);
#endif
}

// Canonical per-type parameter slots (mm). Pure validation: no state touched.
// Slot names live in DescribeParams (model/shapes) — single source of truth.
bool ResolveParamsForEdit(const ShapeRecord& rec, const std::string& paramName,
                          double valueMm, std::vector<double>* out,
                          std::string* error) {
  const std::vector<std::string> slots = DescribeParams(rec.type);
  std::vector<double> params = rec.paramsMm;
  bool matched = false;
  if (!slots.empty() && slots.size() == params.size()) {
    for (size_t i = 0; i < slots.size(); ++i) {
      if (slots[i] == paramName) {
        params[i] = valueMm;
        matched = true;
        break;
      }
    }
  }
  if (!matched) {
    if (error) {
      *error = "unknown parameter '" + paramName + "' for " + rec.type +
               " (canonical mm names only)";
    }
    return false;
  }
  *out = std::move(params);
  return true;
}

// DAG recompute dispatch lives in features/rebuild.cpp (all B-Rep types).

bool BuildPreviewMesh(const std::string& featureId,
                      const std::string& paramName, double valueMm,
                      CoreMesh* out, std::string* error) {
  ShapeRecord rec;
  if (!ShapeStore::instance().get(featureId, &rec)) {
    if (error) *error = "unknown feature " + featureId;
    return false;
  }
  if (rec.type == "Hole" && paramName == "depthMm" &&
      rec.refExtra.find("mode=blind") == std::string::npos) {
    if (error) *error = "throughAll hole has no depthMm (use a blind hole to set depth)";
    return false;
  }
  std::vector<double> newParams;
  if (!ResolveParamsForEdit(rec, paramName, valueMm, &newParams, error)) {
    return false;
  }
#if KREODA_WITH_OCCT
  TopoDS_Shape candidate;
  bool built = false;
  if (rec.type == "Box") {
    built = BuildBoxShape(newParams[0], newParams[1], newParams[2],
                          &candidate, error);
  } else if (rec.type == "Cylinder") {
    built = BuildCylinderShape(newParams[0], newParams[1], &candidate, error);
  } else if (rec.type == "Sphere") {
    built = BuildSphereShape(newParams[0], &candidate, error);
  } else if (rec.type == "Extrude" && newParams.size() == 1 &&
             !rec.dependsOn.empty()) {
    built = BuildExtrudeShape(rec.dependsOn[0], newParams[0], &candidate,
                              error);
  } else if (rec.type == "Revolve" && newParams.size() == 1 &&
             !rec.dependsOn.empty()) {
    built = BuildRevolveShape(rec.dependsOn[0], newParams[0], &candidate,
                              error);
  } else if (rec.type == "Hole" && newParams.size() == 2 &&
             !rec.dependsOn.empty()) {
    ShapeRecord target;
    if (!ShapeStore::instance().get(rec.dependsOn[0], &target)) {
      if (error) *error = "hole target vanished";
      return false;
    }
    std::string faceRole, mode;
    double hx = 0, hy = 0;
    if (!DecodeHoleRef(rec.refExtra, &faceRole, &hx, &hy, &mode)) {
      if (error) *error = "hole record corrupted";
      return false;
    }
    built = BuildHoleShape(target.shape, target.featureId, target.type,
                           faceRole, hx, hy, newParams[0], mode, newParams[1],
                           &candidate, error);
  } else if ((rec.type == "Fillet" || rec.type == "Chamfer") &&
             newParams.size() == 1 && !rec.dependsOn.empty()) {
    ShapeRecord target;
    if (!ShapeStore::instance().get(rec.dependsOn[0], &target)) {
      if (error) *error = "dress-up target vanished";
      return false;
    }
    std::vector<std::string> edgeIds = SplitEdgeIds(rec.refExtra);
    if (rec.type == "Fillet") {
      built = BuildFilletShape(target.shape, target.featureId, target.type,
                               edgeIds, newParams[0], &candidate, error);
    } else {
      built = BuildChamferShape(target.shape, target.featureId, target.type,
                                edgeIds, newParams[0], &candidate, error);
    }
  } else if (rec.type == "Instance" && newParams.size() == 6 &&
             !rec.dependsOn.empty()) {
    // M1: preview must match commit (BuildInstanceShape + tessellate).
    ShapeRecord target;
    if (!ShapeStore::instance().get(rec.dependsOn[0], &target)) {
      if (error) *error = "instance target vanished";
      return false;
    }
    built = BuildInstanceShape(target.shape, newParams, &candidate, error);
  } else {
    if (error) *error = "cannot preview " + rec.type;
    return false;
  }
  if (!built) return false;
  ShapeRecord tmp = rec;
  tmp.paramsMm = std::move(newParams);
  tmp.shape = candidate;
  *out = TessellateRecord(tmp, 0, error);
  return !out->indices.empty();
#else
  // Stub has no kernel: exact box tessellation straight from params.
  if (rec.type != "Box" || newParams.size() != 3) {
    if (error) *error = "stub preview supports Box only";
    return false;
  }
  ShapeRecord tmp = rec;
  tmp.paramsMm = newParams;
  *out = TessellateRecord(tmp, 0, error);
  return !out->indices.empty();
#endif
}

bool RebuildFeature(const std::string& featureId, const std::string& paramName,
                      double valueMm, const std::string& expression,
                      std::string* error) {
  ShapeRecord rec;
  if (!ShapeStore::instance().get(featureId, &rec)) {
    if (error) *error = "unknown feature " + featureId;
    return false;
  }
  // M14: throughAll holes have no depth — a depthMm edit would be a silent
  // no-op (BuildHoleShape ignores depth unless mode=blind). Fail honestly.
  if (rec.type == "Hole" && paramName == "depthMm" &&
      rec.refExtra.find("mode=blind") == std::string::npos) {
    if (error) *error = "throughAll hole has no depthMm (use a blind hole to set depth)";
    return false;
  }
  // Phase 9a: a formula replaces the bare value. Validate it NOW (parse +
  // resolution against live values) so typos fail before anything stages.
  if (!expression.empty()) {
    double probe = 0;
    if (!EvaluateOneExpression(featureId, paramName, expression, &probe,
                               error)) {
      return false;
    }
  } else {
    std::vector<double> check;
    if (!ResolveParamsForEdit(rec, paramName, valueMm, &check, error)) {
      return false;
    }
  }
#if KREODA_WITH_OCCT
  // DAG recompute (§53): stage new params, mark the closure dirty, rebuild
  // in topological order inside ONE OCAF command (one Undo step, §12).
  // Snapshot first (pre-images for rollback); params staged after.
  // Defensive: features adopted via open/undo always have graph nodes, but a
  // missing node must never silently skip the rebuild.
  if (!TheFeatureGraph().hasFeature(featureId)) {
    TheFeatureGraph().addFeature(featureId);
    TheFeatureGraph().clearDirty(featureId);
  }
  TheFeatureGraph().markDirty(featureId);
  // C1: snapshot the WHOLE store before any mutation (expression dependents
  // are not geometry-dirty yet, and EvaluateAll is now two-phase but the
  // staged bare-value put below still needs a full pre-image).
  std::map<std::string, ShapeRecord> snapshot;
  for (const auto& r : ShapeStore::instance().listInOrder()) {
    snapshot[r.featureId] = r;
  }
  // Slice 3: tip stays at last good on failure — restore alongside shapes.
  const std::vector<BodyRecord> bodySnap = BodyStore::instance().bodies();
  // Previous formula map for rollback (restored on abort with the params).
  const std::map<std::string, std::string> prevExpr =
      ExpressionStore::instance().forFeature(featureId);
  if (!expression.empty()) {
    // Stage the formula itself; its VALUE lands via the fixpoint below.
    ExpressionStore::instance().set(featureId, paramName, expression);
  }
  if (expression.empty()) {
    std::vector<double> newParams;
    if (!ResolveParamsForEdit(rec, paramName, valueMm, &newParams, error)) {
      return false;
    }
    rec.paramsMm = newParams;
    ShapeStore::instance().put(rec);
  }
  if (!OcafLive::instance().BeginCommand(error)) {
    for (const auto& [id, s] : snapshot) ShapeStore::instance().put(s);
    BodyStore::instance().replaceAll(bodySnap);
    ExpressionStore::instance().setFeatureMap(featureId, prevExpr);
    return false;
  }
  // Mirror the formula (or its continuity) inside the command, then run the
  // fixpoint: dependents of every changed param recompute downstream.
  {
    std::string exprErr;
    if (!MirrorFeatureExpressions(featureId, &exprErr)) {
      OcafLive::instance().AbortCommand();
      for (const auto& [id, s] : snapshot) ShapeStore::instance().put(s);
      BodyStore::instance().replaceAll(bodySnap);
      ExpressionStore::instance().setFeatureMap(featureId, prevExpr);
      // C7: aborted NewChild/AddShape labels are undone by OCAF but the
      // label maps still point at them — rebuild maps from the live doc.
      { std::string rsErr; OcafLive::instance().ResyncStore(&rsErr); }
      if (error) *error = exprErr;
      return false;
    }
  }
  std::vector<std::string> exprChanged;
  {
    std::string evalErr;
    if (!EvaluateAllExpressions(&exprChanged, &evalErr)) {
      OcafLive::instance().AbortCommand();
      for (const auto& [id, s] : snapshot) ShapeStore::instance().put(s);
      BodyStore::instance().replaceAll(bodySnap);
      ExpressionStore::instance().setFeatureMap(featureId, prevExpr);
      { std::string rsErr; OcafLive::instance().ResyncStore(&rsErr); }
      if (error) *error = evalErr;
      return false;
    }
  }
  for (const std::string& id : exprChanged) {
    if (!TheFeatureGraph().hasFeature(id)) TheFeatureGraph().addFeature(id);
    TheFeatureGraph().markDirty(id);
  }
  const auto report = TheFeatureGraph().recompute(
      [](const std::string& id, std::string* e) {
        return RebuildNodeFromStore(id, e);
      });
  if (!report.ok) {
    for (const auto& [id, s] : snapshot) ShapeStore::instance().put(s);
    BodyStore::instance().replaceAll(bodySnap);
    ExpressionStore::instance().setFeatureMap(featureId, prevExpr);
    OcafLive::instance().AbortCommand();
    { std::string rsErr; OcafLive::instance().ResyncStore(&rsErr); }
    if (error) *error = report.firstError;
    return false;
  }
  bool hadDelta = false;
  OcafLive::instance().CommitCommand(&hadDelta, nullptr);
  DocumentStore::instance().registerFeature(featureId, rec.type);
  return true;
#else
  if (error) *error = "rebuild requires OCCT (link via vcpkg)";
  return false;
#endif
}

}  // namespace kreoda
