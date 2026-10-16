#include <gtest/gtest.h>

#include "../src/features/sketch/sketch_json.h"
#include "../src/features/sketch/sketch_projection.h"
#include "../src/protocol/json_fields.h"

#if KREODA_WITH_OCCT
#include <BRepAdaptor_Curve.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRep_Builder.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepTools.hxx>
#include <GeomAbs_CurveType.hxx>
#include <GProp_GProps.hxx>
#include <Standard_Failure.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <gp_Ax1.hxx>
#include <TopoDS_Edge.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>

#include <cmath>
#include <algorithm>
#include <chrono>
#include <filesystem>
#include <atomic>
#include <sstream>

#include "../src/document/document_store.h"
#include "../src/exchange/sew.h"
#include "../src/features/extrusion/extrude.h"
#include "../src/features/instance/instance.h"
#include "../src/features/primitives/primitives.h"
#include "../src/features/revolve/revolve.h"
#include "../src/features/sketch/sketch_face.h"
#include "../src/features/sketch/sketch_commands.h"
#include "../src/model/body.h"
#include "../src/model/feature_graph.h"
#include "../src/model/shapes.h"
#include "../src/model/geometry_availability.h"
#include "../src/model/commit.h"
#include "../src/persistence/icad_zip.h"
#include "../src/persistence/ocaf_live.h"
#include "../src/protocol/dispatcher.h"
#include "../src/protocol/session_geometry.h"
#include "../src/tessellation/mesh.h"
#include "../src/topology/face_roles.h"

#include "rpc_text.h"

namespace {

kreoda::SketchPlane TiltedProjectionPlane() {
  const gp_Dir normal(1, 2, 3);
  const gp_Dir xAxis(2, -1, 0);
  const gp_Dir yAxis = normal.Crossed(xAxis);
  kreoda::SketchPlane plane;
  plane.origin[0] = 2;
  plane.origin[1] = -3;
  plane.origin[2] = 8;
  plane.xAxis[0] = xAxis.X(); plane.xAxis[1] = xAxis.Y(); plane.xAxis[2] = xAxis.Z();
  plane.yAxis[0] = yAxis.X(); plane.yAxis[1] = yAxis.Y(); plane.yAxis[2] = yAxis.Z();
  plane.normal[0] = normal.X(); plane.normal[1] = normal.Y(); plane.normal[2] = normal.Z();
  return plane;
}

std::string NativeShapeDump(const TopoDS_Shape& shape) {
  std::ostringstream out;
  BRepTools::Write(shape, out);
  return out.str();
}

bool StartProjectionDocument(const std::string& documentId,
                             std::string* error) {
  static std::atomic<uint64_t> requestNumber{0};
  const kreoda::Json request = {
      {"protocolVersion", 1},
      {"requestId", "projection-create-" +
                         std::to_string(requestNumber.fetch_add(1))},
      {"documentId", documentId}, {"type", kreoda::kCreateDocument}};
  const auto response = kreoda::Json::parse(
      kreoda_test::rpcText(request.dump()));
  if (response.value("status", "") != "ok") {
    if (error) *error = response.dump();
    return false;
  }
  if (error) error->clear();
  return true;
}

kreoda::Json ProjectionRpc(const std::string& documentId, int type,
                           const kreoda::Json& fields = kreoda::Json::object()) {
  static std::atomic<uint64_t> requestNumber{0};
  kreoda::Json request = {
      {"protocolVersion", 1},
      {"requestId", "projection-rpc-" +
                         std::to_string(requestNumber.fetch_add(1))},
      {"documentId", documentId}, {"type", type}};
  request.update(fields);
  return kreoda::Json::parse(kreoda_test::rpcText(request.dump()));
}

kreoda::SketchModel CircleModel(double radius, double centerX = 0) {
  kreoda::SketchModel model;
  model.points = {{"center", centerX, 0}};
  model.circles = {{"circle", "center", radius}};
  return model;
}

kreoda::Json SketchEntityProjection(const std::string& featureId,
                                    const std::vector<std::string>& entityIds) {
  return {{"version", 1}, {"operation", "projectEdges"},
          {"sources", {{{"type", "sketchEntities"},
                         {"featureId", featureId},
                         {"entityIds", entityIds}}}}};
}

double ProjectionDeviation(const TopoDS_Edge& source,
                           const TopoDS_Edge& projected,
                           const kreoda::SketchPlane& plane) {
  const BRepAdaptor_Curve sourceCurve(source);
  const BRepAdaptor_Curve projectedCurve(projected);
  const gp_Pnt origin(plane.origin[0], plane.origin[1], plane.origin[2]);
  const gp_Vec normal(plane.normal[0], plane.normal[1], plane.normal[2]);
  double maximum = 0;
  constexpr int kSamples = 512;
  for (int i = 0; i <= kSamples; ++i) {
    const double fraction = static_cast<double>(i) / kSamples;
    const double t = sourceCurve.FirstParameter() +
        (sourceCurve.LastParameter() - sourceCurve.FirstParameter()) * fraction;
    const gp_Pnt point = sourceCurve.Value(t);
    const gp_Pnt exact = point.Translated(-gp_Vec(origin, point).Dot(normal) * normal);
    maximum = std::max(maximum, exact.Distance(projectedCurve.Value(t)));
  }
  return maximum;
}

double ProjectionAreaTolerance(const TopoDS_Edge& edge) {
  constexpr double kCadToleranceMm = 1e-6;
  GProp_GProps edgeLength;
  BRepGProp::LinearProperties(edge, edgeLength);
  return edgeLength.Mass() * kCadToleranceMm +
         std::acos(-1.0) * kCadToleranceMm * kCadToleranceMm;
}

}  // namespace

TEST(SketchProjectionLifecycle, NativeEdgeFeedsGroupOnlyExtrudeAndRecomputes) {
  kreoda::DocumentStore::instance().create("projection-native-lifecycle");
  std::string error;
  ASSERT_TRUE(kreoda::CreateCylinderFeature("source", 4, 10, &error)) << error;
  kreoda::ShapeRecord sourceBefore;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("source", &sourceBefore));
  std::string selectedEdgeId;
  TopoDS_Edge selectedSourceEdge;
  for (const auto& role : kreoda::ClassifyEdgeRoles(
           sourceBefore.shape, sourceBefore.type, sourceBefore.featureId)) {
    if (role.persistentEdgeId.find("edge.cir.") != std::string::npos &&
        role.persistentEdgeId.find("cyl.+Z") != std::string::npos) {
      selectedEdgeId = role.persistentEdgeId;
      selectedSourceEdge = role.edge;
      break;
    }
  }
  ASSERT_FALSE(selectedEdgeId.empty());
  const std::string immutableSource = NativeShapeDump(sourceBefore.shape);

  const auto plane = TiltedProjectionPlane();
  ASSERT_TRUE(kreoda::CreateSketchFeature("target", "XY", {}, plane, &error))
      << error;
  const kreoda::Json definition = {
      {"version", 1},
      {"operation", "projectEdges"},
      {"sources", {{{"type", "edge"},
                     {"featureId", "source"},
                     {"persistentEdgeId", selectedEdgeId}}}}};
  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      "target", "linked", definition.dump(), &error)) << error;

  kreoda::SketchFeature target;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("target", &target));
  ASSERT_EQ(target.projectionGroups.size(), 1u);
  ASSERT_EQ(target.projectionGroups.front().evaluatedEdges.size(), 1u);
  const auto curveType = BRepAdaptor_Curve(
      target.projectionGroups.front().evaluatedEdges.front()).GetType();
  // OCCT's ProjectOnPlane represents this oblique projected circle as a
  // spline. Verify that spline against the analytic orthographic projection
  // at the evaluator's declared 1e-6 mm CAD tolerance.
  EXPECT_TRUE(curveType == GeomAbs_Ellipse || curveType == GeomAbs_BSplineCurve);
  const auto& projectedEdge = target.projectionGroups.front().evaluatedEdges.front();
  constexpr double kCadToleranceMm = 1e-6;
  EXPECT_LE(ProjectionDeviation(selectedSourceEdge, projectedEdge, plane),
            kCadToleranceMm);
  const BRepAdaptor_Curve projectedCurve(projectedEdge);
  EXPECT_NEAR(projectedCurve.Value(projectedCurve.FirstParameter()).Distance(
                  projectedCurve.Value(projectedCurve.LastParameter())),
              0.0, kCadToleranceMm);

  TopoDS_Shape profile;
  ASSERT_TRUE(kreoda::BuildProfileFromSketch(target, &profile, &error)) << error;
  GProp_GProps areaProperties;
  BRepGProp::SurfaceProperties(profile, areaProperties);
  const double projectedArea = std::acos(-1.0) * 16 * 3 / std::sqrt(14.0);
  GProp_GProps edgeLength;
  BRepGProp::LinearProperties(projectedEdge, edgeLength);
  const double areaTolerance = edgeLength.Mass() * kCadToleranceMm +
                               std::acos(-1.0) * kCadToleranceMm * kCadToleranceMm;
  EXPECT_NEAR(std::fabs(areaProperties.Mass()), projectedArea, areaTolerance);
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("solid", "target", 7, &error)) << error;
  kreoda::ShapeRecord solid;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("solid", &solid));
  EXPECT_NEAR(solid.volumeMm3, std::fabs(areaProperties.Mass()) * 7,
              areaTolerance * 7);
  const double initialVolume = solid.volumeMm3;
  kreoda::SketchPlane revolutionPlane = kreoda::PrincipalPlane("XY");
  revolutionPlane.origin[1] = 10;
  ASSERT_TRUE(kreoda::CreateSketchFeature(
      "revolveSketch", "XY", {}, revolutionPlane, &error)) << error;
  const kreoda::Json revolutionDefinition = {
      {"version", 1}, {"operation", "projectEdges"},
      {"sources", {{{"type", "edge"}, {"featureId", "source"},
                     {"persistentEdgeId", selectedEdgeId}}}}};
  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      "revolveSketch", "revolve-link", revolutionDefinition.dump(), &error)) << error;
  ASSERT_TRUE(kreoda::CreateRevolveFeature(
      "revolved", "revolveSketch", 360, &error)) << error;
  kreoda::ShapeRecord revolved;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("revolved", &revolved));
  EXPECT_NEAR(revolved.volumeMm3,
              2 * std::acos(-1.0) * std::acos(-1.0) * 10 * 16,
              1e-6);
  ASSERT_TRUE(kreoda::UpdateSketchFeature("target", target.model, &error)) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("target", &target));
  ASSERT_EQ(target.projectionGroups.size(), 1u);
  EXPECT_EQ(target.projectionGroups.front().status, "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("solid", &solid));
  EXPECT_EQ(solid.featureId, "solid");
  kreoda::ShapeRecord sourceAfter;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("source", &sourceAfter));
  EXPECT_EQ(NativeShapeDump(sourceAfter.shape), immutableSource);

  ASSERT_TRUE(kreoda::RebuildFeature("source", "radiusMm", 5, &error)) << error;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("source", &sourceAfter));
  const std::string editedSource = NativeShapeDump(sourceAfter.shape);
  EXPECT_NE(editedSource, immutableSource);
  ASSERT_TRUE(kreoda::SketchStore::instance().get("target", &target));
  EXPECT_EQ(target.id, "target");
  ASSERT_EQ(target.projectionGroups.size(), 1u);
  EXPECT_EQ(target.projectionGroups.front().groupId, "linked");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("solid", &solid));
  EXPECT_EQ(solid.featureId, "solid");
  ASSERT_TRUE(kreoda::SketchStore::instance().get("target", &target));
  ASSERT_TRUE(kreoda::BuildProfileFromSketch(target, &profile, &error)) << error;
  BRepGProp::SurfaceProperties(profile, areaProperties);
  ASSERT_EQ(target.projectionGroups.front().evaluatedEdges.size(), 1u);
  TopoDS_Edge currentSourceEdge;
  size_t currentMatches = 0;
  for (const auto& role : kreoda::ClassifyEdgeRoles(
           sourceAfter.shape, sourceAfter.type, sourceAfter.featureId)) {
    if (role.persistentEdgeId == selectedEdgeId) {
      currentSourceEdge = role.edge;
      ++currentMatches;
    }
  }
  ASSERT_EQ(currentMatches, 1u);
  const auto& changedProjectedEdge =
      target.projectionGroups.front().evaluatedEdges.front();
  EXPECT_LE(ProjectionDeviation(currentSourceEdge, changedProjectedEdge, plane),
            kCadToleranceMm);
  GProp_GProps changedEdgeLength;
  BRepGProp::LinearProperties(changedProjectedEdge, changedEdgeLength);
  const double changedAnalyticArea = std::acos(-1.0) * 25 * 3 / std::sqrt(14.0);
  const double changedAreaTolerance = changedEdgeLength.Mass() * kCadToleranceMm +
      std::acos(-1.0) * kCadToleranceMm * kCadToleranceMm;
  EXPECT_NEAR(std::fabs(areaProperties.Mass()), changedAnalyticArea,
              changedAreaTolerance);
  EXPECT_NEAR(solid.volumeMm3, changedAnalyticArea * 7,
              changedAreaTolerance * 7);
  EXPECT_GT(solid.volumeMm3, initialVolume);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("revolved", &revolved));
  EXPECT_EQ(revolved.featureId, "revolved");
  EXPECT_GT(revolved.volumeMm3,
            2 * std::acos(-1.0) * std::acos(-1.0) * 10 * 16);
  EXPECT_NEAR(revolved.volumeMm3,
              2 * std::acos(-1.0) * std::acos(-1.0) * 10 * 25,
              1e-6);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("source", &sourceAfter));
  EXPECT_EQ(NativeShapeDump(sourceAfter.shape), editedSource);

  ASSERT_TRUE(kreoda::CreateCylinderFeature("source2", 2, 6, &error)) << error;
  kreoda::ShapeRecord secondSource;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("source2", &secondSource));
  std::string secondEdgeId;
  for (const auto& role : kreoda::ClassifyEdgeRoles(
           secondSource.shape, secondSource.type, secondSource.featureId)) {
    if (role.persistentEdgeId.find("edge.cir.") != std::string::npos &&
        role.persistentEdgeId.find("cyl.+Z") != std::string::npos) {
      secondEdgeId = role.persistentEdgeId;
      break;
    }
  }
  ASSERT_FALSE(secondEdgeId.empty());
  const kreoda::Json secondDefinition = {
      {"version", 1}, {"operation", "projectEdges"},
      {"sources", {{{"type", "edge"}, {"featureId", "source2"},
                     {"persistentEdgeId", secondEdgeId}}}}};
  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      "target", "linked2", secondDefinition.dump(), &error)) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("target", &target));
  ASSERT_EQ(target.projectionGroups.size(), 2u);
  const std::string untouchedBinding = target.projectionGroups[1].bindingsJson;
  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      "target", "linked", definition.dump(), &error)) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("target", &target));
  EXPECT_EQ(target.projectionGroups[1].groupId, "linked2");
  EXPECT_EQ(target.projectionGroups[1].bindingsJson, untouchedBinding);
  EXPECT_EQ(target.projectionGroups[1].status, "ok");
}

TEST(SketchProjectionAvailability, BrokenGroupBlocksCachedShapeButNotUnrelatedBranch) {
  kreoda::DocumentStore::instance().create("projection-availability");
  std::string error;
  kreoda::SketchFeature sketch;
  sketch.id = "target";
  kreoda::SketchProjectionGroup group;
  group.groupId = "linked";
  group.definitionJson =
      R"({"version":1,"operation":"silhouette","sources":[{"type":"shape","featureId":"source"}]})";
  group.status = "broken";
  group.error = "source binding is missing";
  group.blockingSourceIds = {"source"};
  sketch.projectionGroups.push_back(group);
  kreoda::SketchStore::instance().put(sketch);

  kreoda::ShapeRecord stale, unrelated;
  ASSERT_TRUE(kreoda::BuildBoxShape(10, 10, 10, &stale.shape, &error)) << error;
  stale.featureId = "stale";
  stale.type = "Box";
  stale.dependsOn = {"target"};
  ASSERT_TRUE(kreoda::BuildBoxShape(2, 3, 4, &unrelated.shape, &error)) << error;
  unrelated.featureId = "unrelated";
  unrelated.type = "Box";
  kreoda::ShapeStore::instance().put(stale);
  kreoda::ShapeStore::instance().put(unrelated);

  const auto availability = kreoda::GetGeometryAvailability("stale");
  EXPECT_FALSE(availability.geometryCurrent);
  EXPECT_EQ(availability.status, "unavailable");
  EXPECT_NE(std::find(availability.blockingSourceIds.begin(),
                      availability.blockingSourceIds.end(), "source"),
            availability.blockingSourceIds.end());
  kreoda::ShapeRecord current;
  EXPECT_FALSE(kreoda::GetCurrentShapeRecord("stale", &current, &error));
  EXPECT_NE(error.find("source"), std::string::npos) << error;
  EXPECT_TRUE(kreoda::GetCurrentShapeRecord("unrelated", &current, &error)) << error;

  const auto mesh = kreoda::TessellateRecord(stale, 1, &error);
  EXPECT_TRUE(mesh.indices.empty());
  EXPECT_NE(error.find("source"), std::string::npos) << error;
}

TEST(SketchProjectionPersistence, IcadRoundTripBrokenBindingRepairUndoRedo) {
#if KREODA_WITH_OCCT && KREODA_WITH_MINIZIP
  namespace fs = std::filesystem;
  const fs::path tempDir = fs::temp_directory_path() /
      ("kreoda-projection-lifecycle-" + std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()));
  struct TempDirectory {
    fs::path path;
    ~TempDirectory() {
      std::error_code ignored;
      fs::remove_all(path, ignored);
    }
  } cleanup{tempDir};
  std::error_code fsError;
  ASSERT_TRUE(fs::create_directories(tempDir, fsError)) << fsError.message();

  auto& ocaf = kreoda::OcafLive::instance();
  std::string error;
  ASSERT_TRUE(StartProjectionDocument("projection-icad-lifecycle", &error))
      << error;
  ASSERT_TRUE(kreoda::CreateCylinderFeature("persist-source", 3, 10, &error))
      << error;
  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("persist-source", &source));
  std::string edgeId;
  for (const auto& role : kreoda::ClassifyEdgeRoles(
           source.shape, source.type, source.featureId)) {
    if (role.persistentEdgeId.find("edge.cir.") != std::string::npos &&
        role.persistentEdgeId.find("cyl.+Z") != std::string::npos) {
      edgeId = role.persistentEdgeId;
      break;
    }
  }
  ASSERT_FALSE(edgeId.empty());
  ASSERT_TRUE(kreoda::CreateSketchFeature("persist-target", "XY", {}, &error))
      << error;
  const kreoda::Json definition = {
      {"version", 1}, {"operation", "projectEdges"},
      {"sources", {{{"type", "edge"}, {"featureId", "persist-source"},
                     {"persistentEdgeId", edgeId}}}}};
  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      "persist-target", "linked", definition.dump(), &error)) << error;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature(
      "persist-solid", "persist-target", 5, &error)) << error;
  ASSERT_TRUE(kreoda::CreateBoxFeature(
      "persist-unrelated", 2, 3, 4, &error)) << error;
  const double expectedVolume = std::acos(-1.0) * 9 * 5;
  kreoda::ShapeRecord solid, unrelated;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("persist-solid", &solid));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("persist-unrelated", &unrelated));
  EXPECT_NEAR(solid.volumeMm3, expectedVolume, 1e-6);
  const std::string featureId = solid.featureId;

  const auto manifest = kreoda::Json{
      {"format", "kreoda-project"}, {"schemaVersion", 1},
      {"appVersion", "0.1.0"}, {"documentId", "projection-icad-lifecycle"},
      {"units", "mm"}, {"bodies", kreoda::Json::parse(kreoda::SerializeBodiesJson())},
      {"referencePlanesJson", "[]"}}.dump();
  const fs::path healthyXbf = tempDir / "healthy.xbf";
  const fs::path healthyIcad = tempDir / "healthy.icad";
  ASSERT_TRUE(ocaf.Save(healthyXbf.string(), &error)) << error;
  ASSERT_TRUE(kreoda::WriteIcad(healthyIcad.string(), manifest,
                                healthyXbf.string(), &error)) << error;

  const fs::path healthyExtract = tempDir / "healthy-open";
  ASSERT_TRUE(fs::create_directories(healthyExtract, fsError)) << fsError.message();
  std::string readManifest, extractedXbf;
  ASSERT_TRUE(kreoda::ReadIcad(healthyIcad.string(), healthyExtract.string(),
                               &readManifest, &extractedXbf, &error)) << error;
  std::vector<kreoda::SketchFeature> validatedSketches;
  ASSERT_TRUE(ocaf.ValidateSketchesInFile(extractedXbf, &validatedSketches,
                                          &error)) << error;
  auto validatedTarget = std::find_if(validatedSketches.begin(),
      validatedSketches.end(), [](const auto& sketch) {
        return sketch.id == "persist-target";
      });
  ASSERT_NE(validatedTarget, validatedSketches.end());
  ASSERT_EQ(validatedTarget->projectionGroups.size(), 1u);
  EXPECT_EQ(validatedTarget->projectionGroups.front().status, "ok");
  const std::string healthyBindings =
      validatedTarget->projectionGroups.front().bindingsJson;
  EXPECT_NE(healthyBindings.find("selectionEntry"), std::string::npos);

  std::vector<kreoda::ShapeRecord> loadedRecords;
  std::vector<std::string> loadedSketchJsons;
  ASSERT_TRUE(ocaf.Load(extractedXbf, &loadedRecords, &loadedSketchJsons,
                        &error, true)) << error;
  ASSERT_TRUE(ocaf.ResyncStore(&error)) << error;
  kreoda::SketchFeature loadedTarget;
  ASSERT_TRUE(kreoda::SketchStore::instance().get(
      "persist-target", &loadedTarget));
  ASSERT_EQ(loadedTarget.projectionGroups.size(), 1u);
  EXPECT_EQ(loadedTarget.projectionGroups.front().status, "ok");
  EXPECT_EQ(loadedTarget.projectionGroups.front().bindingsJson, healthyBindings);
  ASSERT_TRUE(kreoda::GetCurrentShapeRecord("persist-solid", &solid, &error))
      << error;
  EXPECT_EQ(solid.featureId, featureId);
  EXPECT_NEAR(solid.volumeMm3, expectedVolume, 1e-6);
  const std::string warmCacheDocumentId =
      kreoda::DocumentStore::instance().snapshotDocumentId();
  const int64_t warmCacheRevision =
      kreoda::DocumentStore::instance().revision();
  ASSERT_EQ(warmCacheDocumentId, "projection-icad-lifecycle");
#if KREODA_WITH_FLATBUFFERS
  const kreoda::Json meshRequest = {
      {"protocolVersion", 1}, {"requestId", "projection-mesh-warm"},
      {"documentId", "projection-icad-lifecycle"},
      {"type", kreoda::kRequestMesh}, {"featureId", "persist-solid"},
      {"lod", 1}};
  const auto warmMesh = kreoda::handle_command(meshRequest.dump());
  ASSERT_NE(kreoda_test::meshRoot(warmMesh), nullptr);
#endif

  // Persist a well-formed but nonexistent OCAF label entry. Validation should
  // retain the sketch and mark only its associative group broken.
  kreoda::Json brokenBindings = kreoda::Json::parse(healthyBindings);
  ASSERT_TRUE(brokenBindings.contains("entries"));
  ASSERT_FALSE(brokenBindings["entries"].empty());
  brokenBindings["entries"][0]["selectionEntry"] = "99999:1";
  loadedTarget.projectionGroups.front().bindingsJson = brokenBindings.dump();
  ASSERT_TRUE(ocaf.BeginCommand(&error)) << error;
  if (!ocaf.UpsertSketch("persist-target",
                         kreoda::SerializeSketchFeature(loadedTarget), &error)) {
    ocaf.AbortCommand();
    FAIL() << error;
    return;
  }
  bool hadDelta = false;
  if (!ocaf.CommitCommand(&hadDelta, &error)) {
    ocaf.AbortCommand();
    FAIL() << error;
    return;
  }
  ASSERT_TRUE(hadDelta);

  const fs::path brokenXbf = tempDir / "broken.xbf";
  const fs::path brokenIcad = tempDir / "broken.icad";
  ASSERT_TRUE(ocaf.Save(brokenXbf.string(), &error)) << error;
  ASSERT_TRUE(kreoda::WriteIcad(brokenIcad.string(), manifest,
                                brokenXbf.string(), &error)) << error;
  validatedSketches.clear();
  ASSERT_TRUE(ocaf.ValidateSketchesInFile(brokenXbf.string(),
                                          &validatedSketches, &error)) << error;
  validatedTarget = std::find_if(validatedSketches.begin(),
      validatedSketches.end(), [](const auto& sketch) {
        return sketch.id == "persist-target";
      });
  ASSERT_NE(validatedTarget, validatedSketches.end());
  ASSERT_EQ(validatedTarget->projectionGroups.size(), 1u);
  EXPECT_EQ(validatedTarget->projectionGroups.front().status, "broken");

  const fs::path brokenExtract = tempDir / "broken-open";
  ASSERT_TRUE(fs::create_directories(brokenExtract, fsError)) << fsError.message();
  ASSERT_TRUE(kreoda::ReadIcad(brokenIcad.string(), brokenExtract.string(),
                               &readManifest, &extractedXbf, &error)) << error;
  ASSERT_TRUE(ocaf.ValidateSketchesInFile(extractedXbf, &validatedSketches,
                                          &error)) << error;
  loadedRecords.clear();
  loadedSketchJsons.clear();
  ASSERT_TRUE(ocaf.Load(extractedXbf, &loadedRecords, &loadedSketchJsons,
                        &error, true)) << error;
  ASSERT_TRUE(ocaf.ResyncStore(&error)) << error;
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotDocumentId(),
            warmCacheDocumentId);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), warmCacheRevision);

  ASSERT_TRUE(kreoda::ShapeStore::instance().get("persist-solid", &solid));
  EXPECT_EQ(solid.featureId, featureId);
  EXPECT_NEAR(solid.volumeMm3, expectedVolume, 1e-6);
  auto availability = kreoda::GetGeometryAvailability("persist-solid");
  EXPECT_FALSE(availability.geometryCurrent);
  EXPECT_NE(std::find(availability.blockingSourceIds.begin(),
                      availability.blockingSourceIds.end(), "persist-source"),
            availability.blockingSourceIds.end());
  const auto brokenProjection = ProjectionRpc("projection-icad-lifecycle",
      kreoda::kRequestSketchProjection, {{"featureId", "persist-target"}});
  ASSERT_EQ(brokenProjection.value("status", ""), "ok")
      << brokenProjection.dump();
  EXPECT_FALSE(brokenProjection["projection"]["geometryCurrent"].get<bool>());
  EXPECT_EQ(brokenProjection["projection"]["status"], "unavailable");
  EXPECT_NE(brokenProjection["projection"]["error"].get<std::string>().find(
                "persist-source"), std::string::npos);
  ASSERT_EQ(brokenProjection["projection"]["groups"].size(), 1u);
  EXPECT_EQ(brokenProjection["projection"]["groups"][0]["status"], "broken");
  EXPECT_TRUE(brokenProjection["projection"]["groups"][0]["edges"].empty());
#if KREODA_WITH_FLATBUFFERS
  const kreoda::Json cachedRequest = {
      {"protocolVersion", 1}, {"requestId", "projection-mesh-after-break"},
      {"documentId", "projection-icad-lifecycle"},
      {"type", kreoda::kRequestMesh}, {"featureId", "persist-solid"},
      {"lod", 1}};
  const auto deniedCachedMesh = kreoda::handle_command(cachedRequest.dump());
  ASSERT_FALSE(deniedCachedMesh.empty());
  const auto deniedCachedMeshJson = kreoda::Json::parse(
      deniedCachedMesh.begin(), deniedCachedMesh.end());
  EXPECT_EQ(deniedCachedMeshJson["status"], "error");
  EXPECT_EQ(deniedCachedMeshJson["errorCode"], "MESH_FAILED");
  EXPECT_NE(deniedCachedMeshJson["errorMessage"].get<std::string>().find(
                "persist-source"), std::string::npos);
#endif
  EXPECT_TRUE(kreoda::GetCurrentShapeRecord(
      "persist-unrelated", &unrelated, &error)) << error;
  EXPECT_TRUE(kreoda::GetCurrentShapeRecord(
      "persist-source", &source, &error)) << error;
  EXPECT_FALSE(kreoda::GetCurrentShapeRecord("persist-solid", &solid, &error));
  EXPECT_NE(error.find("persist-source"), std::string::npos) << error;
  const auto staleMesh = kreoda::TessellateRecord(solid, 1, &error);
  EXPECT_TRUE(staleMesh.indices.empty());
  EXPECT_NE(error.find("persist-source"), std::string::npos) << error;
  const auto byIdMesh = kreoda::TessellateFeature("persist-solid", 1, &error);
  EXPECT_TRUE(byIdMesh.indices.empty());
  EXPECT_NE(error.find("persist-source"), std::string::npos) << error;

  std::vector<kreoda::ShapeRecord> exportRecords;
  EXPECT_FALSE(kreoda::CollectExportRecords(&exportRecords, &error));
  EXPECT_NE(error.find("persist-source"), std::string::npos) << error;
  kreoda::BodyRecord solidBody;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature(
      "persist-solid", &solidBody));
  EXPECT_EQ(solidBody.tipFeatureId, "persist-solid");
  bool bodyQueryRejected = false;
  try {
    (void)kreoda::RunSessionGeometryQuery(
        "measureVolume", {{"bodyId", solidBody.bodyId}});
  } catch (kreoda::SessionQueryError& failure) {
    bodyQueryRejected = true;
    EXPECT_EQ(failure.code, "GEOMETRY_UNAVAILABLE");
    EXPECT_NE(std::string(failure.what()).find("persist-source"),
              std::string::npos);
  }
  EXPECT_TRUE(bodyQueryRejected);
  for (const auto* method : {"findFaces", "findEdges"}) {
    bool picksRejected = false;
    try {
      (void)kreoda::RunSessionGeometryQuery(
          method, {{"bodyId", solidBody.bodyId}});
    } catch (kreoda::SessionQueryError& failure) {
      picksRejected = true;
      EXPECT_EQ(failure.code, "GEOMETRY_UNAVAILABLE");
      EXPECT_NE(std::string(failure.what()).find("persist-source"),
                std::string::npos);
    }
    EXPECT_TRUE(picksRejected) << method;
  }
  const auto faceInfo = ProjectionRpc("projection-icad-lifecycle",
      kreoda::kRequestFaceInfo,
      {{"featureId", "persist-solid"}, {"faceRole", "extrude.+Z"}});
  EXPECT_EQ(faceInfo["status"], "error") << faceInfo.dump();
  EXPECT_EQ(faceInfo["errorCode"], "GEOMETRY_UNAVAILABLE") << faceInfo.dump();
  EXPECT_NE(faceInfo["errorMessage"].get<std::string>().find("persist-source"),
            std::string::npos);
  bool queryRejected = false;
  try {
    (void)kreoda::RunSessionGeometryQuery(
        "measureVolume", {{"featureId", "persist-solid"}});
  } catch (kreoda::SessionQueryError& failure) {
    queryRejected = true;
    EXPECT_EQ(failure.code, "GEOMETRY_UNAVAILABLE");
    EXPECT_NE(std::string(failure.what()).find("persist-source"),
              std::string::npos);
  }
  EXPECT_TRUE(queryRejected);
  const auto bodyVolume = ProjectionRpc("projection-icad-lifecycle",
      kreoda::kRequestSessionQuery,
      {{"method", "measureVolume"},
       {"params", {{"bodyId", solidBody.bodyId}}}});
  EXPECT_EQ(bodyVolume["status"], "error") << bodyVolume.dump();
  EXPECT_EQ(bodyVolume["errorCode"], "GEOMETRY_UNAVAILABLE")
      << bodyVolume.dump();
  EXPECT_FALSE(kreoda::CreateInstanceFeature(
      "blocked-instance", "persist-solid", {0, 0, 0, 0, 0, 0}, &error));
  EXPECT_NE(error.find("persist-source"), std::string::npos) << error;
  EXPECT_TRUE(kreoda::CreateInstanceFeature(
      "unrelated-instance", "persist-unrelated", {0, 0, 0, 0, 0, 0},
      &error)) << error;

  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      "persist-target", "linked", definition.dump(), &error)) << error;
  kreoda::SketchFeature repairedTarget;
  ASSERT_TRUE(kreoda::SketchStore::instance().get(
      "persist-target", &repairedTarget));
  ASSERT_EQ(repairedTarget.projectionGroups.size(), 1u);
  EXPECT_EQ(repairedTarget.projectionGroups.front().status, "ok");
  EXPECT_EQ(repairedTarget.id, "persist-target");
  ASSERT_TRUE(kreoda::GetCurrentShapeRecord("persist-solid", &solid, &error))
      << error;
  EXPECT_EQ(solid.featureId, featureId);
  EXPECT_NEAR(solid.volumeMm3, expectedVolume, 1e-6);

  ASSERT_TRUE(ocaf.Undo(&error)) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get(
      "persist-target", &repairedTarget));
  ASSERT_EQ(repairedTarget.projectionGroups.size(), 1u);
  EXPECT_EQ(repairedTarget.projectionGroups.front().status, "broken");
  EXPECT_FALSE(kreoda::GetGeometryAvailability("persist-solid").geometryCurrent);
  ASSERT_TRUE(ocaf.Redo(&error)) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get(
      "persist-target", &repairedTarget));
  ASSERT_EQ(repairedTarget.projectionGroups.size(), 1u);
  EXPECT_EQ(repairedTarget.projectionGroups.front().status, "ok");
  ASSERT_TRUE(kreoda::GetCurrentShapeRecord("persist-solid", &solid, &error))
      << error;
  EXPECT_EQ(solid.featureId, featureId);
  EXPECT_NEAR(solid.volumeMm3, expectedVolume, 1e-6);
#else
  GTEST_SKIP() << "needs OCCT + minizip-ng";
#endif
}

TEST(SketchProjectionAuthoredSources, EntityEditReflowsStableDownstreamFeature) {
#if KREODA_WITH_OCCT
  std::string error;
  ASSERT_TRUE(StartProjectionDocument("projection-authored-edit", &error))
      << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature(
      "authored-source", "XY", CircleModel(2), &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("authored-target", "XY", {}, &error))
      << error;
  const auto definition =
      SketchEntityProjection("authored-source", {"circle"});
  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      "authored-target", "authored-link", definition.dump(), &error)) << error;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature(
      "authored-solid", "authored-target", 6, &error)) << error;

  kreoda::ShapeRecord before;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("authored-solid", &before));
  const std::string stableId = before.featureId;
  EXPECT_NEAR(before.volumeMm3, std::acos(-1.0) * 4 * 6, 1e-6);
  kreoda::SketchFeature target;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("authored-target", &target));
  ASSERT_EQ(target.projectionGroups.size(), 1u);
  ASSERT_EQ(target.projectionGroups.front().evaluatedEdges.size(), 1u);

  ASSERT_TRUE(kreoda::UpdateSketchFeature(
      "authored-source", CircleModel(5), &error)) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("authored-target", &target));
  ASSERT_EQ(target.projectionGroups.size(), 1u);
  EXPECT_EQ(target.projectionGroups.front().status, "ok");
  ASSERT_EQ(target.projectionGroups.front().evaluatedEdges.size(), 1u);
  EXPECT_NEAR(BRepAdaptor_Curve(
                  target.projectionGroups.front().evaluatedEdges.front())
                  .Circle().Radius(),
              5, 1e-7);
  kreoda::ShapeRecord after;
  ASSERT_TRUE(kreoda::GetCurrentShapeRecord("authored-solid", &after, &error))
      << error;
  EXPECT_EQ(after.featureId, stableId);
  EXPECT_NEAR(after.volumeMm3, std::acos(-1.0) * 25 * 6, 1e-6);
#else
  GTEST_SKIP() << "needs OCCT";
#endif
}

TEST(SketchProjectionOperations, SilhouetteAndSectionGroupsRecompute) {
#if KREODA_WITH_OCCT
  std::string error;
  ASSERT_TRUE(StartProjectionDocument("projection-operation-rebuild", &error))
      << error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("operation-source", 10, 8, 6, &error))
      << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature(
      "silhouette-target", "XY", {}, &error)) << error;
  kreoda::SketchPlane sectionPlane = kreoda::PrincipalPlane("XY");
  sectionPlane.origin[2] = 3;
  ASSERT_TRUE(kreoda::CreateSketchFeature(
      "section-target", "XY", {}, sectionPlane, &error)) << error;
  const kreoda::Json silhouette = {
      {"version", 1}, {"operation", "silhouette"},
      {"sources", {{{"type", "shape"}, {"featureId", "operation-source"}}}}};
  const kreoda::Json section = {
      {"version", 1}, {"operation", "section"},
      {"sources", {{{"type", "shape"}, {"featureId", "operation-source"}}}}};
  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      "silhouette-target", "silhouette-link", silhouette.dump(), &error))
      << error;
  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      "section-target", "section-link", section.dump(), &error)) << error;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature(
      "silhouette-solid", "silhouette-target", 2, &error)) << error;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature(
      "section-solid", "section-target", 3, &error)) << error;
  kreoda::ShapeRecord silhouetteSolid, sectionSolid;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(
      "silhouette-solid", &silhouetteSolid));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("section-solid", &sectionSolid));
  const std::string silhouetteId = silhouetteSolid.featureId;
  const std::string sectionId = sectionSolid.featureId;
  EXPECT_NEAR(silhouetteSolid.volumeMm3, 10 * 8 * 2, 1e-6);
  EXPECT_NEAR(sectionSolid.volumeMm3, 10 * 8 * 3, 1e-6);

  ASSERT_TRUE(kreoda::RebuildFeature(
      "operation-source", "widthMm", 12, &error)) << error;
  ASSERT_TRUE(kreoda::GetCurrentShapeRecord(
      "silhouette-solid", &silhouetteSolid, &error)) << error;
  ASSERT_TRUE(kreoda::GetCurrentShapeRecord(
      "section-solid", &sectionSolid, &error)) << error;
  EXPECT_EQ(silhouetteSolid.featureId, silhouetteId);
  EXPECT_EQ(sectionSolid.featureId, sectionId);
  EXPECT_NEAR(silhouetteSolid.volumeMm3, 12 * 8 * 2, 1e-6);
  EXPECT_NEAR(sectionSolid.volumeMm3, 12 * 8 * 3, 1e-6);
  kreoda::SketchFeature sketch;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("silhouette-target", &sketch));
  ASSERT_EQ(sketch.projectionGroups.size(), 1u);
  EXPECT_EQ(sketch.projectionGroups.front().status, "ok");
  ASSERT_TRUE(kreoda::SketchStore::instance().get("section-target", &sketch));
  ASSERT_EQ(sketch.projectionGroups.size(), 1u);
  EXPECT_EQ(sketch.projectionGroups.front().status, "ok");
#else
  GTEST_SKIP() << "needs OCCT";
#endif
}

TEST(SketchProjectionLifecycle, RemoveReleasesSourceAndUndoSaveOpenRetainIt) {
#if KREODA_WITH_OCCT && KREODA_WITH_MINIZIP
  namespace fs = std::filesystem;
  const fs::path tempDir = fs::temp_directory_path() /
      ("kreoda-projection-remove-" + std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()));
  struct TempDirectory {
    fs::path path;
    ~TempDirectory() {
      std::error_code ignored;
      fs::remove_all(path, ignored);
    }
  } cleanup{tempDir};
  std::error_code fsError;
  ASSERT_TRUE(fs::create_directories(tempDir, fsError)) << fsError.message();
  std::string error;
  constexpr const char* kDocument = "projection-remove-release";
  ASSERT_TRUE(StartProjectionDocument(kDocument, &error)) << error;
  ASSERT_TRUE(kreoda::CreateCylinderFeature("remove-source", 2, 5, &error))
      << error;
  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("remove-source", &source));
  std::string edgeId;
  for (const auto& role : kreoda::ClassifyEdgeRoles(
           source.shape, source.type, source.featureId)) {
    if (role.persistentEdgeId.find("edge.cir.") != std::string::npos &&
        role.persistentEdgeId.find("cyl.+Z") != std::string::npos) {
      edgeId = role.persistentEdgeId;
      break;
    }
  }
  ASSERT_FALSE(edgeId.empty());
  ASSERT_TRUE(kreoda::CreateSketchFeature(
      "remove-target", "XY", CircleModel(1, 20), &error)) << error;
  const kreoda::Json definition = {
      {"version", 1}, {"operation", "projectEdges"},
      {"sources", {{{"type", "edge"}, {"featureId", "remove-source"},
                     {"persistentEdgeId", edgeId}}}}};
  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      "remove-target", "removable", definition.dump(), &error)) << error;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature(
      "remove-solid", "remove-target", 2, &error)) << error;
  const double withProjection = std::acos(-1.0) * 10;
  const double withoutProjection = std::acos(-1.0) * 2;
  kreoda::ShapeRecord solid;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("remove-solid", &solid));
  const std::string stableSolidId = solid.featureId;
  EXPECT_NEAR(solid.volumeMm3, withProjection, 1e-6);

  const auto revision = kreoda::DocumentStore::instance().revision();
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();
  auto refused = ProjectionRpc(kDocument, kreoda::kDeleteFeature,
                               {{"featureId", "remove-source"}});
  EXPECT_EQ(refused["status"], "error") << refused.dump();
  EXPECT_EQ(refused["errorCode"], "HAS_DEPENDENTS") << refused.dump();
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);

  ASSERT_TRUE(kreoda::RemoveSketchProjectionGroup(
      "remove-target", "removable", &error)) << error;
  kreoda::SketchFeature target;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("remove-target", &target));
  EXPECT_TRUE(target.projectionGroups.empty());
  const auto dependencies = kreoda::SketchDependencies(target);
  EXPECT_EQ(std::find(dependencies.begin(), dependencies.end(), "remove-source"),
            dependencies.end());
  ASSERT_TRUE(kreoda::GetCurrentShapeRecord("remove-solid", &solid, &error))
      << error;
  EXPECT_EQ(solid.featureId, stableSolidId);
  EXPECT_NEAR(solid.volumeMm3, withoutProjection, 1e-6);

  ASSERT_TRUE(kreoda::OcafLive::instance().Undo(&error)) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("remove-target", &target));
  ASSERT_EQ(target.projectionGroups.size(), 1u);
  EXPECT_EQ(target.projectionGroups.front().status, "ok");
  ASSERT_TRUE(kreoda::GetCurrentShapeRecord("remove-solid", &solid, &error))
      << error;
  EXPECT_NEAR(solid.volumeMm3, withProjection, 1e-6);
  ASSERT_TRUE(kreoda::OcafLive::instance().Redo(&error)) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("remove-target", &target));
  EXPECT_TRUE(target.projectionGroups.empty());
  ASSERT_TRUE(kreoda::GetCurrentShapeRecord("remove-solid", &solid, &error))
      << error;
  EXPECT_NEAR(solid.volumeMm3, withoutProjection, 1e-6);

  const fs::path xbf = tempDir / "removed.xbf";
  const fs::path icad = tempDir / "removed.icad";
  const fs::path extracted = tempDir / "open";
  ASSERT_TRUE(fs::create_directories(extracted, fsError)) << fsError.message();
  const std::string manifest = kreoda::Json{
      {"format", "kreoda-project"}, {"schemaVersion", 1},
      {"appVersion", "0.1.0"}, {"documentId", kDocument},
      {"units", "mm"},
      {"bodies", kreoda::Json::parse(kreoda::SerializeBodiesJson())},
      {"referencePlanesJson", "[]"}}.dump();
  auto& ocaf = kreoda::OcafLive::instance();
  ASSERT_TRUE(ocaf.Save(xbf.string(), &error)) << error;
  ASSERT_TRUE(kreoda::WriteIcad(icad.string(), manifest, xbf.string(), &error))
      << error;
  std::string readManifest, extractedXbf;
  ASSERT_TRUE(kreoda::ReadIcad(icad.string(), extracted.string(),
                               &readManifest, &extractedXbf, &error)) << error;
  std::vector<kreoda::ShapeRecord> loadedRecords;
  ASSERT_TRUE(ocaf.Load(extractedXbf, &loadedRecords, nullptr, &error, true))
      << error;
  ASSERT_TRUE(ocaf.ResyncStore(&error)) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("remove-target", &target));
  EXPECT_TRUE(target.projectionGroups.empty());
  ASSERT_TRUE(kreoda::GetCurrentShapeRecord("remove-solid", &solid, &error))
      << error;
  EXPECT_NEAR(solid.volumeMm3, withoutProjection, 1e-6);

  const auto deleted = ProjectionRpc(kDocument, kreoda::kDeleteFeature,
                                     {{"featureId", "remove-source"}});
  EXPECT_EQ(deleted["status"], "ok") << deleted.dump();
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("remove-source"));
  EXPECT_TRUE(kreoda::GetCurrentShapeRecord("remove-solid", &solid, &error))
      << error;
  EXPECT_EQ(solid.featureId, stableSolidId);
  EXPECT_NEAR(solid.volumeMm3, withoutProjection, 1e-6);
#else
  GTEST_SKIP() << "needs OCCT + minizip-ng";
#endif
}

TEST(SketchProjectionLifecycle, DeletingTargetReleasesOnlyOwnedBindings) {
#if KREODA_WITH_OCCT && KREODA_WITH_MINIZIP
  namespace fs = std::filesystem;
  const fs::path tempDir = fs::temp_directory_path() /
      ("kreoda-projection-delete-owner-" + std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()));
  struct TempDirectory {
    fs::path path;
    ~TempDirectory() {
      std::error_code ignored;
      fs::remove_all(path, ignored);
    }
  } cleanup{tempDir};
  std::error_code fsError;
  ASSERT_TRUE(fs::create_directories(tempDir, fsError)) << fsError.message();
  std::string error;
  constexpr const char* kDocument = "projection-delete-owned-target";
  ASSERT_TRUE(StartProjectionDocument(kDocument, &error)) << error;
  ASSERT_TRUE(kreoda::CreateCylinderFeature("owned-source", 2, 5, &error))
      << error;
  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("owned-source", &source));
  std::string edgeId;
  for (const auto& role : kreoda::ClassifyEdgeRoles(
           source.shape, source.type, source.featureId)) {
    if (role.persistentEdgeId.find("edge.cir.") != std::string::npos &&
        role.persistentEdgeId.find("cyl.+Z") != std::string::npos) {
      edgeId = role.persistentEdgeId;
      break;
    }
  }
  ASSERT_FALSE(edgeId.empty());
  ASSERT_TRUE(kreoda::CreateSketchFeature("owned-target-a", "XY", {},
                                           &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("owned-target-b", "XY", {},
                                           &error)) << error;
  const kreoda::Json definition = {
      {"version", 1}, {"operation", "projectEdges"},
      {"sources", {{{"type", "edge"}, {"featureId", "owned-source"},
                     {"persistentEdgeId", edgeId}}}}};
  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      "owned-target-a", "owned-group-a", definition.dump(), &error)) << error;
  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      "owned-target-b", "owned-group-b", definition.dump(), &error)) << error;

  kreoda::SketchFeature targetA, targetB;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("owned-target-a", &targetA));
  ASSERT_TRUE(kreoda::SketchStore::instance().get("owned-target-b", &targetB));
  ASSERT_EQ(targetA.projectionGroups.size(), 1u);
  ASSERT_EQ(targetB.projectionGroups.size(), 1u);
  const kreoda::Json bindingsA =
      kreoda::Json::parse(targetA.projectionGroups.front().bindingsJson);
  const kreoda::Json bindingsB =
      kreoda::Json::parse(targetB.projectionGroups.front().bindingsJson);
  ASSERT_EQ(bindingsA["entries"].size(), 1u);
  ASSERT_EQ(bindingsB["entries"].size(), 1u);
  const std::string entryA = bindingsA["entries"][0]["selectionEntry"];
  const std::string entryB = bindingsB["entries"][0]["selectionEntry"];
  ASSERT_NE(entryA, entryB);
  auto resolver =
      kreoda::OcafLive::instance().SketchProjectionSourceResolver();
  ASSERT_TRUE(static_cast<bool>(resolver));
  const auto resolves = [&](const std::string& entry,
                            const std::string& sketchId,
                            const std::string& groupId,
                            const kreoda::Json& binding) {
    TopoDS_Edge resolved;
    std::string resolveError;
    return resolver(entry, sketchId, groupId,
                    binding["sourceIdentity"].get<std::string>(),
                    "owned-source", edgeId, &resolved, &resolveError) &&
           !resolved.IsNull();
  };
  EXPECT_TRUE(resolves(entryA, "owned-target-a", "owned-group-a",
                       bindingsA["entries"][0]));
  EXPECT_TRUE(resolves(entryB, "owned-target-b", "owned-group-b",
                       bindingsB["entries"][0]));

  const auto deleted = ProjectionRpc(
      kDocument, kreoda::kDeleteFeature, {{"featureId", "owned-target-a"}});
  ASSERT_EQ(deleted["status"], "ok") << deleted.dump();
  EXPECT_FALSE(kreoda::SketchStore::instance().contains("owned-target-a"));
  EXPECT_FALSE(resolves(entryA, "owned-target-a", "owned-group-a",
                        bindingsA["entries"][0]))
      << "deleted sketch's private projection selector still resolves";
  EXPECT_TRUE(resolves(entryB, "owned-target-b", "owned-group-b",
                       bindingsB["entries"][0]));

  ASSERT_TRUE(kreoda::OcafLive::instance().Undo(&error)) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("owned-target-a", &targetA));
  ASSERT_EQ(targetA.projectionGroups.size(), 1u);
  const auto undoBindings =
      kreoda::Json::parse(targetA.projectionGroups.front().bindingsJson);
  ASSERT_EQ(undoBindings["entries"].size(), 1u);
  EXPECT_EQ(undoBindings["entries"][0]["selectionEntry"], entryA);
  EXPECT_TRUE(resolves(entryA, "owned-target-a", "owned-group-a",
                       undoBindings["entries"][0]));
  EXPECT_TRUE(resolves(entryB, "owned-target-b", "owned-group-b",
                       bindingsB["entries"][0]));

  ASSERT_TRUE(kreoda::OcafLive::instance().Redo(&error)) << error;
  EXPECT_FALSE(kreoda::SketchStore::instance().contains("owned-target-a"));
  EXPECT_FALSE(resolves(entryA, "owned-target-a", "owned-group-a",
                        bindingsA["entries"][0]));
  EXPECT_TRUE(resolves(entryB, "owned-target-b", "owned-group-b",
                       bindingsB["entries"][0]));

  const fs::path xbf = tempDir / "deleted-target.xbf";
  const fs::path icad = tempDir / "deleted-target.icad";
  const std::string manifest = kreoda::Json{
      {"format", "kreoda-project"}, {"schemaVersion", 1},
      {"appVersion", "0.1.0"}, {"documentId", kDocument},
      {"units", "mm"},
      {"bodies", kreoda::Json::parse(kreoda::SerializeBodiesJson())},
      {"referencePlanesJson", "[]"}}.dump();
  auto& ocaf = kreoda::OcafLive::instance();
  ASSERT_TRUE(ocaf.Save(xbf.string(), &error)) << error;
  ASSERT_TRUE(kreoda::WriteIcad(icad.string(), manifest, xbf.string(), &error))
      << error;
  const auto opened = ProjectionRpc(
      kDocument, kreoda::kOpenDocument, {{"path", icad.generic_string()}});
  ASSERT_EQ(opened["status"], "ok") << opened.dump();
  resolver = kreoda::OcafLive::instance().SketchProjectionSourceResolver();
  ASSERT_TRUE(static_cast<bool>(resolver));
  EXPECT_FALSE(kreoda::SketchStore::instance().contains("owned-target-a"));
  ASSERT_TRUE(kreoda::SketchStore::instance().get("owned-target-b", &targetB));
  ASSERT_EQ(targetB.projectionGroups.size(), 1u);
  EXPECT_EQ(targetB.projectionGroups.front().status, "ok");
  const auto reopenedBindings = kreoda::Json::parse(
      targetB.projectionGroups.front().bindingsJson);
  ASSERT_EQ(reopenedBindings["entries"].size(), 1u);
  EXPECT_EQ(reopenedBindings["entries"][0]["selectionEntry"], entryB);
  EXPECT_TRUE(resolves(entryB, "owned-target-b", "owned-group-b",
                       reopenedBindings["entries"][0]));
  EXPECT_FALSE(resolves(entryA, "owned-target-a", "owned-group-a",
                        bindingsA["entries"][0]));
#else
  GTEST_SKIP() << "needs OCCT + minizip-ng";
#endif
}

TEST(SketchProjectionDependencies, SelfAndDownstreamCyclesRejectAtomically) {
#if KREODA_WITH_OCCT
  std::string error;
  ASSERT_TRUE(StartProjectionDocument("projection-cycle-atomic", &error))
      << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("cycle-a", "XY", CircleModel(1),
                                          &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("cycle-b", "XY", CircleModel(2),
                                          &error)) << error;
  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      "cycle-a", "from-b",
      SketchEntityProjection("cycle-b", {"circle"}).dump(), &error)) << error;
  kreoda::SketchFeature a, b;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("cycle-a", &a));
  ASSERT_TRUE(kreoda::SketchStore::instance().get("cycle-b", &b));
  const std::string beforeA = kreoda::SerializeSketchFeature(a);
  const std::string beforeB = kreoda::SerializeSketchFeature(b);
  const auto revision = kreoda::DocumentStore::instance().revision();
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();
  const auto redos = kreoda::OcafLive::instance().AvailableRedos();
  const auto graphSize = kreoda::TheFeatureGraph().size();

  EXPECT_FALSE(kreoda::SetSketchProjectionGroup(
      "cycle-a", "self-link",
      SketchEntityProjection("cycle-a", {"circle"}).dump(), &error));
  EXPECT_NE(error.find("cycle"), std::string::npos) << error;
  EXPECT_FALSE(kreoda::SetSketchProjectionGroup(
      "cycle-b", "from-a",
      SketchEntityProjection("cycle-a", {"circle"}).dump(), &error));
  EXPECT_NE(error.find("cycle"), std::string::npos) << error;

  ASSERT_TRUE(kreoda::SketchStore::instance().get("cycle-a", &a));
  ASSERT_TRUE(kreoda::SketchStore::instance().get("cycle-b", &b));
  EXPECT_EQ(kreoda::SerializeSketchFeature(a), beforeA);
  EXPECT_EQ(kreoda::SerializeSketchFeature(b), beforeB);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableRedos(), redos);
  EXPECT_EQ(kreoda::TheFeatureGraph().size(), graphSize);
#else
  GTEST_SKIP() << "needs OCCT";
#endif
}

TEST(SketchProjectionLimits, OversizedDefinitionsAndResolvedEdgesRejectAtomically) {
#if KREODA_WITH_OCCT
  std::string error;
  ASSERT_TRUE(StartProjectionDocument("projection-limits-atomic", &error))
      << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("limit-source", "XY",
                                          CircleModel(1), &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("limit-target", "XY", {}, &error))
      << error;
  kreoda::SketchFeature target;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("limit-target", &target));
  const std::string emptyTarget = kreoda::SerializeSketchFeature(target);
  const auto revision = kreoda::DocumentStore::instance().revision();
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();

  kreoda::Json tooManySources = kreoda::Json::array();
  for (int i = 0; i < 129; ++i)
    tooManySources.push_back({{"type", "sketchEntities"},
                              {"featureId", "owner" + std::to_string(i)},
                              {"entityIds", {"circle"}}});
  const kreoda::Json sourceOverflow = {
      {"version", 1}, {"operation", "projectEdges"},
      {"sources", tooManySources}};
  EXPECT_FALSE(kreoda::SetSketchProjectionGroup(
      "limit-target", "source-overflow", sourceOverflow.dump(), &error));
  EXPECT_NE(error.find("128"), std::string::npos) << error;

  std::vector<std::string> tooManyEntities;
  for (int i = 0; i < 129; ++i)
    tooManyEntities.push_back("entity" + std::to_string(i));
  const auto entityOverflow = SketchEntityProjection(
      "limit-source", tooManyEntities);
  EXPECT_FALSE(kreoda::SetSketchProjectionGroup(
      "limit-target", "entity-overflow", entityOverflow.dump(), &error));
  EXPECT_NE(error.find("128"), std::string::npos) << error;

  const std::string utf8 = "\xC3\xA9";
  std::string repeatedUtf8;
  repeatedUtf8.reserve(65540);
  for (int i = 0; i < 32770; ++i) repeatedUtf8 += utf8;
  const std::string multibyteDefinition =
      "{\"version\":1,\"operation\":\"silhouette\",\"sources\":[{\"type\":\"shape\",\"featureId\":\"limit-source\"}],\"extra\":\"" +
      repeatedUtf8 + "\"}";
  EXPECT_GT(multibyteDefinition.size(), 65536u);
  EXPECT_FALSE(kreoda::SetSketchProjectionGroup(
      "limit-target", "utf8-overflow", multibyteDefinition, &error));
  EXPECT_NE(error.find("65536 UTF-8 bytes"), std::string::npos) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("limit-target", &target));
  EXPECT_EQ(kreoda::SerializeSketchFeature(target), emptyTarget);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);

  // The 129th group is rejected before any group, graph, revision, or OCAF
  // history change. Seed valid associative groups through normal commands.
  ASSERT_TRUE(kreoda::CreateSketchFeature(
      "limit-groups-target", "XY", {}, &error)) << error;
  const auto oneEdge = SketchEntityProjection("limit-source", {"circle"});
  for (int i = 0; i < 128; ++i) {
    ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
        "limit-groups-target", "g" + std::to_string(i),
        oneEdge.dump(), &error)) << error;
  }
  ASSERT_TRUE(kreoda::SketchStore::instance().get(
      "limit-groups-target", &target));
  ASSERT_EQ(target.projectionGroups.size(), 128u);
  const std::string maxGroups = kreoda::SerializeSketchFeature(target);
  const auto maxGroupRevision = kreoda::DocumentStore::instance().revision();
  const auto maxGroupUndos = kreoda::OcafLive::instance().AvailableUndos();
  EXPECT_FALSE(kreoda::SetSketchProjectionGroup(
      "limit-groups-target", "overflow", oneEdge.dump(), &error));
  EXPECT_NE(error.find("128 projection groups"), std::string::npos) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get(
      "limit-groups-target", &target));
  EXPECT_EQ(kreoda::SerializeSketchFeature(target), maxGroups);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), maxGroupRevision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), maxGroupUndos);

  kreoda::SketchModel lines;
  std::vector<std::string> lineIds;
  for (int i = 0; i < 128; ++i) {
    const std::string p0 = "p" + std::to_string(i * 2);
    const std::string p1 = "p" + std::to_string(i * 2 + 1);
    lines.points.push_back({p0, static_cast<double>(i * 3), 0});
    lines.points.push_back({p1, static_cast<double>(i * 3 + 1), 0});
    const std::string lineId = "line" + std::to_string(i);
    lines.lines.push_back({lineId, p0, p1});
    lineIds.push_back(lineId);
  }
  ASSERT_TRUE(kreoda::CreateSketchFeature(
      "edge-limit-source", "XY", lines, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature(
      "edge-limit-target", "XY", {}, &error)) << error;
  const auto manyEdges = SketchEntityProjection("edge-limit-source", lineIds);
  for (int i = 0; i < 15; ++i) {
    ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
        "edge-limit-target", "eg" + std::to_string(i),
        manyEdges.dump(), &error)) << error;
  }
  ASSERT_TRUE(kreoda::SketchStore::instance().get(
      "edge-limit-target", &target));
  ASSERT_EQ(target.projectionGroups.size(), 15u);
  const std::string maxResolvedEdges = kreoda::SerializeSketchFeature(target);
  const auto maxEdgeRevision = kreoda::DocumentStore::instance().revision();
  const auto maxEdgeUndos = kreoda::OcafLive::instance().AvailableUndos();
  EXPECT_FALSE(kreoda::SetSketchProjectionGroup(
      "edge-limit-target", "eg-overflow", manyEdges.dump(), &error));
  EXPECT_NE(error.find("2000 edges"), std::string::npos) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get(
      "edge-limit-target", &target));
  EXPECT_EQ(kreoda::SerializeSketchFeature(target), maxResolvedEdges);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), maxEdgeRevision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), maxEdgeUndos);
#else
  GTEST_SKIP() << "needs OCCT";
#endif
}

TEST(SketchProjectionAtomicity, FailedRemoveAndRepairRestoreJoinedModelState) {
#if KREODA_WITH_OCCT
  std::string error;
  constexpr const char* kDocument = "projection-repair-atomic";
  ASSERT_TRUE(StartProjectionDocument(kDocument, &error)) << error;
  ASSERT_TRUE(kreoda::CreateCylinderFeature("atomic-source", 2, 5, &error))
      << error;
  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("atomic-source", &source));
  std::string circleEdge;
  for (const auto& role : kreoda::ClassifyEdgeRoles(
           source.shape, source.type, source.featureId)) {
    if (role.persistentEdgeId.find("edge.cir.") != std::string::npos &&
        role.persistentEdgeId.find("cyl.+Z") != std::string::npos) {
      circleEdge = role.persistentEdgeId;
      break;
    }
  }
  ASSERT_FALSE(circleEdge.empty());
  ASSERT_TRUE(kreoda::CreateSketchFeature(
      "atomic-target", "XY", {}, &error)) << error;
  const kreoda::Json circleDefinition = {
      {"version", 1}, {"operation", "projectEdges"},
      {"sources", {{{"type", "edge"}, {"featureId", "atomic-source"},
                     {"persistentEdgeId", circleEdge}}}}};
  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      "atomic-target", "link", circleDefinition.dump(), &error)) << error;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature(
      "atomic-solid", "atomic-target", 4, &error)) << error;

  kreoda::SketchFeature target;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("atomic-target", &target));
  const std::string healthySketch = kreoda::SerializeSketchFeature(target);
  kreoda::ShapeRecord solid;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("atomic-solid", &solid));
  const std::string healthySolid = NativeShapeDump(solid.shape);
  const auto healthyRevision = kreoda::DocumentStore::instance().revision();
  const auto healthyUndos = kreoda::OcafLive::instance().AvailableUndos();
  const auto healthyRedos = kreoda::OcafLive::instance().AvailableRedos();
  const auto healthyGraphSize = kreoda::TheFeatureGraph().size();

  EXPECT_FALSE(kreoda::RemoveSketchProjectionGroup(
      "atomic-target", "link", &error));
  ASSERT_TRUE(kreoda::SketchStore::instance().get("atomic-target", &target));
  EXPECT_EQ(kreoda::SerializeSketchFeature(target), healthySketch);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("atomic-solid", &solid));
  EXPECT_EQ(NativeShapeDump(solid.shape), healthySolid);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), healthyRevision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), healthyUndos);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableRedos(), healthyRedos);
  EXPECT_EQ(kreoda::TheFeatureGraph().size(), healthyGraphSize);

  // Turn the persisted selector into a well-formed but missing label. The
  // loaded sketch remains inspectable and provides the repair preimage.
  auto corruptBindings = kreoda::Json::parse(
      target.projectionGroups.front().bindingsJson);
  ASSERT_FALSE(corruptBindings["entries"].empty());
  corruptBindings["entries"][0]["selectionEntry"] = "99999:1";
  target.projectionGroups.front().bindingsJson = corruptBindings.dump();
  auto& ocaf = kreoda::OcafLive::instance();
  ASSERT_TRUE(ocaf.BeginCommand(&error)) << error;
  if (!ocaf.UpsertSketch("atomic-target",
                         kreoda::SerializeSketchFeature(target), &error)) {
    ocaf.AbortCommand();
    FAIL() << error;
    return;
  }
  if (!ocaf.CommitCommand(nullptr, &error)) {
    ocaf.AbortCommand();
    FAIL() << error;
    return;
  }
  ASSERT_TRUE(ocaf.ResyncStore(&error)) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("atomic-target", &target));
  ASSERT_EQ(target.projectionGroups.size(), 1u);
  EXPECT_EQ(target.projectionGroups.front().status, "broken");
  const std::string brokenSketch = kreoda::SerializeSketchFeature(target);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("atomic-solid", &solid));
  const std::string brokenSolid = NativeShapeDump(solid.shape);

  ASSERT_TRUE(kreoda::CreateBoxFeature("atomic-open-source", 10, 10, 10,
                                       &error)) << error;
  kreoda::ShapeRecord openSource;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(
      "atomic-open-source", &openSource));
  std::string openEdgeId;
  for (const auto& role : kreoda::ClassifyEdgeRoles(
           openSource.shape, openSource.type, openSource.featureId)) {
    if (role.persistentEdgeId.find("edge.lin.") == std::string::npos) continue;
    const BRepAdaptor_Curve curve(role.edge);
    if (curve.GetType() == GeomAbs_Line &&
        std::fabs(curve.Line().Direction().Z()) < 0.5) {
      openEdgeId = role.persistentEdgeId;
      break;
    }
  }
  ASSERT_FALSE(openEdgeId.empty());
  const auto brokenRevision = kreoda::DocumentStore::instance().revision();
  const auto brokenUndos = ocaf.AvailableUndos();
  const auto brokenRedos = ocaf.AvailableRedos();
  const auto brokenGraphSize = kreoda::TheFeatureGraph().size();
  const kreoda::Json openLineDefinition = {
      {"version", 1}, {"operation", "projectEdges"},
      {"sources", {{{"type", "edge"},
                     {"featureId", "atomic-open-source"},
                     {"persistentEdgeId", openEdgeId}}}}};
  EXPECT_FALSE(kreoda::SetSketchProjectionGroup(
      "atomic-target", "link", openLineDefinition.dump(), &error));
  ASSERT_TRUE(kreoda::SketchStore::instance().get("atomic-target", &target));
  EXPECT_EQ(kreoda::SerializeSketchFeature(target), brokenSketch);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("atomic-solid", &solid));
  EXPECT_EQ(NativeShapeDump(solid.shape), brokenSolid);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), brokenRevision);
  EXPECT_EQ(ocaf.AvailableUndos(), brokenUndos);
  EXPECT_EQ(ocaf.AvailableRedos(), brokenRedos);
  EXPECT_EQ(kreoda::TheFeatureGraph().size(), brokenGraphSize);

  const std::string transactionId = "projection-repair-transaction";
  const auto begin = ProjectionRpc(kDocument, kreoda::kBeginTransaction,
                                   {{"transactionId", transactionId}});
  ASSERT_EQ(begin["status"], "ok") << begin.dump();
  const auto joinedCreate = ProjectionRpc(kDocument, kreoda::kCreateBox,
      {{"transactionId", transactionId}, {"featureId", "transaction-only"},
       {"widthMm", 2}, {"heightMm", 3}, {"depthMm", 4}});
  ASSERT_EQ(joinedCreate["status"], "ok") << joinedCreate.dump();
  EXPECT_FALSE(kreoda::SetSketchProjectionGroup(
      "atomic-target", "link", openLineDefinition.dump(), &error));
  ASSERT_TRUE(ocaf.InTransaction());
  const auto commit = ProjectionRpc(kDocument, kreoda::kCommitTransaction,
                                    {{"transactionId", transactionId}});
  EXPECT_EQ(commit["status"], "error") << commit.dump();
  EXPECT_EQ(commit["errorCode"], "TRANSACTION_TAINTED") << commit.dump();
  EXPECT_FALSE(ocaf.InTransaction());
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("transaction-only"));
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), brokenRevision);
  EXPECT_EQ(ocaf.AvailableUndos(), brokenUndos);
  EXPECT_EQ(ocaf.AvailableRedos(), brokenRedos);
  EXPECT_EQ(kreoda::TheFeatureGraph().size(), brokenGraphSize);
  ASSERT_TRUE(kreoda::SketchStore::instance().get("atomic-target", &target));
  EXPECT_EQ(kreoda::SerializeSketchFeature(target), brokenSketch);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("atomic-solid", &solid));
  EXPECT_EQ(NativeShapeDump(solid.shape), brokenSolid);
  EXPECT_FALSE(kreoda::GetGeometryAvailability("atomic-solid").geometryCurrent);
#else
  GTEST_SKIP() << "needs OCCT";
#endif
}

TEST(SketchProjectionBindings, WrongPrivateContextAndLostIndexedLineageBreak) {
#if KREODA_WITH_OCCT
  std::string error;
  ASSERT_TRUE(StartProjectionDocument("projection-context-mismatch", &error))
      << error;
  ASSERT_TRUE(kreoda::CreateCylinderFeature("context-source", 2, 5, &error))
      << error;
  kreoda::ShapeRecord cylinder;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("context-source", &cylinder));
  std::string circleEdge;
  for (const auto& role : kreoda::ClassifyEdgeRoles(
           cylinder.shape, cylinder.type, cylinder.featureId)) {
    if (role.persistentEdgeId.find("edge.cir.") != std::string::npos &&
        role.persistentEdgeId.find("cyl.+Z") != std::string::npos) {
      circleEdge = role.persistentEdgeId;
      break;
    }
  }
  ASSERT_FALSE(circleEdge.empty());
  ASSERT_TRUE(kreoda::CreateSketchFeature("context-a", "XY", {}, &error))
      << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("context-b", "XY", {}, &error))
      << error;
  const kreoda::Json edgeDefinition = {
      {"version", 1}, {"operation", "projectEdges"},
      {"sources", {{{"type", "edge"}, {"featureId", "context-source"},
                     {"persistentEdgeId", circleEdge}}}}};
  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      "context-a", "private-a", edgeDefinition.dump(), &error)) << error;
  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      "context-b", "private-b", edgeDefinition.dump(), &error)) << error;
  kreoda::SketchFeature a, b;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("context-a", &a));
  ASSERT_TRUE(kreoda::SketchStore::instance().get("context-b", &b));
  const auto aBindings = kreoda::Json::parse(
      a.projectionGroups.front().bindingsJson);
  const auto bBindings = kreoda::Json::parse(
      b.projectionGroups.front().bindingsJson);
  ASSERT_EQ(aBindings["entries"].size(), 1u);
  ASSERT_EQ(bBindings["entries"].size(), 1u);
  EXPECT_NE(aBindings["entries"][0]["selectionEntry"],
            bBindings["entries"][0]["selectionEntry"]);

  a.projectionGroups.front().bindingsJson = kreoda::Json{
      {"version", 1},
      {"entries", {{{"sourceIdentity", aBindings["entries"][0]["sourceIdentity"]},
                     {"selectionEntry", bBindings["entries"][0]["selectionEntry"]}}}}}.dump();
  auto& ocaf = kreoda::OcafLive::instance();
  ASSERT_TRUE(ocaf.BeginCommand(&error)) << error;
  if (!ocaf.UpsertSketch("context-a", kreoda::SerializeSketchFeature(a),
                         &error)) {
    ocaf.AbortCommand();
    FAIL() << error;
    return;
  }
  if (!ocaf.CommitCommand(nullptr, &error)) {
    ocaf.AbortCommand();
    FAIL() << error;
    return;
  }
  ASSERT_TRUE(ocaf.ResyncStore(&error)) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("context-a", &a));
  ASSERT_TRUE(kreoda::SketchStore::instance().get("context-b", &b));
  ASSERT_EQ(a.projectionGroups.size(), 1u);
  ASSERT_EQ(b.projectionGroups.size(), 1u);
  EXPECT_EQ(a.projectionGroups.front().status, "broken");
  EXPECT_NE(a.projectionGroups.front().error.find("context"), std::string::npos)
      << a.projectionGroups.front().error;
  EXPECT_EQ(b.projectionGroups.front().status, "ok");

  ASSERT_TRUE(StartProjectionDocument("projection-indexed-loss", &error))
      << error;
  gp_Trsf rotation;
  rotation.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 0.3);
  const auto imported = BRepBuilderAPI_Transform(
      BRepPrimAPI_MakeBox(10, 20, 30).Shape(), rotation, true).Shape();
  ASSERT_TRUE(kreoda::CommitSingleFeature(
      "indexed-source", "Imported", {}, {}, "", imported, &error)) << error;
  kreoda::ShapeRecord indexedSource;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("indexed-source", &indexedSource));
  std::string indexedEdgeId;
  for (const auto& role : kreoda::ClassifyEdgeRoles(
           indexedSource.shape, indexedSource.type, indexedSource.featureId)) {
    if (!kreoda::HasIndexedTopologyRole(role.persistentEdgeId)) continue;
    const BRepAdaptor_Curve curve(role.edge);
    if (curve.GetType() == GeomAbs_Line &&
        std::fabs(curve.Line().Direction().Z()) < 0.5) {
      indexedEdgeId = role.persistentEdgeId;
      break;
    }
  }
  ASSERT_FALSE(indexedEdgeId.empty());
  ASSERT_TRUE(kreoda::CreateSketchFeature(
      "indexed-target", "XY", {}, &error)) << error;
  const kreoda::Json indexedDefinition = {
      {"version", 1}, {"operation", "projectEdges"},
      {"sources", {{{"type", "edge"}, {"featureId", "indexed-source"},
                     {"persistentEdgeId", indexedEdgeId}}}}};
  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      "indexed-target", "indexed-link", indexedDefinition.dump(), &error))
      << error;
  kreoda::SketchFeature indexedTarget;
  ASSERT_TRUE(kreoda::SketchStore::instance().get(
      "indexed-target", &indexedTarget));
  const std::string indexedBinding =
      indexedTarget.projectionGroups.front().bindingsJson;
  ASSERT_EQ(indexedTarget.projectionGroups.front().status, "ok");

  // Replace native topology while keeping its owner id and indexed role text.
  // The previously selected edge is now detached; no new ordinal can stand in.
  indexedSource.shape = BRepBuilderAPI_Copy(indexedSource.shape).Shape();
  kreoda::ShapeStore::instance().put(indexedSource);
  auto candidate = indexedTarget;
  const bool staged = kreoda::ResolveSketchProjectionGroups(
      &candidate, kreoda::ShapeStore::instance().listInOrder(),
      kreoda::SketchStore::instance().listInOrder(),
      kreoda::DatumStore::instance().listInOrder(),
      ocaf.SketchProjectionSourceResolver(), "", true, false, nullptr, &error);
  ASSERT_TRUE(staged) << error;
  ASSERT_EQ(candidate.projectionGroups.size(), 1u);
  EXPECT_EQ(candidate.projectionGroups.front().status, "broken");
  EXPECT_NE(candidate.projectionGroups.front().error.find("indexed"),
            std::string::npos) << candidate.projectionGroups.front().error;
  EXPECT_TRUE(candidate.projectionGroups.front().evaluatedEdges.empty());
  EXPECT_EQ(candidate.projectionGroups.front().bindingsJson, indexedBinding);
  ASSERT_TRUE(kreoda::SketchStore::instance().get(
      "indexed-target", &indexedTarget));
  EXPECT_EQ(indexedTarget.projectionGroups.front().status, "ok");
#else
  GTEST_SKIP() << "needs OCCT";
#endif
}

TEST(SketchProjectionPersistence, IncomingIcadWinsOverSameLiveIdsAndGeometryDiffers) {
#if KREODA_WITH_OCCT && KREODA_WITH_MINIZIP
  namespace fs = std::filesystem;
  const fs::path tempDir = fs::temp_directory_path() /
      ("kreoda-projection-incoming-" + std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()));
  struct TempDirectory {
    fs::path path;
    ~TempDirectory() {
      std::error_code ignored;
      fs::remove_all(path, ignored);
    }
  } cleanup{tempDir};
  std::error_code fsError;
  ASSERT_TRUE(fs::create_directories(tempDir, fsError)) << fsError.message();
  std::string error;
  constexpr const char* kIncomingDocument = "projection-incoming-source";
  constexpr const char* kLiveDocument = "projection-live-conflict";
  ASSERT_TRUE(StartProjectionDocument(kIncomingDocument, &error)) << error;
  ASSERT_TRUE(kreoda::CreateCylinderFeature("shared-source", 3, 10, &error))
      << error;
  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("shared-source", &source));
  std::string edgeId;
  for (const auto& role : kreoda::ClassifyEdgeRoles(
           source.shape, source.type, source.featureId)) {
    if (role.persistentEdgeId.find("edge.cir.") != std::string::npos &&
        role.persistentEdgeId.find("cyl.+Z") != std::string::npos) {
      edgeId = role.persistentEdgeId;
      break;
    }
  }
  ASSERT_FALSE(edgeId.empty());
  ASSERT_TRUE(kreoda::CreateSketchFeature("shared-target", "XY", {}, &error))
      << error;
  const kreoda::Json definition = {
      {"version", 1}, {"operation", "projectEdges"},
      {"sources", {{{"type", "edge"}, {"featureId", "shared-source"},
                     {"persistentEdgeId", edgeId}}}}};
  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      "shared-target", "shared-link", definition.dump(), &error)) << error;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature(
      "shared-solid", "shared-target", 4, &error)) << error;
  const fs::path xbf = tempDir / "incoming.xbf";
  const fs::path icad = tempDir / "incoming.icad";
  const std::string manifest = kreoda::Json{
      {"format", "kreoda-project"}, {"schemaVersion", 1},
      {"appVersion", "0.1.0"}, {"documentId", kIncomingDocument},
      {"units", "mm"},
      {"bodies", kreoda::Json::parse(kreoda::SerializeBodiesJson())},
      {"referencePlanesJson", "[]"}}.dump();
  ASSERT_TRUE(kreoda::OcafLive::instance().Save(xbf.string(), &error)) << error;
  ASSERT_TRUE(kreoda::WriteIcad(icad.string(), manifest, xbf.string(), &error))
      << error;

  // The live document has the same feature/sketch ids and selector contexts,
  // but a different source radius and therefore different native geometry.
  ASSERT_TRUE(StartProjectionDocument(kLiveDocument, &error)) << error;
  ASSERT_TRUE(kreoda::CreateCylinderFeature("shared-source", 7, 10, &error))
      << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("shared-target", "XY", {}, &error))
      << error;
  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      "shared-target", "shared-link", definition.dump(), &error)) << error;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature(
      "shared-solid", "shared-target", 4, &error)) << error;
  kreoda::ShapeRecord liveSolid;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("shared-solid", &liveSolid));
  EXPECT_NEAR(liveSolid.volumeMm3, std::acos(-1.0) * 49 * 4, 1e-6);

  const auto opened = ProjectionRpc(kLiveDocument, kreoda::kOpenDocument,
                                    {{"path", icad.generic_string()}});
  ASSERT_EQ(opened["status"], "ok") << opened.dump();
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("shared-source", &source));
  ASSERT_EQ(source.paramsMm.size(), 2u);
  EXPECT_DOUBLE_EQ(source.paramsMm[0], 3);
  kreoda::SketchFeature target;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("shared-target", &target));
  ASSERT_EQ(target.projectionGroups.size(), 1u);
  EXPECT_EQ(target.projectionGroups.front().status, "ok");
  ASSERT_TRUE(kreoda::GetCurrentShapeRecord("shared-solid", &liveSolid, &error))
      << error;
  EXPECT_EQ(liveSolid.featureId, "shared-solid");
  EXPECT_NEAR(liveSolid.volumeMm3, std::acos(-1.0) * 9 * 4, 1e-6);

  ASSERT_TRUE(kreoda::RebuildFeature("shared-source", "radiusMm", 4, &error))
      << error;
  ASSERT_TRUE(kreoda::GetCurrentShapeRecord("shared-solid", &liveSolid, &error))
      << error;
  EXPECT_EQ(liveSolid.featureId, "shared-solid");
  EXPECT_NEAR(liveSolid.volumeMm3, std::acos(-1.0) * 16 * 4, 1e-6);
#else
  GTEST_SKIP() << "needs OCCT + minizip-ng";
#endif
}

TEST(SketchProjectionSources, RejectsDuplicateAndMissingEntityIdsAtomically) {
  kreoda::SketchFeature source;
  source.id = "source";
  source.model.points = {{"a", 0, 0}, {"b", 2, 0}, {"center", 5, 0}};
  source.model.lines = {{"same", "a", "b"}};
  source.model.circles = {{"same", "center", 1}};
  std::vector<TopoDS_Edge> output{
      BRepBuilderAPI_MakeEdge(gp_Pnt(8, 0, 0), gp_Pnt(9, 0, 0)).Edge()};
  const auto before = output.front();
  std::string error;

  EXPECT_FALSE(kreoda::BuildSketchEntityEdges(
      source, {"same", "missing"}, &output, &error));
  EXPECT_EQ(output.size(), 1u);
  EXPECT_TRUE(output.front().IsSame(before));
}
#endif

TEST(SketchProjectionPersistence, RejectsMalformedPresentGroups) {
  kreoda::SketchFeature parsed;
  std::string error;
  const std::string json =
      R"({"id":"target","planeKind":"XY","model":{"points":[],"lines":[],"circles":[],"arcs":[],"constraints":[]},"projectionGroups":[{"groupId":"g","definition":{"version":2}}]})";

  EXPECT_FALSE(kreoda::ParseSketchFeature(json, &parsed, &error));
  EXPECT_NE(error.find("projection"), std::string::npos) << error;
}

TEST(SketchProjectionPersistence, KeepsLegacyGroupFreeSketchesReadable) {
  kreoda::SketchFeature parsed;
  std::string error;
  const std::string json =
      R"({"id":"legacy","planeKind":"XY","model":{"points":[],"lines":[],"circles":[],"arcs":[],"constraints":[]}})";

  ASSERT_TRUE(kreoda::ParseSketchFeature(json, &parsed, &error)) << error;
  EXPECT_EQ(parsed.id, "legacy");
}

TEST(SketchProjectionPersistence, PreservesValidatedGroupDefinitions) {
  kreoda::SketchFeature parsed;
  std::string error;
  const std::string json =
      R"({"id":"target","planeKind":"XY","model":{"points":[],"lines":[],"circles":[],"arcs":[],"constraints":[]},"projectionGroups":[{"groupId":"linked","definition":{"version":1,"operation":"projectEdges","sources":[{"type":"edge","featureId":"source","persistentEdgeId":"source:edge.lin.box.+X~box.+Z"}]},"bindings":{"version":1,"entries":[]}}]})";

  ASSERT_TRUE(kreoda::ParseSketchFeature(json, &parsed, &error)) << error;
  const std::string serialized = kreoda::SerializeSketchFeature(parsed);
  EXPECT_NE(serialized.find("projectionGroups"), std::string::npos);
  EXPECT_NE(serialized.find("box.+X~box.+Z"), std::string::npos);
}

TEST(SketchProjectionPersistence, RejectsUnknownGroupFieldsAndVersions) {
  std::string error;
  kreoda::SketchFeature parsed;
  const std::string base =
      R"({"id":"target","planeKind":"XY","model":{"points":[],"lines":[],"circles":[],"arcs":[],"constraints":[]},"projectionGroups":[{"groupId":"linked","definition":{"version":1,"operation":"projectEdges","sources":[{"type":"edge","featureId":"source","persistentEdgeId":"source:edge.lin.x"}]},"bindings":{"version":1,"entries":[]},"untrusted":true}]})";
  EXPECT_FALSE(kreoda::ParseSketchFeature(base, &parsed, &error));
  EXPECT_NE(error.find("projection"), std::string::npos) << error;

  const std::string unsupported =
      R"({"id":"target","planeKind":"XY","model":{"points":[],"lines":[],"circles":[],"arcs":[],"constraints":[]},"projectionGroups":[{"groupId":"linked","definition":{"version":2,"operation":"projectEdges","sources":[{"type":"edge","featureId":"source","persistentEdgeId":"source:edge.lin.x"}]},"bindings":{"version":1,"entries":[]}}]})";
  EXPECT_FALSE(kreoda::ParseSketchFeature(unsupported, &parsed, &error));
  EXPECT_NE(error.find("projection"), std::string::npos) << error;
}

TEST(SketchProjectionPersistence, AuthoredEntitySourceIdentityCannotCollideOnDelimiters) {
  const kreoda::Json definition = {
      {"version", 1},
      {"operation", "projectEdges"},
      {"sources", {{{"type", "sketchEntities"},
                     {"featureId", "source"},
                     {"entityIds", {"a|b", "c"}}},
                    {{"type", "sketchEntities"},
                     {"featureId", "source"},
                     {"entityIds", {"a", "b|c"}}}}}};
  std::string canonical, error;
  std::vector<std::string> sourceIds;
  EXPECT_TRUE(kreoda::ValidateSketchProjectionDefinition(
      "linked", definition.dump(), &canonical, &sourceIds, &error)) << error;
  EXPECT_EQ(sourceIds, (std::vector<std::string>{"source", "source"}));
}

TEST(SketchProjectionPersistence, AllowsFullAggregateOfBoundedGroupDefinitions) {
  kreoda::Json groups = kreoda::Json::array();
  for (int group = 0; group < 40; ++group) {
    kreoda::Json sources = kreoda::Json::array();
    for (int edge = 0; edge < 60; ++edge) {
      sources.push_back({{"type", "edge"},
                         {"featureId", "source"},
                         {"persistentEdgeId", "source:" + std::string(480, 'x') +
                                                  std::to_string(edge)}});
    }
    groups.push_back({{"groupId", "g" + std::to_string(group)},
                      {"definition", {{"version", 1},
                                      {"operation", "projectEdges"},
                                      {"sources", sources}}},
                      {"bindings", {{"version", 1}, {"entries", kreoda::Json::array()}}}});
  }
  const auto serialized = groups.dump();
  ASSERT_GT(serialized.size(), 1024u * 1024u);
  std::vector<kreoda::SketchProjectionGroup> parsed;
  std::string error;
  EXPECT_TRUE(kreoda::ParseSketchProjectionGroups(serialized, &parsed, &error)) << error;
  EXPECT_EQ(parsed.size(), 40u);
}

TEST(SketchProjectionPublicWire, DispatchesAndSamplesCurvedGeometryReadOnly) {
#if KREODA_WITH_OCCT
  std::string error;
  ASSERT_TRUE(StartProjectionDocument("projection-public-wire", &error)) << error;

  kreoda::SketchPlane sourcePlane = kreoda::PrincipalPlane("XY");
  sourcePlane.origin[0] = 14;
  sourcePlane.origin[1] = -8;
  sourcePlane.origin[2] = 12;
  ASSERT_TRUE(kreoda::CreateSketchFeature(
      "wire-source", "XY", CircleModel(2, 1), sourcePlane, &error)) << error;
  const auto targetPlane = TiltedProjectionPlane();
  ASSERT_TRUE(kreoda::CreateSketchFeature(
      "wire-target", "XY", {}, targetPlane, &error)) << error;

  const kreoda::Json definition =
      SketchEntityProjection("wire-source", {"circle"});
  const auto set = ProjectionRpc("projection-public-wire", 36,
      {{"featureId", "wire-target"}, {"groupId", "wire-link"},
       {"definition", definition}});
  ASSERT_EQ(set.value("status", ""), "ok") << set.dump();
  EXPECT_EQ(set["featureId"], "wire-target");
  EXPECT_EQ(set["sketch"]["projectionGroups"][0]["groupId"], "wire-link");
  EXPECT_EQ(set["sketch"]["projectionGroups"][0]["status"], "ok");

  kreoda::SketchFeature sourceSketch;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("wire-source", &sourceSketch));
  TopoDS_Shape sourceProfile;
  ASSERT_TRUE(kreoda::BuildProfileFromSketch(sourceSketch, &sourceProfile, &error))
      << error;
  TopoDS_Edge sourceEdge;
  for (TopExp_Explorer explorer(sourceProfile, TopAbs_EDGE); explorer.More();
       explorer.Next()) {
    sourceEdge = TopoDS::Edge(explorer.Current());
    break;
  }
  ASSERT_FALSE(sourceEdge.IsNull());
  kreoda::SketchFeature targetSketch;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("wire-target", &targetSketch));
  ASSERT_EQ(targetSketch.projectionGroups.size(), 1u);
  ASSERT_EQ(targetSketch.projectionGroups.front().evaluatedEdges.size(), 1u);
  const auto& projectedEdge = targetSketch.projectionGroups.front().evaluatedEdges.front();
  constexpr double kCadToleranceMm = 1e-6;
  EXPECT_LE(ProjectionDeviation(sourceEdge, projectedEdge, targetPlane),
            kCadToleranceMm);
  const double initialVolumeTolerance = ProjectionAreaTolerance(projectedEdge) * 5;

  ASSERT_TRUE(kreoda::CreateExtrudeFeature(
      "wire-solid", "wire-target", 5, &error)) << error;
  kreoda::ShapeRecord beforeEdit;
  ASSERT_TRUE(kreoda::GetCurrentShapeRecord("wire-solid", &beforeEdit, &error))
      << error;
  const double planeCosine = 3.0 / std::sqrt(14.0);
  const double initialVolume = std::acos(-1.0) * 4 * planeCosine * 5;
  EXPECT_NEAR(beforeEdit.volumeMm3, initialVolume, initialVolumeTolerance);
  const auto stableSolidId = beforeEdit.featureId;

  const auto revisionBeforeQuery = kreoda::DocumentStore::instance().revision();
  const auto query = ProjectionRpc("projection-public-wire", 38,
      {{"featureId", "wire-target"}});
  ASSERT_EQ(query.value("status", ""), "ok") << query.dump();
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revisionBeforeQuery);
  ASSERT_EQ(query["projection"]["featureId"], "wire-target");
  ASSERT_EQ(query["projection"]["plane"]["origin"],
            (kreoda::Json{2, -3, 8}));
  ASSERT_EQ(query["projection"]["groups"].size(), 1u);
  const auto& group = query["projection"]["groups"][0];
  EXPECT_EQ(group["groupId"], "wire-link");
  EXPECT_EQ(group["sourceFeatureIds"], (kreoda::Json{"wire-source"}));
  EXPECT_EQ(group["status"], "ok");
  ASSERT_EQ(group["edges"].size(), 1u);
  const auto& edge = group["edges"][0];
  EXPECT_EQ(edge["memberIndex"], 0);
  EXPECT_TRUE(edge["closed"].get<bool>());
  ASSERT_EQ(edge["pointsMm"].size(), 129u);
  const auto firstPoint = gp_Pnt(edge["pointsMm"][0][0].get<double>(),
                                 edge["pointsMm"][0][1].get<double>(),
                                 edge["pointsMm"][0][2].get<double>());
  const auto lastPoint = gp_Pnt(edge["pointsMm"][128][0].get<double>(),
                                edge["pointsMm"][128][1].get<double>(),
                                edge["pointsMm"][128][2].get<double>());
  EXPECT_LE(firstPoint.Distance(lastPoint), 1e-7);

  kreoda::SketchFeature target;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("wire-target", &target));
  ASSERT_EQ(target.projectionGroups.size(), 1u);
  ASSERT_EQ(target.projectionGroups.front().evaluatedEdges.size(), 1u);
  BRepAdaptor_Curve nativeCurve(target.projectionGroups.front().evaluatedEdges.front());
  EXPECT_DOUBLE_EQ(edge["firstParameter"].get<double>(), nativeCurve.FirstParameter());
  EXPECT_DOUBLE_EQ(edge["lastParameter"].get<double>(), nativeCurve.LastParameter());
  const gp_Pnt sampledStart(edge["pointsMm"][0][0].get<double>(),
                            edge["pointsMm"][0][1].get<double>(),
                            edge["pointsMm"][0][2].get<double>());
  EXPECT_LE(sampledStart.Distance(nativeCurve.Value(nativeCurve.FirstParameter())),
            1e-9);
  std::string nativeCurveType;
  switch (nativeCurve.GetType()) {
    case GeomAbs_Line: nativeCurveType = "line"; break;
    case GeomAbs_Circle: nativeCurveType = "circle"; break;
    case GeomAbs_Ellipse: nativeCurveType = "ellipse"; break;
    case GeomAbs_Hyperbola: nativeCurveType = "hyperbola"; break;
    case GeomAbs_Parabola: nativeCurveType = "parabola"; break;
    case GeomAbs_BezierCurve: nativeCurveType = "bezier"; break;
    case GeomAbs_BSplineCurve: nativeCurveType = "bspline"; break;
    case GeomAbs_OffsetCurve: nativeCurveType = "offset"; break;
    default: nativeCurveType = "other"; break;
  }
  EXPECT_EQ(edge["curveType"], nativeCurveType);

  const gp_Pnt sourceCenter(15, -8, 12);
  const gp_Pnt targetOrigin(targetPlane.origin[0], targetPlane.origin[1],
                            targetPlane.origin[2]);
  const gp_Vec normal(targetPlane.normal[0], targetPlane.normal[1],
                      targetPlane.normal[2]);
  const gp_Pnt projectedCenter = sourceCenter.Translated(
      -gp_Vec(targetOrigin, sourceCenter).Dot(normal) * normal);
  const auto projectDirection = [&](const gp_Vec& direction) {
    return direction - normal.Dot(direction) * normal;
  };
  const gp_Vec projectedX = projectDirection(gp_Vec(1, 0, 0));
  const gp_Vec projectedY = projectDirection(gp_Vec(0, 1, 0));
  const double xx = projectedX.Dot(projectedX);
  const double xy = projectedX.Dot(projectedY);
  const double yy = projectedY.Dot(projectedY);
  const double determinant = xx * yy - xy * xy;
  ASSERT_GT(determinant, 0);
  for (const auto& point : edge["pointsMm"]) {
    ASSERT_EQ(point.size(), 3u);
    const gp_Pnt worldPoint(point[0].get<double>(), point[1].get<double>(),
                            point[2].get<double>());
    const gp_Vec fromOrigin(targetOrigin, worldPoint);
    EXPECT_NEAR(fromOrigin.Dot(normal), 0, 1e-7);
    const gp_Vec offset(projectedCenter, worldPoint);
    const double x = offset.Dot(projectedX);
    const double y = offset.Dot(projectedY);
    const double localX = (x * yy - y * xy) / determinant;
    const double localY = (y * xx - x * xy) / determinant;
    EXPECT_NEAR(localX * localX + localY * localY, 4, 1e-5);
  }

  const auto secondQuery = ProjectionRpc("projection-public-wire", 38,
      {{"featureId", "wire-target"}});
  ASSERT_EQ(secondQuery.value("status", ""), "ok") << secondQuery.dump();
  EXPECT_EQ(secondQuery["projection"], query["projection"]);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revisionBeforeQuery);
  const auto unexpectedRevision = ProjectionRpc("projection-public-wire", 38,
      {{"featureId", "wire-target"}, {"expectedRevision", revisionBeforeQuery}});
  EXPECT_EQ(unexpectedRevision["status"], "error");
  EXPECT_EQ(unexpectedRevision["errorCode"], "BAD_PARAMS");

  ASSERT_TRUE(kreoda::UpdateSketchFeature(
      "wire-source", CircleModel(3, 1), &error)) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("wire-target", &targetSketch));
  ASSERT_EQ(targetSketch.projectionGroups.size(), 1u);
  ASSERT_EQ(targetSketch.projectionGroups.front().evaluatedEdges.size(), 1u);
  const double updatedVolumeTolerance =
      ProjectionAreaTolerance(targetSketch.projectionGroups.front().evaluatedEdges.front()) * 5;
  kreoda::ShapeRecord afterEdit;
  ASSERT_TRUE(kreoda::GetCurrentShapeRecord("wire-solid", &afterEdit, &error))
      << error;
  EXPECT_EQ(afterEdit.featureId, stableSolidId);
  EXPECT_NEAR(afterEdit.volumeMm3,
              std::acos(-1.0) * 9 * planeCosine * 5, updatedVolumeTolerance);

  const auto blockedRemove = ProjectionRpc("projection-public-wire", 37,
      {{"featureId", "wire-target"}, {"groupId", "wire-link"}});
  EXPECT_EQ(blockedRemove.value("status", ""), "error") << blockedRemove.dump();
  EXPECT_EQ(blockedRemove.value("errorCode", ""), "PROJECTION_FAILED");
  ASSERT_TRUE(kreoda::SketchStore::instance().get("wire-target", &target));
  ASSERT_EQ(target.projectionGroups.size(), 1u);
  ASSERT_TRUE(kreoda::GetCurrentShapeRecord("wire-solid", &afterEdit, &error))
      << error;
  EXPECT_EQ(afterEdit.featureId, stableSolidId);
  EXPECT_NEAR(afterEdit.volumeMm3,
              std::acos(-1.0) * 9 * planeCosine * 5, updatedVolumeTolerance);

  const auto deleted = ProjectionRpc("projection-public-wire",
      kreoda::kDeleteFeature, {{"featureId", "wire-solid"}});
  ASSERT_EQ(deleted.value("status", ""), "ok") << deleted.dump();
  const auto remove = ProjectionRpc("projection-public-wire", 37,
      {{"featureId", "wire-target"}, {"groupId", "wire-link"}});
  ASSERT_EQ(remove.value("status", ""), "ok") << remove.dump();
  EXPECT_EQ(remove["featureId"], "wire-target");
  EXPECT_TRUE(remove["sketch"]["projectionGroups"].empty());
  const auto afterRemove = ProjectionRpc("projection-public-wire", 38,
      {{"featureId", "wire-target"}});
  ASSERT_EQ(afterRemove.value("status", ""), "ok") << afterRemove.dump();
  EXPECT_TRUE(afterRemove["projection"]["groups"].empty());
#else
  GTEST_SKIP() << "needs OCCT";
#endif
}

TEST(SketchProjectionPublicWire, HidesCachedEdgesWhenSourceClosureIsUnavailable) {
#if KREODA_WITH_OCCT
  std::string error;
  ASSERT_TRUE(StartProjectionDocument("projection-public-wire-unavailable", &error))
      << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature(
      "stale-source", "XY", CircleModel(2), &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("stale-target", "XY", {}, &error))
      << error;
  const auto definition = SketchEntityProjection("stale-source", {"circle"});
  const auto set = ProjectionRpc("projection-public-wire-unavailable", 36,
      {{"featureId", "stale-target"}, {"groupId", "stale-link"},
       {"definition", definition}});
  ASSERT_EQ(set.value("status", ""), "ok") << set.dump();
  kreoda::SketchFeature stored;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("stale-target", &stored));
  ASSERT_EQ(stored.projectionGroups.size(), 1u);
  ASSERT_EQ(stored.projectionGroups.front().evaluatedEdges.size(), 1u);

  ASSERT_TRUE(kreoda::SketchStore::instance().remove("stale-source"));
  const auto revision = kreoda::DocumentStore::instance().revision();
  const auto query = ProjectionRpc("projection-public-wire-unavailable", 38,
      {{"featureId", "stale-target"}});
  ASSERT_EQ(query.value("status", ""), "ok") << query.dump();
  const auto& result = query["projection"];
  EXPECT_FALSE(result["geometryCurrent"].get<bool>());
  EXPECT_EQ(result["status"], "unavailable");
  EXPECT_NE(result["error"].get<std::string>().find("stale-source"),
            std::string::npos);
  EXPECT_EQ(result["blockingSourceIds"], (kreoda::Json{"stale-source"}));
  ASSERT_EQ(result["groups"].size(), 1u);
  EXPECT_EQ(result["groups"][0]["status"], "ok");
  EXPECT_TRUE(result["groups"][0]["edges"].empty());
  ASSERT_TRUE(kreoda::SketchStore::instance().get("stale-target", &stored));
  EXPECT_EQ(stored.projectionGroups.front().evaluatedEdges.size(), 1u);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
#else
  GTEST_SKIP() << "needs OCCT";
#endif
}

TEST(SketchProjectionPublicWire, SerializesLineEdgesWithTwoWorldSpaceEndpoints) {
#if KREODA_WITH_OCCT
  std::string error;
  ASSERT_TRUE(StartProjectionDocument("projection-public-wire-line", &error))
      << error;

  kreoda::SketchModel sourceModel;
  sourceModel.points = {{"start", 1, 2}, {"end", 4, 6}};
  sourceModel.lines = {{"diagonal", "start", "end"}};
  ASSERT_TRUE(kreoda::CreateSketchFeature(
      "line-source", "XY", sourceModel, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature(
      "line-target", "XY", {}, &error)) << error;
  const auto definition = SketchEntityProjection("line-source", {"diagonal"});
  const auto set = ProjectionRpc("projection-public-wire-line", 36,
      {{"featureId", "line-target"}, {"groupId", "line-link"},
       {"definition", definition}});
  ASSERT_EQ(set.value("status", ""), "ok") << set.dump();

  const auto query = ProjectionRpc("projection-public-wire-line", 38,
      {{"featureId", "line-target"}});
  ASSERT_EQ(query.value("status", ""), "ok") << query.dump();
  const auto& edges = query["projection"]["groups"][0]["edges"];
  ASSERT_EQ(edges.size(), 1u);
  EXPECT_EQ(edges[0]["curveType"], "line");
  EXPECT_FALSE(edges[0]["closed"].get<bool>());
  ASSERT_EQ(edges[0]["pointsMm"].size(), 2u);
  EXPECT_EQ(edges[0]["pointsMm"][0], (kreoda::Json{1, 2, 0}));
  EXPECT_EQ(edges[0]["pointsMm"][1], (kreoda::Json{4, 6, 0}));
#else
  GTEST_SKIP() << "needs OCCT";
#endif
}

TEST(SketchProjectionPublicWire, ValidatesErrorsAndJoinsOwnerTransaction) {
#if KREODA_WITH_OCCT
  std::string error;
  ASSERT_TRUE(StartProjectionDocument("projection-public-wire-transaction", &error))
      << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature(
      "transaction-source", "XY", CircleModel(2), &error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature(
      "transaction-target", "XY", {}, &error)) << error;
  const auto definition = SketchEntityProjection("transaction-source", {"circle"});
  const auto revision = kreoda::DocumentStore::instance().revision();

  auto response = ProjectionRpc("projection-public-wire-transaction",
      kreoda::kRequestSketchProjection, {{"featureId", "missing-sketch"}});
  EXPECT_EQ(response["errorCode"], "NOT_FOUND");
  response = ProjectionRpc("projection-public-wire-transaction",
      kreoda::kRequestSketchProjection,
      {{"featureId", "transaction-target"}, {"groupId", "missing-group"}});
  EXPECT_EQ(response["errorCode"], "NOT_FOUND");
  response = ProjectionRpc("projection-public-wire-transaction",
      kreoda::kRemoveSketchProjection,
      {{"featureId", "transaction-target"}, {"groupId", "missing-group"}});
  EXPECT_EQ(response["errorCode"], "NOT_FOUND");
  response = ProjectionRpc("projection-public-wire-transaction",
      kreoda::kRequestSketchProjection,
      {{"featureId", "transaction-target"}, {"unknown", true}});
  EXPECT_EQ(response["errorCode"], "BAD_PARAMS");

  response = ProjectionRpc("projection-public-wire-transaction",
      kreoda::kSetSketchProjection,
      {{"featureId", "transaction-target"}, {"groupId", "bad group"},
       {"definition", definition}});
  EXPECT_EQ(response["errorCode"], "BAD_PARAMS");
  response = ProjectionRpc("projection-public-wire-transaction",
      kreoda::kSetSketchProjection,
      {{"featureId", "transaction-target"}, {"groupId", "private"},
       {"definition", {{"version", 1}, {"operation", "projectEdges"},
                       {"sources", kreoda::Json::array()}, {"bindings", {}}}}});
  EXPECT_EQ(response["errorCode"], "BAD_PARAMS");
  response = ProjectionRpc("projection-public-wire-transaction",
      kreoda::kSetSketchProjection,
      {{"featureId", "transaction-target"}, {"groupId", "missing-source"},
       {"definition", SketchEntityProjection("missing-source", {"circle"})}});
  EXPECT_EQ(response["errorCode"], "PROJECTION_FAILED") << response.dump();
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);

  kreoda::Json oversizedSources = kreoda::Json::array();
  std::string multibyte;
  for (int index = 0; index < 236; ++index) multibyte += "\xC3\xA9";
  for (int index = 0; index < 128; ++index)
    oversizedSources.push_back({{"type", "edge"}, {"featureId", "source"},
        {"persistentEdgeId", "source:" + multibyte + ":" +
                                 std::to_string(index)}});
  const auto oversized = kreoda::Json{{"version", 1}, {"operation", "projectEdges"},
                                      {"sources", oversizedSources}};
  response = ProjectionRpc("projection-public-wire-transaction",
      kreoda::kSetSketchProjection,
      {{"featureId", "transaction-target"}, {"groupId", "oversized"},
       {"definition", oversized}});
  EXPECT_EQ(response["errorCode"], "BAD_PARAMS") << response.dump();
  EXPECT_NE(response["errorMessage"].get<std::string>().find("65536 UTF-8 bytes"),
            std::string::npos);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);

  response = ProjectionRpc("projection-public-wire-transaction",
      kreoda::kBeginTransaction, {{"transactionId", "projection-owner"}});
  ASSERT_EQ(response["status"], "ok") << response.dump();
  response = ProjectionRpc("projection-public-wire-transaction",
      kreoda::kSetSketchProjection,
      {{"featureId", "transaction-target"}, {"groupId", "owned"},
       {"definition", definition}, {"transactionId", "other-owner"}});
  EXPECT_EQ(response["errorCode"], "TRANSACTION_OPEN");
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);

  response = ProjectionRpc("projection-public-wire-transaction",
      kreoda::kSetSketchProjection,
      {{"featureId", "transaction-target"}, {"groupId", "owned"},
       {"definition", definition}, {"transactionId", "projection-owner"}});
  ASSERT_EQ(response["status"], "ok") << response.dump();
  auto query = ProjectionRpc("projection-public-wire-transaction",
      kreoda::kRequestSketchProjection, {{"featureId", "transaction-target"}});
  ASSERT_EQ(query["status"], "ok") << query.dump();
  ASSERT_EQ(query["projection"]["groups"].size(), 1u);
  EXPECT_EQ(query["projection"]["groups"][0]["groupId"], "owned");

  response = ProjectionRpc("projection-public-wire-transaction",
      kreoda::kSetSketchProjection,
      {{"featureId", "transaction-target"}, {"groupId", "failed"},
       {"definition", SketchEntityProjection("missing-source", {"circle"})},
       {"transactionId", "projection-owner"}});
  EXPECT_EQ(response["errorCode"], "PROJECTION_FAILED");
  response = ProjectionRpc("projection-public-wire-transaction",
      kreoda::kRollbackTransaction, {{"transactionId", "projection-owner"}});
  ASSERT_EQ(response["status"], "ok") << response.dump();
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
  query = ProjectionRpc("projection-public-wire-transaction",
      kreoda::kRequestSketchProjection, {{"featureId", "transaction-target"}});
  ASSERT_EQ(query["status"], "ok") << query.dump();
  EXPECT_TRUE(query["projection"]["groups"].empty());
#else
  GTEST_SKIP() << "needs OCCT";
#endif
}
