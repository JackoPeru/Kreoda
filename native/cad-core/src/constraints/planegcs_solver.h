#pragma once

#include "solver.h"

namespace intentcad {

// PlaneGCS-backed ISketchSolver (FreeCAD Sketcher, LGPL-2.1-or-later).
// The GCS System is rebuilt from scratch per solve (sketches are small):
// no stale state, drag targets are simply fixed-point exclusions.
class PlaneGcsSolver : public ISketchSolver {
 public:
  SolveResult solve(const SketchModel& model,
                    const SolveOptions& opts) override;
  SolverDiagnostics diagnose(const SketchModel& model) override;
};

}  // namespace intentcad
