#include <gtest/gtest.h>

#include <filesystem>

#include "../src/protocol/dispatcher.h"

#include "rpc_text.h"

namespace fs = std::filesystem;

// §49: save → reopen returns the same solid (volume + feature identity).

namespace {

// Numeric extraction: kernel volumes print at full precision (e.g.
// 99999.99999999997 for a 100x50x20 box), so substring matching is wrong —
// compare with tolerance instead.
double ExtractVolume(const std::string& response) {
  const std::string key = "\"volumeMm3\":";
  const size_t pos = response.find(key);
  if (pos == std::string::npos) return -1.0;
  try {
    return std::stod(response.substr(pos + key.size()));
  } catch (...) {
    return -1.0;
  }
}

}  // namespace

TEST(Persistence, SaveReopenRoundTrip) {
#if INTENTCAD_WITH_OCCT && INTENTCAD_WITH_MINIZIP
  ASSERT_NE(intentcad_test::rpcText(
                R"({"protocolVersion":1,"requestId":"p1","documentId":"dp","type":2})")
                .find("\"status\":\"ok\""),
            std::string::npos);
  const std::string mk =
      R"({"protocolVersion":1,"requestId":"p2","documentId":"dp","type":3,"featureId":"persist-box","widthMm":100,"heightMm":50,"depthMm":20})";
  const std::string created = intentcad_test::rpcText(mk);
  ASSERT_NE(created.find("\"status\":\"ok\""), std::string::npos);
  EXPECT_NEAR(ExtractVolume(created), 100000.0, 1.0);

  const fs::path icad =
      fs::temp_directory_path() / "intentcad-roundtrip.icad";
  const std::string save =
      std::string(
          R"({"protocolVersion":1,"requestId":"p3","documentId":"dp","type":10,"path":")") +
      icad.string() + "\"}";
  const std::string saved = intentcad_test::rpcText(save);
  ASSERT_NE(saved.find("\"status\":\"ok\""), std::string::npos)
      << saved;
  ASSERT_TRUE(fs::exists(icad));

  // Fresh document, then reopen: identical solid must come back.
  intentcad_test::rpcText(
      R"({"protocolVersion":1,"requestId":"p4","documentId":"dp2","type":2})");
  const std::string open =
      std::string(
          R"({"protocolVersion":1,"requestId":"p5","documentId":"dp2","type":11,"path":")") +
      icad.string() + "\"}";
  const std::string opened = intentcad_test::rpcText(open);
  ASSERT_NE(opened.find("\"status\":\"ok\""), std::string::npos) << opened;
  EXPECT_NE(opened.find("persist-box"), std::string::npos);
  EXPECT_NEAR(ExtractVolume(opened), 100000.0, 1.0) << opened;

  // Mesh after reopen: same 12 triangles, persistent face still mapped (§8).
  const std::vector<uint8_t> meshed = intentcad_test::rpcBytes(
      R"({"protocolVersion":1,"requestId":"p6","documentId":"dp2","type":12,"featureId":"persist-box","lod":1})");
#ifdef INTENTCAD_WITH_FLATBUFFERS
  const auto* update = intentcad_test::meshRoot(meshed);
  ASSERT_NE(update, nullptr);
  EXPECT_EQ(update->indices_count() / 3, 12u);
  ASSERT_NE(update->faces(), nullptr);
  // Persistent top-face role survives the round-trip (any position — face
  // order is tessellator-defined, never an index contract).
  bool topFound = false;
  for (flatbuffers::uoffset_t i = 0; i < update->faces()->size(); ++i) {
    const auto* f = update->faces()->Get(i);
    if (f && f->persistent_face_id() &&
        f->persistent_face_id()->str() == "persist-box:box.+Z") {
      topFound = true;
    }
  }
  EXPECT_TRUE(topFound);
#else
  GTEST_SKIP() << "mesh binary needs flatbuffers";
#endif

  std::error_code ec;
  fs::remove(icad, ec);
#else
  GTEST_SKIP() << "needs OCCT + minizip-ng (vcpkg build)";
#endif
}

TEST(Persistence, OpenMissingFileFailsHonestly) {
  const std::string open =
      R"({"protocolVersion":1,"requestId":"p7","documentId":"dp","type":11,"path":"Z:/definitely/not/here.icad"})";
  EXPECT_NE(intentcad_test::rpcText(open).find("\"status\":\"error\""),
            std::string::npos);
}
