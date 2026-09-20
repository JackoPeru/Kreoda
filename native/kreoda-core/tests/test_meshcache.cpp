// Mesh response cache (Phase 8 large-model slice): identical re-pulls hit
// the cache byte-for-byte; any commit (revision bump) invalidates via the
// revision in the key — never a stale mesh. Mesh successes are FlatBuffers
// MeshUpdate tables (§8), parsed with the generated bindings.

#include <gtest/gtest.h>

#include <string>
#include <vector>

#include "rpc_text.h"

namespace {

std::string rpc(const std::string& body) {
  return kreoda_test::rpcText(body);
}

bool has(const std::string& r, const std::string& s) {
  return r.find(s) != std::string::npos;
}

}  // namespace

TEST(MeshCache, HitIsIdenticalAndCommitInvalidates) {
#ifdef KREODA_WITH_FLATBUFFERS
  ASSERT_TRUE(has(rpc("{\"protocolVersion\":1,\"requestId\":\"m1\","
                      "\"documentId\":\"mcache-doc\",\"type\":2}"),
                  "\"status\":\"ok\""));
  ASSERT_TRUE(has(rpc("{\"protocolVersion\":1,\"requestId\":\"m2\","
                      "\"documentId\":\"mcache-doc\",\"type\":3,"
                      "\"featureId\":\"mcache-box\",\"widthMm\":100,"
                      "\"heightMm\":50,\"depthMm\":20}"),
                  "\"status\":\"ok\""));
  const std::vector<uint8_t> mesh1 = kreoda::handle_command(
      "{\"protocolVersion\":1,\"requestId\":\"m3\","
      "\"documentId\":\"mcache-doc\",\"type\":12,"
      "\"featureId\":\"mcache-box\",\"lod\":1}");
  const auto* u1 = kreoda_test::meshRoot(mesh1);
  ASSERT_NE(u1, nullptr);
  EXPECT_NEAR(u1->volume_mm3(), 100000.0, 0.5);
  EXPECT_EQ(u1->indices_count() / 3, 12u);
  ASSERT_NE(u1->request_id(), nullptr);
  EXPECT_EQ(u1->request_id()->str(), "m3");
  // Second identical pull: cache hit (tessellation skipped), fresh encoding
  // with THIS request's id for sidecar correlation (C15) — so field-wise
  // equality, not byte equality.
  const std::vector<uint8_t> mesh2 = kreoda::handle_command(
      "{\"protocolVersion\":1,\"requestId\":\"m4\","
      "\"documentId\":\"mcache-doc\",\"type\":12,"
      "\"featureId\":\"mcache-box\",\"lod\":1}");
  const auto* u2 = kreoda_test::meshRoot(mesh2);
  ASSERT_NE(u2, nullptr);
  EXPECT_NEAR(u2->volume_mm3(), u1->volume_mm3(), 1e-9);
  EXPECT_EQ(u2->indices_count(), u1->indices_count());
  EXPECT_EQ(u2->positions_count(), u1->positions_count());
  ASSERT_NE(u2->request_id(), nullptr);
  EXPECT_EQ(u2->request_id()->str(), "m4");
  // Commit bumps the revision: the next pull must reflect new geometry.
  ASSERT_TRUE(has(rpc("{\"protocolVersion\":1,\"requestId\":\"m5\","
                      "\"documentId\":\"mcache-doc\",\"type\":6,"
                      "\"featureId\":\"mcache-box\",\"paramName\":\"widthMm\","
                      "\"valueMm\":200}"),
                  "\"status\":\"ok\""));
  const std::vector<uint8_t> mesh3 = kreoda::handle_command(
      "{\"protocolVersion\":1,\"requestId\":\"m6\","
      "\"documentId\":\"mcache-doc\",\"type\":12,"
      "\"featureId\":\"mcache-box\",\"lod\":1}");
  const auto* u3 = kreoda_test::meshRoot(mesh3);
  ASSERT_NE(u3, nullptr);
  EXPECT_NEAR(u3->volume_mm3(), 200000.0, 0.5);
#else
  GTEST_SKIP() << "mesh binary needs flatbuffers";
#endif
}
