#include <gtest/gtest.h>

#include <cmath>
#include <filesystem>
#include <string>
#include <utility>
#include <vector>

#include "../src/document/document_store.h"
#include "../src/features/hole/hole.h"
#include "../src/features/primitives/primitives.h"
#include "../src/model/body.h"
#include "../src/model/shapes.h"
#include "../src/persistence/ocaf_live.h"
#include "../src/features/fillet/fillet.h"
#include "../src/expressions/expressions.h"
#include "../src/topology/face_roles.h"
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include "../src/protocol/dispatcher.h"

#include "rpc_text.h"

// Phase 10 (M11 validation) + Slice 5: a user-level hole pattern on one body.
// Representation contract: ONE "HolePattern" record advancing the target
// body — the tip shape is the cumulative sequential cut (base minus ALL
// tools). The wire still carries 1..4 frontend-owned ids 1:1 with points;
// only featureIds[0] is committed (trailing ids stay validated-but-free, no
// sub-feature bodies or viewport objects). One OCAF transaction ⇒ one Undo.

namespace {

namespace fs = std::filesystem;

void NewDoc(const std::string& id) {
  kreoda::DocumentStore::instance().create(id);
}

std::string rpc(const std::string& body) {
  return kreoda_test::rpcText(body);
}

bool ok(const std::string& r) {
  return r.find("\"status\":\"ok\"") != std::string::npos;
}

double VolumeOf(const std::string& id) {
  kreoda::ShapeRecord rec;
  EXPECT_TRUE(kreoda::ShapeStore::instance().get(id, &rec));
  return rec.volumeMm3;
}

bool Contains(const std::string& id) {
  return kreoda::ShapeStore::instance().contains(id);
}

bool BodyOf(const std::string& featureId, kreoda::BodyRecord* out) {
  return kreoda::BodyStore::instance().bodyForFeature(featureId, out);
}

constexpr double kTool6x10 = 3.14159265358979 * 9.0 * 10.0;

}  // namespace

TEST(HolePattern, CumulativeTipAndSingleUndo) {
  NewDoc("hp1");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("pa", 100, 60, 10, &err)) << err;
  const std::vector<std::pair<double, double>> pts = {
      {8, 8}, {92, 8}, {8, 52}, {92, 52}};
  const std::vector<std::string> ids = {"h1", "h2", "h3", "h4"};
  std::vector<std::string> created;
  ASSERT_TRUE(kreoda::CreateHolePatternFeature("pa", "box.+Z", pts, 6,
                                               "throughAll", 0, ids, &created,
                                               &err))
      << err;
  // One record as the tip — trailing wire ids create nothing.
  EXPECT_EQ(created, (std::vector<std::string>{"h1"}));
  for (const auto& id : {"h2", "h3", "h4"}) EXPECT_FALSE(Contains(id)) << id;
  // One body: root + pattern tip, tip = the cumulative cut.
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
  kreoda::BodyRecord b;
  ASSERT_TRUE(BodyOf("h1", &b));
  EXPECT_EQ(b.history, (std::vector<std::string>{"pa", "h1"}));
  EXPECT_EQ(b.tipFeatureId, "h1");
  EXPECT_NEAR(VolumeOf("h1"), 60000.0 - 4 * kTool6x10, 2.0);
  // Exactly ONE undo step removes the whole pattern (root + tip restored).
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"hp-u1","documentId":"hp1","type":8})")));
  EXPECT_FALSE(Contains("h1"));
  EXPECT_TRUE(Contains("pa"));
  ASSERT_TRUE(BodyOf("pa", &b));
  EXPECT_EQ(b.tipFeatureId, "pa");
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
  // Redo restores the cumulative tip in one step.
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"hp-r1","documentId":"hp1","type":9})")));
  ASSERT_TRUE(Contains("h1"));
  EXPECT_NEAR(VolumeOf("h1"), 60000.0 - 4 * kTool6x10, 2.0);
  ASSERT_TRUE(BodyOf("h1", &b));
  EXPECT_EQ(b.tipFeatureId, "h1");
}

TEST(HolePattern, AtomicOnMiss) {
  NewDoc("hp2");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("pb", 100, 60, 10, &err)) << err;
  // Second point is far outside the face: the miss guard must fail the
  // WHOLE pattern with nothing created (no partial holes).
  const std::vector<std::pair<double, double>> pts = {{50, 30}, {5000, 5000}};
  const std::vector<std::string> ids = {"m1", "m2"};
  std::vector<std::string> created;
  EXPECT_FALSE(kreoda::CreateHolePatternFeature("pb", "box.+Z", pts, 6,
                                                "throughAll", 0, ids, &created,
                                                &err));
  EXPECT_FALSE(err.empty());
  EXPECT_TRUE(created.empty());
  EXPECT_FALSE(Contains("m1"));
  EXPECT_FALSE(Contains("m2"));
  EXPECT_TRUE(Contains("pb"));
}

TEST(HolePattern, RpcEndToEnd) {
  NewDoc("hp3");
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"hp3-b","documentId":"hp3","type":3,"featureId":"pc","widthMm":100,"heightMm":60,"depthMm":10})")));
  const std::string res = rpc(
      R"({"protocolVersion":1,"requestId":"hp3-p","documentId":"hp3","type":25,)"
      R"("targetId":"pc","faceRole":"box.+Z",)"
      R"("featureIds":["p1","p2"],"points":[8,8,92,52],)"
      R"("diameterMm":6,"depthMode":"throughAll","depthMm":0})");
  ASSERT_TRUE(ok(res)) << res;
  // The tip commits under featureIds[0]; the trailing id creates no record.
  EXPECT_NE(res.find("\"featureId\":\"p1\""), std::string::npos);
  EXPECT_EQ(res.find("\"featureId\":\"p2\""), std::string::npos);
  EXPECT_NE(res.find("HolePattern"), std::string::npos);
  // Mismatched points/featureIds count is an honest BAD_PARAMS.
  const std::string bad = rpc(
      R"({"protocolVersion":1,"requestId":"hp3-q","documentId":"hp3","type":25,)"
      R"("targetId":"pc","faceRole":"box.+Z",)"
      R"("featureIds":["q1"],"points":[8,8,92,52],)"
      R"("diameterMm":6,"depthMode":"throughAll","depthMm":0})");
  EXPECT_FALSE(ok(bad));
  EXPECT_NE(bad.find("BAD_PARAMS"), std::string::npos);
}

// Slice 5 §5.1 (native, permanent): 100×60×10 plate + four Ø6 through holes
// → 1 body; cumulative volume; Undo drops all four together; Redo restores;
// Save/Open keeps geometry; a plate-dim edit recomputes the pattern.
TEST(HolePattern, Section51_FourHolePlate) {
  NewDoc("hp51");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("plate", 100, 60, 10, &err)) << err;
  const std::vector<std::pair<double, double>> pts = {
      {8, 8}, {92, 8}, {8, 52}, {92, 52}};
  const std::vector<std::string> ids = {"pat", "u2", "u3", "u4"};
  std::vector<std::string> created;
  ASSERT_TRUE(kreoda::CreateHolePatternFeature("plate", "box.+Z", pts, 6,
                                               "throughAll", 0, ids, &created,
                                               &err))
      << err;
  EXPECT_EQ(created, (std::vector<std::string>{"pat"}));
  // 1 body; final volume ≈ 100*60*10 − 4*PI*9*10.
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
  kreoda::BodyRecord b;
  ASSERT_TRUE(BodyOf("pat", &b));
  EXPECT_EQ(b.history, (std::vector<std::string>{"plate", "pat"}));
  EXPECT_EQ(b.tipFeatureId, "pat");
  EXPECT_NEAR(VolumeOf("pat"), 60000.0 - 4 * kTool6x10, 2.0);
  // Undo → body exists, all 4 holes gone together.
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"hp51-u","documentId":"hp51","type":8})")));
  EXPECT_FALSE(Contains("pat"));
  for (const auto& id : {"u2", "u3", "u4"}) EXPECT_FALSE(Contains(id)) << id;
  EXPECT_TRUE(Contains("plate"));
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
  ASSERT_TRUE(BodyOf("plate", &b));
  EXPECT_EQ(b.tipFeatureId, "plate");
  // Redo → all 4 back (cumulative tip restored).
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"hp51-r","documentId":"hp51","type":9})")));
  ASSERT_TRUE(Contains("pat"));
  EXPECT_NEAR(VolumeOf("pat"), 60000.0 - 4 * kTool6x10, 2.0);
#if KREODA_WITH_OCCT && KREODA_WITH_MINIZIP
  // Save/Open → same geometry, same body/history/tip.
  const fs::path icad = fs::temp_directory_path() / "kreoda-pattern51.icad";
  const std::string saveReq =
      std::string(R"({"protocolVersion":1,"requestId":"hp51-s","documentId":"hp51","type":10,"path":")") +
      icad.string() + "\"}";
  ASSERT_TRUE(ok(rpc(saveReq))) << saveReq;
  NewDoc("hp51b");
  const std::string openReq =
      std::string(R"({"protocolVersion":1,"requestId":"hp51-o","documentId":"hp51b","type":11,"path":")") +
      icad.string() + "\"}";
  ASSERT_TRUE(ok(rpc(openReq))) << openReq;
  ASSERT_TRUE(Contains("pat"));
  EXPECT_NEAR(VolumeOf("pat"), 60000.0 - 4 * kTool6x10, 1.0);
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
  ASSERT_TRUE(BodyOf("pat", &b));
  EXPECT_EQ(b.history, (std::vector<std::string>{"plate", "pat"}));
  EXPECT_EQ(b.tipFeatureId, "pat");
  std::error_code ec;
  fs::remove(icad, ec);
#else
  GTEST_SKIP() << "needs OCCT + minizip-ng (vcpkg build)";
#endif
  // Edit plate dims → pattern recomputes cumulatively (runs on the reopened
  // document above; on the live one when persistence is unavailable).
  ASSERT_TRUE(kreoda::RebuildFeature("plate", "widthMm", 120, &err)) << err;
  EXPECT_NEAR(VolumeOf("plate"), 72000.0, 1.0);
  EXPECT_NEAR(VolumeOf("pat"), 72000.0 - 4 * kTool6x10, 2.0);
  ASSERT_TRUE(BodyOf("pat", &b));
  EXPECT_EQ(b.history, (std::vector<std::string>{"plate", "pat"}));
  EXPECT_EQ(b.tipFeatureId, "pat");
}

TEST(HolePattern, CountEditPreservesLayoutUndoAndPersistence) {
  NewDoc("hp-count");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("plate", 100, 60, 10, &err)) << err;
  std::vector<std::string> created;
  ASSERT_TRUE(kreoda::CreateHolePatternFeature("plate", "box.+Z",
      {{8, 8}, {92, 8}, {8, 52}, {92, 52}}, 6, "throughAll", 0,
      {"pat", "unused2", "unused3", "unused4"}, &created, &err)) << err;
  kreoda::ShapeRecord original;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("pat", &original));
  kreoda::OcafLive::FaceSelection top, removed;
  ASSERT_TRUE(kreoda::OcafLive::instance().SelectFace("pat", "box.+Z", &top, &err));
  ASSERT_TRUE(kreoda::OcafLive::instance().SelectFace("pat", "wall.3", &removed, &err));
  TopoDS_Face firstWall;
  ASSERT_TRUE(kreoda::FindFaceByRole(original.shape, "pat", "HolePattern", "wall.0", &firstWall));
  GProp_GProps firstProps;
  BRepGProp::SurfaceProperties(firstWall, firstProps);
  const auto setCount = [](const std::string& value) {
    return rpc(R"({"protocolVersion":1,"requestId":"count","documentId":"hp-count","type":6,"featureId":"pat","paramName":"count","valueMm":)" + value + "}");
  };
  ASSERT_TRUE(ok(setCount("2"))) << err;
  EXPECT_NEAR(VolumeOf("pat"), 60000 - 2 * kTool6x10, 1);
  kreoda::ShapeRecord reduced;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("pat", &reduced));
  ASSERT_EQ(reduced.paramsMm.size(), 3u);
  EXPECT_EQ(reduced.paramsMm[2], 2);
  EXPECT_EQ(reduced.refExtra, original.refExtra);
  EXPECT_TRUE(kreoda::OcafLive::instance().ResolveSelection(top).valid);
  EXPECT_FALSE(kreoda::OcafLive::instance().ResolveSelection(removed).valid);
  ASSERT_TRUE(kreoda::FindFaceByRole(reduced.shape, "pat", "HolePattern", "wall.0", &firstWall));
  GProp_GProps reducedProps;
  BRepGProp::SurfaceProperties(firstWall, reducedProps);
  EXPECT_NEAR(firstProps.CentreOfMass().Distance(reducedProps.CentreOfMass()), 0, 1e-6);
  kreoda::CoreMesh preview;
  ASSERT_TRUE(kreoda::BuildPreviewMesh("pat", "count", 1, &preview, &err)) << err;
  size_t walls = 0;
  for (const auto& face : preview.faces) if (face.persistentFaceId.find(":wall.") != std::string::npos) ++walls;
  EXPECT_EQ(walls, 1u);
  EXPECT_NEAR(VolumeOf("pat"), reduced.volumeMm3, 1e-6);
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();
  for (const auto& invalid : {"0", "-1", "1.5", "5"}) {
    EXPECT_FALSE(ok(setCount(invalid))) << invalid;
    EXPECT_NEAR(VolumeOf("pat"), reduced.volumeMm3, 1e-6);
    EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
  }
  ASSERT_TRUE(ok(rpc(R"({"protocolVersion":1,"requestId":"u","documentId":"hp-count","type":8})")));
  EXPECT_NEAR(VolumeOf("pat"), 60000 - 4 * kTool6x10, 1);
  ASSERT_TRUE(ok(rpc(R"({"protocolVersion":1,"requestId":"r","documentId":"hp-count","type":9})")));
  EXPECT_NEAR(VolumeOf("pat"), reduced.volumeMm3, 1e-6);
#if KREODA_WITH_OCCT && KREODA_WITH_MINIZIP
  const auto file = fs::temp_directory_path() / "kreoda-pattern-count.icad";
  const auto fileRpc = [&](int type) {
    return rpc("{\"protocolVersion\":1,\"requestId\":\"file\",\"documentId\":\"hp-count\",\"type\":" + std::to_string(type) + ",\"path\":\"" + file.generic_string() + "\"}");
  };
  ASSERT_TRUE(ok(fileRpc(10)));
  NewDoc("hp-count");
  ASSERT_TRUE(ok(fileRpc(11)));
  EXPECT_NEAR(VolumeOf("pat"), reduced.volumeMm3, 1e-6);
  ASSERT_TRUE(ok(setCount("4")));
  EXPECT_NEAR(VolumeOf("pat"), original.volumeMm3, 1e-6);
  ASSERT_TRUE(kreoda::OcafLive::instance().Undo(&err)) << err;
  EXPECT_NEAR(VolumeOf("pat"), reduced.volumeMm3, 1e-6);
  ASSERT_TRUE(kreoda::OcafLive::instance().Redo(&err)) << err;
  EXPECT_NEAR(VolumeOf("pat"), original.volumeMm3, 1e-6);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("pat", &reduced));
  EXPECT_EQ(reduced.refExtra, original.refExtra);
  fs::remove(file);
#endif
}

TEST(HolePattern, LegacyTwoSlotMetadataRemainsEditable) {
  NewDoc("hp-legacy");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("plate", 100, 60, 10, &err));
  std::vector<std::string> created;
  ASSERT_TRUE(kreoda::CreateHolePatternFeature("plate", "box.+Z",
      {{8, 8}, {92, 52}}, 6, "throughAll", 0, {"pat", "unused"}, &created, &err)) << err;
  kreoda::ShapeRecord legacy;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("pat", &legacy));
  legacy.paramsMm.resize(2);
  ASSERT_TRUE(kreoda::OcafLive::instance().BeginCommand(&err));
  ASSERT_TRUE(kreoda::OcafLive::instance().UpsertFeature(legacy, false, &err));
  bool changed = false;
  ASSERT_TRUE(kreoda::OcafLive::instance().CommitCommand(&changed, &err));
  ASSERT_TRUE(kreoda::OcafLive::instance().ResyncStore(&err));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("pat", &legacy));
  ASSERT_EQ(legacy.paramsMm.size(), 3u);
  EXPECT_EQ(legacy.paramsMm[2], 2);
#if KREODA_WITH_OCCT && KREODA_WITH_MINIZIP
  const auto file = fs::temp_directory_path() / "kreoda-pattern-legacy.icad";
  auto fileRpc = [&](int type) {
    return rpc("{\"protocolVersion\":1,\"requestId\":\"file\",\"documentId\":\"hp-legacy\",\"type\":" + std::to_string(type) + ",\"path\":\"" + file.generic_string() + "\"}");
  };
  ASSERT_TRUE(ok(fileRpc(10)));
  NewDoc("hp-legacy");
  ASSERT_TRUE(ok(fileRpc(11)));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("pat", &legacy));
  ASSERT_EQ(legacy.paramsMm.size(), 3u);
  EXPECT_EQ(legacy.paramsMm[2], 2);
  fs::remove(file);
#endif
  ASSERT_TRUE(kreoda::RebuildFeature("pat", "count", 1, "", &err)) << err;
  EXPECT_NEAR(VolumeOf("pat"), 60000 - kTool6x10, 1);
  ASSERT_TRUE(kreoda::RebuildFeature("pat", "count", 0, "1+1", &err)) << err;
  EXPECT_NEAR(VolumeOf("pat"), 60000 - 2 * kTool6x10, 1);
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();
  EXPECT_FALSE(kreoda::RebuildFeature("pat", "count", 0, "1.5", &err));
  EXPECT_NEAR(VolumeOf("pat"), 60000 - 2 * kTool6x10, 1);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
  std::string expression;
  ASSERT_TRUE(kreoda::ExpressionStore::instance().get("pat", "count", &expression));
  EXPECT_EQ(expression, "1+1");
  ASSERT_TRUE(kreoda::RebuildFeature("pat", "count", 1, &err)) << err;
  EXPECT_FALSE(kreoda::ExpressionStore::instance().get("pat", "count", &expression));
  EXPECT_NEAR(VolumeOf("pat"), 60000 - kTool6x10, 1);
  ASSERT_TRUE(kreoda::OcafLive::instance().Undo(&err)) << err;
  EXPECT_NEAR(VolumeOf("pat"), 60000 - 2 * kTool6x10, 1);
  ASSERT_TRUE(kreoda::ExpressionStore::instance().get("pat", "count", &expression));
  EXPECT_EQ(expression, "1+1");
}

TEST(HolePattern, BlindDimensionsAndUpstreamEditsReflowActiveCount) {
  NewDoc("hp-blind");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("plate", 100, 60, 10, &err));
  std::vector<std::string> created;
  ASSERT_TRUE(kreoda::CreateHolePatternFeature("plate", "box.+Z",
      {{8, 8}, {92, 52}}, 6, "blind", 3, {"pat", "unused"}, &created, &err)) << err;
  ASSERT_TRUE(kreoda::RebuildFeature("pat", "count", 1, &err)) << err;
  ASSERT_TRUE(kreoda::RebuildFeature("pat", "diameterMm", 8, &err)) << err;
  ASSERT_TRUE(kreoda::RebuildFeature("pat", "depthMm", 5, &err)) << err;
  ASSERT_TRUE(kreoda::RebuildFeature("plate", "heightMm", 80, &err)) << err;
  EXPECT_NEAR(VolumeOf("pat"), 80000 - 3.14159265358979 * 16 * 5, 1);
}

TEST(HolePattern, RemovedRimDependencyRejectsCountEditAtomically) {
  NewDoc("hp-dependent");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("plate", 100, 60, 10, &err));
  std::vector<std::string> created;
  ASSERT_TRUE(kreoda::CreateHolePatternFeature("plate", "box.+Z",
      {{8, 8}, {92, 8}, {8, 52}, {92, 52}}, 6, "throughAll", 0,
      {"pat", "u2", "u3", "u4"}, &created, &err)) << err;
  ASSERT_TRUE(kreoda::CreateFilletFeature("rim", "pat",
      {"pat:edge.cir.box.+Z~wall.3"}, 1, &err)) << err;
  const auto volume = VolumeOf("rim");
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();
  EXPECT_FALSE(kreoda::RebuildFeature("pat", "count", 2, &err));
  EXPECT_NE(err.find("vanished"), std::string::npos) << err;
  EXPECT_NEAR(VolumeOf("pat"), 60000 - 4 * kTool6x10, 1);
  EXPECT_NEAR(VolumeOf("rim"), volume, 1e-6);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
  kreoda::BodyRecord body;
  ASSERT_TRUE(BodyOf("rim", &body));
  EXPECT_EQ(body.tipFeatureId, "rim");
  ASSERT_TRUE(kreoda::RebuildFeature("pat", "count", 0, "2+2", &err)) << err;
#if KREODA_WITH_MINIZIP
  const auto file = fs::temp_directory_path() / "kreoda-pattern-rim-rollback.icad";
  auto fileRpc = [&](int type) {
    return rpc("{\"protocolVersion\":1,\"requestId\":\"file\",\"documentId\":\"hp-dependent\",\"type\":" + std::to_string(type) + ",\"path\":\"" + file.generic_string() + "\"}");
  };
  ASSERT_TRUE(ok(fileRpc(10)));
  NewDoc("hp-dependent");
  ASSERT_TRUE(ok(fileRpc(11)));
  fs::remove(file);
#endif
  const auto formulaUndos = kreoda::OcafLive::instance().AvailableUndos();
  EXPECT_FALSE(kreoda::RebuildFeature("pat", "count", 0, "1+1", &err));
  std::string expression;
  ASSERT_TRUE(kreoda::ExpressionStore::instance().get("pat", "count", &expression));
  EXPECT_EQ(expression, "2+2");
  EXPECT_NEAR(VolumeOf("rim"), volume, 1e-6);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), formulaUndos);
}
