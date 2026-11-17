#include <gtest/gtest.h>

#include <filesystem>
#include <string>

#include "document/document_store.h"
#include "features/primitives/primitives.h"
#include "features/shell/shell.h"
#include "model/shapes.h"
#include "protocol/dispatcher.h"
#include "protocol/json_fields.h"

namespace {

kreoda::Json ShellRpc(const std::string& documentId, int type, kreoda::Json fields) {
  fields["protocolVersion"] = 1;
  fields["documentId"] = documentId;
  fields["type"] = type;
  const auto bytes = kreoda::handle_command(fields.dump());
  return kreoda::Json::parse(bytes.begin(), bytes.end());
}

}  // namespace

TEST(Shell, BoxOpenTopHollowsWithWallThicknessAndRebuilds) {
  namespace fs = std::filesystem;
  kreoda::DocumentStore::instance().create("shell-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("shell-box", 100, 60, 10, &error)) << error;
  const auto created = ShellRpc("shell-doc", 61,
      {{"requestId", "shell-create"}, {"featureId", "shell-1"},
       {"targetId", "shell-box"}, {"faceIds", kreoda::Json::array({"box.+Z"})},
       {"thicknessMm", 2}});
  ASSERT_EQ(created["status"], "ok") << created;
  kreoda::ShapeRecord shell;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("shell-1", &shell));
  EXPECT_EQ(shell.type, "Shell");
  ASSERT_EQ(shell.paramsMm.size(), 1u);
  EXPECT_DOUBLE_EQ(shell.paramsMm[0], 2.0);
  EXPECT_EQ(shell.dependsOn, (std::vector<std::string>{"shell-box"}));
  EXPECT_EQ(shell.refExtra, "box.+Z");
  EXPECT_LT(shell.volumeMm3, 60000.0);
  EXPECT_NEAR(shell.volumeMm3, 16992.0, 100.0);

  ASSERT_TRUE(kreoda::RebuildShellFromStore("shell-1", &error)) << error;
  kreoda::ShapeRecord rebuilt;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("shell-1", &rebuilt));
  EXPECT_NEAR(rebuilt.volumeMm3, shell.volumeMm3, 1e-6);

  ASSERT_EQ(ShellRpc("shell-doc", 8, {{"requestId", "shell-undo"}})["status"], "ok");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("shell-1"));
  ASSERT_EQ(ShellRpc("shell-doc", 9, {{"requestId", "shell-redo"}})["status"], "ok");
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("shell-1"));

  const auto path = (fs::temp_directory_path() / "kreoda-shell.icad").string();
  ASSERT_EQ(ShellRpc("shell-doc", 10, {{"requestId", "shell-save"}, {"path", path}})["status"], "ok");
  ASSERT_EQ(ShellRpc("shell-doc", 2, {{"requestId", "shell-new"}})["status"], "ok");
  ASSERT_EQ(ShellRpc("shell-doc", 11, {{"requestId", "shell-open"}, {"path", path}})["status"], "ok");
  kreoda::ShapeRecord reopened;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("shell-1", &reopened));
  EXPECT_NEAR(reopened.volumeMm3, shell.volumeMm3, 1e-6);
  fs::remove(path);
}

TEST(Shell, InvalidThicknessAndFaceReferencesAreRejected) {
  kreoda::DocumentStore::instance().create("shell-bad-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("shell-bad-box", 20, 10, 5, &error)) << error;
  const auto zero = ShellRpc("shell-bad-doc", 61,
      {{"requestId", "shell-zero"}, {"featureId", "shell-zero"},
       {"targetId", "shell-bad-box"}, {"faceIds", kreoda::Json::array({"box.+Z"})},
       {"thicknessMm", 0}});
  EXPECT_EQ(zero["status"], "error");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("shell-zero"));

  const auto foreign = ShellRpc("shell-bad-doc", 61,
      {{"requestId", "shell-foreign"}, {"featureId", "shell-foreign"},
       {"targetId", "shell-bad-box"}, {"faceIds", kreoda::Json::array({"other:box.+Z"})},
       {"thicknessMm", 1}});
  EXPECT_EQ(foreign["status"], "error");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("shell-foreign"));

  const auto missing = ShellRpc("shell-bad-doc", 61,
      {{"requestId", "shell-missing"}, {"featureId", "shell-missing"},
       {"targetId", "shell-bad-box"}, {"faceIds", kreoda::Json::array()},
       {"thicknessMm", 1}});
  EXPECT_EQ(missing["status"], "error");
}
