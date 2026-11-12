#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <limits>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <tuple>
#include <vector>

#include "document/document_store.h"
#include "features/surface/surface_trim_extend.h"
#include "features/primitives/primitives.h"
#include "features/sketch/sketch_commands.h"
#include "features/sketch/sketch_json.h"
#include "features/surface/surface_modeling.h"
#include "model/commit.h"
#include "model/shapes.h"
#include "protocol/dispatcher.h"
#include "topology/face_roles.h"

#if KREODA_WITH_OCCT
#include <BRepAdaptor_Curve.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRep_Builder.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepLib.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <Geom2d_Circle.hxx>
#include <Geom2d_Line.hxx>
#include <GeomAbs_CurveType.hxx>
#include <Geom_BSplineSurface.hxx>
#include <Geom_Plane.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <Geom_Surface.hxx>
#include <GProp_GProps.hxx>
#include <NCollection_Array1.hxx>
#include <NCollection_Array2.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS_Compound.hxx>
#include <gp_Pnt2d.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax2d.hxx>
#include <gp_Circ2d.hxx>
#include <gp_Dir.hxx>
#include <gp_Dir2d.hxx>
#include <gp_Pnt.hxx>
#include <gp_Pln.hxx>

namespace {
using Json = nlohmann::json;

Json rpc(Json request) {
  request["protocolVersion"] = 1;
  request["documentId"] = "surface-trim-extend-doc";
  static int sequence = 0;
  request["requestId"] = "surface-trim-extend-" + std::to_string(++sequence);
  const auto bytes = kreoda::handle_command(request.dump());
  return Json::parse(bytes.begin(), bytes.end());
}

double areaMm2(const std::string& featureId) {
  const auto response = rpc({{"type", kreoda::kRequestSessionQuery},
      {"method", "measureArea"}, {"params", {{"featureId", featureId}}}});
  EXPECT_EQ(response.value("status", std::string{}), "ok") << response.dump(2);
  return response["result"]["areaMm2"].get<double>();
}

void createPublicSurface(const std::string& id, const gp_Pnt2d& first,
                         const gp_Pnt2d& second) {
  kreoda::SketchModel model;
  model.points.push_back({"a", first.X(), first.Y(), true});
  model.points.push_back({"b", second.X(), second.Y(), true});
  model.lines.push_back({"line", "a", "b"});
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature(id + "-sketch", "XY", model, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSurfaceExtrudeFeature(id, id + "-sketch", 10, &error)) << error;
}

void createPublicCylinderSurface(const std::string& id, double radius, double height) {
  kreoda::SketchModel model;
  model.points.push_back({"center", 0, 0, true});
  model.circles.push_back({"circle", "center", radius});
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature(id + "-sketch", "XY", model, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSurfaceExtrudeFeature(id, id + "-sketch", height, &error)) << error;
}

double shapeArea(const TopoDS_Shape& shape) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(shape, props);
  return props.Mass();
}

double pristineCommonArea(const TopoDS_Shape& first, const TopoDS_Shape& second) {
  BRepBuilderAPI_Copy firstCopy(first, Standard_True, Standard_False);
  BRepBuilderAPI_Copy secondCopy(second, Standard_True, Standard_False);
  if (!firstCopy.IsDone() || !secondCopy.IsDone())
    throw std::runtime_error("fixture boolean operand copy failed");
  BRepAlgoAPI_Common common;
  TopTools_ListOfShape arguments, tools;
  arguments.Append(firstCopy.Shape());
  tools.Append(secondCopy.Shape());
  common.SetArguments(arguments);
  common.SetTools(tools);
  common.SetNonDestructive(Standard_True);
  common.Build();
  if (!common.IsDone()) throw std::runtime_error("fixture Common failed");
  return shapeArea(common.Shape());
}

TopoDS_Wire circleWire(const Handle(Geom_Surface)& surface,
                       const gp_Pnt2d& center, double radius, bool reversed = false) {
  Handle(Geom2d_Curve) pcurve = new Geom2d_Circle(
      gp_Circ2d(gp_Ax2d(center, gp_Dir2d(1, 0)), radius));
  BRepBuilderAPI_MakeEdge edgeMaker(pcurve, surface, 0.0, 2.0 * std::acos(-1.0));
  if (!edgeMaker.IsDone()) throw std::runtime_error("fixture circle edge failed");
  TopoDS_Edge edge = edgeMaker.Edge();
  BRepLib::BuildCurve3d(edge, 1e-6);
  if (reversed) edge.Reverse();
  BRepBuilderAPI_MakeWire wire;
  wire.Add(edge);
  if (!wire.IsDone()) throw std::runtime_error("fixture circle wire failed");
  return wire.Wire();
}

TopoDS_Face annulusOnSupport(const Handle(Geom_Surface)& surface,
                             const gp_Pnt2d& center, double outerRadius,
                             double innerRadius) {
  BRepBuilderAPI_MakeFace maker(surface, circleWire(surface, center, outerRadius),
                                 Standard_True);
  maker.Add(circleWire(surface, center, innerRadius, true));
  if (!maker.IsDone()) throw std::runtime_error("fixture annulus face failed");
  return maker.Face();
}

double nearestPositivePcurveMidpointChord(const TopoDS_Edge& sourceEdge,
                                         const TopoDS_Face& sourceFace,
                                         const TopoDS_Shape& result) {
  Standard_Real sourceFirst = 0, sourceLast = 0;
  const auto sourcePcurve = BRep_Tool::CurveOnSurface(sourceEdge, sourceFace,
                                                       sourceFirst, sourceLast);
  TopLoc_Location sourceLocation;
  const auto sourceSurface = BRep_Tool::Surface(sourceFace, sourceLocation);
  if (sourcePcurve.IsNull() || sourceSurface.IsNull())
    throw std::runtime_error("fixture source boundary pcurve is missing");
  const gp_Pnt2d sourceUv = sourcePcurve->Value((sourceFirst + sourceLast) * 0.5);
  gp_Pnt sourceMidpoint = sourceSurface->Value(sourceUv.X(), sourceUv.Y());
  sourceMidpoint.Transform(sourceLocation.Transformation());

  double nearest = std::numeric_limits<double>::infinity();
  for (TopExp_Explorer faceIt(result, TopAbs_FACE); faceIt.More(); faceIt.Next()) {
    const auto face = TopoDS::Face(faceIt.Current());
    TopLoc_Location location;
    const auto surface = BRep_Tool::Surface(face, location);
    if (surface.IsNull()) continue;
    for (TopExp_Explorer edgeIt(face, TopAbs_EDGE); edgeIt.More(); edgeIt.Next()) {
      Standard_Real first = 0, last = 0;
      const auto pcurve = BRep_Tool::CurveOnSurface(TopoDS::Edge(edgeIt.Current()),
                                                    face, first, last);
      if (pcurve.IsNull()) continue;
      const gp_Pnt2d uv = pcurve->Value((first + last) * 0.5);
      gp_Pnt midpoint = surface->Value(uv.X(), uv.Y());
      midpoint.Transform(location.Transformation());
      const double distance = sourceMidpoint.Distance(midpoint);
      if (distance > 1e-5) nearest = std::min(nearest, distance);
    }
  }
  return nearest;
}

Handle(Geom_BSplineSurface) boundedBsplineSupport() {
  NCollection_Array2<gp_Pnt> poles(1, 3, 1, 3);
  for (int i = 1; i <= 3; ++i) {
    for (int j = 1; j <= 3; ++j) {
      const double x = (i - 1) * 0.5;
      const double y = (j - 1) * 0.5;
      const double z = (i == 2 && j == 2) ? 0.35 : 0.0;
      poles.SetValue(i, j, gp_Pnt(x, y, z));
    }
  }
  NCollection_Array1<double> uKnots(1, 2), vKnots(1, 2);
  uKnots.SetValue(1, 0); uKnots.SetValue(2, 1);
  vKnots.SetValue(1, 0); vKnots.SetValue(2, 1);
  NCollection_Array1<int> uMults(1, 2), vMults(1, 2);
  uMults.SetValue(1, 3); uMults.SetValue(2, 3);
  vMults.SetValue(1, 3); vMults.SetValue(2, 3);
  return new Geom_BSplineSurface(poles, uKnots, vKnots, uMults, vMults, 2, 2);
}

std::string firstEdgeRole(const kreoda::ShapeRecord& source) {
  const auto roles = kreoda::ClassifyEdgeRoles(source.shape, source.type, source.featureId);
  if (roles.empty()) throw std::runtime_error("fixture has no persistent edge role");
  for (const auto& role : roles) {
    if (BRepAdaptor_Curve(role.edge).GetType() == GeomAbs_Circle)
      return role.persistentEdgeId;
  }
  return roles.front().persistentEdgeId;
}

bool commitSurfaceFixture(const std::string& id, const TopoDS_Shape& shape,
                          std::string* error) {
  return kreoda::CommitSingleFeature(id, "SurfaceTrim", {0, 0, 1e-6}, {}, "{}",
                                     shape, error);
}

bool extendFirstEdge(const std::string& targetId, const std::string& featureId,
                     double distanceMm, std::string* error) {
  kreoda::ShapeRecord target;
  if (!kreoda::ShapeStore::instance().get(targetId, &target)) {
    if (error) *error = "fixture target missing";
    return false;
  }
  const auto reference = kreoda::SurfaceTrimExtendJson{
      {"type", "edge"}, {"featureId", targetId},
      {"persistentEdgeId", firstEdgeRole(target)}};
  return kreoda::CreateSurfaceExtendFeature(featureId, targetId, reference,
                                             distanceMm, 1e-6, error);
}

std::string firstFreeEdgeRole(const kreoda::ShapeRecord& source) {
  TopTools_IndexedDataMapOfShapeListOfShape edgeFaces;
  TopExp::MapShapesAndAncestors(source.shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
  for (const auto& role : kreoda::ClassifyEdgeRoles(source.shape, source.type,
                                                     source.featureId)) {
    if (edgeFaces.Contains(role.edge) && edgeFaces.FindFromKey(role.edge).Extent() == 1)
      return role.persistentEdgeId;
  }
  throw std::runtime_error("fixture has no free edge");
}

void createCutSurface(const std::string& id, double x) {
  kreoda::SketchModel model;
  model.points = {{"a", x, -20, true}, {"b", x, 20, true}};
  model.lines = {{"cut", "a", "b"}};
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature(id + "-sketch", "XY", model, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSurfaceExtrudeFeature(id, id + "-sketch", 10, &error)) << error;
}

Json keepPointJson(const std::string& targetId, const gp_Pnt& point) {
  const auto picked = rpc({{"type", kreoda::kRequestSessionQuery},
      {"method", "resolveSurfacePoint"},
      {"params", {{"targetId", targetId},
                   {"pointMm", {point.X(), point.Y(), point.Z()}}}}});
  if (picked.value("status", std::string{}) != "ok")
    throw std::runtime_error(picked.dump());
  return picked["result"];
}

std::pair<std::string, std::array<double, 2>> keepReference(
    const kreoda::ShapeRecord& source, const gp_Pnt& point) {
  std::vector<std::string> roles =
      kreoda::ClassifyFaceRoles(source.shape, source.type, source.featureId);
  auto faceIt = TopExp_Explorer(source.shape, TopAbs_FACE);
  if (!faceIt.More() || roles.size() != 1) throw std::runtime_error("fixture expects one source face");
  TopLoc_Location location;
  const auto surface = BRep_Tool::Surface(TopoDS::Face(faceIt.Current()), location);
  GeomAPI_ProjectPointOnSurf projection(point, surface);
  if (projection.NbPoints() != 1) throw std::runtime_error("keep-point projection is ambiguous");
  Standard_Real u = 0, v = 0;
  projection.LowerDistanceParameters(u, v);
  return {roles.front(), {u, v}};
}
}  // namespace

TEST(SurfaceTrimExtendPublicWire, Command55TrimsRealPublicSurfaceBodies) {
  kreoda::DocumentStore::instance().create("surface-trim-extend-doc");
  createPublicSurface("trim-target", gp_Pnt2d(0, 0), gp_Pnt2d(10, 0));
  createPublicSurface("trim-tool", gp_Pnt2d(5, -1), gp_Pnt2d(5, 1));
  kreoda::ShapeRecord target;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("trim-target", &target));
  const auto revision = kreoda::DocumentStore::instance().revision();
  const auto picked = rpc({{"type", kreoda::kRequestSessionQuery},
      {"method", "resolveSurfacePoint"},
      {"params", {{"targetId", "trim-target"}, {"pointMm", {2, 0, 5}}}}});
  ASSERT_EQ(picked.value("status", std::string{}), "ok") << picked.dump(2);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
  const auto keepFace = picked["result"]["keepFace"];
  const auto keepUv = picked["result"]["keepUv"];
  ASSERT_TRUE(keepFace.is_object());
  ASSERT_TRUE(keepUv.is_array());
  ASSERT_EQ(keepUv.size(), 2u);

  const auto response = rpc({{"type", 55}, {"featureId", "trim-result"},
      {"targetId", "trim-target"}, {"toolId", "trim-tool"},
      {"keepFace", keepFace}, {"keepUv", keepUv}, {"toleranceMm", 1e-6}});
  ASSERT_TRUE(response.contains("status")) << response.dump();
  EXPECT_EQ(response.value("status", std::string{}), "ok") << response.dump(2);
  kreoda::ShapeRecord result;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("trim-result", &result));
  EXPECT_EQ(result.type, "SurfaceTrim");
  EXPECT_DOUBLE_EQ(result.volumeMm3, 0.0);
  EXPECT_NEAR(areaMm2("trim-result"), 50.0, 1e-7);
  kreoda::ShapeRecord sourceAfter;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("trim-target", &sourceAfter));
  EXPECT_TRUE(target.shape.IsSame(sourceAfter.shape));

  const auto cutPoint = rpc({{"type", kreoda::kRequestSessionQuery},
      {"method", "resolveSurfacePoint"},
      {"params", {{"targetId", "trim-target"}, {"pointMm", {5, 0, 5}}}}});
  ASSERT_EQ(cutPoint.value("status", std::string{}), "ok") << cutPoint.dump(2);
  const auto beforeAmbiguousCut = kreoda::DocumentStore::instance().snapshotRevision();
  const auto rejected = rpc({{"type", 55}, {"featureId", "trim-cut-ambiguous"},
      {"targetId", "trim-target"}, {"toolId", "trim-tool"},
      {"keepFace", cutPoint["result"]["keepFace"]},
      {"keepUv", cutPoint["result"]["keepUv"]}, {"toleranceMm", 1e-6}});
  EXPECT_EQ(rejected.value("status", std::string{}), "error") << rejected.dump(2);
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("trim-cut-ambiguous"));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), beforeAmbiguousCut);
}

TEST(SurfaceTrimExtendPublicWire, Command56ExtendsOneMeasuredFreeBoundary) {
  kreoda::DocumentStore::instance().create("surface-extend-wire-doc");
  createPublicSurface("extend-target", gp_Pnt2d(0, 0), gp_Pnt2d(10, 0));
  const auto edges = rpc({{"type", kreoda::kRequestSessionQuery},
      {"method", "findEdges"}, {"params", {{"featureId", "extend-target"}}}});
  ASSERT_EQ(edges.value("status", std::string{}), "ok") << edges.dump(2);
  ASSERT_TRUE(edges["result"].contains("edges"));
  std::string edgeId;
  for (const auto& edge : edges["result"]["edges"]) {
    if (!edge.contains("bboxMm") || !edge["bboxMm"].is_array() ||
        edge["bboxMm"].size() != 6) continue;
    const auto& b = edge["bboxMm"];
    if (std::abs(b[0].get<double>()) < 1e-7 &&
        std::abs(b[1].get<double>()) < 1e-7 &&
        std::abs(b[2].get<double>() - 10.0) < 1e-7 &&
        std::abs(b[3].get<double>() - 10.0) < 1e-7 &&
        std::abs(b[4].get<double>()) < 1e-7 &&
        std::abs(b[5].get<double>() - 10.0) < 1e-7) {
      edgeId = edge.value("persistentEdgeId", std::string{});
      break;
    }
  }
  ASSERT_FALSE(edgeId.empty()) << edges.dump(2);
  kreoda::ShapeRecord target;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("extend-target", &target));
  const auto edgeRoles = kreoda::ClassifyEdgeRoles(target.shape, target.type, target.featureId);
  EXPECT_EQ(std::count_if(edgeRoles.begin(), edgeRoles.end(), [&](const auto& role) {
    return role.persistentEdgeId == edgeId;
  }), 1);
  const auto response = rpc({{"type", 56}, {"featureId", "extend-result"},
      {"targetId", "extend-target"},
      {"boundaryEdge", {{"type", "edge"}, {"featureId", "extend-target"},
                         {"persistentEdgeId", edgeId}}},
      {"distanceMm", 2.0}, {"toleranceMm", 1e-6}});
  ASSERT_EQ(response.value("status", std::string{}), "ok") << response.dump(2);
  kreoda::ShapeRecord result;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("extend-result", &result));
  EXPECT_EQ(result.type, "SurfaceExtend");
  EXPECT_DOUBLE_EQ(result.volumeMm3, 0.0);
  EXPECT_NEAR(areaMm2("extend-result"), 120.0, 1e-6);
}

TEST(SurfaceTrimExtendPublicWire, ClosedPeriodicCylinderLoopUsesPeriodStrip) {
  kreoda::DocumentStore::instance().create("surface-trim-extend-doc");
  createPublicCylinderSurface("periodic-cylinder", 5.0, 20.0);
  const auto seamPick = rpc({{"type", kreoda::kRequestSessionQuery},
      {"method", "resolveSurfacePoint"},
      {"params", {{"targetId", "periodic-cylinder"}, {"pointMm", {5, 0, 10}}}}});
  ASSERT_EQ(seamPick.value("status", std::string{}), "ok") << seamPick.dump(2);

  std::string error;
  ASSERT_TRUE(extendFirstEdge("periodic-cylinder", "periodic-cylinder-extend",
                              2.0, &error)) << error;
  kreoda::ShapeRecord source, result;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("periodic-cylinder", &source));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("periodic-cylinder-extend", &result));
  EXPECT_TRUE(BRepCheck_Analyzer(result.shape, true).IsValid());
  EXPECT_EQ(TopExp_Explorer(result.shape, TopAbs_SOLID).More(), false);
  EXPECT_NEAR(shapeArea(result.shape) - shapeArea(source.shape), 20.0 * std::acos(-1.0), 1e-5);
}

TEST(SurfaceTrimExtendPublicWire, ClosedCircularExtensionKeepsPlaneAndBsplineHoles) {
  kreoda::DocumentStore::instance().create("surface-trim-extend-doc");
  const double pi = std::acos(-1.0);
  const auto plane = Handle(Geom_Surface)(new Geom_Plane(gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1))));
  const auto planeAnnulus = annulusOnSupport(plane, gp_Pnt2d(0, 0), 5.0, 2.0);
  ASSERT_TRUE(BRepCheck_Analyzer(planeAnnulus, true).IsValid());
  std::string error;
  ASSERT_TRUE(commitSurfaceFixture("plane-annulus", planeAnnulus, &error)) << error;
  ASSERT_TRUE(extendFirstEdge("plane-annulus", "plane-annulus-extend", 2.0, &error)) << error;
  kreoda::ShapeRecord planeExtended;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("plane-annulus-extend", &planeExtended));
  EXPECT_NEAR(shapeArea(planeExtended.shape), 45.0 * pi, 1e-5);
  EXPECT_TRUE(BRepCheck_Analyzer(planeExtended.shape, true).IsValid());
  EXPECT_FALSE(TopExp_Explorer(planeExtended.shape, TopAbs_SOLID).More());
  EXPECT_EQ(rpc({{"type", kreoda::kRequestSessionQuery}, {"method", "resolveSurfacePoint"},
      {"params", {{"targetId", "plane-annulus"}, {"pointMm", {0, 0, 0}}}}})
      .value("status", std::string{}), "error");
  BRepBuilderAPI_MakeFace diskMaker(plane, circleWire(plane, gp_Pnt2d(0, 0), 2.0), Standard_True);
  ASSERT_TRUE(diskMaker.IsDone());
  EXPECT_NEAR(pristineCommonArea(planeExtended.shape, diskMaker.Face()), 0.0, 1e-7);

  const auto bspline = boundedBsplineSupport();
  const auto bsplineAnnulus = annulusOnSupport(bspline, gp_Pnt2d(0.5, 0.5), 0.35, 0.08);
  ASSERT_TRUE(BRepCheck_Analyzer(bsplineAnnulus, true).IsValid());
  ASSERT_TRUE(commitSurfaceFixture("bspline-annulus", bsplineAnnulus, &error)) << error;
  ASSERT_TRUE(extendFirstEdge("bspline-annulus", "bspline-annulus-extend", 0.1, &error)) << error;
  kreoda::ShapeRecord bsplineExtended;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("bspline-annulus-extend", &bsplineExtended));
  EXPECT_TRUE(BRepCheck_Analyzer(bsplineExtended.shape, true).IsValid());
  EXPECT_FALSE(TopExp_Explorer(bsplineExtended.shape, TopAbs_SOLID).More());
  EXPECT_GT(shapeArea(bsplineExtended.shape), shapeArea(bsplineAnnulus));
  EXPECT_NEAR(pristineCommonArea(bsplineAnnulus, bsplineExtended.shape),
              shapeArea(bsplineAnnulus), 1e-5);
  const gp_Pnt holePoint = bspline->Value(0.5, 0.5);
  const auto holePick = rpc({{"type", kreoda::kRequestSessionQuery},
      {"method", "resolveSurfacePoint"},
      {"params", {{"targetId", "bspline-annulus-extend"},
                   {"pointMm", {holePoint.X(), holePoint.Y(), holePoint.Z()}}}}});
  EXPECT_EQ(holePick.value("status", std::string{}), "error") << holePick.dump(2);
  BRepBuilderAPI_MakeFace bsplineHoleDisk(bspline,
      circleWire(bspline, gp_Pnt2d(0.5, 0.5), 0.08), Standard_True);
  ASSERT_TRUE(bsplineHoleDisk.IsDone());
  EXPECT_NEAR(pristineCommonArea(bsplineExtended.shape, bsplineHoleDisk.Face()), 0.0, 1e-7);
}

TEST(SurfaceTrimExtendPublicWire, OpenCircularArcUsesTranslatedPcurveStrip) {
  kreoda::DocumentStore::instance().create("surface-trim-extend-doc");
  const double pi = std::acos(-1.0);
  const auto plane = Handle(Geom_Surface)(new Geom_Plane(
      gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1))));
  const gp_Pnt2d center(0, 0), east(5, 0), north(0, 5);
  Handle(Geom2d_Curve) arc = new Geom2d_Circle(
      gp_Circ2d(gp_Ax2d(center, gp_Dir2d(1, 0)), 5.0));
  BRepBuilderAPI_MakeEdge arcMaker(arc, plane, 0.0, pi * 0.5);
  ASSERT_TRUE(arcMaker.IsDone());
  TopoDS_Edge arcEdge = arcMaker.Edge();
  BRepLib::BuildCurve3d(arcEdge, 1e-6);
  const auto segment = [&](const gp_Pnt2d& first, const gp_Pnt2d& last) {
    const gp_Vec2d vector(first, last);
    Handle(Geom2d_Curve) line = new Geom2d_Line(first, gp_Dir2d(vector));
    BRepBuilderAPI_MakeEdge maker(line, plane, 0.0, vector.Magnitude());
    if (!maker.IsDone()) throw std::runtime_error("fixture radial edge failed");
    TopoDS_Edge edge = maker.Edge();
    BRepLib::BuildCurve3d(edge, 1e-6);
    return edge;
  };
  BRepBuilderAPI_MakeWire wire;
  wire.Add(arcEdge);
  wire.Add(segment(north, center));
  wire.Add(segment(center, east));
  ASSERT_TRUE(wire.IsDone());
  BRepBuilderAPI_MakeFace maker(plane, wire.Wire(), Standard_True);
  ASSERT_TRUE(maker.IsDone());
  const TopoDS_Face face = maker.Face();
  ASSERT_TRUE(BRepCheck_Analyzer(face, true).IsValid());

  std::string error;
  ASSERT_TRUE(commitSurfaceFixture("plane-sector", face, &error)) << error;
  TopoDS_Edge selected;
  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("plane-sector", &source));
  ASSERT_TRUE(kreoda::FindEdgeByRole(source.shape, source.featureId, source.type,
                                     firstEdgeRole(source), &selected));
  TopoDS_Vertex first, last;
  TopExp::Vertices(selected, first, last, true);
  ASSERT_FALSE(first.IsSame(last));
  ASSERT_TRUE(extendFirstEdge("plane-sector", "plane-sector-extend", 2.0, &error)) << error;
  kreoda::ShapeRecord result;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("plane-sector-extend", &result));
  EXPECT_TRUE(BRepCheck_Analyzer(result.shape, true).IsValid());
  EXPECT_FALSE(TopExp_Explorer(result.shape, TopAbs_SOLID).More());
  EXPECT_NEAR(shapeArea(face), 6.25 * pi, 1e-5);
  EXPECT_NEAR(shapeArea(result.shape) - shapeArea(face), 10.0 * std::sqrt(2.0), 1e-5);
  EXPECT_NEAR(nearestPositivePcurveMidpointChord(selected, face, result.shape), 2.0, 1e-5);
}

TEST(SurfaceTrimExtendPublicWire, NaturalBoundedBsplineEdgeExtendsExactSupport) {
  kreoda::DocumentStore::instance().create("surface-trim-extend-doc");
  const auto surface = boundedBsplineSupport();
  BRepBuilderAPI_MakeFace maker(surface, 0.0, 1.0, 0.0, 1.0, 1e-6);
  ASSERT_TRUE(maker.IsDone());
  const TopoDS_Face face = maker.Face();
  ASSERT_TRUE(BRepCheck_Analyzer(face, true).IsValid());
  std::string error;
  ASSERT_TRUE(commitSurfaceFixture("bspline-rectangle", face, &error)) << error;
  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("bspline-rectangle", &source));
  TopoDS_Edge selected;
  ASSERT_TRUE(kreoda::FindEdgeByRole(source.shape, source.featureId, source.type,
                                     firstEdgeRole(source), &selected));
  ASSERT_TRUE(extendFirstEdge("bspline-rectangle", "bspline-rectangle-extend",
                              0.2, &error)) << error;
  kreoda::ShapeRecord result;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("bspline-rectangle-extend", &result));
  EXPECT_TRUE(BRepCheck_Analyzer(result.shape, true).IsValid());
  EXPECT_FALSE(TopExp_Explorer(result.shape, TopAbs_SOLID).More());
  EXPECT_GT(shapeArea(result.shape), shapeArea(face));
  EXPECT_NEAR(nearestPositivePcurveMidpointChord(selected, face, result.shape),
              0.2, 1e-5);
  EXPECT_NEAR(pristineCommonArea(source.shape, result.shape), shapeArea(source.shape), 1e-5);

  TopoDS_Face sourceFace;
  for (TopExp_Explorer it(source.shape, TopAbs_FACE); it.More(); it.Next()) {
    sourceFace = TopoDS::Face(it.Current());
    break;
  }
  TopLoc_Location sourceLocation;
  const auto oldSupport = BRep_Tool::Surface(sourceFace, sourceLocation);
  Handle(Geom_Surface) extendedSupport;
  for (TopExp_Explorer it(result.shape, TopAbs_FACE); it.More(); it.Next()) {
    TopLoc_Location location;
    const auto candidate = BRep_Tool::Surface(TopoDS::Face(it.Current()), location);
    double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
    candidate->Bounds(u0, u1, v0, v1);
    if (u0 < -1e-7 || u1 > 1.0 + 1e-7 || v0 < -1e-7 || v1 > 1.0 + 1e-7) {
      extendedSupport = candidate;
      break;
    }
  }
  ASSERT_FALSE(extendedSupport.IsNull());
  EXPECT_TRUE(kreoda::surface_trim_extend_detail::SupportPreserved(
      sourceFace, oldSupport, extendedSupport, 1e-6, &error)) << error;
}

TEST(SurfaceTrimExtendPublicWire, NonIsoparametricBsplineBoundaryUsesPcurveChord) {
  kreoda::DocumentStore::instance().create("surface-trim-extend-doc");
  const auto surface = boundedBsplineSupport();
  const gp_Pnt2d a(0.1, 0.1), b(0.7, 0.1), c(0.4, 0.9);
  const auto segment = [&](const gp_Pnt2d& first, const gp_Pnt2d& last) {
    const gp_Vec2d vector(first, last);
    Handle(Geom2d_Curve) line = new Geom2d_Line(first, gp_Dir2d(vector));
    BRepBuilderAPI_MakeEdge edgeMaker(line, surface, 0.0, vector.Magnitude());
    if (!edgeMaker.IsDone()) throw std::runtime_error("fixture B-spline edge failed");
    TopoDS_Edge edge = edgeMaker.Edge();
    BRepLib::BuildCurve3d(edge, 1e-6);
    return edge;
  };
  const TopoDS_Edge bottom = segment(a, b);
  const TopoDS_Edge diagonal = segment(b, c);
  const TopoDS_Edge side = segment(c, a);
  BRepBuilderAPI_MakeWire wire;
  wire.Add(diagonal);
  wire.Add(side);
  wire.Add(bottom);
  ASSERT_TRUE(wire.IsDone());
  BRepBuilderAPI_MakeFace maker(surface, wire.Wire(), Standard_True);
  ASSERT_TRUE(maker.IsDone());
  const TopoDS_Face face = maker.Face();
  ASSERT_TRUE(BRepCheck_Analyzer(face, true).IsValid());

  std::string error;
  ASSERT_TRUE(commitSurfaceFixture("bspline-diagonal", face, &error)) << error;
  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("bspline-diagonal", &source));
  const auto roles = kreoda::ClassifyEdgeRoles(source.shape, source.type, source.featureId);
  std::string diagonalRole;
  TopoDS_Edge selected;
  for (const auto& role : roles) {
    Standard_Real first = 0, last = 0;
    const auto pcurve = BRep_Tool::CurveOnSurface(role.edge, face, first, last);
    if (pcurve.IsNull()) continue;
    gp_Pnt2d point;
    gp_Vec2d tangent;
    pcurve->D1((first + last) * 0.5, point, tangent);
    if (std::abs(tangent.X()) > 1e-6 && std::abs(tangent.Y()) > 1e-6) {
      diagonalRole = role.persistentEdgeId;
      selected = role.edge;
      break;
    }
  }
  ASSERT_FALSE(selected.IsNull());
  ASSERT_FALSE(diagonalRole.empty());
  ASSERT_EQ(BRepAdaptor_Curve(selected).GetType(), GeomAbs_BSplineCurve);
  TopoDS_Edge resolvedByRole;
  ASSERT_TRUE(kreoda::FindEdgeByRole(source.shape, source.featureId, source.type,
                                      diagonalRole, &resolvedByRole));
  ASSERT_TRUE(resolvedByRole.IsSame(selected));
  const kreoda::SurfaceTrimExtendJson reference = {{"type", "edge"},
      {"featureId", source.featureId}, {"persistentEdgeId", diagonalRole}};
  ASSERT_TRUE(kreoda::CreateSurfaceExtendFeature("bspline-diagonal-extend",
      source.featureId, reference, 0.1, 1e-6, &error)) << error;

  kreoda::ShapeRecord result;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("bspline-diagonal-extend", &result));
  EXPECT_TRUE(BRepCheck_Analyzer(result.shape, true).IsValid());
  EXPECT_FALSE(TopExp_Explorer(result.shape, TopAbs_SOLID).More());
  EXPECT_NEAR(pristineCommonArea(source.shape, result.shape), shapeArea(source.shape), 1e-5);
  EXPECT_NEAR(nearestPositivePcurveMidpointChord(selected, face, result.shape),
              0.1, 1e-5);
}

TEST(SurfaceTrimExtendPublicWire, ResolveSurfacePointRejectsSharedFaceAmbiguity) {
  kreoda::DocumentStore::instance().create("surface-trim-extend-doc");
  kreoda::SketchModel model;
  model.points = {{"a", 0, 0, true}, {"b", 10, 0, true}, {"c", 10, 10, true}};
  model.lines = {{"ab", "a", "b"}, {"bc", "b", "c"}};
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("ambiguous-sketch", "XY", model, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSurfaceExtrudeFeature("ambiguous-surface", "ambiguous-sketch",
                                                   10.0, &error)) << error;
  const auto response = rpc({{"type", kreoda::kRequestSessionQuery},
      {"method", "resolveSurfacePoint"},
      {"params", {{"targetId", "ambiguous-surface"}, {"pointMm", {10, 0, 5}}}}});
  EXPECT_EQ(response.value("status", std::string{}), "error") << response.dump(2);

  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("ambiguous-surface", &source));
  const auto edgeRole = firstFreeEdgeRole(source);
  const kreoda::SurfaceTrimExtendJson reference = {{"type", "edge"},
      {"featureId", source.featureId}, {"persistentEdgeId", edgeRole}};
  ASSERT_TRUE(kreoda::CreateSurfaceExtendFeature("ambiguous-surface-extend",
      source.featureId, reference, 1.0, 1e-6, &error)) << error;
  kreoda::ShapeRecord extension;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("ambiguous-surface-extend", &extension));
  const auto boundReference = Json::parse(extension.refExtra)["boundaryEdge"];

  std::vector<TopoDS_Face> faces;
  for (TopExp_Explorer it(source.shape, TopAbs_FACE); it.More(); it.Next())
    faces.push_back(TopoDS::Face(it.Current()));
  ASSERT_GT(faces.size(), 1u);
  BRep_Builder builder;
  TopoDS_Compound reorderedShape;
  builder.MakeCompound(reorderedShape);
  for (auto it = faces.rbegin(); it != faces.rend(); ++it) builder.Add(reorderedShape, *it);
  auto reordered = source;
  reordered.shape = reorderedShape;
  TopoDS_Shape selected;
  EXPECT_TRUE(kreoda::surface_trim_extend_detail::ResolveSelectedTopology(
      reordered, extension.featureId, boundReference, true, false, &selected, &error)) << error;
  EXPECT_FALSE(selected.IsNull());

  BRepBuilderAPI_Copy deepCopy(source.shape, Standard_True, Standard_False);
  ASSERT_TRUE(deepCopy.IsDone());
  auto missing = source;
  missing.shape = deepCopy.Shape();
  EXPECT_FALSE(kreoda::surface_trim_extend_detail::ResolveSelectedTopology(
      missing, extension.featureId, boundReference, true, false, &selected, &error));
  EXPECT_NE(error.find("absent or ambiguous"), std::string::npos) << error;
}

TEST(SurfaceTrimExtendPublicWire, TrimsConnectedLAndBoxSurfaceShellsByPhysicalRegion) {
  kreoda::DocumentStore::instance().create("surface-trim-extend-doc");
  std::string error;
  kreoda::SketchModel lModel;
  lModel.points = {{"a", -10, 0, true}, {"b", 0, 0, true}, {"c", 0, 10, true}};
  lModel.lines = {{"ab", "a", "b"}, {"bc", "b", "c"}};
  ASSERT_TRUE(kreoda::CreateSketchFeature("l-shell-sketch", "XY", lModel, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSurfaceExtrudeFeature("l-shell", "l-shell-sketch", 10, &error)) << error;
  createCutSurface("l-shell-cut", -5);
  const auto lKeep = keepPointJson("l-shell", gp_Pnt(-7, 0, 5));
  const auto lTrim = rpc({{"type", 55}, {"featureId", "l-shell-trim"},
      {"targetId", "l-shell"}, {"toolId", "l-shell-cut"},
      {"keepFace", lKeep["keepFace"]}, {"keepUv", lKeep["keepUv"]}});
  ASSERT_EQ(lTrim.value("status", std::string{}), "ok") << lTrim.dump(2);
  EXPECT_NEAR(areaMm2("l-shell-trim"), 50.0, 1e-6);

  kreoda::SketchModel boxModel;
  boxModel.points = {{"a", -10, -5, true}, {"b", 10, -5, true},
                     {"c", 10, 5, true}, {"d", -10, 5, true}};
  boxModel.lines = {{"ab", "a", "b"}, {"bc", "b", "c"},
                    {"cd", "c", "d"}, {"da", "d", "a"}};
  ASSERT_TRUE(kreoda::CreateSketchFeature("box-shell-sketch", "XY", boxModel, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSurfaceExtrudeFeature("box-shell", "box-shell-sketch", 10, &error)) << error;
  createCutSurface("box-shell-cut", 0);
  const auto boxKeep = keepPointJson("box-shell", gp_Pnt(-5, -5, 5));
  const auto boxTrim = rpc({{"type", 55}, {"featureId", "box-shell-trim"},
      {"targetId", "box-shell"}, {"toolId", "box-shell-cut"},
      {"keepFace", boxKeep["keepFace"]}, {"keepUv", boxKeep["keepUv"]}});
  ASSERT_EQ(boxTrim.value("status", std::string{}), "ok") << boxTrim.dump(2);
  EXPECT_NEAR(areaMm2("box-shell-trim"), 300.0, 1e-6);
}

TEST(SurfaceTrimExtendPublicWire, UpstreamDimensionEditRebuildsBoundTrimAndExtend) {
  kreoda::DocumentStore::instance().create("surface-trim-extend-doc");
  createPublicSurface("edit-trim-target", gp_Pnt2d(0, 0), gp_Pnt2d(10, 0));
  createPublicSurface("edit-trim-tool", gp_Pnt2d(5, -1), gp_Pnt2d(5, 1));
  const auto keep = keepPointJson("edit-trim-target", gp_Pnt(2, 0, 5));
  const auto trim = rpc({{"type", 55}, {"featureId", "edit-trim-result"},
      {"targetId", "edit-trim-target"}, {"toolId", "edit-trim-tool"},
      {"keepFace", keep["keepFace"]}, {"keepUv", keep["keepUv"]}});
  ASSERT_EQ(trim.value("status", std::string{}), "ok") << trim.dump(2);
  EXPECT_NEAR(areaMm2("edit-trim-result"), 50.0, 1e-6);
  const auto resizedTrimTool = rpc({{"type", kreoda::kSetFeatureParameter},
      {"featureId", "edit-trim-tool"}, {"paramName", "distanceMm"}, {"valueMm", 12.0}});
  ASSERT_EQ(resizedTrimTool.value("status", std::string{}), "ok") << resizedTrimTool.dump(2);
  EXPECT_NEAR(areaMm2("edit-trim-result"), 50.0, 1e-6);
  const auto resizedTrimSource = rpc({{"type", kreoda::kSetFeatureParameter},
      {"featureId", "edit-trim-target"}, {"paramName", "distanceMm"}, {"valueMm", 12.0}});
  ASSERT_EQ(resizedTrimSource.value("status", std::string{}), "ok") << resizedTrimSource.dump(2);
  EXPECT_NEAR(areaMm2("edit-trim-result"), 60.0, 1e-6);

  createPublicSurface("edit-extend-target", gp_Pnt2d(0, 0), gp_Pnt2d(10, 0));
  const auto edges = rpc({{"type", kreoda::kRequestSessionQuery},
      {"method", "findEdges"}, {"params", {{"featureId", "edit-extend-target"}}}});
  ASSERT_EQ(edges.value("status", std::string{}), "ok") << edges.dump(2);
  std::string boundaryId;
  for (const auto& edge : edges["result"]["edges"]) {
    if (!edge.contains("bboxMm") || !edge["bboxMm"].is_array() || edge["bboxMm"].size() != 6)
      continue;
    const auto& bounds = edge["bboxMm"];
    if (std::abs(bounds[0].get<double>() - 10.0) < 1e-7 &&
        std::abs(bounds[3].get<double>() - 10.0) < 1e-7 &&
        std::abs(bounds[1].get<double>()) < 1e-7 &&
        std::abs(bounds[4].get<double>()) < 1e-7) {
      boundaryId = edge.value("persistentEdgeId", std::string{});
      break;
    }
  }
  ASSERT_FALSE(boundaryId.empty()) << edges.dump(2);
  const auto extend = rpc({{"type", 56}, {"featureId", "edit-extend-result"},
      {"targetId", "edit-extend-target"},
      {"boundaryEdge", {{"type", "edge"}, {"featureId", "edit-extend-target"},
                         {"persistentEdgeId", boundaryId}}},
      {"distanceMm", 2.0}});
  ASSERT_EQ(extend.value("status", std::string{}), "ok") << extend.dump(2);
  EXPECT_NEAR(areaMm2("edit-extend-result"), 120.0, 1e-6);
  const auto resizedExtendSource = rpc({{"type", kreoda::kSetFeatureParameter},
      {"featureId", "edit-extend-target"}, {"paramName", "distanceMm"}, {"valueMm", 12.0}});
  ASSERT_EQ(resizedExtendSource.value("status", std::string{}), "ok") << resizedExtendSource.dump(2);
  EXPECT_NEAR(areaMm2("edit-extend-result"), 144.0, 1e-6);
}

TEST(SurfaceTrimExtendPublicWire, UniqueTopologyIdsSelectTheRequestedNonSquareBoundary) {
  kreoda::DocumentStore::instance().create("surface-trim-extend-doc");
  createPublicSurface("topology-surface", gp_Pnt2d(0, 0), gp_Pnt2d(10, 0));
  ASSERT_EQ(rpc({{"type", kreoda::kSetFeatureParameter},
      {"featureId", "topology-surface"}, {"paramName", "distanceMm"},
      {"valueMm", 5.0}}).value("status", std::string{}), "ok");
  const auto edges = rpc({{"type", kreoda::kRequestSessionQuery},
      {"method", "findEdges"}, {"params", {{"featureId", "topology-surface"}}}});
  ASSERT_EQ(edges.value("status", std::string{}), "ok") << edges.dump(2);
  ASSERT_EQ(edges["result"]["edges"].size(), 4u);
  std::set<std::string> ids;
  std::string top;
  for (const auto& edge : edges["result"]["edges"]) {
    const auto id = edge.at("persistentEdgeId").get<std::string>();
    ids.insert(id);
    EXPECT_FALSE(edge.at("ambiguous").get<bool>());
    const auto& bounds = edge.at("bboxMm");
    if (std::abs(bounds[2].get<double>() - 5.0) < 1e-7 &&
        std::abs(bounds[5].get<double>() - 5.0) < 1e-7) top = id;
  }
  ASSERT_EQ(ids.size(), 4u);
  ASSERT_FALSE(top.empty());
  const auto before = kreoda::DocumentStore::instance().revision();
  const auto invalid = rpc({{"type", 56}, {"featureId", "ambiguous-legacy-edge"},
      {"targetId", "topology-surface"}, {"distanceMm", 2.0},
      {"boundaryEdge", {{"type", "edge"}, {"featureId", "topology-surface"},
        {"persistentEdgeId", "topology-surface:edge.lin.box.+Y"}}}});
  EXPECT_EQ(invalid.value("status", std::string{}), "error");
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), before);
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("ambiguous-legacy-edge"));

  const auto extended = rpc({{"type", 56}, {"featureId", "topology-extended"},
      {"targetId", "topology-surface"}, {"distanceMm", 2.0},
      {"boundaryEdge", {{"type", "edge"}, {"featureId", "topology-surface"},
        {"persistentEdgeId", top}}}});
  ASSERT_EQ(extended.value("status", std::string{}), "ok") << extended.dump(2);
  EXPECT_NEAR(areaMm2("topology-extended"), 70.0, 1e-6);
  kreoda::ShapeRecord result;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("topology-extended", &result));
  EXPECT_NEAR(result.bboxMm[0], 0.0, 1e-7);
  EXPECT_NEAR(result.bboxMm[3], 10.0, 1e-7);
  EXPECT_NEAR(result.bboxMm[5], 7.0, 1e-7);
  const auto faces = kreoda::ClassifyFaceRoles(result.shape, result.type, result.featureId);
  ASSERT_EQ(faces.size(), 2u);
  EXPECT_EQ(std::set<std::string>(faces.begin(), faces.end()).size(), faces.size());
  TopoDS_Face selected;
  EXPECT_FALSE(kreoda::FindFaceByRole(result.shape, result.featureId, result.type,
                                     "box.+Y", &selected));
}

TEST(SurfaceTrimExtendPublicWire, InvalidInputsAndFailedUpstreamChangesAreAtomic) {
  kreoda::DocumentStore::instance().create("surface-trim-extend-doc");
  createPublicSurface("atomic-target", gp_Pnt2d(0, 0), gp_Pnt2d(10, 0));
  createPublicSurface("atomic-tool", gp_Pnt2d(5, -1), gp_Pnt2d(5, 1));
  ASSERT_EQ(rpc({{"type", kreoda::kCreateBox}, {"featureId", "atomic-solid"},
      {"widthMm", 2.0}, {"heightMm", 3.0}, {"depthMm", 4.0}})
      .value("status", std::string{}), "ok");
  const auto keep = keepPointJson("atomic-target", gp_Pnt(2, 0, 5));
  const auto snapshot = []() {
    auto value = rpc({{"type", kreoda::kRequestSnapshot}});
    value.erase("requestId");
    return value;
  };
  const Json base = {{"type", 55}, {"featureId", "atomic-rejected"},
      {"targetId", "atomic-target"}, {"toolId", "atomic-tool"},
      {"keepFace", keep["keepFace"]}, {"keepUv", keep["keepUv"]}};
  std::vector<Json> overrides = {
      {{"keepUv", {5.0, keep["keepUv"][1]}}},
      {{"keepUv", {1000.0, keep["keepUv"][1]}}},
      {{"keepUv", {"2", 0}}}, {{"toleranceMm", 0}},
      {{"toolId", "missing-tool"}}, {{"toolId", "atomic-solid"}},
      {{"toolId", "atomic-target"}}, {{"extra", true}}};
  auto badFace = keep["keepFace"];
  badFace["unexpected"] = 1;
  overrides.push_back({{"keepFace", badFace}});
  for (const auto& fields : overrides) {
    auto request = base;
    request.update(fields);
    const auto before = snapshot();
    const auto rejected = rpc(request);
    EXPECT_EQ(rejected.value("status", std::string{}), "error") << rejected.dump(2);
    EXPECT_FALSE(rejected.value("errorMessage", std::string{}).empty()) << rejected.dump(2);
    EXPECT_EQ(snapshot(), before);
  }
  auto injected = base;
  injected["keepFace"]["selectionEntry"] = "0:1:2";
  const auto untrustedBinding = rpc(injected);
  EXPECT_EQ(untrustedBinding.value("errorCode", std::string{}), "BAD_PARAMS");
  EXPECT_NE(untrustedBinding.value("errorMessage", std::string{}).find("unsupported"), std::string::npos);
  auto missingReference = base;
  missingReference.erase("keepFace");
  EXPECT_FALSE(rpc(missingReference).value("errorMessage", std::string{}).empty());
  const auto missingBoundary = rpc({{"type", 56}, {"featureId", "missing-boundary"},
      {"targetId", "atomic-target"}, {"distanceMm", 2.0}});
  EXPECT_EQ(missingBoundary.value("errorCode", std::string{}), "BAD_PARAMS");
  EXPECT_FALSE(missingBoundary.value("errorMessage", std::string{}).empty());
  auto accepted = base;
  accepted["featureId"] = "atomic-trim";
  ASSERT_EQ(rpc(accepted).value("status", std::string{}), "ok");
  auto before = snapshot();
  EXPECT_EQ(rpc({{"type", kreoda::kSetFeatureParameter}, {"featureId", "atomic-trim"},
      {"paramName", "keepU"}, {"valueMm", 5.0}}).value("status", std::string{}), "error");
  EXPECT_EQ(snapshot(), before);
  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("atomic-target", &source));
  std::ostringstream sourceBefore;
  BRepTools::Write(source.shape, sourceBefore);
  before = snapshot();
  const auto failed = rpc({{"type", kreoda::kSetFeatureParameter},
      {"featureId", "atomic-target"}, {"paramName", "distanceMm"}, {"valueMm", 2.0}});
  EXPECT_EQ(failed.value("status", std::string{}), "error") << failed.dump(2);
  EXPECT_EQ(snapshot(), before);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("atomic-target", &source));
  std::ostringstream sourceAfter;
  BRepTools::Write(source.shape, sourceAfter);
  EXPECT_EQ(sourceAfter.str(), sourceBefore.str());
  ASSERT_EQ(rpc({{"type", kreoda::kSetFeatureParameter},
      {"featureId", "atomic-target"}, {"paramName", "distanceMm"}, {"valueMm", 8.0}})
      .value("status", std::string{}), "ok");
  EXPECT_NEAR(areaMm2("atomic-trim"), 40.0, 1e-6);
}

TEST(SurfaceTrimExtendPublicWire, HealthyDatumToolAndUvEditsPersistWithHistory) {
  kreoda::DocumentStore::instance().create("surface-trim-extend-doc");
  createPublicSurface("datum-target", gp_Pnt2d(0, 0), gp_Pnt2d(10, 0));
  ASSERT_EQ(rpc({{"type", kreoda::kCreateDatumPlane}, {"featureId", "trim-datum"},
      {"definition", {{"type", "offset"}, {"base", {{"type", "principal"},
        {"planeKind", "YZ"}}}, {"offsetMm", 5.0}}}})
      .value("status", std::string{}), "ok");
  const auto keep = keepPointJson("datum-target", gp_Pnt(2, 0, 5));
  const Json create = {{"type", 55}, {"featureId", "datum-trim"},
      {"targetId", "datum-target"}, {"toolId", "trim-datum"},
      {"keepFace", keep["keepFace"]}, {"keepUv", keep["keepUv"]}};
  kreoda::DatumRecord datum;
  ASSERT_TRUE(kreoda::DatumStore::instance().get("trim-datum", &datum));
  auto unavailable = datum;
  unavailable.status = "error";
  unavailable.error = "datum geometry unavailable";
  kreoda::DatumStore::instance().put(unavailable);
  const auto revision = kreoda::DocumentStore::instance().revision();
  EXPECT_EQ(rpc(create).value("status", std::string{}), "error");
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("datum-trim"));
  kreoda::DatumStore::instance().put(datum);
  ASSERT_EQ(rpc(create).value("status", std::string{}), "ok");
  EXPECT_NEAR(areaMm2("datum-trim"), 50.0, 1e-6);
  ASSERT_EQ(rpc({{"type", kreoda::kSetFeatureParameter}, {"featureId", "datum-trim"},
      {"paramName", "keepU"}, {"valueMm", 8.0}}).value("status", std::string{}), "ok");
  kreoda::ShapeRecord result;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("datum-trim", &result));
  EXPECT_NEAR(result.bboxMm[0], 5.0, 1e-7);
  ASSERT_EQ(rpc({{"type", kreoda::kUndo}}).value("status", std::string{}), "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("datum-trim", &result));
  EXPECT_NEAR(result.bboxMm[0], 0.0, 1e-7);
  ASSERT_EQ(rpc({{"type", kreoda::kRedo}}).value("status", std::string{}), "ok");
  const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
  const auto file = (std::filesystem::temp_directory_path() /
      ("kreoda-trim-lifecycle-" + std::to_string(stamp) + ".icad")).string();
  ASSERT_EQ(rpc({{"type", kreoda::kSaveDocument}, {"path", file}})
      .value("status", std::string{}), "ok");
  ASSERT_EQ(rpc({{"type", kreoda::kCreateDocument}}).value("status", std::string{}), "ok");
  ASSERT_EQ(rpc({{"type", kreoda::kOpenDocument}, {"path", file}})
      .value("status", std::string{}), "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("datum-trim", &result));
  EXPECT_NEAR(result.bboxMm[0], 5.0, 1e-7);
  ASSERT_EQ(rpc({{"type", kreoda::kSetFeatureParameter}, {"featureId", "datum-trim"},
      {"paramName", "keepU"}, {"valueMm", 2.0}}).value("status", std::string{}), "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("datum-trim", &result));
  EXPECT_NEAR(result.bboxMm[0], 0.0, 1e-7);
}

TEST(SurfaceTrimExtendPublicWire, PreviewUsesCurrentBindingsOrRejectsDetachedCandidates) {
  kreoda::DocumentStore::instance().create("surface-trim-extend-doc");
  createPublicSurface("preview-target", gp_Pnt2d(0, 0), gp_Pnt2d(10, 0));
  createPublicSurface("preview-tool", gp_Pnt2d(5, -1), gp_Pnt2d(5, 1));
  const auto keep = keepPointJson("preview-target", gp_Pnt(2, 0, 5));
  ASSERT_EQ(rpc({{"type", 55}, {"featureId", "preview-trim"},
      {"targetId", "preview-target"}, {"toolId", "preview-tool"},
      {"keepFace", keep["keepFace"]}, {"keepUv", keep["keepUv"]}})
      .value("status", std::string{}), "ok");
  auto before = rpc({{"type", kreoda::kRequestSnapshot}});
  before.erase("requestId");
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();
  kreoda::CoreMesh mesh;
  std::string error;
  ASSERT_TRUE(kreoda::BuildPreviewMesh("preview-trim", "keepU", 8, &mesh, &error)) << error;
  EXPECT_NEAR(mesh.bboxMm[0], 5.0, 1e-6);
  EXPECT_NEAR(mesh.bboxMm[3], 10.0, 1e-6);
  EXPECT_FALSE(kreoda::BuildPreviewBodyMesh("preview-target", "distanceMm", 12,
      "preview-trim", &mesh, &error));
  EXPECT_NE(error.find("bound topology reference"), std::string::npos) << error;
  auto after = rpc({{"type", kreoda::kRequestSnapshot}});
  after.erase("requestId");
  EXPECT_EQ(after, before);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
  EXPECT_NEAR(areaMm2("preview-trim"), 50.0, 1e-6);
}

TEST(SurfaceTrimExtendPublicWire, BoundUvFollowsCylinderRadiusAndInstanceLocation) {
  kreoda::DocumentStore::instance().create("surface-trim-extend-doc");
  createPublicCylinderSurface("follow-cylinder", 5.0, 20.0);
  ASSERT_EQ(rpc({{"type", kreoda::kCreateInstance}, {"featureId", "follow-instance"},
      {"targetId", "follow-cylinder"}}).value("status", std::string{}), "ok");
  ASSERT_EQ(rpc({{"type", kreoda::kCreateDatumPlane}, {"featureId", "follow-cut"},
      {"definition", {{"type", "offset"}, {"base", {{"type", "principal"},
        {"planeKind", "YZ"}}}, {"offsetMm", 0.0}}}})
      .value("status", std::string{}), "ok");
  const auto keep = keepPointJson("follow-instance", gp_Pnt(5, 0, 10));
  const auto trim = rpc({{"type", 55}, {"featureId", "follow-trim"},
      {"targetId", "follow-instance"}, {"toolId", "follow-cut"},
      {"keepFace", keep["keepFace"]}, {"keepUv", keep["keepUv"]}});
  ASSERT_EQ(trim.value("status", std::string{}), "ok") << trim.dump(2);
  EXPECT_NEAR(areaMm2("follow-trim"), 100.0 * std::acos(-1.0), 1e-5);
  const auto edges = rpc({{"type", kreoda::kRequestSessionQuery}, {"method", "findEdges"},
      {"params", {{"featureId", "follow-instance"}}}});
  ASSERT_EQ(edges.value("status", std::string{}), "ok");
  std::string top;
  for (const auto& edge : edges["result"]["edges"]) {
    const auto& bounds = edge.at("bboxMm");
    if (std::abs(bounds[2].get<double>() - 20) < 1e-6 &&
        std::abs(bounds[5].get<double>() - 20) < 1e-6)
      top = edge.at("persistentEdgeId").get<std::string>();
  }
  ASSERT_FALSE(top.empty());
  const auto extended = rpc({{"type", 56}, {"featureId", "follow-extend"},
      {"targetId", "follow-instance"}, {"distanceMm", 2.0},
      {"boundaryEdge", {{"type", "edge"}, {"featureId", "follow-instance"},
        {"persistentEdgeId", top}}}});
  ASSERT_EQ(extended.value("status", std::string{}), "ok") << extended.dump(2);
  EXPECT_NEAR(areaMm2("follow-extend"), 220.0 * std::acos(-1.0), 1e-5);
  kreoda::ShapeRecord result;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("follow-trim", &result));
  const auto savedParams = result.paramsMm;
  kreoda::SketchFeature sketch;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("follow-cylinder-sketch", &sketch));
  sketch.model.circles.front().r = 6.0;
  const auto resized = rpc({{"type", kreoda::kUpdateSketch},
      {"featureId", "follow-cylinder-sketch"},
      {"model", Json::parse(kreoda::SerializeSketchModel(sketch.model))}});
  ASSERT_EQ(resized.value("status", std::string{}), "ok") << resized.dump(2);
  EXPECT_NEAR(areaMm2("follow-trim"), 120.0 * std::acos(-1.0), 1e-5);
  EXPECT_NEAR(areaMm2("follow-extend"), 264.0 * std::acos(-1.0), 1e-5);
  const auto moved = rpc({{"type", kreoda::kSetFeatureParameter},
      {"featureId", "follow-instance"}, {"paramName", "tzMm"}, {"valueMm", 100.0}});
  ASSERT_EQ(moved.value("status", std::string{}), "ok") << moved.dump(2);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("follow-trim", &result));
  EXPECT_EQ(result.paramsMm, savedParams);
  EXPECT_NEAR(result.bboxMm[2], 100.0, 1e-6);
  EXPECT_NEAR(result.bboxMm[5], 120.0, 1e-6);
  EXPECT_NEAR(areaMm2("follow-trim"), 120.0 * std::acos(-1.0), 1e-5);
  EXPECT_NEAR(areaMm2("follow-extend"), 264.0 * std::acos(-1.0), 1e-5);
  EXPECT_EQ(rpc({{"type", kreoda::kRequestSessionQuery},
      {"method", "resolveSurfacePoint"}, {"params", {{"targetId", "follow-instance"},
        {"pointMm", {6.0, 0.0, 10.0}}}}}).value("status", std::string{}), "error");
  auto before = rpc({{"type", kreoda::kRequestSnapshot}});
  before.erase("requestId");
  ASSERT_TRUE(kreoda::SketchStore::instance().get("follow-cylinder-sketch", &sketch));
  sketch.model.circles.front().id = "replacement-circle";
  const auto replaced = rpc({{"type", kreoda::kUpdateSketch},
      {"featureId", "follow-cylinder-sketch"},
      {"model", Json::parse(kreoda::SerializeSketchModel(sketch.model))}});
  EXPECT_EQ(replaced.value("status", std::string{}), "error") << replaced.dump(2);
  EXPECT_NE(replaced.value("errorMessage", std::string{}).find("identity changed"), std::string::npos);
  auto after = rpc({{"type", kreoda::kRequestSnapshot}});
  after.erase("requestId");
  EXPECT_EQ(after, before);
}
#else
TEST(SurfaceTrimExtendPublicWire, Command55TrimsRealPublicSurfaceBodies) {
  GTEST_SKIP() << "OCCT is required for surface trim";
}
TEST(SurfaceTrimExtendPublicWire, Command56ExtendsOneMeasuredFreeBoundary) {
  GTEST_SKIP() << "OCCT is required for surface extend";
}
#endif
