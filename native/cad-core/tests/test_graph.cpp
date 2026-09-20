#include <gtest/gtest.h>

#include <algorithm>
#include <string>
#include <vector>

#include "../src/model/feature_graph.h"

// §53–§54: DAG ordering, dirty propagation, failure isolation.
// These test graph mechanics with recording callbacks (no geometry);
// geometry recompute is covered by dispatcher/E2E paths.

namespace {

std::vector<std::string> OrderOf(intentcad::FeatureGraph& g) {
  std::vector<std::string> order;
  std::string err;
  EXPECT_TRUE(g.dirtyOrder(&order, &err)) << err;
  return order;
}

}  // namespace

TEST(Graph, TopologicalOrderFollowsDependencies) {
  intentcad::FeatureGraph g;
  g.addFeature("C", {"B"});
  g.addFeature("A");
  g.addFeature("B", {"A"});
  EXPECT_EQ(OrderOf(g), (std::vector<std::string>{"A", "B", "C"}));
}

TEST(Graph, DirtyPropagatesToDependentsOnly) {
  intentcad::FeatureGraph g;
  g.addFeature("A");
  g.addFeature("B", {"A"});
  g.addFeature("C", {"B"});
  g.addFeature("loner");
  for (const auto& id : {"A", "B", "C", "loner"}) g.clearDirty(id);
  g.markDirty("B");
  EXPECT_FALSE(g.isGeometryDirty("A"));
  EXPECT_TRUE(g.isGeometryDirty("B"));
  EXPECT_TRUE(g.isGeometryDirty("C"));
  EXPECT_FALSE(g.isGeometryDirty("loner"));
}

TEST(Graph, RecomputeSkipsFailedBranchButRunsSiblings) {
  intentcad::FeatureGraph g;
  g.addFeature("good");
  g.addFeature("bad");
  g.addFeature("childOfBad", {"bad"});
  std::vector<std::string> ran;
  auto report = g.recompute(
      [&](const std::string& id, std::string* err) {
        ran.push_back(id);
        if (id == "bad") {
          *err = "boom";
          return false;
        }
        return true;
      });
  EXPECT_FALSE(report.ok);
  EXPECT_EQ(report.firstError, "bad: boom");
  EXPECT_EQ(report.skippedUpstreamFailure, std::vector<std::string>{"childOfBad"});
  EXPECT_NE(std::find(ran.begin(), ran.end(), "good"), ran.end());
  EXPECT_EQ(std::find(ran.begin(), ran.end(), "childOfBad"), ran.end());
  // Failed nodes stay dirty for the next attempt; good ones cleared.
  EXPECT_TRUE(g.isGeometryDirty("bad"));
  EXPECT_FALSE(g.isGeometryDirty("good"));
}

TEST(Graph, CycleIsRejectedBeforeKernel) {
  intentcad::FeatureGraph g;
  g.addFeature("A", {"B"});
  g.addFeature("B", {"A"});
  std::vector<std::string> order;
  std::string err;
  EXPECT_FALSE(g.dirtyOrder(&order, &err));
  EXPECT_FALSE(err.empty());
  auto report = g.recompute(
      [](const std::string&, std::string*) { return true; });
  EXPECT_FALSE(report.ok);
}

TEST(Graph, TessellationOnlyDirtySkipsGeometryRecompute) {
  intentcad::FeatureGraph g;
  g.addFeature("A");
  g.clearDirty("A");
  g.markTessellationDirty("A");
  int calls = 0;
  auto report = g.recompute(
      [&](const std::string&, std::string*) { return ++calls, true; });
  EXPECT_TRUE(report.ok);
  EXPECT_EQ(calls, 0);  // appearance-only: no B-Rep work (§54)
  EXPECT_TRUE(report.recomputed.empty());
}

TEST(Graph, RemoveDropsEdges) {
  intentcad::FeatureGraph g;
  g.addFeature("A");
  g.addFeature("B", {"A"});
  g.removeFeature("A");
  EXPECT_FALSE(g.hasFeature("A"));
  for (const auto& id : {"B"}) g.clearDirty(id);
  g.markDirty("B");
  EXPECT_EQ(OrderOf(g), (std::vector<std::string>{"B"}));
}
