#include <gtest/gtest.h>

#include <cmath>
#include <string>
#include <utility>
#include <vector>

#include "../src/document/document_store.h"
#include "../src/features/hole/hole.h"
#include "../src/features/primitives/primitives.h"
#include "../src/model/shapes.h"
#include "../src/protocol/dispatcher.h"

#include "rpc_text.h"

// Phase 10 (M11 validation): a user-level hole pattern on one body.
// Representation contract (locked by phase7-nl E2E): each Hole feature holds
// base-minus-its-hole; the pattern's guarantees are atomic creation +
// exactly one Undo step for the whole pattern.

namespace {

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

}  // namespace

TEST(HolePattern, OneUndoStepAndSingleHoleVolumes) {
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
  EXPECT_EQ(created.size(), 4u);
  // Each hole feature is the base minus exactly its own tool volume.
  const double tool = 3.14159265358979 * 9.0 * 10.0;
  for (const auto& id : ids) {
    ASSERT_TRUE(Contains(id)) << id;
    EXPECT_NEAR(VolumeOf(id), 60000.0 - tool, 1.0) << id;
  }
  // Exactly ONE undo step removes all four (single OCAF transaction).
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"hp-u1","documentId":"hp1","type":8})")));
  for (const auto& id : ids) EXPECT_FALSE(Contains(id)) << id;
  EXPECT_TRUE(Contains("pa"));
  // Redo restores the whole pattern in one step.
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"hp-r1","documentId":"hp1","type":9})")));
  for (const auto& id : ids) {
    ASSERT_TRUE(Contains(id)) << id;
    EXPECT_NEAR(VolumeOf(id), 60000.0 - tool, 1.0) << id;
  }
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
  EXPECT_NE(res.find("p1"), std::string::npos);
  EXPECT_NE(res.find("p2"), std::string::npos);
  // Mismatched points/featureIds count is an honest BAD_PARAMS.
  const std::string bad = rpc(
      R"({"protocolVersion":1,"requestId":"hp3-q","documentId":"hp3","type":25,)"
      R"("targetId":"pc","faceRole":"box.+Z",)"
      R"("featureIds":["q1"],"points":[8,8,92,52],)"
      R"("diameterMm":6,"depthMode":"throughAll","depthMm":0})");
  EXPECT_FALSE(ok(bad));
  EXPECT_NE(bad.find("BAD_PARAMS"), std::string::npos);
}
