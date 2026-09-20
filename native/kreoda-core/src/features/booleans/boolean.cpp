#include "boolean.h"

#include "document/document_store.h"
#include "model/commit.h"
#include "model/feature_graph.h"
#include "model/shapes.h"
#include "features/sketch/sketch_store.h"

#if KREODA_WITH_OCCT
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <Standard_Failure.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS_Shape.hxx>

#include "persistence/ocaf_live.h"
#endif

namespace kreoda {

#if KREODA_WITH_OCCT
namespace {

const char* OpType(const std::string& op) {
  if (op == "fuse") return "Union";
  if (op == "cut") return "Subtract";
  if (op == "common") return "Intersect";
  return nullptr;
}

bool BuildBooleanShape(const std::string& op, const TopoDS_Shape& target,
                       const TopoDS_Shape& tool, TopoDS_Shape* out,
                       std::string* error) {
  try {
    TopoDS_Shape result;
    bool done = false;
    if (op == "fuse") {
      BRepAlgoAPI_Fuse mk(target, tool);
      mk.Build();
      if (!mk.IsDone()) {
        if (error) *error = "Union: boolean fuse failed";
        return false;
      }
      result = mk.Shape();
      done = true;
    } else if (op == "cut") {
      BRepAlgoAPI_Cut mk(target, tool);
      mk.Build();
      if (!mk.IsDone()) {
        if (error) *error = "Subtract: boolean cut failed";
        return false;
      }
      result = mk.Shape();
      done = true;
    } else if (op == "common") {
      BRepAlgoAPI_Common mk(target, tool);
      mk.Build();
      if (!mk.IsDone()) {
        if (error) *error = "Intersect: boolean common failed";
        return false;
      }
      result = mk.Shape();
      done = true;
    } else {
      if (error) *error = "unknown boolean op " + op;
      return false;
    }
    if (!done || result.IsNull()) {
      if (error) *error = "boolean produced null shape";
      return false;
    }
    // Empty-result guard (§41): a cut-to-nothing or disjoint common yields a
    // non-null but faceless compound that would otherwise commit as a fake
    // zero-volume body. Fail honestly instead.
    {
      int faces = 0;
      for (TopExp_Explorer ex(result, TopAbs_FACE); ex.More(); ex.Next()) {
        if (++faces > 0) break;
      }
      GProp_GProps props;
      BRepGProp::VolumeProperties(result, props);
      if (faces == 0 || !(props.Mass() > 1e-12)) {
        if (error) {
          *error = "boolean removed everything (empty result) — "
                   "check tool placement";
        }
        return false;
      }
    }
    // Empty-result guard (§41): a cut that removes everything is an error,
    // not an empty solid.
    BRepCheck_Analyzer check(result);
    if (!check.IsValid(result)) {
      if (error) *error = "boolean result failed validation";
      return false;
    }
    *out = result;
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("boolean kernel exception: ") + f.what();
    return false;
  }
}

}  // namespace

bool CreateBooleanFeature(const std::string& featureId, const std::string& op,
                          const std::string& targetId,
                          const std::string& toolId, std::string* error) {
  if (featureId.empty() || targetId.empty() || toolId.empty()) {
    if (error) *error = "featureId, targetId and toolId are required";
    return false;
  }
  if (!OpType(op)) {
    if (error) *error = "op must be fuse|cut|common";
    return false;
  }
  if (targetId == toolId) {
    if (error) *error = "target and tool must differ";
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
  ShapeRecord target, tool;
  if (!ShapeStore::instance().get(targetId, &target) || target.shape.IsNull()) {
    if (error) *error = "unknown target " + targetId;
    return false;
  }
  if (!ShapeStore::instance().get(toolId, &tool) || tool.shape.IsNull()) {
    if (error) *error = "unknown tool " + toolId;
    return false;
  }
  TopoDS_Shape shape;
  if (!BuildBooleanShape(op, target.shape, tool.shape, &shape, error)) {
    return false;
  }
  if (!OcafLive::instance().BeginCommand(error)) return false;
  const bool ok =
      CommitShape(featureId, OpType(op), {}, {targetId, toolId}, "op=" + op,
                  shape, nullptr, true, error);
  if (!ok) {
    OcafLive::instance().AbortCommand();
    return false;
  }
  bool hadDelta = false;
  OcafLive::instance().CommitCommand(&hadDelta, nullptr);
  return true;
}

bool RebuildBooleanFromStore(const std::string& featureId,
                             std::string* error) {
  ShapeRecord rec;
  if (!ShapeStore::instance().get(featureId, &rec)) {
    if (error) *error = "unknown feature " + featureId;
    return false;
  }
  // op encoded in refExtra as "op=<name>" (paramsMm empty for booleans).
  std::string op;
  const std::string marker = "op=";
  const size_t pos = rec.refExtra.find(marker);
  if (pos == std::string::npos) {
    if (error) *error = "boolean record missing op";
    return false;
  }
  op = rec.refExtra.substr(pos + marker.size());
  if (rec.dependsOn.size() != 2) {
    if (error) *error = "boolean needs exactly 2 inputs";
    return false;
  }
  ShapeRecord target, tool;
  if (!ShapeStore::instance().get(rec.dependsOn[0], &target) ||
      target.shape.IsNull()) {
    if (error) {
      *error = "boolean input vanished (needs repair): " + rec.dependsOn[0];
    }
    return false;
  }
  if (!ShapeStore::instance().get(rec.dependsOn[1], &tool) ||
      tool.shape.IsNull()) {
    if (error) {
      *error = "boolean input vanished (needs repair): " + rec.dependsOn[1];
    }
    return false;
  }
  TopoDS_Shape shape;
  if (!BuildBooleanShape(op, target.shape, tool.shape, &shape, error)) {
    return false;
  }
  return CommitShape(featureId, rec.type, rec.paramsMm, rec.dependsOn,
                     rec.refExtra, shape, nullptr, false, error);
}

#else

bool CreateBooleanFeature(const std::string&, const std::string&,
                          const std::string&, const std::string&,
                          std::string* error) {
  if (error) *error = "booleans require OCCT (link via vcpkg)";
  return false;
}

bool RebuildBooleanFromStore(const std::string&, std::string* error) {
  if (error) *error = "booleans require OCCT (link via vcpkg)";
  return false;
}

#endif

}  // namespace kreoda
