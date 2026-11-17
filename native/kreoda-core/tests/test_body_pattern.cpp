#include <gtest/gtest.h>

#include <filesystem>
#include <string>

#include "document/document_store.h"
#include "features/pattern/body_pattern.h"
#include "features/primitives/primitives.h"
#include "model/shapes.h"
#include "protocol/dispatcher.h"
#include "protocol/json_fields.h"

namespace {

kreoda::Json PatternRpc(const std::string& documentId, int type,
                        kreoda::Json fields) {
  fields["protocolVersion"] = 1;
  fields["documentId"] = documentId;
  fields["type"] = type;
  const auto bytes = kreoda::handle_command(fields.dump());
  return kreoda::Json::parse(bytes.begin(), bytes.end());
}

}  // namespace

TEST(BodyPattern, LinearPatternCreatesThreeCopiesAndFollowsSourceEdit) {
  namespace fs = std::filesystem;
  kreoda::DocumentStore::instance().create("body-pattern-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("pattern-box", 10, 10, 10, &error))
      << error;

  const auto created = PatternRpc("body-pattern-doc", 63,
      {{"requestId", "pattern-create"}, {"featureId", "pattern-1"},
       {"targetId", "pattern-box"}, {"axis", "X"}, {"count", 3},
       {"spacingMm", 20}});
  ASSERT_EQ(created["status"], "ok") << created;
  kreoda::ShapeRecord pattern;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("pattern-1", &pattern));
  EXPECT_EQ(pattern.type, "BodyPattern");
  EXPECT_EQ(pattern.dependsOn, (std::vector<std::string>{"pattern-box"}));
  EXPECT_EQ(pattern.refExtra, "X");
  EXPECT_EQ(pattern.paramsMm, (std::vector<double>{3, 20}));
  EXPECT_NEAR(pattern.volumeMm3, 3000.0, 1e-6);
  EXPECT_NEAR(pattern.bboxMm[0], 0.0, 1e-6);
  EXPECT_NEAR(pattern.bboxMm[3], 50.0, 1e-6);
  EXPECT_NEAR(pattern.bboxMm[4], 10.0, 1e-6);

  ASSERT_EQ(PatternRpc("body-pattern-doc", 6,
      {{"requestId", "pattern-width"}, {"featureId", "pattern-box"},
       {"paramName", "widthMm"}, {"valueMm", 20}})["status"], "ok");
  kreoda::ShapeRecord widened;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("pattern-1", &widened));
  EXPECT_NEAR(widened.volumeMm3, 6000.0, 1e-6);
  EXPECT_NEAR(widened.bboxMm[0], 0.0, 1e-6);
  EXPECT_NEAR(widened.bboxMm[3], 60.0, 1e-6);

  ASSERT_EQ(PatternRpc("body-pattern-doc", 8,
      {{"requestId", "pattern-undo-width"}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("pattern-1", &pattern));
  EXPECT_NEAR(pattern.volumeMm3, 3000.0, 1e-6);
  ASSERT_EQ(PatternRpc("body-pattern-doc", 9,
      {{"requestId", "pattern-redo-width"}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("pattern-1", &widened));
  EXPECT_NEAR(widened.volumeMm3, 6000.0, 1e-6);

  ASSERT_EQ(PatternRpc("body-pattern-doc", 8,
      {{"requestId", "pattern-undo-width-again"}})["status"], "ok");
  ASSERT_EQ(PatternRpc("body-pattern-doc", 8,
      {{"requestId", "pattern-undo-create"}})["status"], "ok");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("pattern-1"));
  ASSERT_EQ(PatternRpc("body-pattern-doc", 9,
      {{"requestId", "pattern-redo-create"}})["status"], "ok");
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("pattern-1"));
  ASSERT_EQ(PatternRpc("body-pattern-doc", 9,
      {{"requestId", "pattern-redo-width-again"}})["status"], "ok");

  ASSERT_EQ(PatternRpc("body-pattern-doc", 6,
      {{"requestId", "pattern-edit-count"}, {"featureId", "pattern-1"},
       {"paramName", "count"}, {"valueMm", 4}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("pattern-1", &widened));
  EXPECT_EQ(widened.paramsMm, (std::vector<double>{4, 20}));
  EXPECT_NEAR(widened.volumeMm3, 8000.0, 1e-6);
  EXPECT_NEAR(widened.bboxMm[3], 80.0, 1e-6);

  ASSERT_EQ(PatternRpc("body-pattern-doc", 6,
      {{"requestId", "pattern-edit-spacing"}, {"featureId", "pattern-1"},
       {"paramName", "spacingMm"}, {"valueMm", 30}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("pattern-1", &widened));
  EXPECT_EQ(widened.paramsMm, (std::vector<double>{4, 30}));
  EXPECT_NEAR(widened.volumeMm3, 8000.0, 1e-6);
  EXPECT_NEAR(widened.bboxMm[3], 110.0, 1e-6);

  const auto path =
      (fs::temp_directory_path() / "kreoda-body-pattern.icad").string();
  ASSERT_EQ(PatternRpc("body-pattern-doc", 10,
      {{"requestId", "pattern-save"}, {"path", path}})["status"], "ok");
  ASSERT_EQ(PatternRpc("body-pattern-doc", 2,
      {{"requestId", "pattern-new"}})["status"], "ok");
  ASSERT_EQ(PatternRpc("body-pattern-doc", 11,
      {{"requestId", "pattern-open"}, {"path", path}})["status"], "ok");
  kreoda::ShapeRecord reopened;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("pattern-1", &reopened));
  EXPECT_EQ(reopened.type, "BodyPattern");
  EXPECT_EQ(reopened.refExtra, "X");
  EXPECT_EQ(reopened.paramsMm, (std::vector<double>{4, 30}));
  EXPECT_NEAR(reopened.volumeMm3, 8000.0, 1e-6);
  EXPECT_NEAR(reopened.bboxMm[3], 110.0, 1e-6);
  fs::remove(path);
}

TEST(BodyPattern, InvalidAxisCountSpacingSelfAndMissingTargetAreRejected) {
  kreoda::DocumentStore::instance().create("body-pattern-bad-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("pattern-bad-box", 10, 10, 10, &error))
      << error;

  for (const auto& [id, fields] : std::vector<std::pair<std::string, kreoda::Json>>{
           {"pattern-bad-axis", {{"axis", "W"}, {"count", 3}, {"spacingMm", 20}}},
           {"pattern-bad-count", {{"axis", "X"}, {"count", 1}, {"spacingMm", 20}}},
           {"pattern-bad-count-max", {{"axis", "X"}, {"count", 65}, {"spacingMm", 20}}},
           {"pattern-bad-spacing", {{"axis", "X"}, {"count", 3}, {"spacingMm", 0}}},
           {"pattern-bad-spacing-max", {{"axis", "X"}, {"count", 3}, {"spacingMm", 100001}}},
       }) {
    auto request = fields;
    request["requestId"] = id;
    request["featureId"] = id;
    request["targetId"] = "pattern-bad-box";
    const auto response = PatternRpc("body-pattern-bad-doc", 63, request);
    EXPECT_EQ(response["status"], "error") << id << ": " << response;
    EXPECT_FALSE(kreoda::ShapeStore::instance().contains(id));
  }

  const auto self = PatternRpc("body-pattern-bad-doc", 63,
      {{"requestId", "pattern-self"}, {"featureId", "pattern-bad-box"},
       {"targetId", "pattern-bad-box"}, {"axis", "X"}, {"count", 3},
       {"spacingMm", 20}});
  EXPECT_EQ(self["status"], "error");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("pattern-self"));

  const auto missing = PatternRpc("body-pattern-bad-doc", 63,
      {{"requestId", "pattern-missing"}, {"featureId", "pattern-missing"},
       {"targetId", "missing-target"}, {"axis", "X"}, {"count", 3},
       {"spacingMm", 20}});
  EXPECT_EQ(missing["status"], "error");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("pattern-missing"));
}
