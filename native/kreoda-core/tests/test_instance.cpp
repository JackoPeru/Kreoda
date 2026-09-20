// Rigid instances, Phase 9d: placed live copies follow target edits,
// persist, undo, and refuse nesting/self-targets honestly.

#include <gtest/gtest.h>

#include <cmath>
#include <string>
#include <vector>

#include "../src/document/document_store.h"
#include "../src/features/instance/instance.h"
#include "../src/features/primitives/primitives.h"
#include "../src/model/shapes.h"
#include "../src/persistence/ocaf_live.h"

namespace {

bool makeBox(std::string* err) {
  kreoda::DocumentStore::instance().create("inst-doc");
  return kreoda::CreateBoxFeature("inst-box", 100, 60, 10, err);
}

double volumeOf(const std::string& id) {
  kreoda::ShapeRecord rec;
  if (!kreoda::ShapeStore::instance().get(id, &rec)) return -1.0;
  return rec.volumeMm3;
}

}  // namespace

TEST(Instance, CreateFollowsTarget) {
  std::string err;
  ASSERT_TRUE(makeBox(&err)) << err;
  ASSERT_TRUE(kreoda::CreateInstanceFeature(
                  "inst-1", "inst-box", {50, 0, 0, 0, 0, 90}, &err))
      << err;
  // Same volume, moved + rotated.
  EXPECT_NEAR(volumeOf("inst-1"), 60000.0, 0.5);
  kreoda::ShapeRecord rec;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("inst-1", &rec));
  EXPECT_EQ(rec.type, "Instance");
  ASSERT_EQ(rec.dependsOn.size(), 1u);
  EXPECT_EQ(rec.dependsOn[0], "inst-box");
  EXPECT_NEAR(rec.bboxMm[0], -10.0, 1e-6);  // Rz90 about origin, then +50 X
  EXPECT_NEAR(rec.bboxMm[3], 50.0, 1e-6);
  EXPECT_NEAR(rec.bboxMm[4], 100.0, 1e-6);
}

TEST(Instance, TargetEditReflowsInstance) {
  std::string err;
  ASSERT_TRUE(makeBox(&err)) << err;
  ASSERT_TRUE(
      kreoda::CreateInstanceFeature("inst-2", "inst-box", {0, 0, 0, 0, 0, 0},
                                    &err))
      << err;
  EXPECT_NEAR(volumeOf("inst-2"), 60000.0, 0.5);
  // Widen the source: the instance rebuilds through the DAG.
  ASSERT_TRUE(kreoda::RebuildFeature("inst-box", "widthMm", 200, &err)) << err;
  EXPECT_NEAR(volumeOf("inst-2"), 120000.0, 0.5);
}

TEST(Instance, MoveViaSetDimension) {
  std::string err;
  ASSERT_TRUE(makeBox(&err)) << err;
  ASSERT_TRUE(
      kreoda::CreateInstanceFeature("inst-3", "inst-box", {0, 0, 0, 0, 0, 0},
                                    &err))
      << err;
  ASSERT_TRUE(kreoda::RebuildFeature("inst-3", "txMm", 25, &err)) << err;
  kreoda::ShapeRecord rec;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("inst-3", &rec));
  EXPECT_NEAR(rec.bboxMm[0], 25.0, 1e-6);
  EXPECT_NEAR(rec.bboxMm[3], 125.0, 1e-6);
}

TEST(Instance, RefusesNestingSelfAndGarbage) {
  std::string err;
  ASSERT_TRUE(makeBox(&err)) << err;
  ASSERT_TRUE(
      kreoda::CreateInstanceFeature("inst-4", "inst-box", {0, 0, 0, 0, 0, 0},
                                    &err))
      << err;
  // Nested instances: no.
  EXPECT_FALSE(kreoda::CreateInstanceFeature("inst-5", "inst-4",
                                             {0, 0, 0, 0, 0, 0}, &err));
  // Self target: no.
  EXPECT_FALSE(kreoda::CreateInstanceFeature("inst-4", "inst-4",
                                             {0, 0, 0, 0, 0, 0}, &err));
  // Unknown target: no.
  EXPECT_FALSE(kreoda::CreateInstanceFeature("inst-6", "ghost",
                                             {0, 0, 0, 0, 0, 0}, &err));
  // Bad placement: no.
  EXPECT_FALSE(kreoda::CreateInstanceFeature("inst-7", "inst-box",
                                             {0, 0}, &err));
  // Undo removes the instance in one step; the source survives.
  ASSERT_TRUE(kreoda::OcafLive::instance().Undo(&err)) << err;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("inst-4"));
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("inst-box"));
}
