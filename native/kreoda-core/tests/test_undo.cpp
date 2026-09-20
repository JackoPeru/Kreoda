#include <gtest/gtest.h>

#include <string>

#include "rpc_text.h"

// §12: one user action == one Undo delta; undo/redo resync the store.

namespace {

std::string rpc(const std::string& body) {
  return kreoda_test::rpcText(body);
}

bool ok(const std::string& r) {
  return r.find("\"status\":\"ok\"") != std::string::npos;
}

bool has(const std::string& r, const std::string& s) {
  return r.find(s) != std::string::npos;
}

#ifdef KREODA_WITH_FLATBUFFERS
// Mesh successes are FlatBuffers MeshUpdate tables (§8). The byte vector
// must outlive the decoded view — never parse a temporary.
double meshVolume(const std::string& body) {
  const std::vector<uint8_t> bytes = kreoda::handle_command(body);
  const auto* update = kreoda_test::meshRoot(bytes);
  return update ? update->volume_mm3() : -1.0;
}

uint32_t meshTriangles(const std::string& body) {
  const std::vector<uint8_t> bytes = kreoda::handle_command(body);
  const auto* update = kreoda_test::meshRoot(bytes);
  return update ? update->indices_count() / 3 : 0;
}
#endif

}  // namespace

TEST(UndoRedo, CreateUndoRedoRoundTrip) {
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"u0","documentId":"ud1","type":2})")));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"u1","documentId":"ud1","type":3,"featureId":"ubox","widthMm":100,"heightMm":50,"depthMm":20})")));
#ifdef KREODA_WITH_FLATBUFFERS
  EXPECT_EQ(meshTriangles(
                R"({"protocolVersion":1,"requestId":"u2","documentId":"ud1","type":12,"featureId":"ubox","lod":1})"),
            12u);
#else
  GTEST_SKIP() << "mesh binary needs flatbuffers";
#endif

  // Undo the creation: the feature must be gone (no fake geometry).
  const std::string undo = rpc(
      R"({"protocolVersion":1,"requestId":"u3","documentId":"ud1","type":8})");
  ASSERT_TRUE(ok(undo)) << undo;
  EXPECT_TRUE(has(
      rpc(R"({"protocolVersion":1,"requestId":"u4","documentId":"ud1","type":12,"featureId":"ubox","lod":1})"),
      "\"status\":\"error\""));

  // Redo brings the identical solid back.
  const std::string redo2 = rpc(
      R"({"protocolVersion":1,"requestId":"u6","documentId":"ud1","type":9})");
  ASSERT_TRUE(ok(redo2)) << redo2;
#ifdef KREODA_WITH_FLATBUFFERS
  EXPECT_EQ(meshTriangles(
                R"({"protocolVersion":1,"requestId":"u7","documentId":"ud1","type":12,"featureId":"ubox","lod":1})"),
            12u);
  EXPECT_NEAR(meshVolume(
                  R"({"protocolVersion":1,"requestId":"u7","documentId":"ud1","type":12,"featureId":"ubox","lod":1})"),
              100000.0, 0.5);
#else
  GTEST_SKIP() << "mesh binary needs flatbuffers";
#endif
}

TEST(UndoRedo, ParameterEditUndoRestoresVolume) {
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"w0","documentId":"ud2","type":2})")));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"w1","documentId":"ud2","type":3,"featureId":"wbox","widthMm":100,"heightMm":50,"depthMm":20})")));
  const std::string set = rpc(
      R"({"protocolVersion":1,"requestId":"w2","documentId":"ud2","type":6,"featureId":"wbox","paramName":"widthMm","valueMm":150})");
  ASSERT_TRUE(ok(set)) << set;
  EXPECT_TRUE(has(set, "150000"));

  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"w3","documentId":"ud2","type":8})")));
#ifdef KREODA_WITH_FLATBUFFERS
  EXPECT_NEAR(meshVolume(
                  R"({"protocolVersion":1,"requestId":"w4","documentId":"ud2","type":12,"featureId":"wbox","lod":1})"),
              100000.0, 0.5);
#else
  GTEST_SKIP() << "mesh binary needs flatbuffers";
#endif

  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"w5","documentId":"ud2","type":9})")));
#ifdef KREODA_WITH_FLATBUFFERS
  EXPECT_NEAR(meshVolume(
                  R"({"protocolVersion":1,"requestId":"w6","documentId":"ud2","type":12,"featureId":"wbox","lod":1})"),
              150000.0, 0.5);
#else
  GTEST_SKIP() << "mesh binary needs flatbuffers";
#endif
}

TEST(UndoRedo, EmptyStacksFailHonestly) {
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"e0","documentId":"ud3","type":2})")));
  const std::string undo = rpc(
      R"({"protocolVersion":1,"requestId":"e1","documentId":"ud3","type":8})");
  EXPECT_TRUE(has(undo, "\"status\":\"error\""));
  EXPECT_TRUE(has(undo, "NOTHING_TO_UNDO"));
  const std::string redo = rpc(
      R"({"protocolVersion":1,"requestId":"e2","documentId":"ud3","type":9})");
  EXPECT_TRUE(has(redo, "NOTHING_TO_REDO"));
}

TEST(UndoRedo, NewCommandClearsRedo) {
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"c0","documentId":"ud4","type":2})")));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"c1","documentId":"ud4","type":3,"featureId":"cbox","widthMm":100,"heightMm":50,"depthMm":20})")));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"c2","documentId":"ud4","type":8})")));
  // A new command after undo: redo must be gone (standard semantics).
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"c3","documentId":"ud4","type":3,"featureId":"cbox2","widthMm":10,"heightMm":10,"depthMm":10})")));
  const std::string redo = rpc(
      R"({"protocolVersion":1,"requestId":"c4","documentId":"ud4","type":9})");
  EXPECT_TRUE(has(redo, "NOTHING_TO_REDO")) << redo;
}
