#include <gtest/gtest.h>

#include <filesystem>
#include <string>

#include "document/document_store.h"
#include "features/instance/instance.h"
#include "features/mirror/mirror.h"
#include "features/primitives/primitives.h"
#include "model/shapes.h"
#include "protocol/dispatcher.h"
#include "protocol/json_fields.h"

namespace {

kreoda::Json MirrorRpc(const std::string& documentId, int type, kreoda::Json fields) {
  fields["protocolVersion"] = 1;
  fields["documentId"] = documentId;
  fields["type"] = type;
  const auto bytes = kreoda::handle_command(fields.dump());
  return kreoda::Json::parse(bytes.begin(), bytes.end());
}

}  // namespace

TEST(Mirror, InstanceMirrorsAcrossPrincipalPlaneAndRebuilds) {
  namespace fs = std::filesystem;
  kreoda::DocumentStore::instance().create("mirror-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("mirror-box", 20, 10, 5, &error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("mirror-inst", "mirror-box",
                                            {30, 0, 0, 0, 0, 0}, &error)) << error;

  const auto created = MirrorRpc("mirror-doc", 62,
      {{"requestId", "mirror-create"}, {"featureId", "mirror-1"},
       {"targetId", "mirror-inst"}, {"planeKind", "YZ"}});
  ASSERT_EQ(created["status"], "ok") << created;
  kreoda::ShapeRecord mirror;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("mirror-1", &mirror));
  EXPECT_EQ(mirror.type, "Mirror");
  EXPECT_EQ(mirror.dependsOn, (std::vector<std::string>{"mirror-inst"}));
  EXPECT_EQ(mirror.refExtra, "YZ");
  EXPECT_NEAR(mirror.volumeMm3, 1000.0, 1e-6);
  EXPECT_NEAR(mirror.bboxMm[0], -50.0, 1e-6);
  EXPECT_NEAR(mirror.bboxMm[3], -30.0, 1e-6);

  ASSERT_TRUE(kreoda::RebuildMirrorFromStore("mirror-1", &error)) << error;
  kreoda::ShapeRecord rebuilt;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("mirror-1", &rebuilt));
  EXPECT_NEAR(rebuilt.volumeMm3, mirror.volumeMm3, 1e-6);
  EXPECT_NEAR(rebuilt.bboxMm[0], -50.0, 1e-6);

  ASSERT_EQ(MirrorRpc("mirror-doc", 8, {{"requestId", "mirror-undo"}})["status"], "ok");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("mirror-1"));
  ASSERT_EQ(MirrorRpc("mirror-doc", 9, {{"requestId", "mirror-redo"}})["status"], "ok");
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("mirror-1"));

  const auto path = (fs::temp_directory_path() / "kreoda-mirror.icad").string();
  ASSERT_EQ(MirrorRpc("mirror-doc", 10, {{"requestId", "mirror-save"}, {"path", path}})["status"], "ok");
  ASSERT_EQ(MirrorRpc("mirror-doc", 2, {{"requestId", "mirror-new"}})["status"], "ok");
  ASSERT_EQ(MirrorRpc("mirror-doc", 11, {{"requestId", "mirror-open"}, {"path", path}})["status"], "ok");
  kreoda::ShapeRecord reopened;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("mirror-1", &reopened));
  EXPECT_NEAR(reopened.volumeMm3, mirror.volumeMm3, 1e-6);
  EXPECT_EQ(reopened.refExtra, "YZ");
  fs::remove(path);
}

TEST(Mirror, InvalidPlaneSelfTargetAndMissingTargetAreRejected) {
  kreoda::DocumentStore::instance().create("mirror-bad-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("mirror-bad-box", 20, 10, 5, &error)) << error;
  const auto badPlane = MirrorRpc("mirror-bad-doc", 62,
      {{"requestId", "mirror-plane"}, {"featureId", "mirror-plane"},
       {"targetId", "mirror-bad-box"}, {"planeKind", "AB"}});
  EXPECT_EQ(badPlane["status"], "error");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("mirror-plane"));

  const auto self = MirrorRpc("mirror-bad-doc", 62,
      {{"requestId", "mirror-self"}, {"featureId", "mirror-bad-box"},
       {"targetId", "mirror-bad-box"}, {"planeKind", "XY"}});
  EXPECT_EQ(self["status"], "error");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("mirror-self"));

  const auto missing = MirrorRpc("mirror-bad-doc", 62,
      {{"requestId", "mirror-missing"}, {"featureId", "mirror-missing"},
       {"targetId", "missing-target"}, {"planeKind", "XY"}});
  EXPECT_EQ(missing["status"], "error");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("mirror-missing"));
}
