#include <gtest/gtest.h>

#include <array>
#include <cmath>
#include <filesystem>
#include <utility>

#include "document/document_store.h"
#include "features/primitives/primitives.h"
#include "features/instance/instance.h"
#include "features/sketch/sketch_commands.h"
#include "features/sketch/sketch_store.h"
#include "model/body.h"
#include "model/geometry_kind.h"
#include "model/shapes.h"
#include "protocol/dispatcher.h"
#include "protocol/json_fields.h"
#include "persistence/ocaf_live.h"
#include "tessellation/mesh.h"

#if KREODA_WITH_OCCT
#include <BRepAdaptor_Surface.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRep_Builder.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepGProp.hxx>
#include <BRepTools.hxx>
#include <GProp_GProps.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#endif

#if KREODA_WITH_OCCT
namespace {
using kreoda::Json;

Json rpc(Json request) {
  request["protocolVersion"] = 1;
  request["documentId"] = "surface-sew-offset-doc";
  const auto bytes = kreoda::handle_command(request.dump());
  return Json::parse(bytes.begin(), bytes.end());
}

void newDocument() {
  kreoda::DocumentStore::instance().create("surface-sew-offset-doc");
}

kreoda::SketchModel lineModel(double length = 10.0) {
  kreoda::SketchModel model;
  model.points = {{"a", 0, 0, true}, {"b", length, 0, true}};
  model.lines = {{"edge", "a", "b"}};
  return model;
}

kreoda::SketchModel squareModel(double size = 10.0) {
  kreoda::SketchModel model;
  model.points = {{"a", 0, 0, true}, {"b", size, 0, true},
                  {"c", size, size, true}, {"d", 0, size, true}};
  model.lines = {{"ab", "a", "b"}, {"bc", "b", "c"},
                 {"cd", "c", "d"}, {"da", "d", "a"}};
  return model;
}

kreoda::SketchPlane plane(double ox, double oy, double oz,
                          std::array<double, 3> x,
                          std::array<double, 3> y,
                          std::array<double, 3> normal) {
  kreoda::SketchPlane result;
  result.origin[0] = ox; result.origin[1] = oy; result.origin[2] = oz;
  for (int i = 0; i < 3; ++i) {
    result.xAxis[i] = x[i];
    result.yAxis[i] = y[i];
    result.normal[i] = normal[i];
  }
  return result;
}

bool createLineSketch(const std::string& id, const kreoda::SketchPlane& support,
                      double length, std::string* error) {
  return kreoda::CreateSketchFeature(id, "XY", lineModel(length), support,
                                     error);
}

Json extrude(const std::string& featureId, const std::string& sketchId,
             double distance = 10) {
  return rpc({{"type", 48}, {"requestId", featureId},
              {"featureId", featureId}, {"sketchId", sketchId},
              {"distanceMm", distance}});
}

Json loft(const std::string& featureId, std::vector<std::string> sketchIds) {
  return rpc({{"type", 50}, {"requestId", featureId},
              {"featureId", featureId}, {"sketchIds", sketchIds}});
}

Json sew(const std::string& featureId, std::vector<std::string> featureIds,
         bool makeSolid = false, double tolerance = 0.01) {
  return rpc({{"type", 51}, {"requestId", featureId},
              {"featureId", featureId}, {"featureIds", featureIds},
              {"toleranceMm", tolerance}, {"makeSolid", makeSolid}});
}

Json offset(const std::string& featureId, const std::string& targetId,
            double distance, double tolerance = 1e-6) {
  return rpc({{"type", 52}, {"requestId", featureId},
              {"featureId", featureId}, {"targetId", targetId},
              {"distanceMm", distance}, {"toleranceMm", tolerance}});
}

int countShape(const TopoDS_Shape& shape, TopAbs_ShapeEnum kind) {
  int count = 0;
  for (TopExp_Explorer it(shape, kind); it.More(); it.Next()) ++count;
  return count;
}

double area(const TopoDS_Shape& shape) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(shape, props);
  return props.Mass();
}

std::pair<gp_Pnt, gp_Vec> midpointAndNormal(const TopoDS_Shape& shape) {
  TopExp_Explorer faces(shape, TopAbs_FACE);
  const auto face = TopoDS::Face(faces.Current());
  BRepAdaptor_Surface surface(face, true);
  double u0, u1, v0, v1;
  BRepTools::UVBounds(face, u0, u1, v0, v1);
  gp_Pnt point;
  gp_Vec du, dv;
  surface.D1((u0 + u1) * 0.5, (v0 + v1) * 0.5, point, du, dv);
  gp_Vec direction = du.Crossed(dv);
  if (face.Orientation() == TopAbs_REVERSED) direction.Reverse();
  direction.Normalize();
  return {point, direction};
}

gp_Vec normal(const TopoDS_Shape& shape) {
  return midpointAndNormal(shape).second;
}

std::array<double, 3> bboxCenter(const kreoda::ShapeRecord& record) {
  return {(record.bboxMm[0] + record.bboxMm[3]) * 0.5,
          (record.bboxMm[1] + record.bboxMm[4]) * 0.5,
          (record.bboxMm[2] + record.bboxMm[5]) * 0.5};
}
}  // namespace

TEST(SurfaceSewOffset, SewAdjacentOpenPatchesAndRefuseInventedCaps) {
  newDocument();
  std::string error;
  const auto xy = plane(0, 0, 0, {1, 0, 0}, {0, 1, 0}, {0, 0, 1});
  const auto yz = plane(0, 0, 0, {0, 0, 1}, {1, 0, 0}, {0, 1, 0});
  ASSERT_TRUE(createLineSketch("open-a-sketch", xy, 10, &error)) << error;
  ASSERT_TRUE(createLineSketch("open-b-sketch", yz, 10, &error)) << error;
  ASSERT_EQ(extrude("open-a", "open-a-sketch")["status"], "ok");
  ASSERT_EQ(extrude("open-b", "open-b-sketch")["status"], "ok");
  kreoda::ShapeRecord sourceA, sourceB;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("open-a", &sourceA));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("open-b", &sourceB));
  const double sourceAArea = area(sourceA.shape), sourceBArea = area(sourceB.shape);

  const auto sewn = rpc({{"type", 51}, {"requestId", "open-sew"},
                        {"featureId", "open-sew"},
                        {"featureIds", {"open-a", "open-b"}}});
  ASSERT_EQ(sewn["status"], "ok") << sewn;
  kreoda::ShapeRecord surface;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("open-sew", &surface));
  EXPECT_EQ(surface.type, "SurfaceSew");
  EXPECT_EQ(kreoda::FeatureGeometryKind(surface), kreoda::GeometryKind::Surface);
  EXPECT_EQ(surface.paramsMm, (std::vector<double>{0.01}));
  EXPECT_EQ(surface.dependsOn, (std::vector<std::string>{"open-a", "open-b"}));
  EXPECT_EQ(countShape(surface.shape, TopAbs_FACE), 2);
  EXPECT_EQ(countShape(surface.shape, TopAbs_SOLID), 0);
  EXPECT_DOUBLE_EQ(surface.volumeMm3, 0);
  EXPECT_NEAR(area(surface.shape), 200, 1e-7);
  EXPECT_TRUE(BRepCheck_Analyzer(surface.shape, true).IsValid());
  const auto joinedOffset = offset("open-sew-offset", "open-sew", 1);
  ASSERT_EQ(joinedOffset["status"], "ok") << joinedOffset;
  kreoda::ShapeRecord joinedOffsetShape;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("open-sew-offset", &joinedOffsetShape));
  EXPECT_GE(countShape(joinedOffsetShape.shape, TopAbs_FACE), 2);
  EXPECT_EQ(countShape(joinedOffsetShape.shape, TopAbs_SOLID), 0);
  EXPECT_DOUBLE_EQ(joinedOffsetShape.volumeMm3, 0);
  EXPECT_DOUBLE_EQ(kreoda::TessellateFeature("open-sew", 1, &error).volumeMm3, 0);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("open-a", &sourceA));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("open-b", &sourceB));
  EXPECT_NEAR(area(sourceA.shape), sourceAArea, 1e-8);
  EXPECT_NEAR(area(sourceB.shape), sourceBArea, 1e-8);
  for (const auto& sourceId : {"open-a", "open-b"}) {
    kreoda::BodyRecord body;
    ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature(sourceId, &body));
    EXPECT_TRUE(body.visible);
    EXPECT_EQ(body.tipFeatureId, sourceId);
  }

  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  const auto registry = kreoda::DocumentStore::instance().snapshotRegistry();
  const auto refused = sew("open-solid", {"open-a", "open-b"}, true);
  EXPECT_EQ(refused["status"], "error") << refused;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("open-solid"));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRegistry(), registry);
}

TEST(SurfaceSewOffset, SewExplicitLoftAndTwoAuthoredCapsIntoSolidAndKeepShellMode) {
  newDocument();
  std::string error;
  const auto xy0 = plane(0, 0, 0, {1, 0, 0}, {0, 1, 0}, {0, 0, 1});
  const auto xy20 = plane(0, 0, 20, {1, 0, 0}, {0, 1, 0}, {0, 0, 1});
  const auto yz0 = plane(0, 0, 0, {0, 1, 0}, {0, 0, 1}, {1, 0, 0});
  const auto yz20 = plane(0, 0, 20, {0, 1, 0}, {0, 0, 1}, {1, 0, 0});
  ASSERT_TRUE(kreoda::CreateSketchFeature("loft-bottom", "XY", squareModel(), xy0,
                                           &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("loft-top", "XY", squareModel(), xy20,
                                           &error)) << error;
  ASSERT_TRUE(createLineSketch("cap-bottom-sketch", yz0, 10, &error)) << error;
  ASSERT_TRUE(createLineSketch("cap-top-sketch", yz20, 10, &error)) << error;
  ASSERT_EQ(loft("loft-lateral", {"loft-bottom", "loft-top"})["status"], "ok");
  ASSERT_EQ(extrude("cap-bottom", "cap-bottom-sketch")["status"], "ok");
  ASSERT_EQ(extrude("cap-top", "cap-top-sketch")["status"], "ok");

  const std::vector<std::string> sources = {"loft-lateral", "cap-bottom", "cap-top"};
  const auto shell = sew("closed-shell", sources, false);
  ASSERT_EQ(shell["status"], "ok") << shell;
  kreoda::ShapeRecord surface;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("closed-shell", &surface));
  EXPECT_EQ(surface.type, "SurfaceSew");
  EXPECT_EQ(countShape(surface.shape, TopAbs_FACE), 6);
  EXPECT_EQ(countShape(surface.shape, TopAbs_SOLID), 0);
  EXPECT_DOUBLE_EQ(surface.volumeMm3, 0);
  EXPECT_NEAR(area(surface.shape), 1000, 1e-6);

  const auto solidResult = sew("closed-solid", sources, true);
  ASSERT_EQ(solidResult["status"], "ok") << solidResult;
  kreoda::ShapeRecord solid;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("closed-solid", &solid));
  EXPECT_EQ(solid.type, "SurfaceSewnSolid");
  EXPECT_EQ(kreoda::FeatureGeometryKind(solid), kreoda::GeometryKind::Solid);
  EXPECT_EQ(countShape(solid.shape, TopAbs_SOLID), 1);
  EXPECT_NEAR(solid.bboxMm[0], 0, 2e-7);
  EXPECT_NEAR(solid.bboxMm[1], 0, 2e-7);
  EXPECT_NEAR(solid.bboxMm[2], 0, 2e-7);
  EXPECT_NEAR(solid.bboxMm[3], 10, 2e-7);
  EXPECT_NEAR(solid.bboxMm[4], 10, 2e-7);
  EXPECT_NEAR(solid.bboxMm[5], 20, 2e-7);
  EXPECT_NEAR(solid.volumeMm3, 2000, 1e-6);
  EXPECT_NEAR(area(solid.shape), 1000, 1e-6);
  EXPECT_TRUE(BRepCheck_Analyzer(solid.shape, true).IsValid());
  EXPECT_NEAR(kreoda::TessellateFeature("closed-solid", 1, &error).volumeMm3,
              2000, 1e-4);
  const auto physical = rpc({{"type", 30}, {"requestId", "closed-mass"},
                             {"method", "measureVolume"},
                             {"params", {{"featureId", "closed-solid"}}}});
  EXPECT_EQ(physical["status"], "ok") << physical;
  EXPECT_NEAR(physical["result"]["volumeMm3"].get<double>(), 2000, 1e-6);
  const auto documentVolume = rpc({{"type", 30}, {"requestId", "closed-document-volume"},
                                   {"method", "measureVolume"}, {"params", Json::object()}});
  ASSERT_EQ(documentVolume["status"], "ok") << documentVolume;
  EXPECT_NEAR(documentVolume["result"]["volumeMm3"].get<double>(), 2000, 1e-6);
  const auto documentMass = rpc({{"type", 30}, {"requestId", "closed-document-mass"},
                                 {"method", "measureMassProperties"}, {"params", Json::object()}});
  ASSERT_EQ(documentMass["status"], "ok") << documentMass;
  EXPECT_NEAR(documentMass["result"]["volumeMm3"].get<double>(), 2000, 1e-6);
  ASSERT_TRUE(kreoda::CreateInstanceFeature("closed-solid-instance", "closed-solid",
                                             {30, 0, 0, 0, 0, 0}, &error)) << error;
  kreoda::ShapeRecord instance;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("closed-solid-instance", &instance));
  EXPECT_EQ(kreoda::FeatureGeometryKind(instance), kreoda::GeometryKind::Solid);

  const auto path = (std::filesystem::temp_directory_path() /
                     "kreoda-surface-sewn-solid.icad").generic_string();
  ASSERT_EQ(rpc({{"type", 10}, {"requestId", "sew-solid-save"}, {"path", path}})["status"], "ok");
  ASSERT_EQ(rpc({{"type", 2}, {"requestId", "sew-solid-reset"}})["status"], "ok");
  ASSERT_EQ(rpc({{"type", 11}, {"requestId", "sew-solid-open"}, {"path", path}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("closed-shell", &surface));
  EXPECT_EQ(surface.type, "SurfaceSew");
  EXPECT_EQ(kreoda::FeatureGeometryKind(surface), kreoda::GeometryKind::Surface);
  EXPECT_EQ(countShape(surface.shape, TopAbs_SOLID), 0);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("closed-solid", &solid));
  EXPECT_EQ(solid.type, "SurfaceSewnSolid");
  EXPECT_EQ(kreoda::FeatureGeometryKind(solid), kreoda::GeometryKind::Solid);
  EXPECT_EQ(countShape(solid.shape, TopAbs_SOLID), 1);
  EXPECT_NEAR(solid.volumeMm3, 2000, 1e-6);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("closed-solid-instance", &instance));
  EXPECT_EQ(instance.type, "Instance");
  EXPECT_EQ(kreoda::FeatureGeometryKind(instance), kreoda::GeometryKind::Solid);
  EXPECT_EQ(countShape(instance.shape, TopAbs_SOLID), 1);
  std::error_code ec;
  std::filesystem::remove(path, ec);
}

TEST(SurfaceSewOffset, SewSinglePeriodicTorusIntoAnalyticalSolid) {
  newDocument();
  kreoda::SketchModel circle;
  circle.points = {{"center", 0, 0, true}};
  circle.circles = {{"circle", "center", 5}};
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("torus-circle", "XY", circle, &error)) << error;
  const auto source = rpc({{"type", 49}, {"requestId", "torus-surface"},
                           {"featureId", "torus-surface"}, {"sketchId", "torus-circle"},
                           {"angleDeg", 360}, {"axisOriginXMm", 20},
                           {"axisX", 0}, {"axisY", 1}, {"axisZ", 0}});
  ASSERT_EQ(source["status"], "ok") << source;
  const auto result = sew("torus-solid", {"torus-surface"}, true);
  ASSERT_EQ(result["status"], "ok") << result;
  kreoda::ShapeRecord solid;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("torus-solid", &solid));
  EXPECT_EQ(solid.type, "SurfaceSewnSolid");
  EXPECT_EQ(countShape(solid.shape, TopAbs_SOLID), 1);
  EXPECT_NEAR(solid.volumeMm3, 2 * std::acos(-1.0) * std::acos(-1.0) * 20 * 25,
              1e-5);
  EXPECT_NEAR(area(solid.shape), 4 * std::acos(-1.0) * std::acos(-1.0) * 20 * 5,
              1e-5);
  EXPECT_TRUE(BRepCheck_Analyzer(solid.shape, true).IsValid());
}

TEST(SurfaceSewOffset, RejectsDuplicateDisjointSolidMissingAndNonManifoldInputsAtomically) {
  newDocument();
  std::string error;
  const auto xy = plane(0, 0, 0, {1, 0, 0}, {0, 1, 0}, {0, 0, 1});
  const auto yz = plane(0, 0, 0, {0, 0, 1}, {1, 0, 0}, {0, 1, 0});
  const auto diagonal = plane(0, 0, 0, {0, 0, 1},
                              {std::sqrt(0.5), -std::sqrt(0.5), 0},
                              {std::sqrt(0.5), std::sqrt(0.5), 0});
  const auto far = plane(100, 0, 0, {1, 0, 0}, {0, 1, 0}, {0, 0, 1});
  ASSERT_TRUE(createLineSketch("invalid-a-sketch", xy, 10, &error)) << error;
  ASSERT_TRUE(createLineSketch("invalid-b-sketch", yz, 10, &error)) << error;
  ASSERT_TRUE(createLineSketch("invalid-c-sketch", diagonal, 10, &error)) << error;
  ASSERT_TRUE(createLineSketch("invalid-far-sketch", far, 10, &error)) << error;
  ASSERT_TRUE(createLineSketch("free-wire-sketch", xy, 10, &error)) << error;
  ASSERT_EQ(extrude("invalid-a", "invalid-a-sketch")["status"], "ok");
  ASSERT_EQ(extrude("invalid-b", "invalid-b-sketch")["status"], "ok");
  ASSERT_EQ(extrude("invalid-c", "invalid-c-sketch")["status"], "ok");
  ASSERT_EQ(extrude("invalid-far", "invalid-far-sketch")["status"], "ok");
  ASSERT_EQ(extrude("free-wire-source", "free-wire-sketch")["status"], "ok");
  ASSERT_TRUE(kreoda::CreateBoxFeature("invalid-solid", 10, 10, 10, &error)) << error;

  kreoda::ShapeRecord freeWireSource;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("free-wire-source", &freeWireSource));
  BRep_Builder builder;
  TopoDS_Compound faceAndWire;
  builder.MakeCompound(faceAndWire);
  builder.Add(faceAndWire, freeWireSource.shape);
  builder.Add(faceAndWire,
              BRepBuilderAPI_MakeEdge(gp_Pnt(100, 0, 0), gp_Pnt(101, 0, 0)).Edge());
  freeWireSource.shape = faceAndWire;
  kreoda::ShapeStore::instance().put(freeWireSource);

  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  const auto registry = kreoda::DocumentStore::instance().snapshotRegistry();
  const auto freeWire = sew("reject-free-wire", {"free-wire-source"});
  EXPECT_EQ(freeWire["status"], "error") << freeWire;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("reject-free-wire"));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRegistry(), registry);
  const std::vector<std::pair<std::string, std::vector<std::string>>> invalid = {
      {"reject-duplicate", {"invalid-a", "invalid-a"}},
      {"reject-disjoint", {"invalid-a", "invalid-far"}},
      {"reject-solid", {"invalid-a", "invalid-solid"}},
      {"reject-missing", {"invalid-a", "does-not-exist"}},
      {"reject-nonmanifold", {"invalid-a", "invalid-b", "invalid-c"}},
  };
  for (const auto& item : invalid) {
    const auto result = sew(item.first, item.second);
    EXPECT_EQ(result["status"], "error") << item.first << ": " << result;
    EXPECT_FALSE(kreoda::ShapeStore::instance().contains(item.first));
    EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
    EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRegistry(), registry);
  }
  for (const auto& malformed : std::vector<Json>{
           {{"type", 51}, {"requestId", "bad-tolerance-type"},
            {"featureId", "bad-tolerance-type"}, {"featureIds", {"invalid-a"}},
            {"toleranceMm", "0.01"}},
           {{"type", 51}, {"requestId", "bad-mode-type"},
            {"featureId", "bad-mode-type"}, {"featureIds", {"invalid-a"}},
            {"makeSolid", "false"}},
           {{"type", 52}, {"requestId", "bad-offset-tolerance"},
            {"featureId", "bad-offset-tolerance"}, {"targetId", "invalid-a"},
            {"distanceMm", 1}, {"toleranceMm", "1e-6"}}}) {
    const auto response = rpc(malformed);
    EXPECT_EQ(response["status"], "error") << response;
    EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
    EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRegistry(), registry);
  }
}

TEST(SurfaceSewOffset, AcceptsDirectSurfaceInstanceAsInput) {
  newDocument();
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("instance-source-sketch", "XY",
                                           lineModel(), &error)) << error;
  ASSERT_EQ(extrude("instance-source", "instance-source-sketch")["status"], "ok");
  ASSERT_TRUE(kreoda::CreateInstanceFeature("instance-copy", "instance-source",
                                             {20, 0, 0, 0, 0, 0}, &error)) << error;
  const auto result = sew("instance-sew", {"instance-copy"});
  ASSERT_EQ(result["status"], "ok") << result;
  kreoda::ShapeRecord sewn;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("instance-sew", &sewn));
  EXPECT_EQ(sewn.type, "SurfaceSew");
  EXPECT_EQ(sewn.dependsOn, (std::vector<std::string>{"instance-copy"}));
  EXPECT_NEAR(sewn.bboxMm[0], 20, 1e-7);
  EXPECT_NEAR(sewn.bboxMm[3], 30, 1e-7);
  EXPECT_NEAR(area(sewn.shape), 100, 1e-7);
  EXPECT_EQ(countShape(sewn.shape, TopAbs_SOLID), 0);
}

TEST(SurfaceSewOffset, PlanarAndMultiFaceOffsetsFollowOrientedNormalsExactly) {
  newDocument();
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("plane-offset-sketch", "XY",
                                           lineModel(), &error)) << error;
  ASSERT_EQ(extrude("plane-offset-source", "plane-offset-sketch", 10)["status"], "ok");
  kreoda::SketchModel multi;
  multi.points = {{"a", 0, 0, true}, {"b", 10, 0, true},
                  {"c", 0, 20, true}, {"d", 10, 20, true}};
  multi.lines = {{"first", "a", "b"}, {"second", "c", "d"}};
  ASSERT_TRUE(kreoda::CreateSketchFeature("multi-offset-sketch", "XY", multi, &error)) << error;
  ASSERT_EQ(extrude("multi-offset-source", "multi-offset-sketch", 10)["status"], "ok");

  kreoda::ShapeRecord planar, multiFace;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("plane-offset-source", &planar));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("multi-offset-source", &multiFace));
  const gp_Vec planarNormal = normal(planar.shape);
  const gp_Vec multiNormal = normal(multiFace.shape);
  ASSERT_EQ(countShape(multiFace.shape, TopAbs_FACE), 2);

  ASSERT_EQ(offset("plane-positive", "plane-offset-source", 2)["status"], "ok");
  ASSERT_EQ(offset("plane-negative", "plane-offset-source", -2)["status"], "ok");
  const auto multiPositiveResult = offset("multi-positive", "multi-offset-source", 1);
  ASSERT_EQ(multiPositiveResult["status"], "ok") << multiPositiveResult;
  const auto multiNegativeResult = offset("multi-negative", "multi-offset-source", -1);
  ASSERT_EQ(multiNegativeResult["status"], "ok") << multiNegativeResult;
  kreoda::ShapeRecord positive, negative, multiPositive, multiNegative;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("plane-positive", &positive));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("plane-negative", &negative));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("multi-positive", &multiPositive));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("multi-negative", &multiNegative));

  const auto sourceCenter = bboxCenter(planar);
  const auto positiveCenter = bboxCenter(positive);
  const auto negativeCenter = bboxCenter(negative);
  for (int axis = 0; axis < 3; ++axis) {
    EXPECT_NEAR(positiveCenter[axis] - sourceCenter[axis],
                2 * planarNormal.Coord(axis + 1), 1e-6);
    EXPECT_NEAR(negativeCenter[axis] - sourceCenter[axis],
                -2 * planarNormal.Coord(axis + 1), 1e-6);
  }
  EXPECT_EQ(countShape(positive.shape, TopAbs_SOLID), 0);
  EXPECT_EQ(countShape(negative.shape, TopAbs_SOLID), 0);
  EXPECT_NEAR(area(positive.shape), 100, 1e-7);
  EXPECT_NEAR(area(negative.shape), 100, 1e-7);
  EXPECT_NEAR(positive.bboxMm[0], planar.bboxMm[0], 1e-7);
  EXPECT_NEAR(positive.bboxMm[3], planar.bboxMm[3], 1e-7);
  EXPECT_DOUBLE_EQ(positive.volumeMm3, 0);
  EXPECT_DOUBLE_EQ(negative.volumeMm3, 0);

  EXPECT_EQ(countShape(multiPositive.shape, TopAbs_FACE), 2);
  EXPECT_EQ(countShape(multiNegative.shape, TopAbs_FACE), 2);
  EXPECT_EQ(countShape(multiPositive.shape, TopAbs_SOLID), 0);
  EXPECT_EQ(countShape(multiNegative.shape, TopAbs_SOLID), 0);
  EXPECT_NEAR(area(multiPositive.shape), 200, 1e-7);
  EXPECT_NEAR(area(multiNegative.shape), 200, 1e-7);
  const auto multiSourceCenter = bboxCenter(multiFace);
  const auto multiPositiveCenter = bboxCenter(multiPositive);
  const auto multiNegativeCenter = bboxCenter(multiNegative);
  for (int axis = 0; axis < 3; ++axis) {
    EXPECT_NEAR(multiPositiveCenter[axis] - multiSourceCenter[axis],
                multiNormal.Coord(axis + 1), 1e-6);
    EXPECT_NEAR(multiNegativeCenter[axis] - multiSourceCenter[axis],
                -multiNormal.Coord(axis + 1), 1e-6);
  }
  EXPECT_DOUBLE_EQ(multiPositive.volumeMm3, 0);
  EXPECT_DOUBLE_EQ(multiNegative.volumeMm3, 0);
  EXPECT_TRUE(BRepCheck_Analyzer(multiPositive.shape, true).IsValid());
  EXPECT_TRUE(BRepCheck_Analyzer(multiNegative.shape, true).IsValid());
}

TEST(SurfaceSewOffset, NumericAndUpstreamEditsUndoRedoAndIcADReopen) {
  newDocument();
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("edit-offset-sketch", "XY",
                                           lineModel(), &error)) << error;
  ASSERT_EQ(extrude("edit-offset-source", "edit-offset-sketch", 10)["status"], "ok");
  ASSERT_EQ(offset("edit-offset", "edit-offset-source", 2)["status"], "ok");

  ASSERT_TRUE(kreoda::RebuildFeature("edit-offset-source", "distanceMm", 20, &error)) << error;
  kreoda::ShapeRecord offsetRecord;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("edit-offset", &offsetRecord));
  EXPECT_NEAR(area(offsetRecord.shape), 200, 1e-7);
  EXPECT_EQ(offsetRecord.paramsMm, (std::vector<double>{2, 1e-6}));

  ASSERT_TRUE(kreoda::RebuildFeature("edit-offset", "distanceMm", 3, &error)) << error;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("edit-offset", &offsetRecord));
  EXPECT_EQ(offsetRecord.paramsMm, (std::vector<double>{3, 1e-6}));
  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  const TopoDS_Shape beforeFailedEdit = offsetRecord.shape;
  EXPECT_FALSE(kreoda::RebuildFeature("edit-offset", "distanceMm", 0, &error));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("edit-offset", &offsetRecord));
  EXPECT_TRUE(offsetRecord.shape.IsSame(beforeFailedEdit));
  EXPECT_EQ(offsetRecord.paramsMm, (std::vector<double>{3, 1e-6}));

  ASSERT_EQ(rpc({{"type", 8}, {"requestId", "offset-undo"}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("edit-offset", &offsetRecord));
  EXPECT_EQ(offsetRecord.paramsMm, (std::vector<double>{2, 1e-6}));
  ASSERT_EQ(rpc({{"type", 9}, {"requestId", "offset-redo"}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("edit-offset", &offsetRecord));
  EXPECT_EQ(offsetRecord.paramsMm, (std::vector<double>{3, 1e-6}));

  ASSERT_TRUE(kreoda::CreateInstanceFeature("edit-offset-instance", "edit-offset",
                                             {20, 0, 0, 0, 0, 0}, &error)) << error;
  kreoda::ShapeRecord instance;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("edit-offset-instance", &instance));
  EXPECT_EQ(kreoda::FeatureGeometryKind(instance), kreoda::GeometryKind::Surface);
  EXPECT_EQ(countShape(instance.shape, TopAbs_SOLID), 0);
  EXPECT_DOUBLE_EQ(instance.volumeMm3, 0);

  const auto path = (std::filesystem::temp_directory_path() /
                     "kreoda-surface-sew-offset.icad").generic_string();
  ASSERT_EQ(rpc({{"type", 10}, {"requestId", "offset-save"}, {"path", path}})["status"], "ok");
  ASSERT_EQ(rpc({{"type", 2}, {"requestId", "offset-reset"}})["status"], "ok");
  ASSERT_EQ(rpc({{"type", 11}, {"requestId", "offset-open"}, {"path", path}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("edit-offset", &offsetRecord));
  EXPECT_EQ(offsetRecord.type, "SurfaceOffset");
  EXPECT_EQ(offsetRecord.paramsMm, (std::vector<double>{3, 1e-6}));
  EXPECT_EQ(offsetRecord.dependsOn, (std::vector<std::string>{"edit-offset-source"}));
  EXPECT_NEAR(area(offsetRecord.shape), 200, 1e-7);
  EXPECT_DOUBLE_EQ(offsetRecord.volumeMm3, 0);
  EXPECT_EQ(countShape(offsetRecord.shape, TopAbs_SOLID), 0);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("edit-offset-instance", &instance));
  EXPECT_EQ(instance.type, "Instance");
  EXPECT_EQ(kreoda::FeatureGeometryKind(instance), kreoda::GeometryKind::Surface);
  EXPECT_EQ(countShape(instance.shape, TopAbs_SOLID), 0);
  const auto mesh = kreoda::TessellateFeature("edit-offset", 1, &error);
  EXPECT_DOUBLE_EQ(mesh.volumeMm3, 0);
  std::error_code ec;
  std::filesystem::remove(path, ec);
}

TEST(SurfaceSewOffset, SignedExactCylinderOffsetsAndCollapseAreAtomic) {
  newDocument();
  kreoda::SketchModel circle;
  circle.points = {{"center", 0, 0, true}};
  circle.circles = {{"circle", "center", 5}};
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("cylinder-circle", "XY", circle, &error)) << error;
  ASSERT_EQ(extrude("cylinder-surface", "cylinder-circle", 20)["status"], "ok");
  kreoda::ShapeRecord sourceCylinder;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("cylinder-surface", &sourceCylinder));
  const auto sourcePointNormal = midpointAndNormal(sourceCylinder.shape);
  const double radialNormalDot = sourcePointNormal.second.X() * sourcePointNormal.first.X() +
                                 sourcePointNormal.second.Y() * sourcePointNormal.first.Y();
  ASSERT_GT(std::abs(radialNormalDot), 0.99);
  const double sourceNormalSign = radialNormalDot > 0 ? 1.0 : -1.0;
  const double positiveRadius = 5 + 2 * sourceNormalSign;
  const double negativeRadius = 5 - 2 * sourceNormalSign;

  const auto positiveOffset = rpc({{"type", 52}, {"requestId", "cylinder-positive"},
                            {"featureId", "cylinder-positive"},
                            {"targetId", "cylinder-surface"}, {"distanceMm", 2}});
  ASSERT_EQ(positiveOffset["status"], "ok") << positiveOffset;
  kreoda::ShapeRecord positive;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("cylinder-positive", &positive));
  EXPECT_EQ(positive.type, "SurfaceOffset");
  EXPECT_EQ(positive.paramsMm, (std::vector<double>{2, 1e-6}));
  EXPECT_EQ(positive.dependsOn, (std::vector<std::string>{"cylinder-surface"}));
  EXPECT_EQ(countShape(positive.shape, TopAbs_FACE), 1);
  EXPECT_EQ(countShape(positive.shape, TopAbs_SOLID), 0);
  EXPECT_DOUBLE_EQ(positive.volumeMm3, 0);
  EXPECT_NEAR(positive.bboxMm[0], -positiveRadius, 1e-6);
  EXPECT_NEAR(positive.bboxMm[3], positiveRadius, 1e-6);
  EXPECT_NEAR(positive.bboxMm[1], -positiveRadius, 1e-6);
  EXPECT_NEAR(positive.bboxMm[4], positiveRadius, 1e-6);
  EXPECT_NEAR(positive.bboxMm[2], 0, 1e-6);
  EXPECT_NEAR(positive.bboxMm[5], 20, 1e-6);
  EXPECT_NEAR(area(positive.shape), 2 * std::acos(-1.0) * positiveRadius * 20, 1e-5);
  EXPECT_TRUE(BRepCheck_Analyzer(positive.shape, true).IsValid());
  EXPECT_DOUBLE_EQ(kreoda::TessellateFeature("cylinder-positive", 1, &error).volumeMm3, 0);

  const auto negativeOffset = offset("cylinder-negative", "cylinder-surface", -2);
  ASSERT_EQ(negativeOffset["status"], "ok") << negativeOffset;
  kreoda::ShapeRecord negative;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("cylinder-negative", &negative));
  EXPECT_NEAR(negative.bboxMm[0], -negativeRadius, 1e-6);
  EXPECT_NEAR(negative.bboxMm[3], negativeRadius, 1e-6);
  EXPECT_NEAR(area(negative.shape), 2 * std::acos(-1.0) * negativeRadius * 20, 1e-5);
  EXPECT_DOUBLE_EQ(negative.volumeMm3, 0);

  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  const auto registry = kreoda::DocumentStore::instance().snapshotRegistry();
  const auto collapsed = offset("cylinder-collapse", "cylinder-surface", 5);
  EXPECT_EQ(collapsed["status"], "error") << collapsed;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("cylinder-collapse"));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRegistry(), registry);
}

#else
TEST(SurfaceSewOffset, RequiresOcct) {
  GTEST_SKIP() << "surface sewing and offsets require OCCT";
}
#endif
