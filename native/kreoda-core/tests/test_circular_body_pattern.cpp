#include <gtest/gtest.h>

#include <filesystem>
#include <string>

#include "document/document_store.h"
#include "features/instance/instance.h"
#include "features/pattern/circular_body_pattern.h"
#include "features/primitives/primitives.h"
#include "model/shapes.h"
#include "protocol/dispatcher.h"
#include "protocol/json_fields.h"

namespace {

kreoda::Json CircularRpc(const std::string& documentId, int type,
                         kreoda::Json fields) {
  fields["protocolVersion"] = 1;
  fields["documentId"] = documentId;
  fields["type"] = type;
  const auto bytes = kreoda::handle_command(fields.dump());
  return kreoda::Json::parse(bytes.begin(), bytes.end());
}

}  // namespace

TEST(CircularBodyPattern, FourCopiesAroundZFollowSourceAndPersist) {
  namespace fs = std::filesystem;
  kreoda::DocumentStore::instance().create("circular-pattern-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("circular-box", 20, 10, 5, &error))
      << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("circular-inst", "circular-box",
                                            {30, 0, 0, 0, 0, 0}, &error))
      << error;

  const auto created = CircularRpc("circular-pattern-doc", 64,
      {{"requestId", "circular-create"}, {"featureId", "circular-1"},
       {"targetId", "circular-inst"}, {"axis", "Z"}, {"count", 4},
       {"angleDeg", 360}});
  ASSERT_EQ(created["status"], "ok") << created;
  kreoda::ShapeRecord pattern;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("circular-1", &pattern));
  EXPECT_EQ(pattern.type, "CircularBodyPattern");
  EXPECT_EQ(pattern.dependsOn, (std::vector<std::string>{"circular-inst"}));
  EXPECT_EQ(pattern.refExtra, "Z");
  EXPECT_EQ(pattern.paramsMm, (std::vector<double>{4, 360}));
  EXPECT_NEAR(pattern.volumeMm3, 4000.0, 1e-6);
  EXPECT_NEAR(pattern.bboxMm[0], -50.0, 1e-6);
  EXPECT_NEAR(pattern.bboxMm[1], -50.0, 1e-6);
  EXPECT_NEAR(pattern.bboxMm[2], 0.0, 1e-6);
  EXPECT_NEAR(pattern.bboxMm[3], 50.0, 1e-6);
  EXPECT_NEAR(pattern.bboxMm[4], 50.0, 1e-6);
  EXPECT_NEAR(pattern.bboxMm[5], 5.0, 1e-6);

  ASSERT_EQ(CircularRpc("circular-pattern-doc", 6,
      {{"requestId", "circular-width"}, {"featureId", "circular-box"},
       {"paramName", "widthMm"}, {"valueMm", 10}})["status"], "ok");
  kreoda::ShapeRecord narrowed;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("circular-1", &narrowed));
  EXPECT_NEAR(narrowed.volumeMm3, 2000.0, 1e-6);
  EXPECT_NEAR(narrowed.bboxMm[0], -40.0, 1e-6);
  EXPECT_NEAR(narrowed.bboxMm[1], -40.0, 1e-6);
  EXPECT_NEAR(narrowed.bboxMm[3], 40.0, 1e-6);
  EXPECT_NEAR(narrowed.bboxMm[4], 40.0, 1e-6);

  ASSERT_EQ(CircularRpc("circular-pattern-doc", 8,
      {{"requestId", "circular-undo-width"}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("circular-1", &pattern));
  EXPECT_NEAR(pattern.volumeMm3, 4000.0, 1e-6);
  ASSERT_EQ(CircularRpc("circular-pattern-doc", 9,
      {{"requestId", "circular-redo-width"}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("circular-1", &narrowed));
  EXPECT_NEAR(narrowed.volumeMm3, 2000.0, 1e-6);

  ASSERT_EQ(CircularRpc("circular-pattern-doc", 6,
      {{"requestId", "circular-edit-count"}, {"featureId", "circular-1"},
       {"paramName", "count"}, {"valueMm", 5}})["status"], "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("circular-1", &narrowed));
  EXPECT_EQ(narrowed.paramsMm, (std::vector<double>{5, 360}));
  EXPECT_NEAR(narrowed.volumeMm3, 2500.0, 1e-6);

  const auto path =
      (fs::temp_directory_path() / "kreoda-circular-body-pattern.icad").string();
  ASSERT_EQ(CircularRpc("circular-pattern-doc", 10,
      {{"requestId", "circular-save"}, {"path", path}})["status"], "ok");
  ASSERT_EQ(CircularRpc("circular-pattern-doc", 2,
      {{"requestId", "circular-new"}})["status"], "ok");
  ASSERT_EQ(CircularRpc("circular-pattern-doc", 11,
      {{"requestId", "circular-open"}, {"path", path}})["status"], "ok");
  kreoda::ShapeRecord reopened;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("circular-1", &reopened));
  EXPECT_EQ(reopened.type, "CircularBodyPattern");
  EXPECT_EQ(reopened.refExtra, "Z");
  EXPECT_EQ(reopened.paramsMm, (std::vector<double>{5, 360}));
  EXPECT_NEAR(reopened.volumeMm3, 2500.0, 1e-6);
  fs::remove(path);
}

TEST(CircularBodyPattern, InvalidAxisCountAngleSelfAndMissingTargetAreRejected) {
  kreoda::DocumentStore::instance().create("circular-pattern-bad-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("circular-bad-box", 10, 10, 10, &error))
      << error;

  for (const auto& [id, fields] : std::vector<std::pair<std::string, kreoda::Json>>{
           {"circular-bad-axis", {{"axis", "W"}, {"count", 4}, {"angleDeg", 360}}},
           {"circular-bad-count", {{"axis", "Z"}, {"count", 1}, {"angleDeg", 360}}},
           {"circular-bad-count-max", {{"axis", "Z"}, {"count", 65}, {"angleDeg", 360}}},
           {"circular-bad-angle-zero", {{"axis", "Z"}, {"count", 4}, {"angleDeg", 0}}},
           {"circular-bad-angle-max", {{"axis", "Z"}, {"count", 4}, {"angleDeg", 361}}},
       }) {
    auto request = fields;
    request["requestId"] = id;
    request["featureId"] = id;
    request["targetId"] = "circular-bad-box";
    const auto response = CircularRpc("circular-pattern-bad-doc", 64, request);
    EXPECT_EQ(response["status"], "error") << id << ": " << response;
    EXPECT_FALSE(kreoda::ShapeStore::instance().contains(id));
  }

  const auto self = CircularRpc("circular-pattern-bad-doc", 64,
      {{"requestId", "circular-self"}, {"featureId", "circular-bad-box"},
       {"targetId", "circular-bad-box"}, {"axis", "Z"}, {"count", 4},
       {"angleDeg", 360}});
  EXPECT_EQ(self["status"], "error");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("circular-self"));

  const auto missing = CircularRpc("circular-pattern-bad-doc", 64,
      {{"requestId", "circular-missing"}, {"featureId", "circular-missing"},
       {"targetId", "missing-target"}, {"axis", "Z"}, {"count", 4},
       {"angleDeg", 360}});
  EXPECT_EQ(missing["status"], "error");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("circular-missing"));
}
