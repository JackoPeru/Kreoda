#include <gtest/gtest.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <filesystem>

#include "document/document_store.h"
#include "features/instance/instance.h"
#include "features/primitives/primitives.h"
#include "features/sketch/sketch_commands.h"
#include "features/sketch/sketch_json.h"
#include "features/sketch/sketch_store.h"
#include "model/shapes.h"
#include "model/geometry_kind.h"
#include "protocol/dispatcher.h"
#include "protocol/json_fields.h"
#include "tessellation/mesh.h"

#if KREODA_WITH_OCCT
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <gp_Pnt.hxx>
#endif

#if KREODA_WITH_OCCT
namespace {
using kreoda::Json;

Json rpc(Json request) {
  request["protocolVersion"] = 1;
  request["documentId"] = "surface-sweep-doc";
  request["requestId"] = "surface-sweep";
  const auto bytes = kreoda::handle_command(request.dump());
  return Json::parse(bytes.begin(), bytes.end());
}

void newDocument() {
  kreoda::DocumentStore::instance().create("surface-sweep-doc");
}

kreoda::SketchModel lineModel(double length) {
  kreoda::SketchModel model;
  model.points = {{"a", 0, 0, true}, {"b", length, 0, true}};
  model.lines = {{"edge", "a", "b"}};
  return model;
}

kreoda::SketchModel zPathModel(double length) {
  kreoda::SketchModel model;
  model.points = {{"a", 0, 0, true}, {"b", 0, length, true}};
  model.lines = {{"edge", "a", "b"}};
  return model;
}

kreoda::SketchModel quarterPathModel() {
  kreoda::SketchModel model;
  model.points = {{"center", 0, 20, true}};
  model.arcs = {{"arc", "center", 20, -std::acos(-1.0) / 2, 0}};
  return model;
}

kreoda::SketchModel circleModel(double radius) {
  kreoda::SketchModel model;
  model.points = {{"center", 0, 0, true}};
  model.circles = {{"circle", "center", radius}};
  return model;
}

kreoda::SketchModel disconnectedLines(size_t count) {
  kreoda::SketchModel model;
  model.points.reserve(count * 2);
  model.lines.reserve(count);
  for (size_t i = 0; i < count; ++i) {
    const auto suffix = std::to_string(i);
    const auto x = static_cast<double>(i) * 3;
    model.points.push_back({"a" + suffix, x, 0, true});
    model.points.push_back({"b" + suffix, x + 1, 0, true});
    model.lines.push_back({"edge" + suffix, "a" + suffix, "b" + suffix});
  }
  return model;
}

kreoda::SketchPlane zPathPlane() {
  kreoda::SketchPlane plane;
  plane.yAxis[0] = 0;
  plane.yAxis[1] = 0;
  plane.yAxis[2] = 1;
  plane.normal[0] = 0;
  plane.normal[1] = -1;
  plane.normal[2] = 0;
  return plane;
}

kreoda::SketchPlane frame(double ox, double oy, double oz,
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

Json sweep(const std::string& featureId, const std::string& profileId,
           const std::string& pathId, Json extra = Json::object()) {
  Json request = {{"type", 53}, {"featureId", featureId},
                  {"profileSketchId", profileId}, {"pathSketchId", pathId}};
  request.update(extra);
  return rpc(std::move(request));
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
}  // namespace

TEST(SurfaceSweep, StraightLineAndCircleProduceExactUncappedSurfaces) {
  newDocument();
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("line-profile", "XY", lineModel(10),
                                           &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("z-path", "XZ", zPathModel(20),
                                           zPathPlane(), &error)) << error;

  const auto line = sweep("line-sweep", "line-profile", "z-path");
  ASSERT_EQ(line["status"], "ok") << line;
  EXPECT_FALSE(line.contains("volumeMm3"));
  kreoda::ShapeRecord record;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("line-sweep", &record));
  EXPECT_EQ(record.type, "SurfaceSweep");
  EXPECT_EQ(record.paramsMm, (std::vector<double>{1e-6}));
  EXPECT_EQ(record.dependsOn,
            (std::vector<std::string>{"line-profile", "z-path"}));
  EXPECT_DOUBLE_EQ(record.volumeMm3, 0);
  EXPECT_EQ(countShape(record.shape, TopAbs_SOLID), 0);
  EXPECT_NEAR(area(record.shape), 200, 1e-7);
  const double lineBounds[] = {0, 0, 0, 10, 0, 20};
  for (int i = 0; i < 6; ++i) EXPECT_NEAR(record.bboxMm[i], lineBounds[i], 2e-7);

  ASSERT_TRUE(kreoda::CreateSketchFeature("circle-profile", "XY", circleModel(2),
                                           &error)) << error;
  const auto circle = sweep("circle-sweep", "circle-profile", "z-path");
  ASSERT_EQ(circle["status"], "ok") << circle;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("circle-sweep", &record));
  EXPECT_EQ(countShape(record.shape, TopAbs_SOLID), 0);
  EXPECT_NEAR(area(record.shape), 80 * std::acos(-1.0), 1e-7);
  const double circleBounds[] = {-2, -2, 0, 2, 2, 20};
  for (int i = 0; i < 6; ++i) EXPECT_NEAR(record.bboxMm[i], circleBounds[i], 2e-7);
}

TEST(SurfaceSweep, QuarterArcAndClosedCircleKeepAnalyticShellGeometry) {
  newDocument();
  std::string error;
  const auto yz = frame(0, 0, 0, {0, 1, 0}, {0, 0, 1}, {1, 0, 0});
  ASSERT_TRUE(kreoda::CreateSketchFeature("quarter-profile", "YZ", circleModel(2),
                                           yz, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("quarter-path", "XY", quarterPathModel(),
                                           &error)) << error;
  const auto quarter = sweep("quarter-sweep", "quarter-profile", "quarter-path");
  ASSERT_EQ(quarter["status"], "ok") << quarter;
  kreoda::ShapeRecord record;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("quarter-sweep", &record));
  EXPECT_EQ(countShape(record.shape, TopAbs_SOLID), 0);
  EXPECT_NEAR(area(record.shape), 40 * std::pow(std::acos(-1.0), 2), 1e-6);
  const double quarterBounds[] = {0, -2, -2, 22, 20, 2};
  for (int i = 0; i < 6; ++i) EXPECT_NEAR(record.bboxMm[i], quarterBounds[i], 2e-6);

  const auto pathPlane = frame(0, 0, 0, {1, 0, 0}, {0, 1, 0}, {0, 0, 1});
  const auto sectionPlane = frame(20, 0, 0, {0, 0, 1}, {1, 0, 0}, {0, 1, 0});
  ASSERT_TRUE(kreoda::CreateSketchFeature("torus-path", "XY", circleModel(20),
                                           pathPlane, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("torus-profile", "XZ", circleModel(2),
                                           sectionPlane, &error)) << error;
  const auto torus = sweep("torus-sweep", "torus-profile", "torus-path");
  ASSERT_EQ(torus["status"], "ok") << torus;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("torus-sweep", &record));
  EXPECT_EQ(countShape(record.shape, TopAbs_SOLID), 0);
  EXPECT_DOUBLE_EQ(record.volumeMm3, 0);
  EXPECT_NEAR(area(record.shape), 160 * std::pow(std::acos(-1.0), 2), 1e-5);
}

TEST(SurfaceSweep, IncludesEveryProfileWireAcrossRightCornerPath) {
  newDocument();
  std::string error;
  kreoda::SketchModel profiles;
  profiles.points = {{"a", 0, 0, true}, {"b", 10, 0, true},
                     {"c", 0, 5, true}, {"d", 5, 5, true}};
  profiles.lines = {{"profile-a", "a", "b"}, {"profile-b", "c", "d"}};
  kreoda::SketchModel path;
  path.points = {{"p0", 0, 0, true}, {"p1", 0, 20, true},
                 {"p2", 20, 20, true}};
  path.lines = {{"path-a", "p0", "p1"}, {"path-b", "p1", "p2"}};
  ASSERT_TRUE(kreoda::CreateSketchFeature("corner-profiles", "XY", profiles,
                                           &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("corner-path", "XZ", path,
                                           zPathPlane(), &error)) << error;
  const auto created = sweep("corner-sweep", "corner-profiles", "corner-path");
  ASSERT_EQ(created["status"], "ok") << created;
  kreoda::ShapeRecord record;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("corner-sweep", &record));
  EXPECT_EQ(countShape(record.shape, TopAbs_SOLID), 0);
  EXPECT_EQ(countShape(record.shape, TopAbs_FACE), 4);
  EXPECT_NEAR(area(record.shape), 475, 1e-7);
}

TEST(SurfaceSweep, RejectsMisalignedProfileWithoutAllocatingFeature) {
  newDocument();
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("misaligned-profile", "XZ", lineModel(10),
                                           &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("z-path", "XZ", zPathModel(20),
                                           zPathPlane(), &error)) << error;
  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  const auto registry = kreoda::DocumentStore::instance().snapshotRegistry();
  const auto rejected = sweep("misaligned-sweep", "misaligned-profile", "z-path");
  EXPECT_EQ(rejected["status"], "error") << rejected;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("misaligned-sweep"));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRegistry(), registry);
}

TEST(SurfaceSweep, StrictParametersRejectInvalidAndUnknownFieldsAtomically) {
  newDocument();
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("profile", "XY", lineModel(10), &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("path", "XZ", zPathModel(20),
                                           zPathPlane(), &error)) << error;
  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  for (const auto& extra : {Json{{"toleranceMm", 0}}, Json{{"toleranceMm", 1.1}},
                            Json{{"unsupported", true}},
                            Json{{"profileSketchId", 7}},
                            Json{{"profileSketchId", "bad:id"}},
                            Json{{"pathSketchId", ""}},
                            Json{{"pathSketchId", nullptr}},
                            Json{{"featureId", "invalid:id"}}}) {
    EXPECT_EQ(sweep("rejected-sweep", "profile", "path", extra)["status"], "error");
    EXPECT_FALSE(kreoda::ShapeStore::instance().contains("rejected-sweep"));
    EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
  }
  EXPECT_EQ(sweep("same-sketch", "profile", "profile")["status"], "error");
  EXPECT_EQ(sweep("missing-sketch", "missing-profile", "path")["status"], "error");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("missing-sketch"));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
}

TEST(SurfaceSweep, ReorderedEntitiesExcludeConstructionAndPreserveSources) {
  newDocument();
  std::string error;
  kreoda::SketchModel profileA;
  profileA.points = {{"a", 0, 0, true}, {"b", 10, 0, true},
                     {"construction-a", 0, 100, true}, {"construction-b", 5, 100, true}};
  profileA.lines = {{"profile", "a", "b"}, {"construction", "construction-a", "construction-b"}};
  profileA.constructionIds = {"construction"};
  auto profileB = profileA;
  std::reverse(profileB.points.begin(), profileB.points.end());
  std::reverse(profileB.lines.begin(), profileB.lines.end());

  kreoda::SketchModel pathA;
  pathA.points = {{"p0", 0, 0, true}, {"p1", 0, 20, true}, {"p2", 20, 20, true},
                  {"construction-a", 30, 30, true}, {"construction-b", 35, 30, true}};
  pathA.lines = {{"path-a", "p0", "p1"}, {"path-b", "p1", "p2"},
                 {"construction", "construction-a", "construction-b"}};
  pathA.constructionIds = {"construction"};
  auto pathB = pathA;
  std::reverse(pathB.points.begin(), pathB.points.end());
  std::reverse(pathB.lines.begin(), pathB.lines.end());

  ASSERT_TRUE(kreoda::CreateSketchFeature("profile-a", "XY", profileA, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("profile-b", "XY", profileB, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("path-a", "XZ", pathA, zPathPlane(), &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("path-b", "XZ", pathB, zPathPlane(), &error)) << error;
  kreoda::SketchFeature source;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("profile-a", &source));
  const auto profileSourceBefore = kreoda::SerializeSketchFeature(source);
  ASSERT_TRUE(kreoda::SketchStore::instance().get("path-a", &source));
  const auto pathSourceBefore = kreoda::SerializeSketchFeature(source);

  ASSERT_EQ(sweep("ordered-a", "profile-a", "path-a")["status"], "ok");
  ASSERT_EQ(sweep("ordered-b", "profile-b", "path-b")["status"], "ok");
  kreoda::ShapeRecord first, second;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("ordered-a", &first));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("ordered-b", &second));
  EXPECT_NEAR(area(first.shape), area(second.shape), 1e-8);
  for (int i = 0; i < 6; ++i) EXPECT_NEAR(first.bboxMm[i], second.bboxMm[i], 1e-8);
  EXPECT_NEAR(area(first.shape), 300, 1e-7);
  EXPECT_EQ(countShape(first.shape, TopAbs_SOLID), 0);
  ASSERT_TRUE(kreoda::SketchStore::instance().get("profile-a", &source));
  EXPECT_EQ(kreoda::SerializeSketchFeature(source), profileSourceBefore);
  ASSERT_TRUE(kreoda::SketchStore::instance().get("path-a", &source));
  EXPECT_EQ(kreoda::SerializeSketchFeature(source), pathSourceBefore);
}

TEST(SurfaceSweep, SupportsNonAxisAlignedWorldSketchFrames) {
  newDocument();
  std::string error;
  const double root5 = std::sqrt(5.0);
  const std::array<double, 3> x{2 / root5, -1 / root5, 0};
  const std::array<double, 3> tangent{1.0 / 3, 2.0 / 3, 2.0 / 3};
  const std::array<double, 3> normal{-2 / (3 * root5), -4 / (3 * root5), 5 / (3 * root5)};
  const std::array<double, 3> profileY{2 / (3 * root5), 4 / (3 * root5), -5 / (3 * root5)};
  const auto profileFrame = frame(100, -25, 40, x, profileY, tangent);
  const auto pathFrame = frame(100, -25, 40, x, tangent, normal);
  ASSERT_TRUE(kreoda::CreateSketchFeature("world-profile", "XY", lineModel(10),
                                           profileFrame, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("world-path", "XZ", zPathModel(20),
                                           pathFrame, &error)) << error;
  ASSERT_EQ(sweep("world-sweep", "world-profile", "world-path")["status"], "ok");
  kreoda::ShapeRecord record;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("world-sweep", &record));
  EXPECT_NEAR(area(record.shape), 200, 1e-7);
  EXPECT_EQ(countShape(record.shape, TopAbs_SOLID), 0);
  const double expectedBounds[] = {100, -25 - 10 / root5, 40,
                                   100 + 20.0 / 3 + 20 / root5,
                                   -25 + 40.0 / 3, 40 + 40.0 / 3};
  for (int i = 0; i < 6; ++i) EXPECT_NEAR(record.bboxMm[i], expectedBounds[i], 2e-6);
}

TEST(SurfaceSweep, RejectsEmptyBranchedDisconnectedAndStalePathInputsAtomically) {
  newDocument();
  std::string error;
  const auto profileFrame = frame(0, 0, 0, {0, 1, 0}, {0, 0, 1}, {1, 0, 0});
  ASSERT_TRUE(kreoda::CreateSketchFeature("branch-profile", "YZ", lineModel(2),
                                           profileFrame, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("collapsed-profile", "XY", lineModel(10),
                                           &error)) << error;

  kreoda::SketchModel branched;
  branched.points = {{"p0", 0, 0, true}, {"p1", 10, 0, true},
                     {"p2", 20, 0, true}, {"p3", 10, 10, true}};
  branched.lines = {{"a", "p0", "p1"}, {"b", "p1", "p2"}, {"c", "p1", "p3"}};
  kreoda::SketchModel disconnected;
  disconnected.points = {{"p0", 0, 0, true}, {"p1", 10, 0, true},
                         {"p2", 20, 0, true}, {"p3", 30, 0, true}};
  disconnected.lines = {{"a", "p0", "p1"}, {"b", "p2", "p3"}};
  ASSERT_TRUE(kreoda::CreateSketchFeature("branch-path", "XY", branched, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("disconnected-path", "XY", disconnected, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("empty-path", "XY", {}, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("empty-profile", "XY", {}, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("stale-path", "XY", lineModel(10), &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("tiny-path", "XZ", lineModel(1e-8),
                                           zPathPlane(), &error)) << error;
  kreoda::SketchFeature stale;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("stale-path", &stale));
  kreoda::SketchProjectionGroup broken;
  broken.groupId = "old-projection";
  broken.status = "broken";
  broken.error = "source revision changed";
  stale.projectionGroups.push_back(broken);
  kreoda::SketchStore::instance().put(stale);

  kreoda::SketchModel crossing;
  crossing.points = {{"p0", 0, 0, true}, {"p1", 20, 20, true},
                     {"p2", 0, 20, true}, {"p3", 20, 0, true}};
  crossing.lines = {{"a", "p0", "p1"}, {"b", "p1", "p2"}, {"c", "p2", "p3"}};
  const double invSqrt2 = 1 / std::sqrt(2.0);
  const auto crossingProfileFrame = frame(0, 0, 0, {invSqrt2, -invSqrt2, 0},
                                          {0, 0, -1}, {invSqrt2, invSqrt2, 0});
  ASSERT_TRUE(kreoda::CreateSketchFeature("crossing-profile", "XY", circleModel(2),
                                           crossingProfileFrame, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("crossing-path", "XY", crossing, &error)) << error;

  kreoda::SketchModel corner;
  corner.points = {{"p0", 0, 0, true}, {"p1", 0, 10, true}, {"p2", 10, 10, true}};
  corner.lines = {{"a", "p0", "p1"}, {"b", "p1", "p2"}};
  ASSERT_TRUE(kreoda::CreateSketchFeature("collapsed-path", "XZ", corner,
                                           zPathPlane(), &error)) << error;

  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  const std::array<std::array<std::string, 2>, 7> invalidInputs{{
           {"branch-profile", "branch-path"}, {"branch-profile", "disconnected-path"},
           {"branch-profile", "empty-path"}, {"empty-profile", "branch-path"},
           {"branch-profile", "stale-path"}, {"branch-profile", "tiny-path"},
           {"crossing-profile", "crossing-path"}}};
  for (const auto& ids : invalidInputs) {
    const auto rejected = sweep("rejected-path", ids[0], ids[1]);
    EXPECT_EQ(rejected["status"], "error") << rejected;
    EXPECT_FALSE(kreoda::ShapeStore::instance().contains("rejected-path"));
    EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
  }
  const auto collapsed = sweep("collapsed-sweep", "collapsed-profile", "collapsed-path");
  EXPECT_EQ(collapsed["status"], "error") << collapsed;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("collapsed-sweep"));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
}

TEST(SurfaceSweep, RawEdgeAndProfilePathProductBudgetsRejectBeforeWireAssembly) {
  newDocument();
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("limited-profile", "XY", lineModel(10), &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("limited-path", "XZ", zPathModel(20),
                                           zPathPlane(), &error)) << error;
  kreoda::SketchFeature limited;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("limited-profile", &limited));
  kreoda::SketchProjectionGroup large;
  large.groupId = "large-projection";
  BRepBuilderAPI_MakeEdge extraEdge(gp_Pnt(50, 0, 0), gp_Pnt(51, 0, 0));
  ASSERT_TRUE(extraEdge.IsDone());
  large.evaluatedEdges.assign(4096, extraEdge.Edge());
  limited.projectionGroups.push_back(std::move(large));
  kreoda::SketchStore::instance().put(limited);
  auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  auto rejected = sweep("edge-budget-sweep", "limited-profile", "limited-path");
  EXPECT_EQ(rejected["status"], "error") << rejected;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("edge-budget-sweep"));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);

  newDocument();
  ASSERT_TRUE(kreoda::CreateSketchFeature("many-profiles", "XY", disconnectedLines(257), &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("many-paths", "XY", disconnectedLines(257), &error)) << error;
  revision = kreoda::DocumentStore::instance().snapshotRevision();
  rejected = sweep("product-budget-sweep", "many-profiles", "many-paths");
  EXPECT_EQ(rejected["status"], "error") << rejected;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("product-budget-sweep"));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);

  newDocument();
  ASSERT_TRUE(kreoda::CreateSketchFeature("too-many-profiles", "XY", disconnectedLines(129), &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("one-path", "XZ", zPathModel(20),
                                           zPathPlane(), &error)) << error;
  revision = kreoda::DocumentStore::instance().snapshotRevision();
  rejected = sweep("profile-count-sweep", "too-many-profiles", "one-path");
  EXPECT_EQ(rejected["status"], "error") << rejected;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("profile-count-sweep"));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
}

TEST(SurfaceSweep, UpstreamAndToleranceEditsUndoRedoInstanceAndIcADReopen) {
  newDocument();
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("lifecycle-profile", "XY", lineModel(10), &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("lifecycle-path", "XZ", zPathModel(20),
                                           zPathPlane(), &error)) << error;
  ASSERT_EQ(sweep("lifecycle-sweep", "lifecycle-profile", "lifecycle-path")["status"], "ok");

  ASSERT_TRUE(kreoda::UpdateSketchFeature("lifecycle-path", zPathModel(30), &error)) << error;
  kreoda::ShapeRecord record;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("lifecycle-sweep", &record));
  EXPECT_NEAR(area(record.shape), 300, 1e-7);
  ASSERT_TRUE(kreoda::UpdateSketchFeature("lifecycle-profile", lineModel(12), &error)) << error;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("lifecycle-sweep", &record));
  EXPECT_NEAR(area(record.shape), 360, 1e-7);

  ASSERT_TRUE(kreoda::RebuildFeature("lifecycle-sweep", "toleranceMm", 0.002, &error)) << error;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("lifecycle-sweep", &record));
  EXPECT_EQ(record.paramsMm, (std::vector<double>{0.002}));
  EXPECT_NEAR(area(record.shape), 360, 1e-7);
  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  const auto priorShape = record.shape;
  EXPECT_FALSE(kreoda::RebuildFeature("lifecycle-sweep", "toleranceMm", 0, &error));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("lifecycle-sweep", &record));
  EXPECT_TRUE(record.shape.IsSame(priorShape));
  EXPECT_EQ(record.paramsMm, (std::vector<double>{0.002}));

  ASSERT_EQ(rpc({{"type", 8}, {"requestId", "sweep-undo"}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("lifecycle-sweep", &record));
  EXPECT_EQ(record.paramsMm, (std::vector<double>{1e-6}));
  ASSERT_EQ(rpc({{"type", 9}, {"requestId", "sweep-redo"}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("lifecycle-sweep", &record));
  EXPECT_EQ(record.paramsMm, (std::vector<double>{0.002}));

  ASSERT_TRUE(kreoda::CreateInstanceFeature("lifecycle-instance", "lifecycle-sweep",
                                             {20, 0, 0, 0, 0, 0}, &error)) << error;
  kreoda::ShapeRecord instance;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("lifecycle-instance", &instance));
  EXPECT_EQ(kreoda::FeatureGeometryKind(instance), kreoda::GeometryKind::Surface);
  EXPECT_EQ(countShape(instance.shape, TopAbs_SOLID), 0);
  EXPECT_DOUBLE_EQ(instance.volumeMm3, 0);
  EXPECT_DOUBLE_EQ(kreoda::TessellateFeature("lifecycle-sweep", 1, &error).volumeMm3, 0);

  const auto path = (std::filesystem::temp_directory_path() / "kreoda-surface-sweep-lifecycle.icad").generic_string();
  ASSERT_EQ(rpc({{"type", 10}, {"requestId", "sweep-save"}, {"path", path}})["status"], "ok");
  ASSERT_EQ(rpc({{"type", 2}, {"requestId", "sweep-reset"}})["status"], "ok");
  ASSERT_EQ(rpc({{"type", 11}, {"requestId", "sweep-open"}, {"path", path}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("lifecycle-sweep", &record));
  EXPECT_EQ(record.type, "SurfaceSweep");
  EXPECT_EQ(record.paramsMm, (std::vector<double>{0.002}));
  EXPECT_EQ(record.dependsOn, (std::vector<std::string>{"lifecycle-profile", "lifecycle-path"}));
  EXPECT_NEAR(area(record.shape), 360, 1e-7);
  EXPECT_EQ(countShape(record.shape, TopAbs_SOLID), 0);
  EXPECT_DOUBLE_EQ(record.volumeMm3, 0);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("lifecycle-instance", &instance));
  EXPECT_EQ(kreoda::FeatureGeometryKind(instance), kreoda::GeometryKind::Surface);
  EXPECT_EQ(countShape(instance.shape, TopAbs_SOLID), 0);
  EXPECT_DOUBLE_EQ(instance.volumeMm3, 0);
  std::error_code ec;
  std::filesystem::remove(path, ec);
}
#endif
