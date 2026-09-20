#include <gtest/gtest.h>

#include <cmath>

#include "../src/constraints/solver.h"

// §5.1 + §49: real PlaneGCS solves (dimensions, drag, conflicts).
// No invented coordinates — every assertion checks solved geometry.

namespace {

intentcad::SketchModel RectSketch(double x0, double y0, double w, double h) {
  using namespace intentcad;
  SketchModel m;
  m.points = {
      {"p0", x0, y0}, {"p1", x0 + w, y0}, {"p2", x0 + w, y0 + h}, {"p3", x0, y0 + h},
  };
  m.lines = {
      {"l0", "p0", "p1"}, {"l1", "p1", "p2"}, {"l2", "p2", "p3"}, {"l3", "p3", "p0"},
  };
  // Corners shared by construction (same point ids) + H/V + dimensions.
  m.constraints = {
      {"h0", SketchConstraintKind::Horizontal, {"l0"}, 0},
      {"h2", SketchConstraintKind::Horizontal, {"l2"}, 0},
      {"v1", SketchConstraintKind::Vertical, {"l1"}, 0},
      {"v3", SketchConstraintKind::Vertical, {"l3"}, 0},
      {"w", SketchConstraintKind::Distance, {"p0", "p1"}, w},
      {"h", SketchConstraintKind::Distance, {"p1", "p2"}, h},
  };
  return m;
}

}  // namespace

TEST(Solver, RectangleSolvesToExactDimensions) {
  auto solver = intentcad::CreateSketchSolver();
  ASSERT_NE(solver, nullptr);
  intentcad::SolveOptions opts;
  const auto r = solver->solve(RectSketch(0, 0, 100, 50), opts);
  ASSERT_TRUE(r.ok) << r.error;
  EXPECT_NEAR(r.points.at("p1").first, 100.0, 1e-3);
  EXPECT_NEAR(r.points.at("p2").second, 50.0, 1e-3);
  EXPECT_NEAR(r.points.at("p0").first, 0.0, 1e-3);
  EXPECT_NEAR(r.points.at("p0").second, 0.0, 1e-3);
}

TEST(Solver, CircleRadiusDimension) {
  using namespace intentcad;
  auto solver = CreateSketchSolver();
  SketchModel m;
  m.points = {{"c", 5, 5}};
  m.circles = {{"k", "c", 7.0}};
  m.constraints = {
      {"r", SketchConstraintKind::Radius, {"k"}, 25.0},
  };
  SolveOptions opts;
  const auto r = solver->solve(m, opts);
  ASSERT_TRUE(r.ok) << r.error;
  EXPECT_NEAR(r.radii.at("k"), 25.0, 1e-3);
}

TEST(Solver, DragTargetMovesSketchRigidly) {
  using namespace intentcad;
  auto solver = CreateSketchSolver();
  SolveOptions opts;
  opts.hasDragTarget = true;
  opts.dragPointId = "p0";
  opts.dragX = 10.0;
  opts.dragY = 20.0;
  const auto r = solver->solve(RectSketch(0, 0, 100, 50), opts);
  ASSERT_TRUE(r.ok) << r.error;
  // Dragged corner pinned at the target; opposite corner keeps dimensions.
  EXPECT_NEAR(r.points.at("p0").first, 10.0, 1e-3);
  EXPECT_NEAR(r.points.at("p0").second, 20.0, 1e-3);
  EXPECT_NEAR(r.points.at("p2").first, 110.0, 1e-2);
  EXPECT_NEAR(r.points.at("p2").second, 70.0, 1e-2);
}

TEST(Solver, ConflictingDimensionsDiagnosed) {
  using namespace intentcad;
  auto solver = CreateSketchSolver();
  SketchModel m = RectSketch(0, 0, 100, 50);
  m.constraints.push_back(
      {"w-conflict", SketchConstraintKind::Distance, {"p0", "p1"}, 120.0});
  SolveOptions opts;
  const auto r = solver->solve(m, opts);
  EXPECT_FALSE(r.ok);
  EXPECT_FALSE(r.conflicting.empty());
  const auto d = solver->diagnose(m);
  EXPECT_TRUE(d.overConstrained);
  EXPECT_FALSE(d.conflicting.empty());
}

TEST(Solver, UnderConstrainedReportsDofs) {
  using namespace intentcad;
  auto solver = CreateSketchSolver();
  SketchModel m;
  m.points = {{"a", 0, 0}, {"b", 10, 0}};
  m.lines = {{"l", "a", "b"}};
  const auto d = solver->diagnose(m);
  EXPECT_GT(d.dofs, 0);
  EXPECT_TRUE(d.underConstrained);
  EXPECT_FALSE(d.overConstrained);
}
