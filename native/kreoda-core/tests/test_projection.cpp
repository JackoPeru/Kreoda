#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <limits>
#include <sstream>
#include <vector>

#include "../src/features/sketch/projected_geometry.h"
#include "../src/features/sketch/sketch_face.h"

#if KREODA_WITH_OCCT
#include <BRepAdaptor_Curve.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRep_Builder.hxx>
#include <BRepTools.hxx>
#include <GeomAPI_PointsToBSpline.hxx>
#include <GeomAPI_Interpolate.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_Line.hxx>
#include <GeomAbs_CurveType.hxx>
#include <NCollection_HArray1.hxx>
#include <GProp_GProps.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <NCollection_Array1.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Lin.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

namespace {

constexpr double kTolerance = 1e-6;
constexpr double kPi = 3.14159265358979323846;

void StoreVector(const gp_Vec& value, double output[3]) {
  output[0] = value.X();
  output[1] = value.Y();
  output[2] = value.Z();
}

kreoda::SketchPlane TiltedPlane() {
  kreoda::SketchPlane plane;
  const gp_Dir normal(1, 2, 3);
  const gp_Dir xAxis(2, -1, 0);
  const gp_Dir yAxis = normal.Crossed(xAxis);
  plane.origin[0] = 4;
  plane.origin[1] = -3;
  plane.origin[2] = 8;
  StoreVector(gp_Vec(xAxis), plane.xAxis);
  StoreVector(gp_Vec(yAxis), plane.yAxis);
  StoreVector(gp_Vec(normal), plane.normal);
  return plane;
}

gp_Pnt Origin(const kreoda::SketchPlane& plane) {
  return gp_Pnt(plane.origin[0], plane.origin[1], plane.origin[2]);
}

gp_Vec Normal(const kreoda::SketchPlane& plane) {
  return gp_Vec(plane.normal[0], plane.normal[1], plane.normal[2]);
}

gp_Ax3 Axes(const kreoda::SketchPlane& plane) {
  return gp_Ax3(Origin(plane), gp_Dir(plane.normal[0], plane.normal[1], plane.normal[2]),
                gp_Dir(plane.xAxis[0], plane.xAxis[1], plane.xAxis[2]));
}

gp_Pnt ProjectPoint(const gp_Pnt& point, const kreoda::SketchPlane& plane) {
  const double signedDistance = gp_Vec(Origin(plane), point).Dot(Normal(plane));
  return point.Translated(-signedDistance * Normal(plane));
}

bool Near(const gp_Pnt& left, const gp_Pnt& right, double tolerance = kTolerance) {
  return left.Distance(right) <= tolerance;
}

std::vector<TopoDS_Edge> EdgesOf(const TopoDS_Shape& shape) {
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

double EdgeLength(const TopoDS_Edge& edge) {
  GProp_GProps properties;
  BRepGProp::LinearProperties(edge, properties);
  return std::fabs(properties.Mass());
}

double TotalLength(const std::vector<TopoDS_Edge>& edges) {
  double length = 0;
  for (const auto& edge : edges) length += EdgeLength(edge);
  return length;
}

bool EdgeSamplesOnPlane(const TopoDS_Edge& edge,
                        const kreoda::SketchPlane& plane,
                        double tolerance = kTolerance) {
  BRepAdaptor_Curve curve(edge);
  const double first = curve.FirstParameter();
  const double last = curve.LastParameter();
  for (int i = 0; i <= 8; ++i) {
    const double u = first + (last - first) * i / 8.0;
    const gp_Pnt point = curve.Value(u);
    if (std::fabs(gp_Vec(Origin(plane), point).Dot(Normal(plane))) > tolerance) {
      return false;
    }
  }
  return true;
}

bool ClosedWireArea(const std::vector<TopoDS_Edge>& edges, double* area) {
  BRepBuilderAPI_MakeWire wire;
  for (const auto& edge : edges) wire.Add(edge);
  if (!wire.IsDone()) return false;
  BRepBuilderAPI_MakeFace face(wire.Wire());
  if (!face.IsDone()) return false;
  GProp_GProps properties;
  BRepGProp::SurfaceProperties(face.Face(), properties);
  *area = std::fabs(properties.Mass());
  return std::isfinite(*area);
}

TopoDS_Edge CircleEdge(const gp_Pnt& center,
                       const gp_Dir& normal,
                       double radius,
                       double first = 0,
                       double last = 2 * M_PI) {
  const gp_Dir xAxis = std::fabs(normal.Dot(gp_Dir(0, 1, 0))) < 0.9
                           ? gp_Dir(0, 1, 0)
                           : gp_Dir(1, 0, 0);
  return BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(center, normal, xAxis), radius),
                                 first, last).Edge();
}

void ExpectSameOutput(const std::vector<TopoDS_Edge>& actual,
                      const std::vector<TopoDS_Edge>& before) {
  ASSERT_EQ(actual.size(), before.size());
  for (std::size_t i = 0; i < actual.size(); ++i) {
    EXPECT_TRUE(actual[i].IsSame(before[i]));
    EXPECT_EQ(actual[i].Orientation(), before[i].Orientation());
  }
}

std::string ShapeDump(const TopoDS_Shape& shape) {
  std::ostringstream output;
  BRepTools::Write(shape, output);
  return output.str();
}

int FaceCount(const TopoDS_Shape& shape) {
  int count = 0;
  for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next()) ++count;
  return count;
}

int WireCount(const TopoDS_Shape& shape) {
  int count = 0;
  for (TopExp_Explorer it(shape, TopAbs_WIRE); it.More(); it.Next()) ++count;
  return count;
}

double ProfileArea(const TopoDS_Shape& shape) {
  double area = 0;
  for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next()) {
    GProp_GProps properties;
    BRepGProp::SurfaceProperties(TopoDS::Face(it.Current()), properties);
    area += std::fabs(properties.Mass());
  }
  return area;
}

void SaveProfileProof(const char* name, const std::string& dump) {
  const char* directory = std::getenv("KREODA_PROFILE_BREP_PROOF_DIR");
  if (!directory || !*directory) return;
  std::filesystem::create_directories(directory);
  std::ofstream output(std::filesystem::path(directory) / name,
                       std::ios::binary);
  output.write(dump.data(), static_cast<std::streamsize>(dump.size()));
}

TEST(Projection, EdgesApplySourceLocationAndTiltedTargetFrame) {
  const TopoDS_Edge local = BRepBuilderAPI_MakeEdge(gp_Pnt(1, 2, 3),
                                                     gp_Pnt(5, -2, 8)).Edge();
  gp_Trsf sourceTransform;
  sourceTransform.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 0.43);
  sourceTransform.SetTranslationPart(gp_Vec(11, -7, 4));
  const TopoDS_Edge source = TopoDS::Edge(
      local.Located(TopLoc_Location(sourceTransform)));
  ASSERT_TRUE(BRepCheck_Analyzer(source).IsValid());
  const kreoda::SketchPlane plane = TiltedPlane();
  ASSERT_TRUE(kreoda::ValidateSketchPlane(plane, nullptr));
  BRepAdaptor_Curve sourceCurve(source);
  const double first = sourceCurve.FirstParameter();
  const double last = sourceCurve.LastParameter();
  const gp_Pnt sourceStart = sourceCurve.Value(first);
  const gp_Pnt sourceEnd = sourceCurve.Value(last);

  std::vector<TopoDS_Edge> output;
  std::string error;
  ASSERT_TRUE(kreoda::ProjectNativeEdgesToPlane({source}, plane, &output, &error))
      << error;
  ASSERT_EQ(output.size(), 1u);
  EXPECT_EQ(BRepAdaptor_Curve(output[0]).GetType(), GeomAbs_Line);
  EXPECT_TRUE(EdgeSamplesOnPlane(output[0], plane));

  BRepAdaptor_Curve projected(output[0]);
  const gp_Pnt actualStart = projected.Value(projected.FirstParameter());
  const gp_Pnt actualEnd = projected.Value(projected.LastParameter());
  const gp_Pnt expectedStart = ProjectPoint(sourceStart, plane);
  const gp_Pnt expectedEnd = ProjectPoint(sourceEnd, plane);
  EXPECT_TRUE((Near(actualStart, expectedStart) && Near(actualEnd, expectedEnd)) ||
              (Near(actualStart, expectedEnd) && Near(actualEnd, expectedStart)));
  for (double t : {0.2, 0.5, 0.8}) {
    const double sourceParameter = first + (last - first) * t;
    const double outputParameter = projected.FirstParameter() +
        (projected.LastParameter() - projected.FirstParameter()) * t;
    EXPECT_TRUE(Near(projected.Value(outputParameter),
                     ProjectPoint(sourceCurve.Value(sourceParameter), plane)));
  }
  EXPECT_TRUE(Near(sourceCurve.Value(first), sourceStart));
  EXPECT_TRUE(Near(sourceCurve.Value(last), sourceEnd));
}

TEST(Projection, TrimmedObliqueCircleRetainsAnalyticEllipseAndTrim) {
  constexpr double radius = 5;
  constexpr double first = 0.35;
  constexpr double last = 1.6;
  const TopoDS_Edge source = CircleEdge(gp_Pnt(3, 4, 8), gp_Dir(1, 0, 1),
                                       radius, first, last);
  const kreoda::SketchPlane plane;
  BRepAdaptor_Curve sourceCurve(source);
  std::vector<TopoDS_Edge> output;
  std::string error;
  ASSERT_TRUE(kreoda::ProjectNativeEdgesToPlane({source}, plane, &output, &error))
      << error;
  ASSERT_EQ(output.size(), 1u);
  BRepAdaptor_Curve projected(output[0]);
  ASSERT_EQ(projected.GetType(), GeomAbs_Ellipse);
  EXPECT_NEAR(projected.Ellipse().MajorRadius(), radius, kTolerance);
  EXPECT_NEAR(projected.Ellipse().MinorRadius(), radius / std::sqrt(2.0), kTolerance);
  EXPECT_NEAR(projected.FirstParameter(), first, kTolerance);
  EXPECT_NEAR(projected.LastParameter(), last, kTolerance);
  EXPECT_TRUE(Near(projected.Value(first), ProjectPoint(sourceCurve.Value(first), plane)));
  EXPECT_TRUE(Near(projected.Value(last), ProjectPoint(sourceCurve.Value(last), plane)));
  EXPECT_TRUE(EdgeSamplesOnPlane(output[0], plane));
  EXPECT_GT(EdgeLength(output[0]), 0.1);
}

TEST(Projection, SplineProjectionRetainsNativeCurveAndParameterMapping) {
  NCollection_Array1<gp_Pnt> points(1, 6);
  points.SetValue(1, gp_Pnt(0, 0, 2));
  points.SetValue(2, gp_Pnt(1, 2, 3));
  points.SetValue(3, gp_Pnt(3, 1, 5));
  points.SetValue(4, gp_Pnt(4, -1, 1));
  points.SetValue(5, gp_Pnt(6, 2, 4));
  points.SetValue(6, gp_Pnt(7, 0, 2));
  GeomAPI_PointsToBSpline builder(points);
  ASSERT_TRUE(builder.IsDone());
  const Handle(Geom_BSplineCurve) spline = builder.Curve();
  const TopoDS_Edge source = BRepBuilderAPI_MakeEdge(
      spline, spline->FirstParameter(), spline->LastParameter()).Edge();
  const kreoda::SketchPlane plane = TiltedPlane();
  BRepAdaptor_Curve sourceCurve(source);

  std::vector<TopoDS_Edge> output;
  std::string error;
  ASSERT_TRUE(kreoda::ProjectNativeEdgesToPlane({source}, plane, &output, &error))
      << error;
  ASSERT_EQ(output.size(), 1u);
  BRepAdaptor_Curve projected(output[0]);
  ASSERT_EQ(projected.GetType(), GeomAbs_BSplineCurve);
  EXPECT_NEAR(projected.FirstParameter(), sourceCurve.FirstParameter(), kTolerance);
  EXPECT_NEAR(projected.LastParameter(), sourceCurve.LastParameter(), kTolerance);
  for (double t : {0.07, 0.23, 0.5, 0.78, 0.91}) {
    const double parameter = sourceCurve.FirstParameter() +
        (sourceCurve.LastParameter() - sourceCurve.FirstParameter()) * t;
    EXPECT_TRUE(Near(projected.Value(parameter),
                     ProjectPoint(sourceCurve.Value(parameter), plane), 2e-5));
  }
  EXPECT_TRUE(EdgeSamplesOnPlane(output[0], plane));
  EXPECT_GT(EdgeLength(output[0]), 1.0);
}

TEST(Projection, ClosedProjectedLoopRetainsOrientationAndAnalyticArea) {
  constexpr double radius = 5;
  const TopoDS_Edge source = CircleEdge(gp_Pnt(0, 0, 4), gp_Dir(1, 0, 1), radius);
  TopoDS_Edge reversed = source;
  reversed.Reverse();
  std::vector<TopoDS_Edge> output;
  std::string error;
  ASSERT_TRUE(kreoda::ProjectNativeEdgesToPlane({reversed}, kreoda::SketchPlane{},
                                                 &output, &error)) << error;
  ASSERT_EQ(output.size(), 1u);
  EXPECT_EQ(output[0].Orientation(), reversed.Orientation());
  BRepAdaptor_Curve curve(output[0]);
  ASSERT_EQ(curve.GetType(), GeomAbs_Ellipse);
  EXPECT_TRUE(output[0].Closed());
  double area = 0;
  ASSERT_TRUE(ClosedWireArea(output, &area));
  EXPECT_NEAR(area, kPi * radius * radius / std::sqrt(2.0), 1e-5);
  EXPECT_TRUE(EdgeSamplesOnPlane(output[0], kreoda::SketchPlane{}));
  TopoDS_Shape profile;
  ASSERT_TRUE(kreoda::BuildPlanarProfileFromEdges(
      output, kreoda::SketchPlane{}, &profile, &error)) << error;
  GProp_GProps profileProperties;
  BRepGProp::SurfaceProperties(profile, profileProperties);
  EXPECT_NEAR(std::fabs(profileProperties.Mass()), area, 1e-5);
}

TEST(Projection, TiltedProjectedCircleBuildsExactProfileAndPrismWithoutMutation) {
  constexpr double radius = 6;
  constexpr double height = 9;
  const kreoda::SketchPlane plane = TiltedPlane();
  const gp_Pnt sourceCenter = Origin(plane).Translated(
      3 * gp_Vec(plane.xAxis[0], plane.xAxis[1], plane.xAxis[2]) +
      4 * gp_Vec(plane.yAxis[0], plane.yAxis[1], plane.yAxis[2]) +
      8 * Normal(plane));
  const gp_Dir sourceNormal(1, 0, 1);
  const TopoDS_Edge source = CircleEdge(sourceCenter, sourceNormal, radius);
  const std::string originalSource = ShapeDump(source);

  std::vector<TopoDS_Edge> projected;
  std::string error;
  ASSERT_TRUE(kreoda::ProjectNativeEdgesToPlane({source}, plane, &projected,
                                                 &error)) << error;
  ASSERT_EQ(projected.size(), 1u);
  ASSERT_EQ(BRepAdaptor_Curve(projected[0]).GetType(), GeomAbs_BSplineCurve);
  const std::string sourceBefore = ShapeDump(projected[0]);

  TopoDS_Shape profile;
  ASSERT_TRUE(kreoda::BuildPlanarProfileFromEdges(projected, plane, &profile,
                                                   &error)) << error;
  const std::string sourceAfter = ShapeDump(projected[0]);
  EXPECT_EQ(sourceAfter, sourceBefore);
  EXPECT_EQ(ShapeDump(source), originalSource);
  SaveProfileProof("native-profile-source-before.brep", sourceBefore);
  SaveProfileProof("native-profile-source-after.brep", sourceAfter);

  const double projectedArea = kPi * radius * radius *
      std::fabs(sourceNormal.Dot(gp_Dir(plane.normal[0], plane.normal[1],
                                        plane.normal[2])));
  GProp_GProps areaProperties;
  BRepGProp::SurfaceProperties(profile, areaProperties);
  EXPECT_NEAR(std::fabs(areaProperties.Mass()), projectedArea, 1e-5);
  const gp_Pnt expectedCenter = ProjectPoint(sourceCenter, plane);
  EXPECT_TRUE(Near(areaProperties.CentreOfMass(), expectedCenter, 1e-5));

  BRepPrimAPI_MakePrism prism(profile, height * Normal(plane), false, true);
  prism.Build();
  ASSERT_TRUE(prism.IsDone());
  const TopoDS_Shape solid = prism.Shape();
  GProp_GProps volumeProperties;
  BRepGProp::VolumeProperties(solid, volumeProperties);
  EXPECT_NEAR(std::fabs(volumeProperties.Mass()), projectedArea * height,
              projectedArea * height * 1e-7);
  EXPECT_TRUE(Near(volumeProperties.CentreOfMass(),
                   expectedCenter.Translated((height / 2) * Normal(plane)),
                   1e-5));
  EXPECT_EQ(FaceCount(profile), 1);
  EXPECT_EQ(FaceCount(solid), 3);
}

TEST(Projection, ProfilesClassifyAnnularDisconnectedAndNestedNativeLoops) {
  const kreoda::SketchPlane plane;
  std::string error;
  TopoDS_Shape profile;

  ASSERT_TRUE(kreoda::BuildPlanarProfileFromEdges(
      {CircleEdge(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), 4),
       CircleEdge(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), 10)},
      plane, &profile, &error)) << error;
  EXPECT_EQ(FaceCount(profile), 1);
  EXPECT_EQ(WireCount(profile), 2);
  EXPECT_NEAR(ProfileArea(profile), 84 * kPi, 1e-5);

  ASSERT_TRUE(kreoda::BuildPlanarProfileFromEdges(
      {CircleEdge(gp_Pnt(20, 0, 0), gp_Dir(0, 0, 1), 2),
       CircleEdge(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), 5)},
      plane, &profile, &error)) << error;
  EXPECT_EQ(FaceCount(profile), 2);
  EXPECT_EQ(WireCount(profile), 2);
  EXPECT_NEAR(ProfileArea(profile), 29 * kPi, 1e-5);

  TopoDS_Edge outer = CircleEdge(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), 10);
  TopoDS_Edge hole = CircleEdge(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), 6);
  TopoDS_Edge island = CircleEdge(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), 2);
  outer.Reverse();
  island.Reverse();
  ASSERT_TRUE(kreoda::BuildPlanarProfileFromEdges(
      {island, outer, hole}, plane, &profile, &error)) << error;
  EXPECT_EQ(FaceCount(profile), 2);
  EXPECT_EQ(WireCount(profile), 3);
  EXPECT_NEAR(ProfileArea(profile), 68 * kPi, 1e-5);

  TopoDS_Shape withoutErrorOutput;
  EXPECT_TRUE(kreoda::BuildPlanarProfileFromEdges(
      {CircleEdge(gp_Pnt(40, 0, 0), gp_Dir(0, 0, 1), 1)}, plane,
      &withoutErrorOutput, nullptr));
  EXPECT_NEAR(ProfileArea(withoutErrorOutput), kPi, 1e-5);
}

TEST(Projection, ClosedBSplineProfileRetainsNativeCurve) {
  Handle(NCollection_HArray1<gp_Pnt>) points =
      new NCollection_HArray1<gp_Pnt>(1, 8);
  for (int i = 1; i <= 8; ++i) {
    const double angle = 2 * kPi * (i - 1) / 8;
    points->SetValue(i, gp_Pnt(4 * std::cos(angle), 3 * std::sin(angle), 0));
  }
  GeomAPI_Interpolate interpolation(points, true, 1e-7);
  interpolation.Perform();
  ASSERT_TRUE(interpolation.IsDone());
  const Handle(Geom_BSplineCurve) spline = interpolation.Curve();
  const TopoDS_Edge edge = BRepBuilderAPI_MakeEdge(spline).Edge();
  ASSERT_TRUE(edge.Closed());

  std::vector<TopoDS_Edge> projected;
  std::string error;
  ASSERT_TRUE(kreoda::ProjectNativeEdgesToPlane(
      {edge}, kreoda::SketchPlane{}, &projected, &error)) << error;
  ASSERT_EQ(projected.size(), 1u);
  EXPECT_EQ(BRepAdaptor_Curve(projected.front()).GetType(), GeomAbs_BSplineCurve);
  TopoDS_Shape profile;
  ASSERT_TRUE(kreoda::BuildPlanarProfileFromEdges(
      projected, kreoda::SketchPlane{}, &profile, &error)) << error;
  int edgeCount = 0;
  for (TopExp_Explorer it(profile, TopAbs_EDGE); it.More(); it.Next()) {
    ++edgeCount;
    EXPECT_EQ(BRepAdaptor_Curve(TopoDS::Edge(it.Current())).GetType(),
              GeomAbs_BSplineCurve);
  }
  EXPECT_EQ(edgeCount, 1);
  EXPECT_GT(ProfileArea(profile), 0);
}

TEST(Projection, AmbiguousAndInvalidProfilesFailAtomically) {
  const kreoda::SketchPlane plane;
  const TopoDS_Shape sentinel = BRepPrimAPI_MakeBox(2, 3, 4).Shape();
  const std::string sentinelDump = ShapeDump(sentinel);
  const auto expectRejected = [&](const std::vector<TopoDS_Edge>& edges,
                                  const kreoda::SketchPlane& target) {
    std::vector<std::string> sourceBefore;
    for (const auto& edge : edges) sourceBefore.push_back(ShapeDump(edge));
    TopoDS_Shape output = sentinel;
    std::string error;
    EXPECT_FALSE(kreoda::BuildPlanarProfileFromEdges(edges, target, &output,
                                                      &error));
    EXPECT_FALSE(error.empty());
    EXPECT_TRUE(output.IsSame(sentinel));
    EXPECT_EQ(ShapeDump(output), sentinelDump);
    for (std::size_t i = 0; i < edges.size(); ++i) {
      EXPECT_EQ(ShapeDump(edges[i]), sourceBefore[i]);
    }
  };

  expectRejected({BRepBuilderAPI_MakeEdge(gp_Pnt(0, 0, 0),
                                          gp_Pnt(5, 0, 0)).Edge()}, plane);
  expectRejected({BRepBuilderAPI_MakeEdge(gp_Pnt(0, 0, 0),
                                          gp_Pnt(5, 0, 1)).Edge()}, plane);
  expectRejected({CircleEdge(gp_Pnt(0, 0, 1), gp_Dir(0, 1, 0), 2)}, plane);
  expectRejected({CircleEdge(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), 5),
                  CircleEdge(gp_Pnt(7, 0, 0), gp_Dir(0, 0, 1), 2)}, plane);
  expectRejected({CircleEdge(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), 5),
                  CircleEdge(gp_Pnt(4, 0, 0), gp_Dir(0, 0, 1), 2)}, plane);
  expectRejected({CircleEdge(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), 5),
                  CircleEdge(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), 5)}, plane);
  expectRejected({}, plane);

  TopoDS_Shape unchanged = sentinel;
  const TopoDS_Edge nullEdge;
  std::string error;
  EXPECT_FALSE(kreoda::BuildPlanarProfileFromEdges({nullEdge}, plane,
                                                    &unchanged, &error));
  EXPECT_FALSE(error.empty());
  EXPECT_TRUE(unchanged.IsSame(sentinel));

  Handle(NCollection_HArray1<gp_Pnt>) crossingPoints =
      new NCollection_HArray1<gp_Pnt>(1, 4);
  crossingPoints->SetValue(1, gp_Pnt(-3, -3, 0));
  crossingPoints->SetValue(2, gp_Pnt(3, 3, 0));
  crossingPoints->SetValue(3, gp_Pnt(-3, 3, 0));
  crossingPoints->SetValue(4, gp_Pnt(3, -3, 0));
  GeomAPI_Interpolate crossingInterpolation(crossingPoints, true, 1e-7);
  crossingInterpolation.Perform();
  ASSERT_TRUE(crossingInterpolation.IsDone());
  const TopoDS_Edge selfCrossing =
      BRepBuilderAPI_MakeEdge(crossingInterpolation.Curve()).Edge();
  ASSERT_TRUE(selfCrossing.Closed());
  ASSERT_TRUE(BRepCheck_Analyzer(selfCrossing).IsValid());
  expectRejected({selfCrossing}, plane);

  auto invalidPlane = plane;
  invalidPlane.xAxis[0] = 2;
  expectRejected({CircleEdge(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), 1)},
                 invalidPlane);
  EXPECT_FALSE(kreoda::BuildPlanarProfileFromEdges(
      {CircleEdge(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), 1)}, plane, nullptr,
      nullptr));
}

TEST(Projection, SphereSilhouetteIsTargetPlaneCircleAndRepeatable) {
  constexpr double radius = 4;
  const kreoda::SketchPlane plane = TiltedPlane();
  const gp_Pnt center = Origin(plane).Translated(2 * gp_Vec(
      plane.xAxis[0], plane.xAxis[1], plane.xAxis[2]) -
      gp_Vec(plane.yAxis[0], plane.yAxis[1], plane.yAxis[2]) +
      3 * Normal(plane));
  const TopoDS_Shape source = BRepPrimAPI_MakeSphere(center, radius).Solid();
  GProp_GProps beforeProperties;
  BRepGProp::VolumeProperties(source, beforeProperties);

  std::vector<TopoDS_Edge> first, second;
  std::string error;
  ASSERT_TRUE(kreoda::ProjectNativeSilhouetteToPlane(source, plane, &first, &error))
      << error;
  ASSERT_TRUE(kreoda::ProjectNativeSilhouetteToPlane(source, plane, &second, &error))
      << error;
  ASSERT_EQ(first.size(), 1u);
  ASSERT_EQ(second.size(), first.size());
  BRepAdaptor_Curve circle(first[0]);
  ASSERT_EQ(circle.GetType(), GeomAbs_Circle);
  EXPECT_NEAR(circle.Circle().Radius(), radius, kTolerance);
  EXPECT_TRUE(Near(circle.Circle().Location(), ProjectPoint(center, plane)));
  EXPECT_TRUE(EdgeSamplesOnPlane(first[0], plane));
  EXPECT_NEAR(TotalLength(first), 2 * kPi * radius, 1e-5);
  EXPECT_NEAR(TotalLength(second), TotalLength(first), kTolerance);
  GProp_GProps afterProperties;
  BRepGProp::VolumeProperties(source, afterProperties);
  EXPECT_NEAR(afterProperties.Mass(), beforeProperties.Mass(), kTolerance);
}

TEST(Projection, ObliqueBoxSilhouetteHasAnalyticAreaWithoutInternalCreases) {
  constexpr double x = 2;
  constexpr double y = 3;
  constexpr double z = 4;
  const kreoda::SketchPlane plane = TiltedPlane();
  const TopoDS_Shape box = BRepPrimAPI_MakeBox(x, y, z).Shape();
  std::vector<TopoDS_Edge> output;
  std::string error;
  ASSERT_TRUE(kreoda::ProjectNativeSilhouetteToPlane(box, plane, &output, &error))
      << error;
  ASSERT_FALSE(output.empty());
  for (const auto& edge : output) EXPECT_TRUE(EdgeSamplesOnPlane(edge, plane));

  double area = 0;
  ASSERT_TRUE(ClosedWireArea(output, &area));
  const double expected = y * z * std::fabs(plane.normal[0]) +
                          x * z * std::fabs(plane.normal[1]) +
                          x * y * std::fabs(plane.normal[2]);
  EXPECT_NEAR(area, expected, 1e-5);
}

TEST(Projection, AnnularFaceSilhouettePreservesInnerContour) {
  constexpr double outerRadius = 5;
  constexpr double innerRadius = 2;
  const gp_Ax2 axis(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0));
  const TopoDS_Edge outer = BRepBuilderAPI_MakeEdge(
      gp_Circ(axis, outerRadius)).Edge();
  TopoDS_Edge inner = BRepBuilderAPI_MakeEdge(
      gp_Circ(axis, innerRadius)).Edge();
  inner.Reverse();
  const TopoDS_Wire outerWire = BRepBuilderAPI_MakeWire(outer).Wire();
  const TopoDS_Wire innerWire = BRepBuilderAPI_MakeWire(inner).Wire();
  BRepBuilderAPI_MakeFace faceBuilder(outerWire);
  faceBuilder.Add(innerWire);
  ASSERT_TRUE(faceBuilder.IsDone());
  const TopoDS_Face ring = faceBuilder.Face();
  ASSERT_TRUE(BRepCheck_Analyzer(ring).IsValid());

  std::vector<TopoDS_Edge> output;
  std::string error;
  ASSERT_TRUE(kreoda::ProjectNativeSilhouetteToPlane(
      ring, kreoda::SketchPlane{}, &output, &error)) << error;
  ASSERT_FALSE(output.empty());
  EXPECT_NEAR(TotalLength(output), 2 * kPi * (outerRadius + innerRadius), 1e-5);
  for (const auto& edge : output) {
    EXPECT_TRUE(EdgeSamplesOnPlane(edge, kreoda::SketchPlane{}));
  }
}

TEST(Projection, SphereSectionHasAnalyticRadiusInRotatedFrame) {
  constexpr double sphereRadius = 5;
  constexpr double offset = 3;
  const kreoda::SketchPlane plane = TiltedPlane();
  const gp_Pnt center = Origin(plane).Translated(offset * Normal(plane));
  const TopoDS_Shape sphere = BRepPrimAPI_MakeSphere(center, sphereRadius).Solid();
  std::vector<TopoDS_Edge> output;
  std::string error;
  ASSERT_TRUE(kreoda::IntersectNativeShapeWithPlane(sphere, plane, &output, &error))
      << error;
  ASSERT_EQ(output.size(), 1u);
  BRepAdaptor_Curve circle(output[0]);
  ASSERT_EQ(circle.GetType(), GeomAbs_Circle);
  EXPECT_NEAR(circle.Circle().Radius(),
              std::sqrt(sphereRadius * sphereRadius - offset * offset), kTolerance);
  EXPECT_TRUE(Near(circle.Circle().Location(), Origin(plane)));
  EXPECT_TRUE(EdgeSamplesOnPlane(output[0], plane));
}

TEST(Projection, SectionPreservesSourceTopologyOnSuccessAndFailure) {
  const TopoDS_Shape source = BRepPrimAPI_MakeBox(4, 6, 8).Shape();
  auto snapshot = [&]() {
    std::ostringstream stream;
    BRepTools::Write(source, stream);
    return stream.str();
  };
  const std::string before = snapshot();
  const TopoDS_Edge sentinel = BRepBuilderAPI_MakeEdge(
      gp_Pnt(100, 100, 100), gp_Pnt(101, 100, 100)).Edge();
  for (const double height : {3.0, 1e-8, 0.0, 20.0}) {
    kreoda::SketchPlane plane;
    plane.origin[2] = height;
    std::vector<TopoDS_Edge> output{sentinel};
    std::string error;
    const bool success = kreoda::IntersectNativeShapeWithPlane(
        source, plane, &output, &error);
    EXPECT_EQ(success, height != 20.0) << error;
    EXPECT_EQ(snapshot(), before) << "section at z=" << height;
    if (!success) ExpectSameOutput(output, {sentinel});
  }
}

TEST(Projection, NullMalformedNonfiniteUnboundedAndCollapsedInputsFailAtomically) {
  const TopoDS_Edge sentinel = BRepBuilderAPI_MakeEdge(
      gp_Pnt(100, 100, 100), gp_Pnt(101, 100, 100)).Edge();
  const std::vector<TopoDS_Edge> before{sentinel};
  std::vector<TopoDS_Edge> output = before;
  std::string error;

  EXPECT_FALSE(kreoda::ProjectNativeEdgesToPlane(
      {TopoDS_Edge{}}, kreoda::SketchPlane{}, &output, &error));
  ExpectSameOutput(output, before);
  EXPECT_FALSE(error.empty());

  BRep_Builder builder;
  TopoDS_Edge malformed;
  builder.MakeEdge(malformed);
  ASSERT_FALSE(malformed.IsNull());
  output = before;
  EXPECT_FALSE(kreoda::ProjectNativeEdgesToPlane(
      {malformed}, kreoda::SketchPlane{}, &output, &error));
  ExpectSameOutput(output, before);
  EXPECT_FALSE(error.empty());

  const TopoDS_Edge unbounded = BRepBuilderAPI_MakeEdge(
      new Geom_Line(gp_Lin(gp_Pnt(0, 0, 1), gp_Dir(1, 0, 0)))).Edge();
  output = before;
  EXPECT_FALSE(kreoda::ProjectNativeEdgesToPlane(
      {unbounded}, kreoda::SketchPlane{}, &output, &error));
  ExpectSameOutput(output, before);
  EXPECT_FALSE(error.empty());

  const kreoda::SketchPlane nonfinite = [] {
    kreoda::SketchPlane plane;
    plane.origin[1] = std::numeric_limits<double>::quiet_NaN();
    return plane;
  }();
  const TopoDS_Edge valid = BRepBuilderAPI_MakeEdge(
      gp_Pnt(0, 0, 0), gp_Pnt(1, 0, 0)).Edge();
  output = before;
  EXPECT_FALSE(kreoda::ProjectNativeEdgesToPlane({valid}, nonfinite, &output, &error));
  ExpectSameOutput(output, before);
  EXPECT_FALSE(error.empty());

  kreoda::SketchPlane malformedFrame;
  malformedFrame.xAxis[0] = 2;
  output = before;
  EXPECT_FALSE(kreoda::ProjectNativeEdgesToPlane(
      {valid}, malformedFrame, &output, &error));
  ExpectSameOutput(output, before);
  EXPECT_FALSE(error.empty());

  const TopoDS_Edge collapsed = BRepBuilderAPI_MakeEdge(
      gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 5)).Edge();
  output = before;
  EXPECT_FALSE(kreoda::ProjectNativeEdgesToPlane(
      {collapsed}, kreoda::SketchPlane{}, &output, &error));
  ExpectSameOutput(output, before);
  EXPECT_FALSE(error.empty());
}

TEST(Projection, DisjointSectionAndNullSilhouetteFailWithoutPublishing) {
  const TopoDS_Edge sentinel = BRepBuilderAPI_MakeEdge(
      gp_Pnt(100, 100, 100), gp_Pnt(101, 100, 100)).Edge();
  const std::vector<TopoDS_Edge> before{sentinel};
  std::vector<TopoDS_Edge> output = before;
  std::string error;

  const TopoDS_Shape disjoint = BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, 10), 2).Solid();
  EXPECT_FALSE(kreoda::IntersectNativeShapeWithPlane(
      disjoint, kreoda::SketchPlane{}, &output, &error));
  ExpectSameOutput(output, before);
  EXPECT_FALSE(error.empty());

  output = before;
  EXPECT_FALSE(kreoda::ProjectNativeSilhouetteToPlane(
      TopoDS_Shape{}, kreoda::SketchPlane{}, &output, &error));
  ExpectSameOutput(output, before);
  EXPECT_FALSE(error.empty());
}

}  // namespace
#else
TEST(Projection, RequiresOCCT) { GTEST_SKIP() << "native projection requires OCCT"; }
#endif
