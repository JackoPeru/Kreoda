#include <gtest/gtest.h>

#include <filesystem>

#include "../src/document/document_store.h"
#include "../src/features/fillet/fillet.h"
#include "../src/features/hole/hole.h"
#include "../src/features/primitives/primitives.h"
#include "../src/model/body.h"
#include "../src/model/shapes.h"
#include "../src/persistence/ocaf_live.h"
#include "../src/protocol/dispatcher.h"
#include "../src/topology/face_roles.h"
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopoDS_Face.hxx>

#include "rpc_text.h"

namespace fs = std::filesystem;

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
  EXPECT_DOUBLE_EQ(update->volume_mm3(), 999.0 * 50.0 * 20.0);
#else
  GTEST_SKIP() << "preview binary needs flatbuffers";
#endif
  // Committed state untouched: same revision, same volume.
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), rev);
  EXPECT_DOUBLE_EQ(Get("vbox").volumeMm3, 100000);
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
      icad.string() + "\"}";
  ASSERT_NE(kreoda_test::rpcText(save).find("\"status\":\"ok\""),
            std::string::npos);

  NewDoc("topo7b");
  const std::string open =
      std::string(
          R"({"protocolVersion":1,"requestId":"t2","documentId":"topo7b","type":11,"path":")") +
      icad.string() + "\"}";
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
      icad.string() + "\"}";
  ASSERT_NE(kreoda_test::rpcText(save).find("\"status\":\"ok\""),
            std::string::npos);

  NewDoc("topo-tip4b");
  const std::string open =
      std::string(
          R"({"protocolVersion":1,"requestId":"to1","documentId":"topo-tip4b","type":11,"path":")") +
      icad.string() + "\"}";
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
