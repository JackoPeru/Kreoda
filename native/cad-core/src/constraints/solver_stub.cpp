#include "solver.h"

namespace intentcad {

namespace {

// Fallback when PlaneGCS is not linked (no Eigen/Boost): honest errors,
// never invented coordinates (§41).
class UnavailableSolver : public ISketchSolver {
 public:
  SolveResult solve(const SketchModel&, const SolveOptions&) override {
    SolveResult r;
    r.error = "sketch solver unavailable (build with Eigen+Boost)";
    return r;
  }
  SolverDiagnostics diagnose(const SketchModel&) override {
    return {};
  }
};

}  // namespace

std::unique_ptr<ISketchSolver> CreateSketchSolver() {
  return std::make_unique<UnavailableSolver>();
}

}  // namespace intentcad
