#pragma once

#include <cmath>
#include <string>
#include <vector>

#include "features/surface/surface_modeling.h"
#include "features/surface/surface_sew_offset.h"

#if KREODA_WITH_OCCT
#include <BRepAdaptor_Curve.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Standard_Failure.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#endif

namespace kreoda {

#if KREODA_WITH_OCCT
namespace surface_sweep_detail {

inline bool Fail(std::string* error, const std::string& message) {
  if (error) *error = message;
  return false;
}

inline bool RawEdgeCount(const SketchFeature& sketch, size_t* count,
                         std::string* error) {
  if (!count) return Fail(error, "SurfaceSweep edge count output is null");
  size_t total = surface_detail::EntityIds(sketch).size();
  if (total > kMaxSurfaceSketchEdges)
    return Fail(error, "SurfaceSweep sketch exceeds 4096 raw edges");
  for (const auto& group : sketch.projectionGroups) {
    if (group.evaluatedEdges.size() > kMaxSurfaceSketchEdges - total)
      return Fail(error, "SurfaceSweep sketch exceeds 4096 raw edges");
    total += group.evaluatedEdges.size();
  }
  if (total == 0) return Fail(error, "SurfaceSweep sketch has no boundary edges");
  *count = total;
  return true;
}

inline bool StartVertexAndTangent(const TopoDS_Wire& wire,
                                  TopoDS_Vertex* startVertex,
                                  gp_Pnt* startPoint, gp_Vec* tangent,
                                  std::string* error) {
  BRepTools_WireExplorer ordered(wire);
  if (!ordered.More()) return Fail(error, "SurfaceSweep path has no first edge");
  const TopoDS_Edge edge = ordered.Current();
  TopoDS_Vertex first, last;
  TopExp::Vertices(edge, first, last, Standard_True);
  if (first.IsNull())
    return Fail(error, "SurfaceSweep path has no canonical first vertex");

  BRepAdaptor_Curve curve(edge);
  const double parameter = edge.Orientation() == TopAbs_REVERSED
                               ? curve.LastParameter()
                               : curve.FirstParameter();
  if (!std::isfinite(parameter))
    return Fail(error, "SurfaceSweep path has no finite initial parameter");
  gp_Pnt evaluated;
  gp_Vec direction;
  curve.D1(parameter, evaluated, direction);
  if (edge.Orientation() == TopAbs_REVERSED) direction.Reverse();
  if (!std::isfinite(direction.X()) || !std::isfinite(direction.Y()) ||
      !std::isfinite(direction.Z()) || direction.Magnitude() <= Precision::Confusion())
    return Fail(error, "SurfaceSweep path has a zero initial tangent");
  const gp_Pnt vertexPoint = BRep_Tool::Pnt(first);
  if (evaluated.Distance(vertexPoint) > 1e-7)
    return Fail(error, "SurfaceSweep canonical path vertex and tangent disagree");
  direction.Normalize();
  *startVertex = first;
  *startPoint = vertexPoint;
  *tangent = direction;
  return true;
}

inline bool ValidatePatch(const TopoDS_Shape& shape, std::string* error) {
  ShapeRecord validation;
  validation.type = "SurfaceSweep";
  if (!surface_sew_offset_detail::SetSurfaceBounds(
          shape, &validation, "SurfaceSweep patch", error) ||
      !surface_sew_offset_detail::NoSelfInterference(
          shape, "SurfaceSweep patch", error))
    return false;
  if (!TopExp_Explorer(shape, TopAbs_FACE).More())
    return Fail(error, "SurfaceSweep patch contains no faces");
  return true;
}

inline bool ValidateCompound(const TopoDS_Shape& shape, size_t expectedFaces,
                             std::string* error) {
  size_t faces = 0;
  for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next()) ++faces;
  if (faces == 0 || faces != expectedFaces)
    return Fail(error, "SurfaceSweep compound dropped or merged a patch face");
  ShapeRecord validation;
  validation.type = "SurfaceSweep";
  return surface_sew_offset_detail::SetSurfaceBounds(
             shape, &validation, "SurfaceSweep compound", error) &&
         surface_sew_offset_detail::NoSelfInterference(
             shape, "SurfaceSweep compound", error);
}

}  // namespace surface_sweep_detail

inline bool BuildSurfaceSweepShape(const std::string& profileSketchId,
                                   const std::string& pathSketchId,
                                   double toleranceMm, TopoDS_Shape* output,
                                   std::string* error) {
  using namespace surface_sweep_detail;
  if (!output) return Fail(error, "SurfaceSweep output shape is null");
  if (!ShapeStore::ValidFeatureId(profileSketchId) ||
      !ShapeStore::ValidFeatureId(pathSketchId))
    return Fail(error, "SurfaceSweep sketch IDs must match [A-Za-z0-9_-]");
  if (profileSketchId == pathSketchId)
    return Fail(error, "SurfaceSweep profileSketchId and pathSketchId must differ");
  if (!surface_sew_offset_detail::ValidTolerance(toleranceMm))
    return Fail(error, "SurfaceSweep toleranceMm must be finite and in [1e-7, 1]");

  try {
  SketchFeature profile, path;
  if (!surface_detail::LoadSketch(profileSketchId, &profile, error) ||
      !surface_detail::LoadSketch(pathSketchId, &path, error))
    return false;
  size_t profileEdgeCount = 0, pathEdgeCount = 0;
  if (!RawEdgeCount(profile, &profileEdgeCount, error) ||
      !RawEdgeCount(path, &pathEdgeCount, error))
    return false;
  if (profileEdgeCount > 65536 / pathEdgeCount)
    return Fail(error, "SurfaceSweep profile-edge count × path-edge count exceeds 65536");

  std::vector<surface_detail::SurfaceWire> profiles, paths;
  if (!surface_detail::CollectSketchWires(profile, &profiles, error) ||
      !surface_detail::CollectSketchWires(path, &paths, error))
    return false;
  if (profiles.empty() || profiles.size() > 128)
    return Fail(error, "SurfaceSweep requires 1 to 128 profile wires");
  if (paths.size() != 1)
    return Fail(error, "SurfaceSweep path must contain exactly one connected wire");

  TopoDS_Vertex sourceStart;
  gp_Pnt startPoint;
  gp_Vec tangent;
  if (!StartVertexAndTangent(paths.front().wire, &sourceStart, &startPoint,
                             &tangent, error))
    return false;
  gp_Vec normal(profile.plane.normal[0], profile.plane.normal[1],
                profile.plane.normal[2]);
  const double normalLength = normal.Magnitude();
  if (!std::isfinite(normalLength) || normalLength <= Precision::Confusion())
    return Fail(error, "SurfaceSweep profile plane has no valid normal");
  normal.Normalize();
  const gp_Pnt planeOrigin(profile.plane.origin[0], profile.plane.origin[1],
                           profile.plane.origin[2]);
  const gp_Vec originToStart(planeOrigin, startPoint);
  if (std::abs(originToStart.Dot(normal)) > toleranceMm)
    return Fail(error, "SurfaceSweep profile plane must contain the canonical path start within toleranceMm");
  if (std::abs(normal.Dot(tangent)) < 1.0 - 1e-8)
    return Fail(error, "SurfaceSweep profile plane must be perpendicular to the initial path tangent");

    BRepBuilderAPI_Copy pathCopy(paths.front().wire, Standard_True, Standard_False);
    if (!pathCopy.IsDone() || pathCopy.Shape().IsNull())
      return Fail(error, "SurfaceSweep could not copy exact path topology");
    const TopoDS_Wire spine = TopoDS::Wire(pathCopy.Shape());
    TopoDS_Vertex copiedStart;
    gp_Pnt copiedPoint;
    gp_Vec copiedTangent;
    if (!StartVertexAndTangent(spine, &copiedStart, &copiedPoint,
                               &copiedTangent, error))
      return false;
    if (copiedPoint.Distance(startPoint) > 1e-7 ||
        copiedTangent.Dot(tangent) < 1.0 - 1e-10)
      return Fail(error, "SurfaceSweep exact path copy changed its canonical start");

    BRep_Builder builder;
    TopoDS_Compound compound;
    builder.MakeCompound(compound);
    size_t expectedFaces = 0;
    for (const auto& sourceProfile : profiles) {
      BRepBuilderAPI_Copy profileCopy(sourceProfile.wire, Standard_True,
                                      Standard_False);
      if (!profileCopy.IsDone() || profileCopy.Shape().IsNull())
        return Fail(error, "SurfaceSweep could not copy exact profile topology");
      BRepOffsetAPI_MakePipeShell pipe(spine);
      pipe.SetMode(Standard_False);
      pipe.SetTolerance(toleranceMm, toleranceMm, 1e-6);
      pipe.SetTransitionMode(BRepBuilderAPI_RightCorner);
      pipe.Add(profileCopy.Shape(), copiedStart, Standard_False, Standard_False);
      pipe.Build();
      if (!pipe.IsDone() || pipe.Shape().IsNull())
        return Fail(error, "SurfaceSweep OCCT pipe-shell construction failed");
      const TopoDS_Shape patch = pipe.Shape();
      if (!ValidatePatch(patch, error)) return false;
      size_t patchFaces = 0;
      for (TopExp_Explorer it(patch, TopAbs_FACE); it.More(); it.Next()) ++patchFaces;
      expectedFaces += patchFaces;
      builder.Add(compound, patch);
    }
    if (!ValidateCompound(compound, expectedFaces, error)) return false;
    *output = compound;
    return true;
  } catch (const Standard_Failure& failure) {
    return Fail(error, std::string("SurfaceSweep OCCT failure: ") +
                           failure.GetMessageString());
  }
}

inline bool CreateSurfaceSweepFeature(const std::string& featureId,
                                      const std::string& profileSketchId,
                                      const std::string& pathSketchId,
                                      double toleranceMm,
                                      std::string* error) {
  if (!CheckNewId(featureId, error)) return false;
  TopoDS_Shape shape;
  if (!BuildSurfaceSweepShape(profileSketchId, pathSketchId, toleranceMm,
                              &shape, error))
    return false;
  return CommitSurfaceFeature(featureId, "SurfaceSweep", {toleranceMm},
                              {profileSketchId, pathSketchId}, shape, error);
}

inline bool RebuildSurfaceSweepFromStore(const std::string& featureId,
                                         std::string* error) {
  ShapeRecord previous;
  if (!ShapeStore::instance().get(featureId, &previous) ||
      previous.type != "SurfaceSweep" || previous.dependsOn.size() != 2 ||
      previous.paramsMm.size() != 1)
    return surface_sweep_detail::Fail(error, "invalid stored SurfaceSweep feature");
  TopoDS_Shape shape;
  if (!BuildSurfaceSweepShape(previous.dependsOn[0], previous.dependsOn[1],
                              previous.paramsMm[0], &shape, error))
    return false;
  return CommitShape(featureId, "SurfaceSweep", previous.paramsMm,
                     previous.dependsOn, previous.refExtra, shape,
                     &previous, false, error);
}
#endif

}  // namespace kreoda
