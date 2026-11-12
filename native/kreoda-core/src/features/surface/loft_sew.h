#pragma once

#include "model/shapes.h"
#include "model/commit.h"
#include "features/sketch/sketch_store.h"
#include "features/sketch/sketch_face.h"
#include "model/geometry_availability.h"
#include <cmath>
#include <string>
#include <vector>

#if KREODA_WITH_OCCT
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <GProp_GProps.hxx>
#include <Standard_Failure.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Face.hxx>
#endif

namespace kreoda {

// Kernel-only evaluator for a bounded surface workflow: loft closed planar
// section wires into a lateral surface, cap the ends, sew, and make a solid.
// Caller owns persistence/feature graph/transaction; this does not mutate stores.
inline bool BuildLoftSewnSolid(const std::vector<ShapeRecord>& sections,
                              const std::string& featureId, ShapeRecord* out,
                              std::string* error) {
  auto fail = [&](const std::string& why) {
    if (error) *error = why;
    return false;
  };
  if (!out || !ShapeStore::ValidFeatureId(featureId) || sections.size() < 2)
    return fail("loft requires output, valid featureId and at least two sections");
#if !KREODA_WITH_OCCT
  return fail("loft requires OCCT");
#else
  try {
    std::vector<TopoDS_Wire> wires;
    wires.reserve(sections.size());
    for (const auto& section : sections) {
      if (section.featureId.empty() || section.shape.IsNull())
        return fail("loft section is missing a featureId or shape");
      TopoDS_Wire wire;
      int count = 0;
      for (TopExp_Explorer it(section.shape, TopAbs_WIRE); it.More(); it.Next()) {
        wire = TopoDS::Wire(it.Current());
        ++count;
      }
      if (count != 1 || wire.IsNull() || !wire.Closed())
        return fail("each loft section must contain exactly one closed wire");
      BRepBuilderAPI_MakeFace cap(wire, true);
      if (!cap.IsDone() || !BRepCheck_Analyzer(cap.Face()).IsValid())
        return fail("loft sections must be planar, valid and cap-able");
      wires.push_back(wire);
    }
    BRepOffsetAPI_ThruSections loft(false, false);
    loft.CheckCompatibility(true);
    for (const auto& wire : wires) loft.AddWire(wire);
    loft.Build();
    if (!loft.IsDone() || loft.Shape().IsNull())
      return fail("surface loft failed");
    BRepBuilderAPI_Sewing sewing(1e-5);
    sewing.Add(loft.Shape());
    BRepBuilderAPI_MakeFace first(wires.front(), true), last(wires.back(), true);
    if (!first.IsDone() || !last.IsDone()) return fail("loft caps failed");
    sewing.Add(first.Face());
    sewing.Add(last.Face());
    sewing.Perform();
    const auto sewn = sewing.SewedShape();
    TopoDS_Shell shell;
    int shells = 0;
    for (TopExp_Explorer it(sewn, TopAbs_SHELL); it.More(); it.Next()) {
      shell = TopoDS::Shell(it.Current());
      ++shells;
    }
    if (shells != 1 || !shell.Closed())
      return fail("sewn loft is not one closed shell");
    BRepBuilderAPI_MakeSolid maker(shell);
    if (!maker.IsDone()) return fail("solid construction failed");
    TopoDS_Solid solid = maker.Solid();
    if (!BRepCheck_Analyzer(solid).IsValid()) return fail("loft solid is invalid");
    GProp_GProps volume;
    BRepGProp::VolumeProperties(solid, volume);
    if (!std::isfinite(volume.Mass()) || std::abs(volume.Mass()) < 1e-9)
      return fail("loft solid has zero or invalid volume");
    if (volume.Mass() < 0) solid.Reverse();
    ShapeRecord candidate;
    candidate.featureId = featureId;
    candidate.type = "SurfaceLoftSewnSolid";
    for (const auto& section : sections) candidate.dependsOn.push_back(section.featureId);
    candidate.shape = solid;
    candidate.volumeMm3 = std::abs(volume.Mass());
    *out = std::move(candidate);
    return true;
  } catch (const Standard_Failure& ex) {
    return fail(std::string("OCCT loft failure: ") + ex.what());
  }
#endif
}

// Canonical persisted feature entry: section sketch IDs are DAG dependencies.
inline bool BuildLoftFromSketchIds(const std::vector<std::string>& sketchIds,
                                  const std::string& featureId,
                                  ShapeRecord* output, std::string* error) {
  if (!output || sketchIds.size() < 2)
    return error ? (*error="at least two sketches required",false) : false;
#if !KREODA_WITH_OCCT
  return error ? (*error="loft requires OCCT",false) : false;
#else
  std::vector<ShapeRecord> sections;
  for (const auto& id : sketchIds) {
    SketchFeature sketch;
    if (!SketchStore::instance().get(id,&sketch))
      return error ? (*error="missing sketch "+id,false) : false;
    if (!EnsureGeometryAvailable(id,error)) return false;
    TopoDS_Shape profile;
    if (!BuildProfileFromSketch(sketch,&profile,error)) return false;
    ShapeRecord section;
    section.featureId=id;
    section.type="Sketch";
    section.shape=profile;
    sections.push_back(std::move(section));
  }
  return BuildLoftSewnSolid(sections,featureId,output,error);
#endif
}

inline bool CreateSurfaceLoftSewnSolidFeature(const std::string& featureId,
                                             const std::vector<std::string>& sketchIds,
                                             std::string* error) {
  if (!CheckNewId(featureId,error)) return false;
  ShapeRecord result;
  if (!BuildLoftFromSketchIds(sketchIds,featureId,&result,error)) return false;
#if KREODA_WITH_OCCT
  return CommitSingleFeature(featureId,result.type,{},result.dependsOn,"",result.shape,error);
#else
  return false;
#endif
}

inline bool RebuildSurfaceLoftSewnSolidFromStore(const std::string& featureId,
                                                std::string* error) {
  ShapeRecord previous;
  if (!ShapeStore::instance().get(featureId,&previous) ||
      previous.type!="SurfaceLoftSewnSolid" || previous.dependsOn.size()<2 ||
      !previous.paramsMm.empty())
    return error ? (*error="invalid stored surface loft",false) : false;
  ShapeRecord rebuilt;
  if (!BuildLoftFromSketchIds(previous.dependsOn,featureId,&rebuilt,error)) return false;
#if KREODA_WITH_OCCT
  return CommitShape(featureId,previous.type,previous.paramsMm,previous.dependsOn,
                     previous.refExtra,rebuilt.shape,&previous,false,error);
#else
  return false;
#endif
}
} // namespace kreoda
