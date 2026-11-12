#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

#include "document/document_store.h"
#include "features/sketch/sketch_commands.h"
#include "features/primitives/primitives.h"
#include "features/surface/surface_modeling.h"
#include "features/surface/surface_thicken.h"
#include "features/instance/instance.h"
#include "model/body.h"
#include "model/geometry_kind.h"
#include "model/shapes.h"
#include "protocol/dispatcher.h"
#include "tessellation/mesh.h"

#if KREODA_WITH_OCCT
#include <BRepAdaptor_Surface.hxx>
#include <BRep_Builder.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <BRepTools.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <sstream>
#include <stdexcept>
#endif

#if KREODA_WITH_OCCT
namespace {
using Json = nlohmann::json;

Json rpc(Json request) {
  request["protocolVersion"] = 1;
  request["documentId"] = "surface-thicken-doc";
  request["requestId"] = request.value("featureId", "surface-thicken");
  const auto bytes = kreoda::handle_command(request.dump());
  return Json::parse(bytes.begin(), bytes.end());
}

int countShape(const TopoDS_Shape& shape, TopAbs_ShapeEnum kind) {
  int count = 0;
  for (TopExp_Explorer it(shape, kind); it.More(); it.Next()) ++count;
  return count;
}

TopoDS_Wire polygon(std::initializer_list<gp_Pnt> points) {
  BRepBuilderAPI_MakePolygon wire;
  for (const auto& point : points) wire.Add(point);
  wire.Close();
  return wire.Wire();
}

TopoDS_Face rectangleFace(double x, double y, double width, double height) {
  const auto boundary = polygon({gp_Pnt(x, y, 0), gp_Pnt(x + width, y, 0),
                                 gp_Pnt(x + width, y + height, 0),
                                 gp_Pnt(x, y + height, 0)});
  return BRepBuilderAPI_MakeFace(gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)),
                                 boundary).Face();
}

TopoDS_Face holedFace() {
  const auto outer = polygon({gp_Pnt(0, 0, 0), gp_Pnt(10, 0, 0),
                              gp_Pnt(10, 5, 0), gp_Pnt(0, 5, 0)});
  const auto edge = BRepBuilderAPI_MakeEdge(
      gp_Circ(gp_Ax2(gp_Pnt(5, 2.5, 0), gp_Dir(0, 0, 1)), 1.0)).Edge();
  TopoDS_Wire inner = BRepBuilderAPI_MakeWire(edge).Wire();
  inner.Reverse();
  BRepBuilderAPI_MakeFace face(gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), outer);
  face.Add(inner);
  return face.Face();
}

TopoDS_Shell onlyShell(const TopoDS_Shape& shape) {
  TopTools_IndexedMapOfShape shells;
  TopExp::MapShapes(shape, TopAbs_SHELL, shells);
  if (shells.Extent() != 1) throw std::runtime_error("fixture needs one shell");
  return TopoDS::Shell(shells(1));
}

TopoDS_Face cylinderSide(const TopoDS_Shape& shape) {
  for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next()) {
    TopoDS_Face face = TopoDS::Face(it.Current());
    if (BRepAdaptor_Surface(face).GetType() == GeomAbs_Cylinder) return face;
  }
  throw std::runtime_error("fixture needs a cylindrical side face");
}

double signedVolume(const TopoDS_Shape& shape) {
  GProp_GProps props;
  BRepGProp::VolumeProperties(shape, props, false, false, false);
  return props.Mass();
}

double volume(const TopoDS_Shape& shape) {
  GProp_GProps props;
  BRepGProp::VolumeProperties(shape, props, true, false, false);
  return props.Mass();
}

double cylinderOrientation(const TopoDS_Face& face) {
  BRepAdaptor_Surface surface(face, true);
  double u0, u1, v0, v1;
  BRepTools::UVBounds(face, u0, u1, v0, v1);
  gp_Pnt point;
  gp_Vec du, dv;
  surface.D1((u0 + u1) * 0.5, (v0 + v1) * 0.5, point, du, dv);
  gp_Vec normal = du.Crossed(dv);
  if (face.Orientation() == TopAbs_REVERSED) normal.Reverse();
  normal.Normalize();
  return point.X() * normal.X() + point.Y() * normal.Y() > 0 ? 1.0 : -1.0;
}

kreoda::ShapeRecord surfaceRecord(const TopoDS_Shape& shape,
                                  const std::string& type = "SurfaceSew") {
  kreoda::ShapeRecord record;
  record.type = type;
  record.shape = shape;
  return record;
}

void expectThickenedVolume(const kreoda::ShapeRecord& source, double thickness,
                           double expected) {
  std::ostringstream before;
  BRepTools::Write(source.shape, before);
  TopoDS_Shape result;
  std::string error;
  ASSERT_TRUE(kreoda::BuildSurfaceThickenShape(source, thickness, 1e-6,
                                                &result, &error)) << error;
  EXPECT_EQ(countShape(result, TopAbs_SOLID), 1);
  EXPECT_NEAR(volume(result), expected, 1e-6);
  std::ostringstream after;
  BRepTools::Write(source.shape, after);
  EXPECT_EQ(after.str(), before.str());
}

double planarOrientation(const TopoDS_Shape& shape, const gp_Pnt& interior) {
  double direction = 0;
  for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next()) {
    const auto face = TopoDS::Face(it.Current());
    BRepAdaptor_Surface surface(face);
    if (surface.GetType() != GeomAbs_Plane)
      throw std::runtime_error("orientation fixture must be planar");
    GProp_GProps area;
    BRepGProp::SurfaceProperties(face, area);
    gp_Vec normal(surface.Plane().Axis().Direction());
    if (face.Orientation() == TopAbs_REVERSED) normal.Reverse();
    direction += gp_Vec(interior, area.CentreOfMass()).Dot(normal);
  }
  if (std::abs(direction) < 1e-8) throw std::runtime_error("ambiguous fixture normals");
  return direction > 0 ? 1.0 : -1.0;
}

kreoda::SketchModel rectangleModel() {
  kreoda::SketchModel model;
  model.points = {{"a", 0, 0, true}, {"b", 10, 0, true},
                  {"c", 10, 5, true}, {"d", 0, 5, true}};
  model.lines = {{"ab", "a", "b"}, {"bc", "b", "c"},
                 {"cd", "c", "d"}, {"da", "d", "a"}};
  return model;
}

bool createExtrudedSurface(const std::string& featureId,
                           const kreoda::SketchModel& model,
                           double distance, std::string* error) {
  const std::string sketchId = featureId + "-sketch";
  return kreoda::CreateSketchFeature(sketchId, "XY", model, error) &&
         kreoda::CreateSurfaceExtrudeFeature(featureId, sketchId, distance,
                                             error);
}
}  // namespace

TEST(SurfaceThicken, Command54BuildsIndependentSolidFromSurface) {
  kreoda::DocumentStore::instance().create("surface-thicken-doc");
  kreoda::SketchModel model;
  model.points = {{"a", 0, 0, true}, {"b", 10, 0, true}};
  model.lines = {{"edge", "a", "b"}};
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("thicken-sketch", "XY", model,
                                            &error)) << error;
  ASSERT_EQ(rpc({{"type", 48}, {"featureId", "thicken-source"},
                 {"sketchId", "thicken-sketch"}, {"distanceMm", 5}})["status"],
            "ok");

  kreoda::ShapeRecord sourceBefore;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("thicken-source", &sourceBefore));
  const auto result = rpc({{"type", 54}, {"featureId", "thicken-result"},
                           {"targetId", "thicken-source"},
                           {"thicknessMm", 1.0}});
  ASSERT_EQ(result["status"], "ok") << result;

  kreoda::ShapeRecord sourceAfter, thickened;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("thicken-source", &sourceAfter));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("thicken-result", &thickened));
  EXPECT_TRUE(sourceAfter.shape.IsSame(sourceBefore.shape));
  EXPECT_EQ(thickened.type, "SurfaceThicken");
  EXPECT_EQ(thickened.paramsMm, (std::vector<double>{1.0, 1e-6}));
  EXPECT_EQ(thickened.dependsOn, (std::vector<std::string>{"thicken-source"}));
  EXPECT_EQ(countShape(thickened.shape, TopAbs_SOLID), 1);
  EXPECT_GT(thickened.volumeMm3, 0);
}

TEST(SurfaceThicken, AnalyticPlanarAndOrientedCylinderOffsets) {
  const double pi = std::acos(-1.0);
  const auto rectangle = surfaceRecord(rectangleFace(0, 0, 10, 5), "SurfaceExtrude");
  expectThickenedVolume(rectangle, 1, 50);
  expectThickenedVolume(rectangle, -1, 50);

  const auto annulus = surfaceRecord(holedFace(), "SurfaceExtrude");
  expectThickenedVolume(annulus, 1, 50 - pi);
  expectThickenedVolume(annulus, -1, 50 - pi);

  const TopoDS_Face cylinder = cylinderSide(BRepPrimAPI_MakeCylinder(5, 20).Shape());
  for (const bool reversed : {false, true}) {
    TopoDS_Face oriented = cylinder;
    if (reversed) oriented.Reverse();
    const double sign = cylinderOrientation(oriented);
    const auto source = surfaceRecord(oriented, "SurfaceExtrude");
    for (const double thickness : {1.0, -1.0}) {
      const double radius = 5 + sign * thickness;
      const double expected = pi * 20 * std::abs(radius * radius - 25);
      expectThickenedVolume(source, thickness, expected);
    }
    EXPECT_TRUE(source.shape.IsSame(oriented));
  }
}

TEST(SurfaceThicken, AnalyticOpenAndClosedShellsAndCollapseGuards) {
  const double pi = std::acos(-1.0);
  kreoda::DocumentStore::instance().create("surface-thicken-analytic-doc");
  std::string error;

  kreoda::SketchModel lModel;
  lModel.points = {{"a", 0, 0, true}, {"b", 10, 0, true}, {"c", 10, 5, true}};
  lModel.lines = {{"ab", "a", "b"}, {"bc", "b", "c"}};
  ASSERT_TRUE(createExtrudedSurface("thicken-L-source", lModel, 5, &error)) << error;
  kreoda::ShapeRecord lSource;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("thicken-L-source", &lSource));
  const auto lSign = planarOrientation(lSource.shape, gp_Pnt(5, 2.5, 2.5));
  for (const double t : {1.0, -1.0})
    expectThickenedVolume(lSource, t, lSign * t > 0 ? 75 + 5 * pi / 4 : 70);

  ASSERT_TRUE(createExtrudedSurface("thicken-tube-source", rectangleModel(), 20,
                                    &error)) << error;
  kreoda::ShapeRecord tubeSource;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("thicken-tube-source", &tubeSource));
  const auto tubeSign = planarOrientation(tubeSource.shape, gp_Pnt(5, 2.5, 10));
  for (const double t : {1.0, -1.0})
    expectThickenedVolume(tubeSource, t, tubeSign * t > 0 ? 20 * (30 + pi) : 520);

  TopoDS_Shell box = onlyShell(BRepPrimAPI_MakeBox(10, 5, 8).Shape());
  if (signedVolume(box) < 0) box.Reverse();
  const auto boxSource = surfaceRecord(box);
  expectThickenedVolume(boxSource, 1, 340 + 23 * pi + 4 * pi / 3);
  expectThickenedVolume(boxSource, -1, 256);

  TopoDS_Shell sphere = onlyShell(BRepPrimAPI_MakeSphere(5).Shape());
  if (signedVolume(sphere) < 0) sphere.Reverse();
  const auto sphereSource = surfaceRecord(sphere);
  expectThickenedVolume(sphereSource, 1, 4 * pi / 3 * (216 - 125));
  expectThickenedVolume(sphereSource, -1, 4 * pi / 3 * (125 - 64));
  for (const double thickness : {-5.0, -6.0}) {
    TopoDS_Shape rejected;
    error.clear();
    EXPECT_FALSE(kreoda::BuildSurfaceThickenShape(
        sphereSource, thickness, 1e-6, &rejected, &error));
    EXPECT_TRUE(rejected.IsNull());
    EXPECT_NE(error.find("offset image"), std::string::npos) << error;
  }

  TopoDS_Shell torus = onlyShell(BRepPrimAPI_MakeTorus(10, 2).Shape());
  const double torusSign = signedVolume(torus) < 0 ? -1.0 : 1.0;
  const auto torusSource = surfaceRecord(torus);
  for (const double thickness : {1.0, -1.0}) {
    const double minor = 2 + torusSign * thickness;
    const double expected = 20 * pi * pi * std::abs(minor * minor - 4);
    expectThickenedVolume(torusSource, thickness, expected);
  }
  EXPECT_TRUE(sphereSource.shape.IsSame(sphere));
  EXPECT_TRUE(boxSource.shape.IsSame(box));
  EXPECT_TRUE(torusSource.shape.IsSame(torus));
}

TEST(SurfaceThicken, StrictFailuresAreAtomicAndSurfaceInstancesAreValidTargets) {
  kreoda::DocumentStore::instance().create("surface-thicken-doc");
  kreoda::SketchModel line;
  line.points = {{"a", 0, 0, true}, {"b", 10, 0, true}};
  line.lines = {{"edge", "a", "b"}};
  std::string error;
  ASSERT_TRUE(createExtrudedSurface("validation-source", line, 5, &error)) << error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("validation-solid", 10, 10, 10, &error)) << error;
  kreoda::ShapeRecord sourceBefore;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("validation-source", &sourceBefore));
  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  const auto registry = kreoda::DocumentStore::instance().snapshotRegistry();
  const auto bodyCount = kreoda::BodyStore::instance().size();

  const std::vector<Json> invalid = {
      {{"type", 54}, {"featureId", "bad-unknown"}, {"targetId", "validation-source"}, {"thicknessMm", 1}, {"ignored", true}},
      {{"type", 54}, {"featureId", "bad-string"}, {"targetId", "validation-source"}, {"thicknessMm", "1"}},
      {{"type", 54}, {"featureId", "bad-bool"}, {"targetId", "validation-source"}, {"thicknessMm", true}},
      {{"type", 54}, {"featureId", "bad-zero"}, {"targetId", "validation-source"}, {"thicknessMm", 0}},
      {{"type", 54}, {"featureId", "bad-small"}, {"targetId", "validation-source"}, {"thicknessMm", 1e-7}},
      {{"type", 54}, {"featureId", "bad-large"}, {"targetId", "validation-source"}, {"thicknessMm", 100001}},
      {{"type", 54}, {"featureId", "bad-tolerance"}, {"targetId", "validation-source"}, {"thicknessMm", 1}, {"toleranceMm", 2}},
      {{"type", 54}, {"featureId", "bad-id"}, {"targetId", "invalid id"}, {"thicknessMm", 1}},
      {{"type", 54}, {"featureId", "bad-missing"}, {"targetId", "does-not-exist"}, {"thicknessMm", 1}},
      {{"type", 54}, {"featureId", "bad-solid"}, {"targetId", "validation-solid"}, {"thicknessMm", 1}},
  };
  for (const auto& request : invalid) {
    const auto response = rpc(request);
    EXPECT_EQ(response["status"], "error") << response;
    EXPECT_FALSE(kreoda::ShapeStore::instance().contains(request["featureId"].get<std::string>()));
    EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
    EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRegistry(), registry);
    EXPECT_EQ(kreoda::BodyStore::instance().size(), bodyCount);
  }

  ASSERT_TRUE(kreoda::CreateInstanceFeature("validation-instance", "validation-source",
                                             {20, 0, 0, 0, 0, 0}, &error)) << error;
  const auto instanceThick = rpc({{"type", 54}, {"featureId", "instance-thick"},
                                  {"targetId", "validation-instance"},
                                  {"thicknessMm", -1}});
  ASSERT_EQ(instanceThick["status"], "ok") << instanceThick;
  kreoda::ShapeRecord thickened, sourceAfter;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("instance-thick", &thickened));
  EXPECT_EQ(kreoda::FeatureGeometryKind(thickened), kreoda::GeometryKind::Solid);
  EXPECT_EQ(thickened.dependsOn, (std::vector<std::string>{"validation-instance"}));
  EXPECT_NEAR(thickened.volumeMm3, 50, 1e-6);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("validation-source", &sourceAfter));
  EXPECT_TRUE(sourceAfter.shape.IsSame(sourceBefore.shape));
  EXPECT_EQ(sourceAfter.paramsMm, sourceBefore.paramsMm);
  for (int i = 0; i < 6; ++i) EXPECT_DOUBLE_EQ(sourceAfter.bboxMm[i], sourceBefore.bboxMm[i]);
}

TEST(SurfaceThicken, RejectsDisconnectedMixedAndLooseTopologyWithoutChangingInputs) {
  BRep_Builder builder;
  TopoDS_Compound disconnected;
  builder.MakeCompound(disconnected);
  builder.Add(disconnected, rectangleFace(0, 0, 10, 5));
  builder.Add(disconnected, rectangleFace(20, 0, 10, 5));
  TopoDS_Compound mixed;
  builder.MakeCompound(mixed);
  builder.Add(mixed, rectangleFace(0, 0, 10, 5));
  builder.Add(mixed, BRepPrimAPI_MakeBox(1, 1, 1).Shape());
  TopoDS_Compound loose;
  builder.MakeCompound(loose);
  builder.Add(loose, rectangleFace(0, 0, 10, 5));
  builder.Add(loose, BRepBuilderAPI_MakeEdge(gp_Pnt(20, 0, 0), gp_Pnt(21, 0, 0)).Edge());
  for (const TopoDS_Shape& shape : {TopoDS_Shape(disconnected), TopoDS_Shape(mixed), TopoDS_Shape(loose)}) {
    std::ostringstream before;
    BRepTools::Write(shape, before);
    auto previous = BRepPrimAPI_MakeBox(1, 1, 1).Shape();
    const auto preserved = previous;
    std::string error;
    EXPECT_FALSE(kreoda::BuildSurfaceThickenShape(surfaceRecord(shape), 1, 1e-6, &previous, &error));
    EXPECT_FALSE(error.empty());
    EXPECT_TRUE(previous.IsSame(preserved));
    std::ostringstream after;
    BRepTools::Write(shape, after);
    EXPECT_EQ(after.str(), before.str());
  }
}

TEST(SurfaceThicken, NumericEditsUndoRedoUpstreamRebuildAndIcADReopen) {
  kreoda::DocumentStore::instance().create("surface-thicken-doc");
  kreoda::SketchModel line;
  line.points = {{"a", 0, 0, true}, {"b", 10, 0, true}};
  line.lines = {{"edge", "a", "b"}};
  std::string error;
  ASSERT_TRUE(createExtrudedSurface("lifecycle-source", line, 5, &error)) << error;
  const auto created = rpc({{"type", 54}, {"featureId", "lifecycle-thick"},
                            {"targetId", "lifecycle-source"}, {"thicknessMm", 1}});
  ASSERT_EQ(created["status"], "ok") << created;
  kreoda::ShapeRecord thick;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("lifecycle-thick", &thick));
  EXPECT_EQ(thick.paramsMm, (std::vector<double>{1, 1e-6}));
  EXPECT_NEAR(thick.volumeMm3, 50, 1e-6);
  const auto initialBodyCount = kreoda::BodyStore::instance().size();
  kreoda::BodyRecord body;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("lifecycle-thick", &body));
  EXPECT_TRUE(body.visible);

  ASSERT_EQ(rpc({{"type", 6}, {"requestId", "thickness-edit"},
                 {"featureId", "lifecycle-thick"}, {"paramName", "thicknessMm"},
                 {"valueMm", 2}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("lifecycle-thick", &thick));
  EXPECT_NEAR(thick.volumeMm3, 100, 1e-6);
  ASSERT_EQ(rpc({{"type", 6}, {"requestId", "tolerance-edit"},
                 {"featureId", "lifecycle-thick"}, {"paramName", "toleranceMm"},
                 {"valueMm", 1e-5}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("lifecycle-thick", &thick));
  EXPECT_EQ(thick.paramsMm, (std::vector<double>{2, 1e-5}));
  EXPECT_NEAR(thick.volumeMm3, 100, 1e-6);

  ASSERT_EQ(rpc({{"type", 6}, {"requestId", "source-edit"},
                 {"featureId", "lifecycle-source"}, {"paramName", "distanceMm"},
                 {"valueMm", 6}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("lifecycle-thick", &thick));
  EXPECT_NEAR(thick.volumeMm3, 120, 1e-6);
  ASSERT_EQ(rpc({{"type", 8}, {"requestId", "thicken-undo"}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("lifecycle-thick", &thick));
  EXPECT_NEAR(thick.volumeMm3, 100, 1e-6);
  ASSERT_EQ(rpc({{"type", 9}, {"requestId", "thicken-redo"}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("lifecycle-thick", &thick));
  EXPECT_NEAR(thick.volumeMm3, 120, 1e-6);

  const auto tessellation = kreoda::TessellateFeature("lifecycle-thick", 1, &error);
  EXPECT_NEAR(tessellation.volumeMm3, 120, 1e-6);
  const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
  const auto path = (std::filesystem::temp_directory_path() /
      ("kreoda-surface-thicken-" + std::to_string(stamp) + ".icad")).generic_string();
  ASSERT_EQ(rpc({{"type", 10}, {"requestId", "thicken-save"}, {"path", path}})["status"], "ok");
  ASSERT_EQ(rpc({{"type", 2}, {"requestId", "thicken-reset"}})["status"], "ok");
  ASSERT_EQ(rpc({{"type", 11}, {"requestId", "thicken-open"}, {"path", path}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("lifecycle-thick", &thick));
  EXPECT_EQ(thick.type, "SurfaceThicken");
  EXPECT_EQ(thick.paramsMm, (std::vector<double>{2, 1e-5}));
  EXPECT_EQ(thick.dependsOn, (std::vector<std::string>{"lifecycle-source"}));
  EXPECT_NEAR(thick.volumeMm3, 120, 1e-6);
  EXPECT_EQ(kreoda::BodyStore::instance().size(), initialBodyCount);
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("lifecycle-thick", &body));
  EXPECT_EQ(body.tipFeatureId, "lifecycle-thick");
  std::error_code ec;
  std::filesystem::remove(path, ec);
}

#else
TEST(SurfaceThicken, RequiresOcct) {
  GTEST_SKIP() << "surface thickening requires OCCT";
}
#endif
