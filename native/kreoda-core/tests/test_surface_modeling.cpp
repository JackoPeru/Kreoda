#include <gtest/gtest.h>

#include <cmath>
#include <algorithm>
#include <filesystem>
#include <limits>

#include "document/document_store.h"
#include "features/datum/datum_commands.h"
#include "features/booleans/boolean.h"
#include "features/instance/instance.h"
#include "features/primitives/primitives.h"
#include "features/sketch/sketch_commands.h"
#include "features/sketch/sketch_store.h"
#include "model/geometry_kind.h"
#include "model/shapes.h"
#include "protocol/dispatcher.h"
#include "protocol/json_fields.h"
#include "persistence/ocaf_live.h"
#include "tessellation/mesh.h"

#if KREODA_WITH_OCCT
#include <BRepCheck_Analyzer.hxx>
#include <BRep_Builder.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopoDS_Compound.hxx>
#include <gp_Pln.hxx>
#endif

#if KREODA_WITH_OCCT
namespace {
using kreoda::Json;

Json rpc(Json request) {
  request["protocolVersion"] = 1;
  request["documentId"] = "surface-modeling-doc";
  const auto bytes = kreoda::handle_command(request.dump());
  return Json::parse(bytes.begin(), bytes.end());
}

void newDocument() {
  kreoda::DocumentStore::instance().create("surface-modeling-doc");
}

kreoda::SketchModel lineModel(double length = 10.0) {
  kreoda::SketchModel model;
  model.points = {{"a", 0, 0, true}, {"b", length, 0, true}};
  model.lines = {{"edge", "a", "b"}};
  return model;
}

kreoda::SketchModel circleModel(double radius = 5.0) {
  kreoda::SketchModel model;
  model.points = {{"center", 0, 0, true}};
  model.circles = {{"circle", "center", radius}};
  return model;
}

kreoda::SketchModel squareModel(double size = 10.0) {
  kreoda::SketchModel model;
  model.points = {{"a", 0, 0, true}, {"b", size, 0, true},
                  {"c", size, size, true}, {"d", 0, size, true}};
  model.lines = {{"bc", "b", "c"}, {"da", "d", "a"},
                 {"ab", "a", "b"}, {"cd", "c", "d"}};
  return model;
}

Json query(const std::string& method, Json params) {
  return rpc({{"type", 30}, {"requestId", "surface-query"},
              {"method", method}, {"params", std::move(params)}});
}

int countShape(const TopoDS_Shape& shape, TopAbs_ShapeEnum kind) {
  int count = 0;
  for (TopExp_Explorer it(shape, kind); it.More(); it.Next()) ++count;
  return count;
}
}  // namespace

TEST(SurfaceModeling, ExtrudeOpenSketchCreatesUncappedExactSurface) {
  newDocument();
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("open-sketch", "XY", lineModel(),
                                           &error)) << error;

  const auto created = rpc({{"type", 48}, {"requestId", "surface-extrude"},
                            {"featureId", "open-surface"},
                            {"sketchId", "open-sketch"}, {"distanceMm", 5}});
  ASSERT_EQ(created["status"], "ok") << created;
  EXPECT_FALSE(created.contains("volumeMm3"));

  kreoda::ShapeRecord surface;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("open-surface", &surface));
  EXPECT_EQ(surface.type, "SurfaceExtrude");
  EXPECT_EQ(surface.paramsMm, (std::vector<double>{5}));
  EXPECT_EQ(surface.dependsOn, (std::vector<std::string>{"open-sketch"}));
  EXPECT_DOUBLE_EQ(surface.volumeMm3, 0);
  EXPECT_EQ(countShape(surface.shape, TopAbs_FACE), 1);
  EXPECT_EQ(countShape(surface.shape, TopAbs_SOLID), 0);
  EXPECT_TRUE(BRepCheck_Analyzer(surface.shape, true).IsValid());
  EXPECT_NEAR(surface.bboxMm[0], 0, 2e-7);
  EXPECT_NEAR(surface.bboxMm[1], 0, 2e-7);
  EXPECT_NEAR(surface.bboxMm[2], 0, 2e-7);
  EXPECT_NEAR(surface.bboxMm[3], 10, 2e-7);
  EXPECT_NEAR(surface.bboxMm[4], 0, 2e-7);
  EXPECT_NEAR(surface.bboxMm[5], 5, 2e-7);

  GProp_GProps area;
  BRepGProp::SurfaceProperties(surface.shape, area);
  EXPECT_NEAR(area.Mass(), 50, 1e-8);
  const auto measuredArea = query("measureArea", {{"featureId", "open-surface"}});
  ASSERT_EQ(measuredArea["status"], "ok") << measuredArea;
  EXPECT_NEAR(measuredArea["result"]["areaMm2"].get<double>(), 50, 1e-8);
  EXPECT_EQ(query("measureVolume", {{"featureId", "open-surface"}})["status"],
            "error");
  EXPECT_EQ(query("measureMassProperties", {{"featureId", "open-surface"}})["status"],
            "error");
  const auto validation = query("validateFeature", {{"featureId", "open-surface"}});
  ASSERT_EQ(validation["status"], "ok") << validation;
  EXPECT_TRUE(validation["result"]["valid"].get<bool>()) << validation;
}

TEST(SurfaceModeling, CircleExtrudeAndFullRevolveRemainOpen) {
  newDocument();
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("circle-sketch", "XY", circleModel(),
                                           &error)) << error;
  auto extruded = rpc({{"type", 48}, {"requestId", "circle-extrude"},
                       {"featureId", "circle-surface"},
                       {"sketchId", "circle-sketch"}, {"distanceMm", -8}});
  ASSERT_EQ(extruded["status"], "ok") << extruded;
  kreoda::ShapeRecord surface;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("circle-surface", &surface));
  EXPECT_LT(surface.bboxMm[2], surface.bboxMm[5]);
  EXPECT_NEAR(surface.volumeMm3, 0, 0);
  EXPECT_EQ(countShape(surface.shape, TopAbs_SOLID), 0);
  GProp_GProps area;
  BRepGProp::SurfaceProperties(surface.shape, area);
  EXPECT_NEAR(area.Mass(), 2 * std::acos(-1.0) * 5 * 8, 1e-7);
  EXPECT_DOUBLE_EQ(kreoda::TessellateFeature("circle-surface", 1, &error).volumeMm3, 0);

  auto revolved = rpc({{"type", 49}, {"requestId", "circle-revolve"},
                       {"featureId", "torus-surface"},
                       {"sketchId", "circle-sketch"}, {"angleDeg", 360},
                       {"axisOriginXMm", 20}, {"axisOriginYMm", 0},
                       {"axisOriginZMm", 0}, {"axisX", 0}, {"axisY", 0.5},
                       {"axisZ", 0}});
  ASSERT_EQ(revolved["status"], "ok") << revolved;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("torus-surface", &surface));
  EXPECT_EQ(surface.type, "SurfaceRevolve");
  EXPECT_EQ(surface.paramsMm.size(), 7u);
  EXPECT_DOUBLE_EQ(surface.paramsMm[0], 360);
  EXPECT_DOUBLE_EQ(surface.paramsMm[4], 0);
  EXPECT_DOUBLE_EQ(surface.paramsMm[5], 1);
  EXPECT_DOUBLE_EQ(surface.paramsMm[6], 0);
  EXPECT_EQ(countShape(surface.shape, TopAbs_FACE), 1);
  EXPECT_EQ(countShape(surface.shape, TopAbs_SOLID), 0);
  EXPECT_TRUE(BRepCheck_Analyzer(surface.shape, true).IsValid());
  BRepGProp::SurfaceProperties(surface.shape, area);
  EXPECT_NEAR(area.Mass(), 4 * std::acos(-1.0) * std::acos(-1.0) * 20 * 5, 1e-5);
  EXPECT_NEAR(surface.bboxMm[0], -5, 2e-7);
  EXPECT_NEAR(surface.bboxMm[3], 45, 2e-7);
  EXPECT_NEAR(surface.bboxMm[1], -5, 2e-7);
  EXPECT_NEAR(surface.bboxMm[4], 5, 2e-7);
  EXPECT_NEAR(surface.bboxMm[2], -25, 2e-7);
  EXPECT_NEAR(surface.bboxMm[5], 25, 2e-7);
  EXPECT_DOUBLE_EQ(kreoda::TessellateFeature("torus-surface", 1, &error).volumeMm3, 0);

  auto partial = rpc({{"type", 49}, {"requestId", "partial-revolve"},
                      {"featureId", "half-torus"}, {"sketchId", "circle-sketch"},
                      {"angleDeg", 180}, {"axisOriginXMm", 20},
                      {"axisX", 0}, {"axisY", 1}, {"axisZ", 0}});
  ASSERT_EQ(partial["status"], "ok") << partial;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("half-torus", &surface));
  BRepGProp::SurfaceProperties(surface.shape, area);
  EXPECT_NEAR(area.Mass(), 2 * std::acos(-1.0) * std::acos(-1.0) * 20 * 5, 1e-5);
  EXPECT_EQ(countShape(surface.shape, TopAbs_SOLID), 0);
}

TEST(SurfaceModeling, LoftOpenSectionsCreatesOneUncappedFaceAndRejectsMixedStatus) {
  newDocument();
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("loft-open-a", "XY", lineModel(),
                                           &error)) << error;
  ASSERT_TRUE(kreoda::CreateDatumFeature(
      "loft-plane", kreoda::DatumKind::Plane,
      R"({"type":"offset","base":{"type":"principal","planeKind":"XY"},"offsetMm":20})",
      &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchOnDatumFeature("loft-open-b", "loft-plane",
                                                  lineModel(), &error)) << error;
  auto created = rpc({{"type", 50}, {"requestId", "loft-open"},
                      {"featureId", "open-loft"},
                      {"sketchIds", {"loft-open-a", "loft-open-b"}}});
  ASSERT_EQ(created["status"], "ok") << created;
  kreoda::ShapeRecord surface;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("open-loft", &surface));
  EXPECT_EQ(surface.type, "SurfaceLoft");
  EXPECT_TRUE(surface.paramsMm.empty());
  EXPECT_EQ(surface.dependsOn,
            (std::vector<std::string>{"loft-open-a", "loft-open-b"}));
  EXPECT_EQ(countShape(surface.shape, TopAbs_FACE), 1);
  EXPECT_EQ(countShape(surface.shape, TopAbs_SOLID), 0);
  GProp_GProps area;
  BRepGProp::SurfaceProperties(surface.shape, area);
  EXPECT_NEAR(area.Mass(), 200, 1e-7);

  ASSERT_TRUE(kreoda::CreateSketchFeature("loft-closed", "XY", circleModel(),
                                           &error)) << error;
  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  const auto rejected = rpc({{"type", 50}, {"requestId", "loft-mixed"},
                             {"featureId", "mixed-loft"},
                             {"sketchIds", {"loft-open-a", "loft-closed"}}});
  EXPECT_EQ(rejected["status"], "error") << rejected;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("mixed-loft"));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
}

TEST(SurfaceModeling, InvalidCreationLeavesRevisionAndRegistryUntouched) {
  newDocument();
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("invalid-source", "XY", lineModel(),
                                           &error)) << error;
  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  const auto registry = kreoda::DocumentStore::instance().snapshotRegistry();
  for (const double distance : {0.0, 100001.0,
                                std::numeric_limits<double>::infinity()}) {
    const auto rejected = rpc({{"type", 48}, {"requestId", "bad-extrude"},
                               {"featureId", "invalid-surface"},
                               {"sketchId", "invalid-source"},
                               {"distanceMm", distance}});
    EXPECT_EQ(rejected["status"], "error") << rejected;
    EXPECT_FALSE(kreoda::ShapeStore::instance().contains("invalid-surface"));
    EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
    EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRegistry(), registry);
  }
  const auto badLoft = rpc({{"type", 50}, {"requestId", "duplicate-loft"},
                            {"featureId", "duplicate-loft"},
                            {"sketchIds", {"invalid-source", "invalid-source"}}});
  EXPECT_EQ(badLoft["status"], "error") << badLoft;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("duplicate-loft"));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
}

TEST(SurfaceModeling, OffsetRotatedPlaneAndUnorderedChainPreserveExactWorldGeometry) {
  newDocument();
  auto model = lineModel();
  model.points.push_back({"c", 10, 5, true});
  model.lines = {{"second", "b", "c"}, {"first", "a", "b"}};
  kreoda::SketchPlane plane;
  plane.origin[0] = 100;
  plane.origin[1] = -20;
  plane.origin[2] = 7;
  plane.xAxis[0] = 0; plane.xAxis[1] = 1; plane.xAxis[2] = 0;
  plane.yAxis[0] = 0; plane.yAxis[1] = 0; plane.yAxis[2] = 1;
  plane.normal[0] = 1; plane.normal[1] = 0; plane.normal[2] = 0;
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("rotated-sketch", "XY", model,
                                           plane, &error)) << error;
  const auto created = rpc({{"type", 48}, {"requestId", "rotated-create"},
                            {"featureId", "rotated-surface"},
                            {"sketchId", "rotated-sketch"}, {"distanceMm", -4}});
  ASSERT_EQ(created["status"], "ok") << created;
  kreoda::ShapeRecord surface;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("rotated-surface", &surface));
  EXPECT_NEAR(surface.bboxMm[0], 96, 3e-7);
  EXPECT_NEAR(surface.bboxMm[1], -20, 3e-7);
  EXPECT_NEAR(surface.bboxMm[2], 7, 3e-7);
  EXPECT_NEAR(surface.bboxMm[3], 100, 3e-7);
  EXPECT_NEAR(surface.bboxMm[4], -10, 3e-7);
  EXPECT_NEAR(surface.bboxMm[5], 12, 3e-7);
  GProp_GProps area;
  BRepGProp::SurfaceProperties(surface.shape, area);
  EXPECT_NEAR(area.Mass(), 60, 1e-7);
}

TEST(SurfaceModeling, RejectsBranchingAndBrokenSketchEdgesWithoutMutation) {
  newDocument();
  kreoda::SketchModel branch;
  branch.points = {{"c", 0, 0, true}, {"a", -5, 0, true},
                   {"b", 5, 0, true}, {"d", 0, 5, true}};
  branch.lines = {{"left", "a", "c"}, {"right", "c", "b"},
                  {"branch", "c", "d"}};
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("branch-sketch", "XY", branch,
                                           &error)) << error;
  auto missing = lineModel();
  ASSERT_TRUE(kreoda::CreateSketchFeature("broken-sketch", "XY", missing,
                                           &error)) << error;
  kreoda::SketchFeature stored;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("broken-sketch", &stored));
  stored.model.lines.push_back({"missing-entity", "a", "unknown-point"});
  kreoda::SketchStore::instance().put(stored);
  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  const auto registry = kreoda::DocumentStore::instance().snapshotRegistry();
  for (const auto& item : std::vector<std::pair<std::string, std::string>>{
           {"branch-surface", "branch-sketch"},
           {"missing-surface", "broken-sketch"},
           {"stale-surface", "no-such-sketch"}}) {
    const auto rejected = rpc({{"type", 48}, {"requestId", item.first},
                               {"featureId", item.first}, {"sketchId", item.second},
                               {"distanceMm", 3}});
    EXPECT_EQ(rejected["status"], "error") << rejected;
    EXPECT_FALSE(kreoda::ShapeStore::instance().contains(item.first));
    EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
    EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRegistry(), registry);
  }
}

TEST(SurfaceModeling, ClosedLoftStaysUncappedSurface) {
  newDocument();
  std::string error;
  kreoda::SketchPlane lower;
  lower.origin[2] = 5;
  kreoda::SketchPlane upper = lower;
  upper.origin[2] = 25;
  ASSERT_TRUE(kreoda::CreateSketchFeature("closed-loft-a", "XY", squareModel(),
                                           lower, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("closed-loft-b", "XY", squareModel(),
                                           upper, &error)) << error;
  const auto created = rpc({{"type", 50}, {"requestId", "closed-loft"},
                            {"featureId", "closed-surface"},
                            {"sketchIds", {"closed-loft-a", "closed-loft-b"}}});
  ASSERT_EQ(created["status"], "ok") << created;
  kreoda::ShapeRecord surface;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("closed-surface", &surface));
  EXPECT_EQ(countShape(surface.shape, TopAbs_SOLID), 0);
  EXPECT_EQ(countShape(surface.shape, TopAbs_FACE), 4);
  EXPECT_TRUE(BRepCheck_Analyzer(surface.shape, true).IsValid());
  GProp_GProps area;
  BRepGProp::SurfaceProperties(surface.shape, area);
  EXPECT_NEAR(area.Mass(), 800, 1e-6);
  EXPECT_DOUBLE_EQ(kreoda::TessellateFeature("closed-surface", 1, &error).volumeMm3, 0);
}

TEST(SurfaceModeling, MalformedStoredExtrudeParametersAreRejectedWithoutMutation) {
  newDocument();
  kreoda::ShapeRecord record;
  record.type = "SurfaceExtrude";
  std::vector<double> parameters;
  std::string error;
  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  EXPECT_FALSE(kreoda::ResolveParamsForEdit(record, "distanceMm", 5, &parameters, &error));
  EXPECT_FALSE(error.empty());
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
}

TEST(SurfaceModeling, PersistenceRejectsInstanceGeometryThatDisagreesWithItsPrototype) {
  newDocument();
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("kind-solid", 10, 10, 10, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("kind-sketch", "XY", lineModel(), &error)) << error;
  ASSERT_EQ(rpc({{"type", 48}, {"requestId", "kind-create"},
                 {"featureId", "kind-surface"}, {"sketchId", "kind-sketch"},
                 {"distanceMm", 5}})["status"], "ok");
  for (const auto& item : std::vector<std::pair<std::string, std::string>>{
           {"valid-solid-instance", "kind-solid"}, {"valid-surface-instance", "kind-surface"},
           {"bad-solid-instance", "kind-solid"}, {"bad-surface-instance", "kind-surface"}})
    ASSERT_TRUE(kreoda::CreateInstanceFeature(item.first, item.second,
        {20, 0, 0, 0, 0, 0}, &error)) << error;
  kreoda::ShapeRecord solid, surface, badSolid, badSurface;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("kind-solid", &solid));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("kind-surface", &surface));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("bad-solid-instance", &badSolid));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("bad-surface-instance", &badSurface));
  badSolid.shape = surface.shape;
  badSurface.shape = solid.shape;
  auto& ocaf = kreoda::OcafLive::instance();
  ASSERT_TRUE(ocaf.BeginCommand(&error)) << error;
  ASSERT_TRUE(ocaf.UpsertFeature(badSolid, false, &error)) << error;
  ASSERT_TRUE(ocaf.UpsertFeature(badSurface, false, &error)) << error;
  ASSERT_TRUE(ocaf.CommitCommand(nullptr, &error)) << error;
  const auto path = (std::filesystem::temp_directory_path() /
                     "kreoda-surface-kind-mismatch.xbf").string();
  ASSERT_TRUE(ocaf.Save(path, &error)) << error;
  std::vector<kreoda::ShapeRecord> loaded;
  ASSERT_TRUE(ocaf.Load(path, &loaded, &error)) << error;
  const auto contains = [&](const std::string& id) {
    return std::any_of(loaded.begin(), loaded.end(), [&](const auto& record) { return record.featureId == id; });
  };
  EXPECT_FALSE(contains("bad-solid-instance"));
  EXPECT_FALSE(contains("bad-surface-instance"));
  EXPECT_TRUE(contains("valid-solid-instance"));
  EXPECT_TRUE(contains("valid-surface-instance"));
  ASSERT_TRUE(ocaf.ResyncStore(&error)) << error;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("bad-solid-instance"));
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("bad-surface-instance"));
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("valid-solid-instance"));
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("valid-surface-instance"));
  EXPECT_DOUBLE_EQ(kreoda::TessellateFeature("valid-surface-instance", 1, &error).volumeMm3, 0);
  EXPECT_NEAR(kreoda::TessellateFeature("valid-solid-instance", 1, &error).volumeMm3, 1000, 1e-6);
  std::error_code ec;
  std::filesystem::remove(path, ec);
}

TEST(SurfaceModeling, NumericEditUpstreamRecomputeUndoRedoAndSaveOpen) {
  newDocument();
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("legacy-solid", 10, 10, 10, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("edit-sketch", "XY", lineModel(),
                                           &error)) << error;
  ASSERT_EQ(rpc({{"type", 48}, {"requestId", "edit-create"},
                 {"featureId", "edit-surface"}, {"sketchId", "edit-sketch"},
                 {"distanceMm", 5}})["status"], "ok");
  ASSERT_TRUE(kreoda::RebuildFeature("edit-surface", "distanceMm", 8, &error)) << error;
  kreoda::ShapeRecord beforeFailure;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("edit-surface", &beforeFailure));
  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  EXPECT_FALSE(kreoda::RebuildFeature("edit-surface", "distanceMm", 0, &error));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
  kreoda::ShapeRecord afterFailure;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("edit-surface", &afterFailure));
  EXPECT_TRUE(afterFailure.shape.IsSame(beforeFailure.shape));
  EXPECT_EQ(afterFailure.paramsMm, (std::vector<double>{8}));

  ASSERT_TRUE(kreoda::UpdateSketchFeature("edit-sketch", lineModel(20), &error)) << error;
  auto measured = query("measureArea", {{"featureId", "edit-surface"}});
  ASSERT_EQ(measured["status"], "ok") << measured;
  EXPECT_NEAR(measured["result"]["areaMm2"].get<double>(), 160, 1e-7);
  ASSERT_EQ(rpc({{"type", 8}, {"requestId", "edit-undo"}})["status"], "ok");
  measured = query("measureArea", {{"featureId", "edit-surface"}});
  ASSERT_EQ(measured["status"], "ok") << measured;
  EXPECT_NEAR(measured["result"]["areaMm2"].get<double>(), 80, 1e-7);
  ASSERT_EQ(rpc({{"type", 9}, {"requestId", "edit-redo"}})["status"], "ok");

  const auto path = (std::filesystem::temp_directory_path() /
                     "kreoda-surface-foundation.icad").generic_string();
  ASSERT_EQ(rpc({{"type", 10}, {"requestId", "surface-save"}, {"path", path}})["status"], "ok");
  ASSERT_EQ(rpc({{"type", 2}, {"requestId", "surface-reset"}})["status"], "ok");
  ASSERT_EQ(rpc({{"type", 11}, {"requestId", "surface-open"}, {"path", path}})["status"], "ok");
  kreoda::ShapeRecord restored;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("edit-surface", &restored));
  EXPECT_EQ(restored.type, "SurfaceExtrude");
  EXPECT_EQ(restored.paramsMm, (std::vector<double>{8}));
  EXPECT_EQ(restored.dependsOn, (std::vector<std::string>{"edit-sketch"}));
  EXPECT_EQ(countShape(restored.shape, TopAbs_SOLID), 0);
  ASSERT_TRUE(kreoda::RebuildFeature("edit-surface", "distanceMm", 9, &error)) << error;
  measured = query("measureArea", {{"featureId", "edit-surface"}});
  ASSERT_EQ(measured["status"], "ok") << measured;
  EXPECT_NEAR(measured["result"]["areaMm2"].get<double>(), 180, 1e-7);

  ASSERT_TRUE(kreoda::CreateInstanceFeature("edit-surface-instance", "edit-surface",
                                             {20, 0, 0, 0, 0, 0}, &error)) << error;
  ASSERT_EQ(rpc({{"type", 10}, {"requestId", "surface-save"}, {"path", path}})["status"], "ok");
  ASSERT_EQ(rpc({{"type", 2}, {"requestId", "surface-reset"}})["status"], "ok");
  ASSERT_EQ(rpc({{"type", 11}, {"requestId", "surface-open"}, {"path", path}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("edit-surface", &restored));
  EXPECT_EQ(restored.featureId, "edit-surface");
  EXPECT_EQ(restored.type, "SurfaceExtrude");
  EXPECT_EQ(restored.paramsMm, (std::vector<double>{9}));
  EXPECT_EQ(restored.dependsOn, (std::vector<std::string>{"edit-sketch"}));
  EXPECT_DOUBLE_EQ(restored.volumeMm3, 0);
  EXPECT_EQ(countShape(restored.shape, TopAbs_SOLID), 0);
  EXPECT_TRUE(BRepCheck_Analyzer(restored.shape, true).IsValid());
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("edit-surface-instance", &restored));
  EXPECT_EQ(restored.type, "Instance");
  EXPECT_EQ(restored.dependsOn, (std::vector<std::string>{"edit-surface"}));
  EXPECT_DOUBLE_EQ(restored.volumeMm3, 0);
  EXPECT_EQ(kreoda::FeatureGeometryKind(restored), kreoda::GeometryKind::Surface);
  EXPECT_EQ(countShape(restored.shape, TopAbs_SOLID), 0);
  EXPECT_TRUE(BRepCheck_Analyzer(restored.shape, true).IsValid());
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("legacy-solid", &restored));
  EXPECT_EQ(restored.type, "Box");
  EXPECT_EQ(restored.paramsMm, (std::vector<double>{10, 10, 10}));
  EXPECT_NEAR(restored.volumeMm3, 1000, 1e-7);
  EXPECT_EQ(countShape(restored.shape, TopAbs_SOLID), 1);
  std::error_code ec;
  std::filesystem::remove(path, ec);
}

TEST(SurfaceModeling, SurfaceInstancesStaySurfaceAndDocumentMassUsesSolidsOnly) {
  newDocument();
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("instance-sketch", "XY", lineModel(),
                                           &error)) << error;
  ASSERT_EQ(rpc({{"type", 48}, {"requestId", "instance-create"},
                 {"featureId", "instance-surface"}, {"sketchId", "instance-sketch"},
                 {"distanceMm", 5}})["status"], "ok");
  ASSERT_TRUE(kreoda::CreateBoxFeature("volume-box", 10, 10, 10, &error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("surface-instance", "instance-surface",
                                             {20, 0, 0, 0, 0, 0}, &error)) << error;
  kreoda::ShapeRecord instance;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("surface-instance", &instance));
  EXPECT_EQ(instance.type, "Instance");
  EXPECT_DOUBLE_EQ(instance.volumeMm3, 0);
  EXPECT_EQ(kreoda::FeatureGeometryKind(instance), kreoda::GeometryKind::Surface);
  EXPECT_EQ(countShape(instance.shape, TopAbs_SOLID), 0);
  EXPECT_TRUE(query("validateFeature", {{"featureId", "surface-instance"}})["result"]["valid"].get<bool>());

  const auto bounds = query("getBoundingBox", {{"featureId", "surface-instance"}});
  ASSERT_EQ(bounds["status"], "ok") << bounds;
  EXPECT_EQ(bounds["result"]["geometryKind"], "surface");
  EXPECT_TRUE(bounds["result"]["volumeMm3"].is_null());
  EXPECT_EQ(query("measureVolume", {{"featureId", "surface-instance"}})["errorCode"],
            "QUERY_FAILED");
  EXPECT_EQ(query("measureMassProperties", {{"featureId", "instance-surface"}})["errorCode"],
            "QUERY_FAILED");
  const auto documentVolume = query("measureVolume", Json::object());
  ASSERT_EQ(documentVolume["status"], "ok") << documentVolume;
  EXPECT_NEAR(documentVolume["result"]["volumeMm3"].get<double>(), 1000, 1e-7);
  const auto documentMass = query("measureMassProperties", Json::object());
  ASSERT_EQ(documentMass["status"], "ok") << documentMass;
  EXPECT_NEAR(documentMass["result"]["volumeMm3"].get<double>(), 1000, 1e-7);

  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  EXPECT_FALSE(kreoda::CreateBooleanFeature("surface-union", "fuse",
      "instance-surface", "volume-box", &error));
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("surface-union"));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
}

TEST(SurfaceModeling, StrictCommandsRejectUnknownFieldsAndDescribeCanonicalSlots) {
  newDocument();
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("strict-sketch", "XY", circleModel(),
                                           &error)) << error;
  const auto strict = rpc({{"type", 48}, {"requestId", "strict"},
                           {"featureId", "strict-surface"},
                           {"sketchId", "strict-sketch"}, {"distanceMm", 5},
                           {"ignored", true}});
  EXPECT_EQ(strict["errorCode"], "BAD_PARAMS");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("strict-surface"));
  EXPECT_EQ(kreoda::DescribeParams("SurfaceRevolve"),
      (std::vector<std::string>{"angleDeg", "axisOriginXMm", "axisOriginYMm",
                                "axisOriginZMm", "axisX", "axisY", "axisZ"}));
  const auto badAxes = rpc({{"type", 49}, {"requestId", "bad-axis"},
                            {"featureId", "bad-axis-surface"},
                            {"sketchId", "strict-sketch"}, {"angleDeg", 90},
                            {"axisX", 0}, {"axisY", 0}, {"axisZ", 0}});
  EXPECT_EQ(badAxes["status"], "error");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("bad-axis-surface"));
}

TEST(SurfaceModeling, MixedSurfaceAndSolidScopesRejectPhysicalVolumeAndMass) {
  newDocument();
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("mixed-box", 10, 10, 10, &error)) << error;
  kreoda::ShapeRecord record;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("mixed-box", &record));
  BRep_Builder builder;
  TopoDS_Compound mixed;
  builder.MakeCompound(mixed);
  builder.Add(mixed, record.shape);
  const auto freeFace = BRepBuilderAPI_MakeFace(
      gp_Pln(gp_Pnt(20, 0, 0), gp_Dir(0, 0, 1)), -2, 2, -2, 2).Face();
  builder.Add(mixed, freeFace);
  record.shape = mixed;
  kreoda::ShapeStore::instance().put(record);
  EXPECT_TRUE(kreoda::HasMixedSolidSurfaceTopology(mixed));
  EXPECT_EQ(query("measureVolume", {{"featureId", "mixed-box"}})["errorCode"],
            "QUERY_FAILED");
  EXPECT_EQ(query("measureMassProperties", {{"featureId", "mixed-box"}})["errorCode"],
            "QUERY_FAILED");
}

TEST(SurfaceModeling, EmptyDocumentVolumeRemainsZeroAndSurfaceInstanceKindHasNoDepthLimit) {
  newDocument();
  auto volume = query("measureVolume", Json::object());
  ASSERT_EQ(volume["status"], "ok") << volume;
  EXPECT_DOUBLE_EQ(volume["result"]["volumeMm3"].get<double>(), 0);
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("deep-sketch", "XY", lineModel(),
                                           &error)) << error;
  ASSERT_EQ(rpc({{"type", 48}, {"requestId", "deep-surface-create"},
                 {"featureId", "deep-surface"}, {"sketchId", "deep-sketch"},
                 {"distanceMm", 5}})["status"], "ok");
  volume = query("measureVolume", Json::object());
  ASSERT_EQ(volume["status"], "ok") << volume;
  EXPECT_DOUBLE_EQ(volume["result"]["volumeMm3"].get<double>(), 0);
  kreoda::ShapeRecord instance;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("deep-surface", &instance));
  instance.type = "Instance";
  EXPECT_EQ(kreoda::FeatureGeometryKind(instance), kreoda::GeometryKind::Surface);
}
#endif
