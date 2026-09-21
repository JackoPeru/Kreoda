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
