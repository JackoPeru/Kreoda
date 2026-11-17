// Cross-feature acceptance witness: sparse configurations must not detach an
// associative native projection, and failed source selection must not publish
// partial model/configuration state. This is deliberately NOT another isolated
// configuration switch or sketch-projection lifecycle fixture.
#include <gtest/gtest.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <string>
#include <vector>

#include "document/document_store.h"
#include "features/configurations/configurations.h"
#include "features/primitives/primitives.h"
#include "features/sketch/sketch_commands.h"
#include "features/sketch/sketch_json.h"
#include "features/sketch/sketch_projection.h"
#include "features/extrusion/extrude.h"
#include "model/geometry_availability.h"
#include "model/commit.h"
#include "model/shapes.h"
#include "model/feature_graph.h"
#include "persistence/ocaf_live.h"
#include "protocol/dispatcher.h"
#include "protocol/json_fields.h"
#include "rpc_text.h"

#if KREODA_WITH_OCCT
#include <BRepCheck_Analyzer.hxx>
#include <BRep_Builder.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Face.hxx>
#include <gp_Pnt.hxx>
#include "topology/face_roles.h"
#endif

namespace {
constexpr const char* kDocumentId = "composed-config-projection-document";
constexpr const char* kCylinderId = "composed-source-cylinder";
constexpr const char* kBoxId = "composed-independent-box";
constexpr const char* kSketchId = "composed-projected-sketch";
constexpr const char* kExtrudeId = "composed-projected-solid";
constexpr const char* kGroupId = "composed-circle";
constexpr const char* kAmbiguousImportedId = "composed-ambiguous-import";

kreoda::Json ComposedWire(int command, const std::string& requestId,
                          const kreoda::Json& fields = kreoda::Json::object()) {
  kreoda::Json request = {{"protocolVersion", 1},
                          {"requestId", requestId},
                          {"documentId", kDocumentId},
                          {"type", command}};
  request.update(fields);
  return kreoda::Json::parse(kreoda_test::rpcText(request.dump()));
}

struct ComposedScratchDir {
  explicit ComposedScratchDir() {
    const auto token = std::chrono::steady_clock::now()
                           .time_since_epoch().count();
    root = std::filesystem::temp_directory_path() /
           ("kreoda-composed-config-projection-" + std::to_string(token));
  }
  ~ComposedScratchDir() {
    std::error_code ignored;
    std::filesystem::remove_all(root, ignored);
  }
  std::filesystem::path root;
};

}  // namespace

TEST(ComposedConfigProjection,
     SparseCylinderOverrideReflowsProjectedSolidAndPersistsBaseAtomically) {
#if KREODA_WITH_OCCT && KREODA_WITH_MINIZIP
  using kreoda::ShapeRecord;
  std::string error;
  const auto created = ComposedWire(kreoda::kCreateDocument, "composed-create");
  ASSERT_EQ(created.value("status", ""), "ok") << created.dump();

  // Two independent canonical native B-Reps in the same OCAF document.
  ASSERT_TRUE(kreoda::CreateCylinderFeature(kCylinderId, 2, 6, &error)) << error;
  ASSERT_TRUE(kreoda::CreateBoxFeature(kBoxId, 8, 5, 4, &error)) << error;
  ShapeRecord cylinder, box, derived;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(kCylinderId, &cylinder));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(kBoxId, &box));
  ASSERT_TRUE(BRepCheck_Analyzer(cylinder.shape).IsValid());
  ASSERT_TRUE(BRepCheck_Analyzer(box.shape).IsValid());

  // Bind a semantic +Z circular edge to a separate sketch; its extrude is
  // a real third B-Rep whose radius follows the cylinder's named variant.
  std::string topCircle;
  for (const auto& role : kreoda::ClassifyEdgeRoles(
           cylinder.shape, cylinder.type, cylinder.featureId)) {
    if (role.persistentEdgeId.find("edge.cir.") != std::string::npos &&
        role.persistentEdgeId.find("cyl.+Z") != std::string::npos) {
      topCircle = role.persistentEdgeId;
      break;
    }
  }
  ASSERT_FALSE(topCircle.empty());
  ASSERT_TRUE(kreoda::CreateSketchFeature(kSketchId, "XY", {}, &error)) << error;
  const kreoda::Json projection = {
      {"version", 1}, {"operation", "projectEdges"},
      {"sources", {{{"type", "edge"}, {"featureId", kCylinderId},
                    {"persistentEdgeId", topCircle}}}}};
  ASSERT_TRUE(kreoda::SetSketchProjectionGroup(
      kSketchId, kGroupId, projection.dump(), &error)) << error;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature(kExtrudeId, kSketchId, 3, &error))
      << error;

  const double pi = std::acos(-1.0);
  const auto verify = [&](const std::string& configuration,
                          double radius, double width, double height) {
    nlohmann::json metadata;
    ASSERT_TRUE(kreoda::ReadConfigurationDocument(&metadata, &error)) << error;
    ASSERT_EQ(metadata.at("active"), configuration);
    ASSERT_TRUE(kreoda::ShapeStore::instance().get(kCylinderId, &cylinder));
    ASSERT_TRUE(kreoda::ShapeStore::instance().get(kBoxId, &box));
    ASSERT_TRUE(kreoda::GetCurrentShapeRecord(kExtrudeId, &derived, &error))
        << error;
    ASSERT_EQ(cylinder.paramsMm.size(), 2u);
    ASSERT_EQ(box.paramsMm.size(), 3u);
    EXPECT_EQ(cylinder.featureId, kCylinderId);
    EXPECT_EQ(box.featureId, kBoxId);
    EXPECT_EQ(derived.featureId, kExtrudeId);
    EXPECT_NEAR(cylinder.paramsMm[0], radius, 1e-9);
    EXPECT_NEAR(box.paramsMm[0], width, 1e-9);
    EXPECT_NEAR(box.paramsMm[1], height, 1e-9);
    EXPECT_NEAR(cylinder.volumeMm3, pi * radius * radius * 6, 1e-4);
    EXPECT_NEAR(box.volumeMm3, width * height * 4, 1e-5);
    EXPECT_NEAR(derived.volumeMm3, pi * radius * radius * 3, 1e-4);
    EXPECT_TRUE(BRepCheck_Analyzer(derived.shape).IsValid());
    EXPECT_TRUE(kreoda::GetGeometryAvailability(kExtrudeId).geometryCurrent);

    kreoda::SketchFeature sketch;
    ASSERT_TRUE(kreoda::SketchStore::instance().get(kSketchId, &sketch));
    EXPECT_EQ(sketch.id, kSketchId);
    ASSERT_EQ(sketch.projectionGroups.size(), 1u);
    EXPECT_EQ(sketch.projectionGroups.front().groupId, kGroupId);
    EXPECT_EQ(sketch.projectionGroups.front().status, "ok");
    EXPECT_EQ(sketch.projectionGroups.front().evaluatedEdges.size(), 1u);
  };

  verify("", 2, 8, 5);
  ASSERT_TRUE(kreoda::DefineConfiguration("Medium",
      {{kCylinderId, {{"radiusMm", 3}}}, {kBoxId, {{"widthMm", 12}}}},
      &error)) << error;
  ASSERT_TRUE(kreoda::DefineConfiguration("Large",
      {{kCylinderId, {{"radiusMm", 4}}}, {kBoxId, {{"heightMm", 9}}}},
      &error)) << error;

  const auto beforeMediumRevision = kreoda::DocumentStore::instance().revision();
  const int beforeMediumUndos = kreoda::OcafLive::instance().AvailableUndos();
  ASSERT_TRUE(kreoda::ActivateConfiguration("Medium", &error)) << error;
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),
            beforeMediumRevision + 1);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(),
            beforeMediumUndos + 1);
  verify("Medium", 3, 12, 5);

  // Edits while the named variant is active are made through a *redefinition*
  // of that variant. A bare SetDimension does not persist a named override.
  const auto beforeEditRevision = kreoda::DocumentStore::instance().revision();
  const int beforeEditUndos = kreoda::OcafLive::instance().AvailableUndos();
  ASSERT_TRUE(kreoda::DefineConfiguration("Medium",
      {{kCylinderId, {{"radiusMm", 3.5}}}, {kBoxId, {{"widthMm", 12}}}},
      &error)) << error;
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),
            beforeEditRevision + 1);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(),
            beforeEditUndos + 1);
  verify("Medium", 3.5, 12, 5);

  // One definition edit == exactly one Undo. Both the native source and its
  // projected B-Rep must travel together, without a second hidden Undo.
  const auto undoEdit = ComposedWire(kreoda::kUndo, "composed-edit-undo");
  ASSERT_EQ(undoEdit.value("status", ""), "ok") << undoEdit.dump();
  verify("Medium", 3, 12, 5);
  const auto redoEdit = ComposedWire(kreoda::kRedo, "composed-edit-redo");
  ASSERT_EQ(redoEdit.value("status", ""), "ok") << redoEdit.dump();
  verify("Medium", 3.5, 12, 5);

  // An ambiguous *proposal* (two conflicting source claims to the same
  // physical edge) must be rejected without creating a broken projected
  // solid, changing OCAF history, or changing the active sparse variant.
  // This is a duplicate source-identity check, NOT a claim that every
  // ambiguous multi-face imported topology was exercised here.
  kreoda::SketchFeature persistedSketch;
  ASSERT_TRUE(kreoda::SketchStore::instance().get(kSketchId, &persistedSketch));
  const std::string sketchBefore =
      kreoda::SerializeSketchFeature(persistedSketch);
  nlohmann::json configBefore;
  ASSERT_TRUE(kreoda::ReadConfigurationDocument(&configBefore, &error));
  const auto negativeRevision = kreoda::DocumentStore::instance().revision();
  const auto negativeUndos = kreoda::OcafLive::instance().AvailableUndos();
  const auto negativeGraphSize = kreoda::TheFeatureGraph().size();
  const kreoda::Json duplicated = {
      {"version", 1}, {"operation", "projectEdges"},
      {"sources", {{{"type", "edge"}, {"featureId", kCylinderId},
                    {"persistentEdgeId", topCircle}},
                   {{"type", "edge"}, {"featureId", kCylinderId},
                    {"persistentEdgeId", topCircle}}}}};
  EXPECT_FALSE(kreoda::SetSketchProjectionGroup(
      kSketchId, "ambiguous-proposal", duplicated.dump(), &error));
  EXPECT_NE(error.find("duplicate projection source"), std::string::npos)
      << error;
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), negativeRevision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), negativeUndos);
  EXPECT_EQ(kreoda::TheFeatureGraph().size(), negativeGraphSize);
  ASSERT_TRUE(kreoda::SketchStore::instance().get(kSketchId, &persistedSketch));
  EXPECT_EQ(kreoda::SerializeSketchFeature(persistedSketch), sketchBefore);
  nlohmann::json configAfter;
  ASSERT_TRUE(kreoda::ReadConfigurationDocument(&configAfter, &error));
  EXPECT_EQ(configAfter, configBefore);
  verify("Medium", 3.5, 12, 5);

  // An invalid active-variant redefinition mentions BOTH source B-Reps.
  // The preview/preflight must refuse it without publishing even one of
  // the candidate edits, undo entry, changed projection or metadata.
  const auto invalidConfigurationRevision =
      kreoda::DocumentStore::instance().revision();
  const auto invalidConfigurationUndos =
      kreoda::OcafLive::instance().AvailableUndos();
  nlohmann::json beforeInvalidDefinition;
  ASSERT_TRUE(kreoda::ReadConfigurationDocument(
      &beforeInvalidDefinition, &error));
  EXPECT_FALSE(kreoda::DefineConfiguration("Medium",
      {{kCylinderId, {{"radiusMm", -5}}}, {kBoxId, {{"widthMm", 99}}}},
      &error));
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),
            invalidConfigurationRevision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(),
            invalidConfigurationUndos);
  nlohmann::json afterInvalidDefinition;
  ASSERT_TRUE(kreoda::ReadConfigurationDocument(&afterInvalidDefinition, &error));
  EXPECT_EQ(afterInvalidDefinition, beforeInvalidDefinition);
  verify("Medium", 3.5, 12, 5);

  // Different failure class: a real two-solid imported B-Rep carries TWO
  // "box.+Z" roles. A face picked by that semantic name is ambiguous, and
  // live OCAF must refuse it without constructing an arbitrary TNaming
  // selection. This is checked inside the same projected/configured document,
  // not by changing the cylinder's own stable edge reference.
  TopoDS_Compound importedCompound;
  BRep_Builder builder;
  builder.MakeCompound(importedCompound);
  builder.Add(importedCompound,
              BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 10, 10, 10).Shape());
  builder.Add(importedCompound,
              BRepPrimAPI_MakeBox(gp_Pnt(20, 0, -3), 10, 10, 23).Shape());
  ASSERT_TRUE(kreoda::CommitSingleFeature(kAmbiguousImportedId, "StepImport",
      {}, {}, "", importedCompound, &error)) << error;
  ShapeRecord importedRecord;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(
      kAmbiguousImportedId, &importedRecord));
  const auto importedRoles = kreoda::ClassifyFaceRoles(
      importedRecord.shape, importedRecord.type, importedRecord.featureId);
  EXPECT_EQ(std::count(importedRoles.begin(), importedRoles.end(),
                       std::string(kAmbiguousImportedId) + ":box.+Z"), 2);
  TopoDS_Face ambiguousFace;
  EXPECT_FALSE(kreoda::FindFaceByRole(importedRecord.shape,
      kAmbiguousImportedId, importedRecord.type, "box.+Z", &ambiguousFace));
  const auto beforeFaceRevision = kreoda::DocumentStore::instance().revision();
  const auto beforeFaceUndos = kreoda::OcafLive::instance().AvailableUndos();
  kreoda::OcafLive::FaceSelection ambiguousSelection;
  EXPECT_FALSE(kreoda::OcafLive::instance().SelectFace(
      kAmbiguousImportedId, "box.+Z", &ambiguousSelection, &error));
  EXPECT_NE(error.find("no face with role"), std::string::npos) << error;
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), beforeFaceRevision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), beforeFaceUndos);
  verify("Medium", 3.5, 12, 5);

  // Large has disjoint box overrides. It must not leak Medium's width or
  // radius into Base; the projection must still reflow with its source.
  ASSERT_TRUE(kreoda::ActivateConfiguration("Large", &error)) << error;
  verify("Large", 4, 8, 9);
  ASSERT_TRUE(kreoda::ActivateConfiguration("Medium", &error)) << error;
  verify("Medium", 3.5, 12, 5);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(
      kAmbiguousImportedId, &importedRecord));
  const auto afterSwitchRoles = kreoda::ClassifyFaceRoles(
      importedRecord.shape, importedRecord.type, importedRecord.featureId);
  EXPECT_EQ(std::count(afterSwitchRoles.begin(), afterSwitchRoles.end(),
                       std::string(kAmbiguousImportedId) + ":box.+Z"), 2);

  ComposedScratchDir scratch;
  std::error_code fsError;
  ASSERT_TRUE(std::filesystem::create_directories(scratch.root, fsError))
      << fsError.message();
  const auto icad = (scratch.root / "composed.icad").generic_string();
  const auto saved = ComposedWire(kreoda::kSaveDocument, "composed-save",
                                  {{"path", icad}});
  ASSERT_EQ(saved.value("status", ""), "ok") << saved.dump();
  ASSERT_TRUE(std::filesystem::is_regular_file(icad));
  ASSERT_GT(std::filesystem::file_size(icad), 100u);
  const auto fresh = ComposedWire(kreoda::kCreateDocument, "composed-new");
  ASSERT_EQ(fresh.value("status", ""), "ok") << fresh.dump();
  const auto opened = ComposedWire(kreoda::kOpenDocument, "composed-open",
                                   {{"path", icad}});
  ASSERT_EQ(opened.value("status", ""), "ok") << opened.dump();

  verify("Medium", 3.5, 12, 5);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(
      kAmbiguousImportedId, &importedRecord));
  const auto afterOpenRoles = kreoda::ClassifyFaceRoles(
      importedRecord.shape, importedRecord.type, importedRecord.featureId);
  EXPECT_EQ(std::count(afterOpenRoles.begin(), afterOpenRoles.end(),
                       std::string(kAmbiguousImportedId) + ":box.+Z"), 2);
  EXPECT_FALSE(kreoda::FindFaceByRole(importedRecord.shape,
      kAmbiguousImportedId, importedRecord.type, "box.+Z", &ambiguousFace));
  nlohmann::json loadedConfig;
  ASSERT_TRUE(kreoda::ReadConfigurationDocument(&loadedConfig, &error));
  EXPECT_EQ(loadedConfig["base"][kCylinderId]["radiusMm"], 2);
  EXPECT_EQ(loadedConfig["base"][kBoxId]["widthMm"], 8);
  EXPECT_EQ(loadedConfig["named"]["Medium"][kCylinderId]["radiusMm"], 3.5);
  EXPECT_EQ(loadedConfig["named"]["Large"][kCylinderId]["radiusMm"], 4);

  const auto beforeBaseRevision = kreoda::DocumentStore::instance().revision();
  const auto beforeBaseUndos = kreoda::OcafLive::instance().AvailableUndos();
  ASSERT_TRUE(kreoda::ActivateConfiguration("", &error)) << error;
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),
            beforeBaseRevision + 1);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(),
            beforeBaseUndos + 1);
  verify("", 2, 8, 5);
  const auto undoBase = ComposedWire(kreoda::kUndo, "composed-base-undo");
  ASSERT_EQ(undoBase.value("status", ""), "ok") << undoBase.dump();
  verify("Medium", 3.5, 12, 5);
  const auto redoBase = ComposedWire(kreoda::kRedo, "composed-base-redo");
  ASSERT_EQ(redoBase.value("status", ""), "ok") << redoBase.dump();
  verify("", 2, 8, 5);
#else
  GTEST_SKIP() << "requires genuine OCCT + minizip-ng; no stub geometry accepted";
#endif
}
