#include "sketch_commands.h"

#include <cmath>
#include <map>

#include "document/document_store.h"
#include "features/evaluate.h"
#include "features/sketch/sketch_json.h"
#include "features/sketch/sketch_projection.h"
#include "model/body.h"
#include "model/feature_graph.h"
#include "model/model_snapshot.h"
#include "model/shapes.h"
#include "model/commit.h"
#include "features/datum/datum_store.h"

#if KREODA_WITH_OCCT
#include "persistence/ocaf_live.h"
#endif

namespace kreoda {

namespace {

bool ValidateSketchRefs(const SketchModel& model, std::string* error) {
  std::map<std::string, bool> points;
  for (const auto& p : model.points) {
    if (p.id.empty()) {
      if (error) *error = "sketch point id required";
      return false;
    }
    if (points.count(p.id)) {
      if (error) *error = "duplicate point id " + p.id;
      return false;
    }
    points[p.id] = true;
    if (!std::isfinite(p.x) || !std::isfinite(p.y)) {
      if (error) *error = "non-finite coordinates for " + p.id;
      return false;
    }
  }
  std::map<std::string, bool> lines, circles, arcs, constraintIds;
  // Entity-count cap: shared 256 MB frame + O(n²) wire chaining (§8, §41).
  constexpr size_t kMaxEntities = 2000;
  if (model.points.size() + model.lines.size() + model.circles.size() +
          model.arcs.size() + model.constraints.size() >
      kMaxEntities) {
    if (error) *error = "sketch too large (max 2000 entities)";
    return false;
  }
  // Coordinate-magnitude cap: OCCT kernels degrade far from origin.
  constexpr double kMaxCoordMm = 100000.0;
  for (const auto& l : model.lines) {
    if (l.id.empty() || !points.count(l.p1) || !points.count(l.p2)) {
      if (error) *error = "line references unknown point";
      return false;
    }
    if (lines.count(l.id)) {
      if (error) *error = "duplicate line id " + l.id;
      return false;
    }
    if (l.p1 == l.p2) {
      if (error) *error = "degenerate line " + l.id;
      return false;
    }
    lines[l.id] = true;
  }
  for (const auto& c : model.circles) {
    if (c.id.empty() || !points.count(c.center)) {
      if (error) *error = "circle references unknown point";
      return false;
    }
    if (circles.count(c.id) || arcs.count(c.id)) {
      if (error) *error = "duplicate circle id " + c.id;
      return false;
    }
    if (!(c.r > 0) || c.r > kMaxCoordMm) {
      if (error) *error = "circle radius out of range";
      return false;
    }
    circles[c.id] = true;
  }
  for (const auto& a : model.arcs) {
    if (a.id.empty() || !points.count(a.center)) {
      if (error) *error = "arc references unknown point";
      return false;
    }
    if (circles.count(a.id) || arcs.count(a.id)) {
      if (error) *error = "duplicate arc id " + a.id;
      return false;
    }
    if (!(a.r > 0) || a.r > kMaxCoordMm) {
      if (error) *error = "arc radius out of range";
      return false;
    }
    if (!std::isfinite(a.startAngleRad) || !std::isfinite(a.endAngleRad)) {
      if (error) *error = "arc angles must be finite";
      return false;
    }
    arcs[a.id] = true;
  }
  for (const auto& p : model.points) {
    if (std::fabs(p.x) > kMaxCoordMm || std::fabs(p.y) > kMaxCoordMm) {
      if (error) *error = "point coordinates out of range: " + p.id;
      return false;
    }
  }
  for (const auto& c : model.constraints) {
    if (c.id.empty()) {
      if (error) *error = "constraint id required";
      return false;
    }
    if (constraintIds.count(c.id)) {
      if (error) *error = "duplicate constraint id " + c.id;
      return false;
    }
    constraintIds[c.id] = true;
    // Ref existence per kind (length checked by the solver wrapper too).
    for (const auto& r : c.refs) {
      if (r.empty()) {
        if (error) *error = "empty ref in constraint " + c.id;
        return false;
      }
    }
  }
  return true;
}

}  // namespace

bool CreateSketchFeature(const std::string& sketchId,
                         const std::string& planeKind,
                         const SketchModel& model, std::string* error) {
  return CreateSketchFeature(sketchId, planeKind, model,
                             PrincipalPlane(planeKind), error);
}

static bool CreateSketchFeatureImpl(const std::string& sketchId,
                         const std::string& planeKind,
                         const SketchModel& model, const SketchPlane& plane,
                         const std::string& supportRef,std::string* error) {
  if (sketchId.empty()) {
    if (error) *error = "sketch id (stable UUID) required";
    return false;
  }
  if (!ShapeStore::ValidFeatureId(sketchId)) {
    if (error) *error = "sketch id must match [A-Za-z0-9_-]";
    return false;
  }
  if (planeKind != "XY" && planeKind != "XZ" && planeKind != "YZ" &&
      !(planeKind == "Datum" && !supportRef.empty())) {
    if (error) *error = "planeKind must be XY|XZ|YZ";
    return false;
  }
  if (!ValidateSketchPlane(plane, error)) return false;
  if (!CheckNewId(sketchId,error)) return false;
  if (!ValidateSketchRefs(model, error)) return false;
  // Solve-before-commit: the stored model always holds solved coordinates.
  auto solver = CreateSketchSolver();
  SolveOptions opts;
  SolveResult r = solver->solve(model, opts);
  if (!r.ok) {
    if (error) {
      *error = r.error.empty() ? "sketch solve failed" : r.error;
    }
    return false;
  }
  SketchFeature sketch;
  sketch.id = sketchId;
  sketch.planeKind = planeKind;
  sketch.plane = plane;
  sketch.supportRef = supportRef;
  sketch.model = model;
  // Write back solved coordinates.
  for (auto& p : sketch.model.points) {
    const auto it = r.points.find(p.id);
    if (it != r.points.end()) {
      p.x = it->second.first;
      p.y = it->second.second;
    }
  }
  for (auto& c : sketch.model.circles) {
    const auto it = r.radii.find(c.id);
    if (it != r.radii.end()) c.r = it->second;
  }
  for (auto& a : sketch.model.arcs) {
    const auto it = r.radii.find(a.id);
    if (it != r.radii.end()) a.r = it->second;
  }
#if KREODA_WITH_OCCT
  if (!OcafLive::instance().BeginCommand(error)) return false;
  SketchStore::instance().put(sketch);
  const std::string js = SerializeSketchFeature(sketch);
  if (!OcafLive::instance().UpsertSketch(sketchId, js, error)) {
    SketchStore::instance().remove(sketchId);
    OcafLive::instance().AbortCommand();
    return false;
  }
  TheFeatureGraph().addFeature(sketchId, SketchDependencies(sketch));
  TheFeatureGraph().clearDirty(sketchId);
  bool hadDelta = false;
  OcafLive::instance().CommitCommand(&hadDelta, nullptr);
  DocumentStore::instance().registerFeature(sketchId, "Sketch");
  return true;
#else
  SketchStore::instance().put(sketch);
  TheFeatureGraph().addFeature(sketchId, SketchDependencies(sketch));
  TheFeatureGraph().clearDirty(sketchId);
  DocumentStore::instance().registerFeature(sketchId, "Sketch");
  return true;
#endif
}

bool CreateSketchFeature(const std::string& sketchId,const std::string& planeKind,
                         const SketchModel& model,const SketchPlane& plane,std::string* error) {
  return CreateSketchFeatureImpl(sketchId,planeKind,model,plane,"",error);
}
bool CreateSketchOnDatumFeature(const std::string& sketchId,const std::string& datumId,
                                const SketchModel& model,std::string* error) {
  DatumRecord support;
  if(!DatumStore::instance().get(datumId,&support)||support.kind!=DatumKind::Plane||support.status!="ok") {if(error)*error="sketch requires a valid DatumPlane";return false;}
  return CreateSketchFeatureImpl(sketchId,"Datum",model,support.plane,datumId,error);
}

bool UpdateSketchFeature(const std::string& sketchId,
                         const SketchModel& model, std::string* error) {
  SketchFeature prev;
  if (!SketchStore::instance().get(sketchId, &prev)) {
    if (error) *error = "unknown sketch " + sketchId;
    return false;
  }
  if (!ValidateSketchRefs(model, error)) return false;
  auto solver = CreateSketchSolver();
  SolveOptions opts;
  SolveResult r = solver->solve(model, opts);
  if (!r.ok) {
    if (error) *error = r.error.empty() ? "sketch solve failed" : r.error;
    return false;
  }
  SketchFeature next = prev;
  next.model = model;
  for (auto& p : next.model.points) {
    const auto it = r.points.find(p.id);
    if (it != r.points.end()) {
      p.x = it->second.first;
      p.y = it->second.second;
    }
  }
  for (auto& c : next.model.circles) {
    const auto it = r.radii.find(c.id);
    if (it != r.radii.end()) c.r = it->second;
  }
  for (auto& a : next.model.arcs) {
    const auto it = r.radii.find(a.id);
    if (it != r.radii.end()) a.r = it->second;
  }
#if KREODA_WITH_OCCT
  const ModelSnapshot before;
  TheFeatureGraph().addFeature(sketchId, SketchDependencies(next));
  TheFeatureGraph().markDirty(sketchId);
  SketchStore::instance().put(next);
  if (!OcafLive::instance().BeginCommand(error)) {
    before.restore();
    return false;
  }
  const std::string js = SerializeSketchFeature(next);
  if (!OcafLive::instance().UpsertSketch(sketchId, js, error)) {
    OcafLive::instance().AbortCommand();
    before.restore();
    return false;
  }
  const auto report = TheFeatureGraph().recompute(
      [](const std::string& id, std::string* e) {
        return RebuildNodeFromStore(id, e);
      });
  if (!report.ok) {
    OcafLive::instance().AbortCommand();
    before.restore();
    if (error) *error = report.firstError;
    return false;
  }
  bool hadDelta = false;
  OcafLive::instance().CommitCommand(&hadDelta, nullptr);
  DocumentStore::instance().registerFeature(sketchId, "Sketch");
  return true;
#else
  SketchStore::instance().put(next);
  TheFeatureGraph().addFeature(sketchId, SketchDependencies(next));
  TheFeatureGraph().markDirty(sketchId);
  DocumentStore::instance().registerFeature(sketchId, "Sketch");
  return true;
#endif
}

bool PutSketchDirect(const SketchFeature& sketch) {
  SketchStore::instance().put(sketch);
  TheFeatureGraph().addFeature(sketch.id, SketchDependencies(sketch));
  TheFeatureGraph().clearDirty(sketch.id);
  return true;
}

}  // namespace kreoda
