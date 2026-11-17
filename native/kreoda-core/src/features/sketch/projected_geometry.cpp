#include "projected_geometry.h"

#if KREODA_WITH_OCCT
#include <BRepAdaptor_Curve.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Section.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <Bnd_Box.hxx>
#include <BRep_Tool.hxx>
#include <GeomProjLib.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Plane.hxx>
#include <GeomAbs_CurveType.hxx>
#include <GProp_GProps.hxx>
#include <HLRAlgo_Projector.hxx>
#include <HLRBRep_Algo.hxx>
#include <HLRBRep_HLRToShape.hxx>
#include <Precision.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <Standard_Failure.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <cmath>
#include <exception>
#include <utility>

namespace kreoda {
namespace {

constexpr double kGeometryTolerance = 1e-6;  // CAD mm

struct TargetFrame {
  gp_Ax3 axes;
  gp_Pln plane;
  Handle(Geom_Plane) surface;
  gp_Trsf localToWorld;
  gp_Trsf worldToLocal;
};

bool Fail(std::string* error, const char* message) {
  if (error) *error = message;
  return false;
}

bool Fail(std::string* error, const std::string& message) {
  if (error) *error = message;
  return false;
}

bool MakeTargetFrame(const SketchPlane& sketchPlane,
                     TargetFrame* frame,
                     std::string* error) {
  if (!ValidateSketchPlane(sketchPlane, error)) return false;

  const gp_Pnt origin(sketchPlane.origin[0], sketchPlane.origin[1],
                      sketchPlane.origin[2]);
  const gp_Dir xAxis(sketchPlane.xAxis[0], sketchPlane.xAxis[1],
                     sketchPlane.xAxis[2]);
  const gp_Dir normal(sketchPlane.normal[0], sketchPlane.normal[1],
                      sketchPlane.normal[2]);
  frame->axes = gp_Ax3(origin, normal, xAxis);
  frame->plane = gp_Pln(frame->axes);
  frame->surface = new Geom_Plane(frame->plane);
  frame->localToWorld.SetValues(
      sketchPlane.xAxis[0], sketchPlane.yAxis[0], sketchPlane.normal[0],
      sketchPlane.origin[0],
      sketchPlane.xAxis[1], sketchPlane.yAxis[1], sketchPlane.normal[1],
      sketchPlane.origin[1],
      sketchPlane.xAxis[2], sketchPlane.yAxis[2], sketchPlane.normal[2],
      sketchPlane.origin[2]);
  frame->worldToLocal = frame->localToWorld.Inverted();
  return true;
}

bool IsFinite(const gp_Pnt& point) {
  return std::isfinite(point.X()) && std::isfinite(point.Y()) &&
         std::isfinite(point.Z());
}

gp_Pnt ProjectPoint(const gp_Pnt& point, const SketchPlane& plane) {
  const gp_Pnt origin(plane.origin[0], plane.origin[1], plane.origin[2]);
  const gp_Vec normal(plane.normal[0], plane.normal[1], plane.normal[2]);
  return point.Translated(-gp_Vec(origin, point).Dot(normal) * normal);
}

bool ValidateEdge(const TopoDS_Edge& edge,
                  const SketchPlane& plane,
                  bool requireCoplanar,
                  bool checkTopology,
                  std::string* error) {
  if (edge.IsNull()) return Fail(error, "source edge is null");
  if (checkTopology && !BRepCheck_Analyzer(edge).IsValid()) {
    return Fail(error, "edge is malformed");
  }

  TopLoc_Location location;
  double first = 0;
  double last = 0;
  const Handle(Geom_Curve) curve = BRep_Tool::Curve(edge, location, first, last);
  if (curve.IsNull()) return Fail(error, "edge has no supported 3D curve");
  if (!std::isfinite(first) || !std::isfinite(last) ||
      Precision::IsInfinite(first) || Precision::IsInfinite(last) ||
      !(last > first)) {
    return Fail(error, "edge curve interval must be finite and nonempty");
  }

  BRepAdaptor_Curve adaptor(edge);
  for (int i = 0; i <= 8; ++i) {
    const double parameter = first + (last - first) * i / 8.0;
    const gp_Pnt point = adaptor.Value(parameter);
    if (!IsFinite(point)) return Fail(error, "edge curve contains nonfinite points");
    if (requireCoplanar) {
      const gp_Vec offset(gp_Pnt(plane.origin[0], plane.origin[1], plane.origin[2]),
                          point);
      const double distance = offset.Dot(
          gp_Vec(plane.normal[0], plane.normal[1], plane.normal[2]));
      if (!std::isfinite(distance) || std::fabs(distance) > kGeometryTolerance) {
        return Fail(error, "result edge is outside target plane tolerance");
      }
    }
  }

  GProp_GProps properties;
  BRepGProp::LinearProperties(edge, properties);
  const double length = std::fabs(properties.Mass());
  if (!std::isfinite(length) || length <= kGeometryTolerance) {
    return Fail(error, "edge is collapsed or has nonfinite length");
  }
  return true;
}

bool ValidateShape(const TopoDS_Shape& shape, std::string* error) {
  if (shape.IsNull()) return Fail(error, "source shape is null");
  if (!BRepCheck_Analyzer(shape).IsValid()) {
    return Fail(error, "source shape is malformed");
  }
  return true;
}

std::vector<TopoDS_Edge> ExtractEdges(const TopoDS_Shape& shape) {
  std::vector<TopoDS_Edge> edges;
  if (shape.IsNull()) return edges;
  if (shape.ShapeType() == TopAbs_EDGE) {
    edges.push_back(TopoDS::Edge(shape));
    return edges;
  }
  for (TopExp_Explorer it(shape, TopAbs_EDGE); it.More(); it.Next()) {
    edges.push_back(TopoDS::Edge(it.Current()));
  }
  return edges;
}

bool ValidateResults(const std::vector<TopoDS_Edge>& edges,
                     const SketchPlane& plane,
                     bool checkTopology,
                     std::string* error) {
  if (edges.empty()) return Fail(error, "operation produced no nondegenerate edges");
  for (const auto& edge : edges) {
    if (!ValidateEdge(edge, plane, true, checkTopology, error)) return false;
  }
  return true;
}

void Publish(std::vector<TopoDS_Edge>* output,
             std::vector<TopoDS_Edge>&& candidate,
             std::string* error) {
  *output = std::move(candidate);
  if (error) error->clear();
}

bool ReportOcctFailure(std::string* error, const Standard_Failure& failure) {
  const char* message = failure.GetMessageString();
  return Fail(error, message && message[0] ? message : "Open CASCADE operation failed");
}

}  // namespace

bool ProjectNativeEdgesToPlane(const std::vector<TopoDS_Edge>& source,
                               const SketchPlane& target,
                               std::vector<TopoDS_Edge>* output,
                               std::string* error) {
  if (!output) return Fail(error, "output edge vector is null");
  if (source.empty()) return Fail(error, "source edge list is empty");

  try {
    TargetFrame frame;
    if (!MakeTargetFrame(target, &frame, error)) return false;

    std::vector<TopoDS_Edge> candidate;
    candidate.reserve(source.size());
    for (const auto& edge : source) {
      std::string validationError;
      if (!ValidateEdge(edge, target, false, true, &validationError)) {
        return Fail(error, "source edge: " + validationError);
      }

      TopLoc_Location location;
      double first = 0;
      double last = 0;
      const Handle(Geom_Curve) localCurve =
          BRep_Tool::Curve(edge, location, first, last);
      TopoDS_Edge result;
      BRepAdaptor_Curve sourceAdaptor(edge);
      if (sourceAdaptor.GetType() == GeomAbs_Line) {
        const gp_Pnt start = ProjectPoint(sourceAdaptor.Value(first), target);
        const gp_Pnt end = ProjectPoint(sourceAdaptor.Value(last), target);
        if (start.Distance(end) <= kGeometryTolerance) {
          return Fail(error, "source line collapses to a point on target plane");
        }
        BRepBuilderAPI_MakeEdge lineBuilder(start, end);
        if (!lineBuilder.IsDone()) {
          return Fail(error, "OCCT could not build projected line");
        }
        result = lineBuilder.Edge();
      } else {
        Handle(Geom_Curve) worldCurve =
            Handle(Geom_Curve)::DownCast(localCurve->Copy());
        if (worldCurve.IsNull()) {
          return Fail(error, "cannot copy source edge curve");
        }
        if (!location.IsIdentity()) worldCurve->Transform(location.Transformation());

        const Handle(Geom_Curve) projected = GeomProjLib::ProjectOnPlane(
            worldCurve, frame.surface,
            gp_Dir(target.normal[0], target.normal[1], target.normal[2]), true);
        if (projected.IsNull()) {
          return Fail(error, "OCCT could not project source curve onto target plane");
        }

        BRepBuilderAPI_MakeEdge builder(projected, first, last);
        if (!builder.IsDone()) return Fail(error, "OCCT could not build projected edge");
        result = builder.Edge();
      }
      result.Orientation(edge.Orientation());
      if (!ValidateEdge(result, target, true, false, &validationError)) {
        return Fail(error, "projected edge: " + validationError);
      }
      candidate.push_back(std::move(result));
    }

    Publish(output, std::move(candidate), error);
    return true;
  } catch (const Standard_Failure& failure) {
    return ReportOcctFailure(error, failure);
  } catch (const std::exception& failure) {
    return Fail(error, failure.what());
  } catch (...) {
    return Fail(error, "native edge projection failed");
  }
}

bool ProjectNativeSilhouetteToPlane(const TopoDS_Shape& source,
                                    const SketchPlane& target,
                                    std::vector<TopoDS_Edge>* output,
                                    std::string* error) {
  if (!output) return Fail(error, "output edge vector is null");

  try {
    TargetFrame frame;
    if (!MakeTargetFrame(target, &frame, error) || !ValidateShape(source, error)) {
      return false;
    }

    BRepBuilderAPI_Transform localTransform(source, frame.worldToLocal, true);
    if (!localTransform.IsDone()) {
      return Fail(error, "cannot place source shape in target frame");
    }

    Bnd_Box bounds;
    BRepBndLib::Add(localTransform.Shape(), bounds, false);
    if (bounds.IsVoid() || bounds.IsOpen()) {
      return Fail(error, "source shape must have finite bounds");
    }
    double xMin = 0, yMin = 0, zMin = 0, xMax = 0, yMax = 0, zMax = 0;
    bounds.Get(xMin, yMin, zMin, xMax, yMax, zMax);
    if (!std::isfinite(zMin) || !std::isfinite(zMax) ||
        Precision::IsInfinite(zMin) || Precision::IsInfinite(zMax)) {
      return Fail(error, "source shape must have finite bounds");
    }
    const double depth = zMax - zMin;
    if (!std::isfinite(depth) || depth < 0 || Precision::IsInfinite(depth)) {
      return Fail(error, "source shape depth is unsupported");
    }
    const double margin = std::max(1.0, depth);
    const double travel = depth + 2 * margin;
    if (!std::isfinite(travel) || Precision::IsInfinite(travel)) {
      return Fail(error, "source shape depth is unsupported");
    }

    gp_Trsf shift;
    shift.SetTranslation(gp_Vec(0, 0, -zMax - margin));
    BRepBuilderAPI_Transform shiftedShape(localTransform.Shape(), shift, true);
    if (!shiftedShape.IsDone()) {
      return Fail(error, "cannot position source shape for silhouette section");
    }

    TopoDS_Shape sweptBoundary;
    for (TopExp_Explorer it(shiftedShape.Shape(), TopAbs_FACE); it.More(); it.Next()) {
      BRepPrimAPI_MakePrism sweptFace(TopoDS::Face(it.Current()),
                                      gp_Vec(0, 0, travel), true);
      if (!sweptFace.IsDone()) {
        return Fail(error, "cannot sweep source boundary face for silhouette");
      }
      if (sweptBoundary.IsNull()) {
        sweptBoundary = sweptFace.Shape();
      } else {
        BRepAlgoAPI_Fuse fuse(sweptBoundary, sweptFace.Shape());
        if (!fuse.IsDone()) return Fail(error, "cannot fuse projected source faces");
        sweptBoundary = fuse.Shape();
      }
    }
    if (sweptBoundary.IsNull()) {
      return Fail(error, "source shape has no projectable boundary faces");
    }

    BRepAlgoAPI_Section section(sweptBoundary, gp_Pln(), true);
    if (!section.IsDone()) return Fail(error, "OCCT silhouette section failed");

    std::vector<TopoDS_Edge> candidate = ExtractEdges(section.Shape());
    if (!candidate.empty()) {
      BRepBuilderAPI_Transform worldTransform(section.Shape(), frame.localToWorld, true);
      if (worldTransform.IsDone()) {
        candidate = ExtractEdges(worldTransform.Shape());
        std::string validationError;
        if (ValidateResults(candidate, target, true, &validationError)) {
          Publish(output, std::move(candidate), error);
          return true;
        }
      }
    }

    Handle(HLRBRep_Algo) algorithm = new HLRBRep_Algo();
    algorithm->Projector(HLRAlgo_Projector(gp_Ax2()));
    algorithm->Add(localTransform.Shape());
    algorithm->Update();
    algorithm->Hide();
    HLRBRep_HLRToShape hiddenLineResult(algorithm);
    const TopoDS_Shape outline = hiddenLineResult.OutLineVCompound3d();
    if (outline.IsNull()) return Fail(error, "OCCT found no apparent silhouette edges");

    TargetFrame viewPlane;
    if (!MakeTargetFrame(SketchPlane{}, &viewPlane, error)) return false;
    std::vector<TopoDS_Edge> localContours;
    for (const auto& edge : ExtractEdges(outline)) {
      std::string validationError;
      if (!ValidateEdge(edge, SketchPlane{}, false, false, &validationError)) {
        return Fail(error, "OCCT outline edge: " + validationError);
      }
      TopLoc_Location location;
      double first = 0;
      double last = 0;
      const Handle(Geom_Curve) curve = BRep_Tool::Curve(edge, location, first, last);
      Handle(Geom_Curve) worldCurve = Handle(Geom_Curve)::DownCast(curve->Copy());
      if (worldCurve.IsNull()) return Fail(error, "cannot copy OCCT outline curve");
      if (!location.IsIdentity()) worldCurve->Transform(location.Transformation());
      const Handle(Geom_Curve) projected = GeomProjLib::ProjectOnPlane(
          worldCurve, viewPlane.surface, gp_Dir(0, 0, 1), true);
      if (projected.IsNull()) return Fail(error, "cannot project OCCT outline curve");
      BRepBuilderAPI_MakeEdge edgeBuilder(projected, first, last);
      if (!edgeBuilder.IsDone()) return Fail(error, "cannot build projected outline edge");
      TopoDS_Edge projectedEdge = edgeBuilder.Edge();
      projectedEdge.Orientation(edge.Orientation());
      if (!ValidateEdge(projectedEdge, SketchPlane{}, true, false, &validationError)) {
        return Fail(error, "projected outline edge: " + validationError);
      }
      localContours.push_back(std::move(projectedEdge));
    }
    if (localContours.empty()) return Fail(error, "OCCT found no apparent silhouette edges");

    candidate.clear();
    candidate.reserve(localContours.size());
    for (const auto& edge : localContours) {
      BRepBuilderAPI_Transform worldOutline(edge, frame.localToWorld, true);
      if (!worldOutline.IsDone()) {
        return Fail(error, "cannot map silhouette into target world frame");
      }
      candidate.push_back(TopoDS::Edge(worldOutline.Shape()));
    }
    if (!ValidateResults(candidate, target, false, error)) return false;

    Publish(output, std::move(candidate), error);
    return true;
  } catch (const Standard_Failure& failure) {
    return ReportOcctFailure(error, failure);
  } catch (const std::exception& failure) {
    return Fail(error, failure.what());
  } catch (...) {
    return Fail(error, "native silhouette evaluation failed");
  }
}

bool IntersectNativeShapeWithPlane(const TopoDS_Shape& source,
                                   const SketchPlane& target,
                                   std::vector<TopoDS_Edge>* output,
                                   std::string* error) {
  if (!output) return Fail(error, "output edge vector is null");

  try {
    TargetFrame frame;
    if (!MakeTargetFrame(target, &frame, error) || !ValidateShape(source, error)) {
      return false;
    }

    BRepAlgoAPI_Section section(source, frame.plane, false);
    section.SetNonDestructive(true);
    section.Build();
    if (!section.IsDone()) return Fail(error, "OCCT plane section failed");

    std::vector<TopoDS_Edge> candidate = ExtractEdges(section.Shape());
    if (!ValidateResults(candidate, target, true, error)) return false;

    Publish(output, std::move(candidate), error);
    return true;
  } catch (const Standard_Failure& failure) {
    return ReportOcctFailure(error, failure);
  } catch (const std::exception& failure) {
    return Fail(error, failure.what());
  } catch (...) {
    return Fail(error, "native plane section failed");
  }
}

}  // namespace kreoda
#endif
