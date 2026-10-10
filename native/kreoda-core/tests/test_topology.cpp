#include <gtest/gtest.h>

#include <filesystem>
#include <cmath>

#include "../src/document/document_store.h"
#include "../src/expressions/expressions.h"
#include "../src/features/booleans/boolean.h"
#include "../src/features/fillet/fillet.h"
#include "../src/features/hole/hole.h"
#include "../src/features/instance/instance.h"
#include "../src/features/primitives/primitives.h"
#include "../src/model/body.h"
#include "../src/model/shapes.h"
#include "../src/persistence/ocaf_live.h"
#include "../src/protocol/dispatcher.h"
#include "../src/topology/face_roles.h"
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopoDS_Face.hxx>
#include <BinXCAFDrivers.hxx>
#include <TDataStd_Comment.hxx>
#include <TDocStd_Application.hxx>
#include <TDocStd_Document.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>

#include "rpc_text.h"

namespace fs = std::filesystem;

TEST(Topology, LegacySelectionsAndMissingFoldersAreAdoptedFromLoadedDocument) {
#if KREODA_WITH_OCCT
  kreoda::DocumentStore::instance().create("legacy-folders");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("legacy-box", 100, 60, 10, &error)) << error;
  const auto source = fs::temp_directory_path() / "kreoda-folder-source.xbf";
  const auto legacy = fs::temp_directory_path() / "kreoda-folder-legacy.xbf";
  ASSERT_TRUE(kreoda::OcafLive::instance().Save(source.string(), &error)) << error;
  kreoda::DocumentStore::instance().create("legacy-folders-reset");
  Handle(TDocStd_Application) app = new TDocStd_Application;
  BinXCAFDrivers::DefineFormat(app);
  Handle(TDocStd_Document) doc;
  ASSERT_EQ(app->Open(TCollection_ExtendedString(source.string().c_str()), doc), PCDM_RS_OK);
  auto shapes = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
  // The old allocator reused XCAF's tag 1 for Selections. Its children
  // survive serialization even though XCAF restores the folder name Shapes.
  TDataStd_Comment::Set(shapes->Label().NewChild(), "legacy-box|face.0");
  for (int tag : {1001, 1002, 1003}) doc->Main().FindChild(tag).ForgetAllAttributes(Standard_True);
  ASSERT_EQ(app->SaveAs(doc, TCollection_ExtendedString(legacy.string().c_str())), PCDM_SS_OK);
  app->Close(doc);
  for (int cycle = 0; cycle < 5; ++cycle) {
    std::vector<kreoda::ShapeRecord> records;
    ASSERT_TRUE(kreoda::OcafLive::instance().Load(legacy.string(), &records, &error)) << error;
    ASSERT_EQ(records.size(), 1u);
    kreoda::ShapeStore::instance().clear();
    for (const auto& rec : records) kreoda::ShapeStore::instance().put(rec);
    EXPECT_TRUE(kreoda::OcafLive::instance().SelectionsNeedRepair({"legacy-box"}));
    kreoda::OcafLive::FaceSelection selected;
    ASSERT_TRUE(kreoda::OcafLive::instance().SelectFace("legacy-box", "box.+Z", &selected, &error)) << error;
    EXPECT_TRUE(kreoda::OcafLive::instance().ResolveSelection(selected).valid);
    ASSERT_TRUE(kreoda::OcafLive::instance().UpsertExpressions("legacy-box", "{}", &error)) << error;
    ASSERT_TRUE(kreoda::OcafLive::instance().Save(legacy.string(), &error)) << error;
  }
  fs::remove(source);
  fs::remove(legacy);
#endif
}

// Phase 2 topology regression tests (§3–§4, §49):
// persistent face references must survive parameter changes and save/open.
// A face is NEVER identified by array index — only UUID + TNaming/role.

namespace {

void NewDoc(const std::string& id) {
  kreoda::DocumentStore::instance().create(id);
}

double FaceArea(const TopoDS_Shape& shape, const std::string& featureId,
                const std::string& type, const std::string& role) {
  TopoDS_Face face;
  if (!kreoda::FindFaceByRole(shape, featureId, type, role, &face)) {
    return -1.0;
  }
  GProp_GProps props;
  BRepGProp::SurfaceProperties(face, props);
  return props.Mass();
}

kreoda::ShapeRecord Get(const std::string& id) {
  kreoda::ShapeRecord rec;
  EXPECT_TRUE(kreoda::ShapeStore::instance().get(id, &rec));
  return rec;
}

}  // namespace

TEST(Topology, BoxTopFaceSurvivesWidthChange) {
  NewDoc("topo1");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("tbox", 100, 50, 20, &err)) << err;
  EXPECT_DOUBLE_EQ(FaceArea(Get("tbox").shape, "tbox", "Box", "box.+Z"),
                   100 * 50);

  kreoda::OcafLive::FaceSelection sel;
  ASSERT_TRUE(kreoda::OcafLive::instance().SelectFace("tbox", "box.+Z",
                                                        &sel, &err))
      << err;
  EXPECT_FALSE(sel.entry.empty());

  ASSERT_TRUE(kreoda::RebuildFeature("tbox", "widthMm", 150, &err)) << err;
  EXPECT_DOUBLE_EQ(Get("tbox").volumeMm3, 150 * 50 * 20);
  // Same face, new size — reference intact, geometry updated.
  EXPECT_DOUBLE_EQ(FaceArea(Get("tbox").shape, "tbox", "Box", "box.+Z"),
                   150 * 50);

  const auto resolved =
      kreoda::OcafLive::instance().ResolveSelection(sel);
  EXPECT_TRUE(resolved.valid);
  EXPECT_NE(resolved.role.find("box.+Z"), std::string::npos);
}

TEST(Topology, CylinderCapSurvivesHeightChange) {
  NewDoc("topo2");
  std::string err;
  ASSERT_TRUE(kreoda::CreateCylinderFeature("tcyl", 10, 40, &err)) << err;

  kreoda::OcafLive::FaceSelection sel;
  ASSERT_TRUE(kreoda::OcafLive::instance().SelectFace("tcyl", "cyl.+Z",
                                                        &sel, &err))
      << err;
  ASSERT_TRUE(kreoda::RebuildFeature("tcyl", "heightMm", 80, &err)) << err;

  const auto resolved =
      kreoda::OcafLive::instance().ResolveSelection(sel);
  EXPECT_TRUE(resolved.valid);
  EXPECT_NE(resolved.role.find("cyl.+Z"), std::string::npos);
  // Cap area unchanged by a height edit (radius untouched).
  EXPECT_NEAR(FaceArea(Get("tcyl").shape, "tcyl", "Cylinder", "cyl.+Z"),
              3.14159265358979 * 100, 1e-3);
}

TEST(Topology, SphereFaceSurvivesRadiusChange) {
  NewDoc("topo3");
  std::string err;
  ASSERT_TRUE(kreoda::CreateSphereFeature("tsph", 15, &err)) << err;

  kreoda::OcafLive::FaceSelection sel;
  ASSERT_TRUE(kreoda::OcafLive::instance().SelectFace("tsph", "sph.all",
                                                        &sel, &err))
      << err;
  ASSERT_TRUE(kreoda::RebuildFeature("tsph", "radiusMm", 25, &err)) << err;

  const auto resolved =
      kreoda::OcafLive::instance().ResolveSelection(sel);
  EXPECT_TRUE(resolved.valid);
  EXPECT_NE(resolved.role.find("sph.all"), std::string::npos);
}

TEST(Topology, ResolutionLayerIsReportedHonestly) {
  NewDoc("topo4");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("tvia", 100, 50, 20, &err)) << err;
  kreoda::OcafLive::FaceSelection sel;
  ASSERT_TRUE(kreoda::OcafLive::instance().SelectFace("tvia", "box.+Z",
                                                        &sel, &err))
      << err;
  ASSERT_TRUE(kreoda::RebuildFeature("tvia", "widthMm", 120, &err)) << err;
  const auto resolved =
      kreoda::OcafLive::instance().ResolveSelection(sel);
  EXPECT_TRUE(resolved.valid);
  // No post-rebuild re-solve yet: the semantic role layer resolves.
  // When TNaming re-solve lands, this flips to "naming" (by geometric proof).
  EXPECT_EQ(resolved.via, "role");
}

TEST(Topology, InvalidRebuildKeepsOldGeometry) {
  NewDoc("topo5");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("tkeep", 100, 50, 20, &err)) << err;
  const int64_t rev = kreoda::DocumentStore::instance().revision();
  EXPECT_FALSE(kreoda::RebuildFeature("tkeep", "widthMm", -5, &err));
  EXPECT_FALSE(err.empty());
  EXPECT_FALSE(kreoda::RebuildFeature("tkeep", "depthZZ", 5, &err));
  EXPECT_DOUBLE_EQ(Get("tkeep").volumeMm3, 100000);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), rev);
}

TEST(Topology, PreviewDoesNotCommit) {
  NewDoc("topo6");
  ASSERT_NE(kreoda_test::rpcText(
                R"({"protocolVersion":1,"requestId":"v1","documentId":"topo6","type":3,"featureId":"vbox","widthMm":100,"heightMm":50,"depthMm":20})")
                .find("\"status\":\"ok\""),
            std::string::npos);
  const int64_t rev = kreoda::DocumentStore::instance().revision();
  const std::vector<uint8_t> pv = kreoda_test::rpcBytes(
      R"({"protocolVersion":1,"requestId":"v2","documentId":"topo6","type":6,"featureId":"vbox","paramName":"widthMm","valueMm":999,"isPreview":true})");
#ifdef KREODA_WITH_FLATBUFFERS
  // Preview arrives as a FlatBuffers mesh (§8): would-be width 999.
  const auto* update = kreoda_test::meshRoot(pv);
  ASSERT_NE(update, nullptr);
  EXPECT_EQ(update->lod(), 0) << "Preview must identify its actual level-0 tessellation";
  EXPECT_DOUBLE_EQ(update->volume_mm3(), 999.0 * 50.0 * 20.0);
#else
  GTEST_SKIP() << "preview binary needs flatbuffers";
#endif
  // Committed state untouched: same revision, same volume.
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), rev);
  EXPECT_DOUBLE_EQ(Get("vbox").volumeMm3, 100000);
}

TEST(Topology, BodyPreviewKeepsDownstreamHoleAndCommittedHistory) {
  NewDoc("p13-preview-body");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("p13-base", 100, 50, 20, &error)) << error;
  ASSERT_TRUE(kreoda::CreateHoleFeature("p13-hole", "p13-base", "box.+Z", 25, 25,
      6, "throughAll", 0, &error)) << error;
  const auto revision = kreoda::DocumentStore::instance().revision();
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();
  const auto beforeVolume = Get("p13-hole").volumeMm3;
  const auto bytes = kreoda_test::rpcBytes(
      R"({"protocolVersion":1,"requestId":"p13-body-preview","documentId":"p13-preview-body","type":6,"featureId":"p13-base","paramName":"widthMm","valueMm":140,"isPreview":true,"previewTipId":"p13-hole"})");
  const auto* update = kreoda_test::meshRoot(bytes);
  ASSERT_NE(update, nullptr);
  EXPECT_EQ(update->feature_id()->str(), "p13-hole");
  EXPECT_EQ(update->lod(), 0);
  EXPECT_NEAR(update->volume_mm3(), 140000 - std::acos(-1.0) * 9 * 20, .001);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
  EXPECT_DOUBLE_EQ(Get("p13-base").paramsMm[0], 100);
  EXPECT_DOUBLE_EQ(Get("p13-hole").volumeMm3, beforeVolume);
  kreoda::BodyRecord body;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("p13-base", &body));
  EXPECT_EQ(body.tipFeatureId, "p13-hole");
  const auto previewVolume = update->volume_mm3();
  ASSERT_TRUE(kreoda::RebuildFeature("p13-base", "widthMm", 140, &error)) << error;
  EXPECT_NEAR(previewVolume, Get("p13-hole").volumeMm3, .001);
}

TEST(Topology, BodyPreviewEvaluatesDependentFormulaInScratchOnly) {
  NewDoc("p13-preview-expression");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("p13-form-base", 100, 50, 20, &error)) << error;
  ASSERT_TRUE(kreoda::CreateHoleFeature("p13-form-hole", "p13-form-base", "box.+Z", 25, 25,
      6, "throughAll", 0, &error)) << error;
  ASSERT_TRUE(kreoda::RebuildFeature("p13-form-hole", "diameterMm", 0,
      "p13-form-base.widthMm / 10", &error)) << error;
  const auto revision = kreoda::DocumentStore::instance().revision();
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();
  const auto expressions = kreoda::ExpressionStore::instance().forFeature("p13-form-hole");
  const auto bytes = kreoda_test::rpcBytes(
      R"({"protocolVersion":1,"requestId":"p13-form-preview","documentId":"p13-preview-expression","type":6,"featureId":"p13-form-base","paramName":"widthMm","valueMm":140,"isPreview":true,"previewTipId":"p13-form-hole"})");
  const auto* update = kreoda_test::meshRoot(bytes);
  ASSERT_NE(update, nullptr);
  EXPECT_EQ(update->feature_id()->str(), "p13-form-hole");
  EXPECT_NEAR(update->volume_mm3(), 140000 - std::acos(-1.0) * 49 * 20, .001);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
  EXPECT_EQ(kreoda::ExpressionStore::instance().forFeature("p13-form-hole"), expressions);
  EXPECT_DOUBLE_EQ(Get("p13-form-base").paramsMm[0], 100);
  EXPECT_DOUBLE_EQ(Get("p13-form-hole").paramsMm[0], 10);
  const auto previewVolume = update->volume_mm3();
  ASSERT_TRUE(kreoda::RebuildFeature("p13-form-base", "widthMm", 140, &error)) << error;
  EXPECT_NEAR(previewVolume, Get("p13-form-hole").volumeMm3, .001);
}

TEST(Topology, BodyPreviewRejectsUnrelatedRequestedTipWithoutMutation) {
  NewDoc("p13-preview-unrelated");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("p13-owner", 100, 50, 20, &error)) << error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("p13-other", 80, 40, 10, &error)) << error;
  const auto revision = kreoda::DocumentStore::instance().revision();
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();
  const auto response = kreoda_test::rpcText(
      R"({"protocolVersion":1,"requestId":"p13-unrelated-preview","documentId":"p13-preview-unrelated","type":6,"featureId":"p13-owner","paramName":"widthMm","valueMm":140,"isPreview":true,"previewTipId":"p13-other"})");
  EXPECT_NE(response.find("PREVIEW_FAILED"), std::string::npos);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
  EXPECT_DOUBLE_EQ(Get("p13-owner").paramsMm[0], 100);
  EXPECT_DOUBLE_EQ(Get("p13-other").paramsMm[0], 80);
}

TEST(Topology, BodyPreviewCompoundPlacementUsesAllValuesWithoutCommit) {
  NewDoc("p13-compound-preview");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("p13-pos-box", 100, 50, 20, &error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("p13-pos-inst", "p13-pos-box", {0, 0, 0, 0, 0, 0}, &error)) << error;
  const auto revision = kreoda::DocumentStore::instance().revision();
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();
  const auto bytes = kreoda_test::rpcBytes(
      R"({"protocolVersion":1,"requestId":"p13-pos-preview","documentId":"p13-compound-preview","type":6,"featureId":"p13-pos-inst","paramName":"txMm","valueMm":10,"isPreview":true,"previewTipId":"p13-pos-inst","previewValues":{"tyMm":20,"tzMm":30}})");
  const auto* update = kreoda_test::meshRoot(bytes);
  ASSERT_NE(update, nullptr);
  EXPECT_EQ(update->feature_id()->str(), "p13-pos-inst");
  ASSERT_NE(update->bbox_mm(), nullptr);
  EXPECT_NEAR(update->bbox_mm()->Get(0), 10, .001);
  EXPECT_NEAR(update->bbox_mm()->Get(1), 20, .001);
  EXPECT_NEAR(update->bbox_mm()->Get(2), 30, .001);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
  EXPECT_EQ(Get("p13-pos-inst").paramsMm, (std::vector<double>{0, 0, 0, 0, 0, 0}));
}

TEST(Topology, BodyPreviewRejectsUnknownCompoundParameterWithoutCommit) {
  NewDoc("p13-invalid-compound-preview");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("p13-invalid-box", 100, 50, 20, &error)) << error;
  const auto revision = kreoda::DocumentStore::instance().revision();
  const auto response = kreoda_test::rpcText(
      R"({"protocolVersion":1,"requestId":"p13-invalid-preview","documentId":"p13-invalid-compound-preview","type":6,"featureId":"p13-invalid-box","paramName":"widthMm","valueMm":140,"isPreview":true,"previewTipId":"p13-invalid-box","previewValues":{"missingMm":20}})");
  EXPECT_NE(response.find("PREVIEW_FAILED"), std::string::npos);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
  EXPECT_DOUBLE_EQ(Get("p13-invalid-box").paramsMm[0], 100);
}

TEST(Topology, BodyPreviewRejectsCyclicOrMissingGeometryDependencies) {
  for (const bool cycle : {false, true}) {
    NewDoc("p13-preview-bad-dependency");
    std::string error;
    ASSERT_TRUE(kreoda::CreateBoxFeature("p13-dep-base", 100, 50, 20, &error)) << error;
    ASSERT_TRUE(kreoda::CreateHoleFeature("p13-dep-hole", "p13-dep-base", "box.+Z", 25, 25,
        6, "throughAll", 0, &error)) << error;
    auto malformed = Get("p13-dep-base");
    malformed.dependsOn = {cycle ? "p13-dep-hole" : "p13-missing"};
    kreoda::ShapeStore::instance().put(malformed);
    const auto revision = kreoda::DocumentStore::instance().revision();
    const auto undos = kreoda::OcafLive::instance().AvailableUndos();
    const auto response = kreoda_test::rpcText(
        R"({"protocolVersion":1,"requestId":"p13-bad-dep-preview","documentId":"p13-preview-bad-dependency","type":6,"featureId":"p13-dep-base","paramName":"widthMm","valueMm":140,"isPreview":true,"previewTipId":"p13-dep-hole"})");
    EXPECT_NE(response.find("PREVIEW_FAILED"), std::string::npos);
    EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
    EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
    EXPECT_EQ(Get("p13-dep-base").dependsOn, malformed.dependsOn);
    EXPECT_DOUBLE_EQ(Get("p13-dep-base").paramsMm[0], 100);
  }
}

TEST(Topology, BodyPreviewRejectsStableSelfReferentialExpression) {
  NewDoc("p13-preview-expression-cycle");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("p13-self-base", 100, 50, 20, &error)) << error;
  const auto revision = kreoda::DocumentStore::instance().revision();
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();
  const auto response = kreoda_test::rpcText(
      R"({"protocolVersion":1,"requestId":"p13-self-preview","documentId":"p13-preview-expression-cycle","type":6,"featureId":"p13-self-base","paramName":"widthMm","expression":"widthMm","isPreview":true,"previewTipId":"p13-self-base"})");
  EXPECT_NE(response.find("PREVIEW_FAILED"), std::string::npos);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
  EXPECT_TRUE(kreoda::ExpressionStore::instance().forFeature("p13-self-base").empty());
}

TEST(Topology, BodyPreviewRejectsMalformedDependentPrimitiveParameters) {
  for (const auto& type : {"Box", "Cylinder", "Sphere"}) {
    NewDoc("p13-preview-malformed-primitive");
    std::string error;
    ASSERT_TRUE(kreoda::CreateBoxFeature("p13-malformed-base", 100, 50, 20, &error)) << error;
    ASSERT_TRUE(kreoda::CreateHoleFeature("p13-malformed-child", "p13-malformed-base", "box.+Z", 25, 25,
        6, "throughAll", 0, &error)) << error;
    auto malformed = Get("p13-malformed-child");
    malformed.type = type;
    malformed.paramsMm = {10, 20, 30, 40};
    kreoda::ShapeStore::instance().put(malformed);
    const auto revision = kreoda::DocumentStore::instance().revision();
    const auto undos = kreoda::OcafLive::instance().AvailableUndos();
    kreoda::CoreMesh mesh;
    EXPECT_FALSE(kreoda::BuildPreviewBodyMesh("p13-malformed-base", "widthMm", 140,
        "p13-malformed-child", &mesh, &error)) << type;
    EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
    EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
    EXPECT_EQ(Get("p13-malformed-child").paramsMm, malformed.paramsMm);
    EXPECT_DOUBLE_EQ(Get("p13-malformed-base").paramsMm[0], 100);
  }
}

TEST(Topology, BodyPreviewRejectsExtraDependentInputs) {
  NewDoc("p13-preview-extra-input");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("p13-extra-base", 100, 50, 20, &error)) << error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("p13-extra-tool", 10, 10, 10, &error)) << error;
  ASSERT_TRUE(kreoda::CreateHoleFeature("p13-extra-hole", "p13-extra-base", "box.+Z", 25, 25,
      6, "throughAll", 0, &error)) << error;
  auto malformed = Get("p13-extra-hole");
  malformed.dependsOn.push_back("p13-extra-tool");
  kreoda::ShapeStore::instance().put(malformed);
  const auto revision = kreoda::DocumentStore::instance().revision();
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();
  kreoda::CoreMesh mesh;
  EXPECT_FALSE(kreoda::BuildPreviewBodyMesh("p13-extra-base", "widthMm", 140,
      "p13-extra-hole", &mesh, &error));
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
  EXPECT_EQ(Get("p13-extra-hole").dependsOn, malformed.dependsOn);
  EXPECT_DOUBLE_EQ(Get("p13-extra-base").paramsMm[0], 100);
}

TEST(Topology, BodyPreviewUsesCanonicalBooleanRecipe) {
  NewDoc("p13-preview-boolean-recipe");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("p13-bool-base", 100, 50, 20, &error)) << error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("p13-bool-tool", 20, 20, 20, &error)) << error;
  ASSERT_TRUE(kreoda::CreateBooleanFeature("p13-bool-tip", "fuse", "p13-bool-base",
      "p13-bool-tool", &error)) << error;
  auto recipe = Get("p13-bool-tip");
  const auto revision = kreoda::DocumentStore::instance().revision();
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();
  kreoda::CoreMesh mesh;
  for (const auto& invalid : {"", "op=invalid"}) {
    recipe.refExtra = invalid;
    kreoda::ShapeStore::instance().put(recipe);
    EXPECT_FALSE(kreoda::BuildPreviewBodyMesh("p13-bool-base", "widthMm", 140,
        "p13-bool-tip", &mesh, &error));
    EXPECT_EQ(Get("p13-bool-tip").refExtra, invalid);
    EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
    EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
  }
  recipe.refExtra = "op=cut";
  kreoda::ShapeStore::instance().put(recipe);
  ASSERT_TRUE(kreoda::BuildPreviewBodyMesh("p13-bool-base", "widthMm", 140,
      "p13-bool-tip", &mesh, &error)) << error;
  EXPECT_NEAR(mesh.volumeMm3, 132000, 1e-5);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
  ASSERT_TRUE(kreoda::RebuildFeature("p13-bool-base", "widthMm", 140, "", &error)) << error;
  EXPECT_NEAR(Get("p13-bool-tip").volumeMm3, mesh.volumeMm3, 1e-5);
}

TEST(Topology, BodyPreviewEvaluatesFormulaAfterCompoundCandidateValues) {
  NewDoc("p13-preview-compound-formula");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("p13-formula-box", 100, 20, 10, &error)) << error;
  const auto revision = kreoda::DocumentStore::instance().revision();
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();
  const auto raw = kreoda_test::rpcBytes(
      R"({"protocolVersion":1,"requestId":"p13-formula-preview","documentId":"p13-preview-compound-formula","type":6,"featureId":"p13-formula-box","paramName":"widthMm","expression":"heightMm * 10000","isPreview":true,"previewTipId":"p13-formula-box","previewValues":{"heightMm":5}})");
  const auto* update = kreoda_test::meshRoot(raw);
  ASSERT_NE(update, nullptr) << std::string(raw.begin(), raw.end());
  EXPECT_DOUBLE_EQ(update->volume_mm3(), 2500000);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
  EXPECT_EQ(Get("p13-formula-box").paramsMm, (std::vector<double>{100, 20, 10}));
  EXPECT_TRUE(kreoda::ExpressionStore::instance().forFeature("p13-formula-box").empty());
}

TEST(Topology, SelectionSurvivesSaveOpen) {
  NewDoc("topo7");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("tsave", 100, 50, 20, &err)) << err;
  kreoda::OcafLive::FaceSelection sel;
  ASSERT_TRUE(kreoda::OcafLive::instance().SelectFace("tsave", "box.+Z",
                                                        &sel, &err))
      << err;
  const fs::path icad = fs::temp_directory_path() / "kreoda-topo.icad";
  const std::string save =
      std::string(
          R"({"protocolVersion":1,"requestId":"t1","documentId":"topo7","type":10,"path":")") +
      icad.generic_string() + "\"}";
  ASSERT_NE(kreoda_test::rpcText(save).find("\"status\":\"ok\""),
            std::string::npos);

  NewDoc("topo7b");
  const std::string open =
      std::string(
          R"({"protocolVersion":1,"requestId":"t2","documentId":"topo7b","type":11,"path":")") +
      icad.generic_string() + "\"}";
  const std::string opened = kreoda_test::rpcText(open);
  ASSERT_NE(opened.find("\"status\":\"ok\""), std::string::npos) << opened;

  // Entry strings are tag paths: stable across save/load by OCAF design.
  const auto resolved =
      kreoda::OcafLive::instance().ResolveSelection(sel);
  EXPECT_TRUE(resolved.valid);
  EXPECT_NE(resolved.role.find("box.+Z"), std::string::npos);
  EXPECT_DOUBLE_EQ(Get("tsave").volumeMm3, 100000);

  std::error_code ec;
  fs::remove(icad, ec);
}

// Slice 3: upstream dimensional edits keep the body tip on the recomputed
// last history feature; unambiguous hole face refs resolve, broken ones
// fail honestly (never a silent rebind).
TEST(Topology, UpstreamEditKeepsBodyTipAndFaceRefs) {
  NewDoc("topo-tip1");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("tbox2", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("thole2", "tbox2", "box.+Z", 50, 25,
                                        8, "throughAll", 0, &err))
      << err;
  kreoda::BodyRecord before;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("thole2", &before));
  const std::string bodyId = before.bodyId;

  kreoda::OcafLive::FaceSelection sel;
  ASSERT_TRUE(kreoda::OcafLive::instance().SelectFace("tbox2", "box.+Z", &sel,
                                                      &err))
      << err;
  ASSERT_TRUE(kreoda::RebuildFeature("tbox2", "widthMm", 150, &err)) << err;

  // Same body, tip still the hole with recomputed (larger) volume.
  kreoda::BodyRecord after;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("thole2", &after));
  EXPECT_EQ(after.bodyId, bodyId);
  EXPECT_EQ(after.tipFeatureId, "thole2");
  EXPECT_DOUBLE_EQ(Get("tbox2").volumeMm3, 150 * 50 * 20);
  EXPECT_NEAR(Get("thole2").volumeMm3,
              150.0 * 50.0 * 20.0 - 3.14159265358979 * 16.0 * 20.0, 2.0);
  // Unambiguous refs resolve on the recomputed downstream shape.
  TopoDS_Face face;
  EXPECT_TRUE(kreoda::FindFaceByRole(Get("thole2").shape, "thole2", "Hole",
                                     "box.+Z", &face));
  const auto resolved = kreoda::OcafLive::instance().ResolveSelection(sel);
  EXPECT_TRUE(resolved.valid);
  EXPECT_FALSE(Get("thole2").shape.IsNull());  // tip B-Rep replaced, not stale
}

TEST(Topology, FilletEdgeRefSurvivesUpstreamEdit) {
  NewDoc("topo-tip2");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("fbox2", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateFilletFeature(
                  "ffil2", "fbox2", {"fbox2:edge.lin.box.+X~box.+Z"}, 2, &err))
      << err;
  kreoda::BodyRecord before;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("ffil2", &before));
  ASSERT_TRUE(kreoda::RebuildFeature("fbox2", "widthMm", 130, &err)) << err;

  // Tip stays the fillet in the same body; the unambiguous edge ref still
  // resolves on the edited box and drives a downstream rebuild.
  kreoda::BodyRecord after;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("ffil2", &after));
  EXPECT_EQ(after.bodyId, before.bodyId);
  EXPECT_EQ(after.tipFeatureId, "ffil2");
  TopoDS_Edge edge;
  EXPECT_TRUE(kreoda::FindEdgeByRole(Get("fbox2").shape, "fbox2", "Box",
                                     "edge.lin.box.+X~box.+Z", &edge));
  ASSERT_TRUE(kreoda::RebuildFeature("ffil2", "radiusMm", 3, &err)) << err;
  kreoda::BodyRecord reanchored;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("ffil2",
                                                           &reanchored));
  EXPECT_EQ(reanchored.tipFeatureId, "ffil2");
  EXPECT_FALSE(Get("ffil2").shape.IsNull());
}

TEST(Topology, UndoRedoStepsBodyTip) {
  NewDoc("topo-tip3");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("ubox2", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("uhole2", "ubox2", "box.+Z", 50, 25,
                                        8, "throughAll", 0, &err))
      << err;
  kreoda::BodyRecord full;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("uhole2", &full));
  const std::string bodyId = full.bodyId;

  // Undo steps the tip back to the root with no ghost body entry.
  ASSERT_NE(kreoda_test::rpcText(
                R"({"protocolVersion":1,"requestId":"tu1","documentId":"topo-tip3","type":8})")
                .find("\"status\":\"ok\""),
            std::string::npos);
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("uhole2"));
  EXPECT_FALSE(
      kreoda::BodyStore::instance().bodyForFeature("uhole2", nullptr));
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
  kreoda::BodyRecord stepped;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("ubox2", &stepped));
  EXPECT_EQ(stepped.bodyId, bodyId);
  EXPECT_EQ(stepped.tipFeatureId, "ubox2");

  // Redo steps the tip forward to the hole again.
  ASSERT_NE(kreoda_test::rpcText(
                R"({"protocolVersion":1,"requestId":"tr1","documentId":"topo-tip3","type":9})")
                .find("\"status\":\"ok\""),
            std::string::npos);
  kreoda::BodyRecord redone;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("uhole2", &redone));
  EXPECT_EQ(redone.bodyId, bodyId);
  EXPECT_EQ(redone.tipFeatureId, "uhole2");
  EXPECT_FALSE(Get("uhole2").shape.IsNull());
}

TEST(Topology, SaveOpenPreservesBodyTip) {
  NewDoc("topo-tip4");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("sbox2", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("shole2", "sbox2", "box.+Z", 50, 25,
                                        8, "throughAll", 0, &err))
      << err;
  kreoda::BodyRecord before;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("shole2", &before));
  const double volBefore = Get("shole2").volumeMm3;
  const fs::path icad = fs::temp_directory_path() / "kreoda-topo-tip.icad";
  const std::string save =
      std::string(
          R"({"protocolVersion":1,"requestId":"ts1","documentId":"topo-tip4","type":10,"path":")") +
      icad.generic_string() + "\"}";
  ASSERT_NE(kreoda_test::rpcText(save).find("\"status\":\"ok\""),
            std::string::npos);

  NewDoc("topo-tip4b");
  const std::string open =
      std::string(
          R"({"protocolVersion":1,"requestId":"to1","documentId":"topo-tip4b","type":11,"path":")") +
      icad.generic_string() + "\"}";
  ASSERT_NE(kreoda_test::rpcText(open).find("\"status\":\"ok\""),
            std::string::npos)
      << open;
  kreoda::BodyRecord after;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("shole2", &after));
  EXPECT_EQ(after.bodyId, before.bodyId);
  EXPECT_EQ(after.history, before.history);
  EXPECT_EQ(after.tipFeatureId, "shole2");
  EXPECT_DOUBLE_EQ(Get("shole2").volumeMm3, volBefore);
  TopoDS_Face face;
  EXPECT_TRUE(kreoda::FindFaceByRole(Get("shole2").shape, "shole2", "Hole",
                                     "box.+Z", &face));
  std::error_code ec;
  fs::remove(icad, ec);
}

TEST(Topology, FallbackOnlyResolvesRealRoles) {
  NewDoc("topo8");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("tunk", 100, 50, 20, &err)) << err;
  // Dead entry + genuine role: fallback resolves by design (§4 order).
  kreoda::OcafLive::FaceSelection stale{"0:9:9:9", "tunk", "box.+Z"};
  const auto via_role =
      kreoda::OcafLive::instance().ResolveSelection(stale);
  EXPECT_TRUE(via_role.valid);
  EXPECT_EQ(via_role.via, "role");
  // Dead entry + invented role: must be invalid, never guessed.
  kreoda::OcafLive::FaceSelection wrongRole{"0:9:9:9", "tunk", "nope"};
  EXPECT_FALSE(
      kreoda::OcafLive::instance().ResolveSelection(wrongRole).valid);
}
