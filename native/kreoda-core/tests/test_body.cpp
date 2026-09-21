#include <gtest/gtest.h>

#include <filesystem>
#include <string>
#include <utility>
#include <vector>

#include "../src/document/document_store.h"
#include "../src/features/booleans/boolean.h"
#include "../src/features/extrusion/extrude.h"
#include "../src/features/fillet/fillet.h"
#include "../src/features/hole/hole.h"
#include "../src/features/instance/instance.h"
#include "../src/features/primitives/primitives.h"
#include "../src/features/sketch/sketch_commands.h"
#include "../src/model/body.h"
#include "../src/model/shapes.h"
#include "../src/persistence/icad_zip.h"
#include "../src/persistence/ocaf_live.h"
#if KREODA_WITH_OCCT
#include <BRepCheck_Analyzer.hxx>

#include "../src/topology/face_roles.h"
#endif

#include "rpc_text.h"

namespace fs = std::filesystem;

// Slice 2: Body/Feature data model — history grouping + tip pointer.
// Geometry itself is asserted by the topology/solids suites; here only the
// body invariants (count, history, tip) plus save/open identity.

namespace {

void NewDoc(const std::string& id) {
  kreoda::DocumentStore::instance().create(id);
}

bool ok(const std::string& r) {
  return r.find("\"status\":\"ok\"") != std::string::npos;
}

std::string rpc(const std::string& body) {
  return kreoda_test::rpcText(body);
}

bool BodyOf(const std::string& featureId, kreoda::BodyRecord* out) {
  return kreoda::BodyStore::instance().bodyForFeature(featureId, out);
}

}  // namespace

TEST(Bodies, BoxOpensOneBody) {
  NewDoc("bd-a");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("ba", 100, 50, 20, &err)) << err;
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
  kreoda::BodyRecord b;
  ASSERT_TRUE(BodyOf("ba", &b));
  EXPECT_EQ(b.history, (std::vector<std::string>{"ba"}));
  EXPECT_EQ(b.tipFeatureId, "ba");
}

TEST(Bodies, HoleAdvancesTip) {
  NewDoc("bd-b");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("bb", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("bh", "bb", "box.+Z", 50, 25, 8,
                                        "throughAll", 0, &err))
      << err;
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
  kreoda::BodyRecord b;
  ASSERT_TRUE(BodyOf("bh", &b));
  EXPECT_EQ(b.history, (std::vector<std::string>{"bb", "bh"}));
  EXPECT_EQ(b.tipFeatureId, "bh");
  // Same body object owns the root too.
  kreoda::BodyRecord root;
  ASSERT_TRUE(BodyOf("bb", &root));
  EXPECT_EQ(root.bodyId, b.bodyId);
}

TEST(Bodies, FilletKeepsSingleBody) {
  NewDoc("bd-c");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("bc", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("bch", "bc", "box.+Z", 50, 25, 8,
                                        "throughAll", 0, &err))
      << err;
  ASSERT_TRUE(kreoda::CreateFilletFeature(
                  "bcf", "bc", {"bc:edge.lin.box.+X~box.+Z"}, 3, &err))
      << err;
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
  kreoda::BodyRecord b;
  ASSERT_TRUE(BodyOf("bcf", &b));
  EXPECT_EQ(b.history,
            (std::vector<std::string>{"bc", "bch", "bcf"}));
  EXPECT_EQ(b.tipFeatureId, "bcf");
}

TEST(Bodies, HolePatternIsOneBodyOneUndo) {
  NewDoc("bd-d");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("bd", 100, 60, 10, &err)) << err;
  const std::vector<std::pair<double, double>> pts = {
      {8, 8}, {92, 8}, {8, 52}, {92, 52}};
  const std::vector<std::string> ids = {"bd-h1", "bd-h2", "bd-h3", "bd-h4"};
  std::vector<std::string> created;
  ASSERT_TRUE(kreoda::CreateHolePatternFeature("bd", "box.+Z", pts, 6,
                                               "throughAll", 0, ids, &created,
                                               &err))
      << err;
  // One body; pattern members join the target body in creation order
  // (cumulative geometry is Slice 5 — only grouping + Undo are pinned here).
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
  kreoda::BodyRecord b;
  ASSERT_TRUE(BodyOf("bd-h4", &b));
  EXPECT_EQ(b.history.size(), 5u);
  EXPECT_EQ(b.tipFeatureId, "bd-h4");
  // Single Undo step removes the whole pattern and restores the root tip.
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"bd-u1","documentId":"bd-d","type":8})")));
  for (const auto& id : ids) {
    EXPECT_FALSE(kreoda::ShapeStore::instance().contains(id)) << id;
  }
  ASSERT_TRUE(BodyOf("bd", &b));
  EXPECT_EQ(b.tipFeatureId, "bd");
}

TEST(Bodies, ExtrudeOpensNewBodyAndInstanceIsNonBody) {
  NewDoc("bd-e");
  std::string err;
  kreoda::SketchModel m;
  m.points = {{"p0", 0, 0}, {"p1", 100, 0}, {"p2", 100, 50}, {"p3", 0, 50}};
  m.lines = {{"l0", "p0", "p1"},
             {"l1", "p1", "p2"},
             {"l2", "p2", "p3"},
             {"l3", "p3", "p0"}};
  ASSERT_TRUE(kreoda::CreateSketchFeature("se", "XY", m, &err)) << err;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("ee", "se", 20, &err)) << err;
  // Sketch is NonBody; the extruded solid is a fresh root (not an advance).
  EXPECT_FALSE(BodyOf("se", nullptr));
  kreoda::BodyRecord b;
  ASSERT_TRUE(BodyOf("ee", &b));
  EXPECT_EQ(b.history, (std::vector<std::string>{"ee"}));
  ASSERT_TRUE(kreoda::CreateInstanceFeature("ei", "ee", {10, 0, 0, 0, 0, 0},
                                            &err))
      << err;
  // Instance is an assembly occurrence reference, not a body edit.
  EXPECT_FALSE(BodyOf("ei", nullptr));
  ASSERT_TRUE(BodyOf("ee", &b));
  EXPECT_EQ(b.tipFeatureId, "ee");
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
}

TEST(Bodies, BooleanAdvancesTargetBody) {
  NewDoc("bd-f");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("bfa", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("bfb", 10, 10, 10, &err)) << err;
  ASSERT_TRUE(kreoda::CreateBooleanFeature("bfu", "fuse", "bfa", "bfb", &err))
      << err;
  // Result joins the TARGET body (tip = result); tool body untouched.
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 2u);
  kreoda::BodyRecord target, tool;
  ASSERT_TRUE(BodyOf("bfu", &target));
  EXPECT_EQ(target.tipFeatureId, "bfu");
  EXPECT_EQ(target.history,
            (std::vector<std::string>{"bfa", "bfu"}));
  ASSERT_TRUE(BodyOf("bfb", &tool));
  EXPECT_EQ(tool.tipFeatureId, "bfb");
  EXPECT_NE(tool.bodyId, target.bodyId);
}

TEST(Bodies, SaveOpenKeepsBodyIdentity) {
#if KREODA_WITH_OCCT && KREODA_WITH_MINIZIP
  NewDoc("bd-g");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("bga", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("bgh", "bga", "box.+Z", 50, 25, 8,
                                        "throughAll", 0, &err))
      << err;
  kreoda::ShapeRecord before;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("bgh", &before));
  const fs::path icad = fs::temp_directory_path() / "kreoda-bodies.icad";
  const std::string saveReq =
      std::string(R"({"protocolVersion":1,"requestId":"bg-s","documentId":"bd-g","type":10,"path":")") +
      icad.string() + "\"}";
  const std::string saveResp = rpc(saveReq);
  ASSERT_TRUE(ok(saveResp)) << saveResp;
  NewDoc("bd-g2");
  const std::string openReq =
      std::string(R"({"protocolVersion":1,"requestId":"bg-o","documentId":"bd-g2","type":11,"path":")") +
      icad.string() + "\"}";
  const std::string opened = rpc(openReq);
  ASSERT_TRUE(ok(opened)) << opened;
  // Same geometry, same body + history + tip.
  kreoda::ShapeRecord after;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("bgh", &after));
  EXPECT_NEAR(after.volumeMm3, before.volumeMm3, 1.0);
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
  kreoda::BodyRecord b;
  ASSERT_TRUE(BodyOf("bgh", &b));
  EXPECT_EQ(b.history, (std::vector<std::string>{"bga", "bgh"}));
  EXPECT_EQ(b.tipFeatureId, "bgh");
  std::error_code ec;
  fs::remove(icad, ec);
#else
  GTEST_SKIP() << "needs OCCT + minizip-ng (vcpkg build)";
#endif
}

// Slice 3 TEST E: Box → Hole → Pattern → Fillet, then an upstream Box width
// edit. Pins: same bodyId, downstream recompute in order (volumes track the
// new box), valid B-Rep on every history member (the CommitShape BRepCheck
// gate — asserted, not assumed), unambiguous refs still resolve (hole face
// role, fillet edge). Pattern members are base-minus-own-hole here;
// cumulative pattern geometry is Slice 5 (counts/tip pinned, not volumes).
#if KREODA_WITH_OCCT
TEST(Bodies, UpstreamEditRecomputesDownstreamAndKeepsTip) {
  NewDoc("bd-tip");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("eb", 120, 60, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("eh", "eb", "box.+Z", 30, 30, 8,
                                        "throughAll", 0, &err))
      << err;
  const std::vector<std::pair<double, double>> pts = {{90, 15}, {90, 45}};
  const std::vector<std::string> pids = {"ehp1", "ehp2"};
  std::vector<std::string> created;
  ASSERT_TRUE(kreoda::CreateHolePatternFeature("eb", "box.+Z", pts, 6,
                                               "throughAll", 0, pids, &created,
                                               &err))
      << err;
  ASSERT_TRUE(kreoda::CreateFilletFeature(
                  "ef", "eb", {"eb:edge.lin.box.+X~box.+Z"}, 2, &err))
      << err;
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
  kreoda::BodyRecord before;
  ASSERT_TRUE(BodyOf("ef", &before));
  EXPECT_EQ(before.history,
            (std::vector<std::string>{"eb", "eh", "ehp1", "ehp2", "ef"}));
  EXPECT_EQ(before.tipFeatureId, "ef");
  const std::string bodyId = before.bodyId;

  // Upstream edit: width 120 → 150. All downstream must recompute in order.
  ASSERT_TRUE(kreoda::RebuildFeature("eb", "widthMm", 150, &err)) << err;
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
  kreoda::BodyRecord after;
  ASSERT_TRUE(BodyOf("ef", &after));
  EXPECT_EQ(after.bodyId, bodyId);  // same body, never a duplicate
  EXPECT_EQ(after.history, before.history);  // counts stable
  EXPECT_EQ(after.tipFeatureId, "ef");       // tip follows the recompute

  // Recompute consistency: every downstream volume tracks the new box
  // (150×60×20 = 180000); through-holes remove pi*r^2*depth each.
  auto vol = [](const std::string& id) {
    kreoda::ShapeRecord rec;
    EXPECT_TRUE(kreoda::ShapeStore::instance().get(id, &rec)) << id;
    return rec.volumeMm3;
  };
  EXPECT_NEAR(vol("eb"), 180000.0, 1.0);
  EXPECT_NEAR(vol("eh"), 180000.0 - 3.14159265358979 * 16.0 * 20.0, 5.0);
  EXPECT_NEAR(vol("ehp1"), 180000.0 - 3.14159265358979 * 9.0 * 20.0, 5.0);
  EXPECT_NEAR(vol("ehp2"), 180000.0 - 3.14159265358979 * 9.0 * 20.0, 5.0);
  EXPECT_GT(vol("ef"), 0.0);
  EXPECT_LT(vol("ef"), vol("eb"));

  // Valid B-Rep on every history member (never a null/stale tip shape).
  for (const auto& id : after.history) {
    kreoda::ShapeRecord rec;
    ASSERT_TRUE(kreoda::ShapeStore::instance().get(id, &rec)) << id;
    EXPECT_FALSE(rec.shape.IsNull()) << id;
  }
  {
    kreoda::ShapeRecord tip;
    ASSERT_TRUE(kreoda::ShapeStore::instance().get("ef", &tip));
    EXPECT_TRUE(BRepCheck_Analyzer(tip.shape).IsValid(tip.shape));
  }
  // Unambiguous refs resolve against the recomputed geometry.
  {
    kreoda::ShapeRecord hole, box;
    ASSERT_TRUE(kreoda::ShapeStore::instance().get("eh", &hole));
    TopoDS_Face face;
    EXPECT_TRUE(
        kreoda::FindFaceByRole(hole.shape, "eh", hole.type, "box.+Z", &face));
    ASSERT_TRUE(kreoda::ShapeStore::instance().get("eb", &box));
    TopoDS_Edge edge;
    EXPECT_TRUE(kreoda::FindEdgeByRole(box.shape, "eb", box.type,
                                       "edge.lin.box.+X~box.+Z", &edge));
  }
  // The fillet edge ref still drives a rebuild (proves it resolves
  // downstream of the upstream edit); the tip stays put with fresh volume.
  const double filletBefore = vol("ef");
  ASSERT_TRUE(kreoda::RebuildFeature("ef", "radiusMm", 2.5, &err)) << err;
  EXPECT_NE(vol("ef"), filletBefore);
  kreoda::BodyRecord reanchored;
  ASSERT_TRUE(BodyOf("ef", &reanchored));
  EXPECT_EQ(reanchored.bodyId, bodyId);
  EXPECT_EQ(reanchored.tipFeatureId, "ef");
}
#else
TEST(Bodies, UpstreamEditRecomputesDownstreamAndKeepsTip) {
  GTEST_SKIP() << "needs OCCT (vcpkg build)";
}
#endif

// Slice 3 TEST F-core: Undo/Redo across tips + save/open identity.
// Undo steps the tip back with no duplicate bodies or ghost shapes;
// Redo steps it forward; save/open preserves body/history/tip.
TEST(Bodies, UndoRedoMovesTipWithoutGhosts) {
#if KREODA_WITH_OCCT && KREODA_WITH_MINIZIP
  NewDoc("bd-ur");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("fb", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("fh", "fb", "box.+Z", 50, 25, 8,
                                        "throughAll", 0, &err))
      << err;
  ASSERT_TRUE(kreoda::CreateFilletFeature(
                  "ff", "fb", {"fb:edge.lin.box.+X~box.+Z"}, 2, &err))
      << err;
  kreoda::BodyRecord full;
  ASSERT_TRUE(BodyOf("ff", &full));
  const std::string bodyId = full.bodyId;
  EXPECT_EQ(full.tipFeatureId, "ff");
  kreoda::ShapeRecord holeBefore, filletBefore;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("fh", &holeBefore));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("ff", &filletBefore));

  // Undo the fillet: tip steps back, no duplicate body, no ghost shape.
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"ur-u1","documentId":"bd-ur","type":8})")));
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("ff"));
  EXPECT_FALSE(BodyOf("ff", nullptr));  // undone id owns no body entry
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
  kreoda::BodyRecord stepped;
  ASSERT_TRUE(BodyOf("fh", &stepped));
  EXPECT_EQ(stepped.bodyId, bodyId);
  EXPECT_EQ(stepped.history, (std::vector<std::string>{"fb", "fh"}));
  EXPECT_EQ(stepped.tipFeatureId, "fh");

  // Undo the hole: tip back at the root.
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"ur-u2","documentId":"bd-ur","type":8})")));
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("fh"));
  EXPECT_FALSE(BodyOf("fh", nullptr));
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
  kreoda::BodyRecord root;
  ASSERT_TRUE(BodyOf("fb", &root));
  EXPECT_EQ(root.bodyId, bodyId);
  EXPECT_EQ(root.tipFeatureId, "fb");

  // Redo both: tip forward, identical geometry, still one body.
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"ur-r1","documentId":"bd-ur","type":9})")));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"ur-r2","documentId":"bd-ur","type":9})")));
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
  kreoda::BodyRecord restored;
  ASSERT_TRUE(BodyOf("ff", &restored));
  EXPECT_EQ(restored.bodyId, bodyId);
  EXPECT_EQ(restored.history, full.history);
  EXPECT_EQ(restored.tipFeatureId, "ff");
  kreoda::ShapeRecord holeAfter, filletAfter;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("fh", &holeAfter));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("ff", &filletAfter));
  EXPECT_NEAR(holeAfter.volumeMm3, holeBefore.volumeMm3, 1.0);
  EXPECT_NEAR(filletAfter.volumeMm3, filletBefore.volumeMm3, 1.0);

  // Save/Open preserves body/history/tip (no duplication on adopt).
  const fs::path icad = fs::temp_directory_path() / "kreoda-tip-undo.icad";
  const std::string saveReq =
      std::string(R"({"protocolVersion":1,"requestId":"ur-s","documentId":"bd-ur","type":10,"path":")") +
      icad.string() + "\"}";
  ASSERT_TRUE(ok(rpc(saveReq))) << saveReq;
  NewDoc("bd-ur2");
  const std::string openReq =
      std::string(R"({"protocolVersion":1,"requestId":"ur-o","documentId":"bd-ur2","type":11,"path":")") +
      icad.string() + "\"}";
  ASSERT_TRUE(ok(rpc(openReq))) << openReq;
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
  kreoda::BodyRecord opened;
  ASSERT_TRUE(BodyOf("ff", &opened));
  EXPECT_EQ(opened.bodyId, bodyId);  // deterministic root-derived id
  EXPECT_EQ(opened.history, full.history);
  EXPECT_EQ(opened.tipFeatureId, "ff");
  std::error_code ec;
  fs::remove(icad, ec);
#else
  GTEST_SKIP() << "needs OCCT + minizip-ng (vcpkg build)";
#endif
}

TEST(Bodies, LegacyFileMigratesByCreationOrder) {
#if KREODA_WITH_OCCT && KREODA_WITH_MINIZIP
  NewDoc("bd-h");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("bla", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("blh", "bla", "box.+Z", 50, 25, 8,
                                        "throughAll", 0, &err))
      << err;
  kreoda::ShapeRecord before;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("blh", &before));
  // Legacy-format archive: current XBF but a manifest WITHOUT the bodies
  // section (the pre-Slice-2 shape) — the honest old-file shape.
  std::error_code ec;
  const std::string tmp = (fs::temp_directory_path() / "kreoda-legacydir").string();
  fs::create_directories(tmp, ec);
  const std::string xbf = (fs::path(tmp) / "document.xbf").string();
  ASSERT_TRUE(kreoda::OcafLive::instance().Save(xbf, &err)) << err;
  const fs::path icad = fs::temp_directory_path() / "kreoda-legacy.icad";
  const std::string legacyManifest =
      R"({"format":"kreoda-project","schemaVersion":1,)"
      R"("appVersion":"0.1.0","documentId":"bd-h","units":"mm"})";
  ASSERT_TRUE(kreoda::WriteIcad(icad.string(), legacyManifest, xbf, &err))
      << err;
  NewDoc("bd-h2");
  const std::string openReq =
      std::string(R"({"protocolVersion":1,"requestId":"bl-o","documentId":"bd-h2","type":11,"path":")") +
      icad.string() + "\"}";
  const std::string opened = rpc(openReq);
  ASSERT_TRUE(ok(opened)) << opened;
  // Same geometry; bodies reconstructed: root opens, hole joins in order.
  kreoda::ShapeRecord after;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("blh", &after));
  EXPECT_NEAR(after.volumeMm3, before.volumeMm3, 1.0);
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
  kreoda::BodyRecord b;
  ASSERT_TRUE(BodyOf("blh", &b));
  EXPECT_EQ(b.history, (std::vector<std::string>{"bla", "blh"}));
  EXPECT_EQ(b.tipFeatureId, "blh");
  fs::remove(icad, ec);
  fs::remove_all(tmp, ec);
#else
  GTEST_SKIP() << "needs OCCT + minizip-ng (vcpkg build)";
#endif
}
