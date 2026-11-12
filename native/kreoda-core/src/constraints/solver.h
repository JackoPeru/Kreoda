#pragma once

#include <cmath>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace kreoda {

// Sketch model for constraint solving (§21, §5). Local 2D coordinates (mm);
// the sketch plane maps them to 3D. Stable string ids throughout.
struct SketchPoint {
  std::string id;
  double x = 0.0;
  double y = 0.0;
  bool fixed = false;  // excluded from unknowns (anchors + drag targets)
};

struct SketchLine {
  std::string id;
  std::string p1;
  std::string p2;
};

struct SketchCircle {
  std::string id;
  std::string center;
  double r = 1.0;
};

struct SketchArc {
  std::string id;
  std::string center;
  double r = 1.0;
  double startAngleRad = 0.0;  // constants in Phase 4 (documented)
  double endAngleRad = 1.0;
};

struct SketchEllipse {
  std::string id;
  std::string center;
  double majorRadius = 1.0;
  double minorRadius = 0.5;
  double rotationRad = 0.0;
  bool arc = false;
  double startAngleRad = 0.0;
  double endAngleRad = 6.283185307179586;
};

struct SketchSpline {
  std::string id;
  std::vector<std::string> pointIds;
  bool controlPoints = true; // true: poles, false: interpolated through points
  bool closed = false;
};

enum class SketchConstraintKind {
  Coincident,
  Horizontal,
  Vertical,
  Parallel,
  Perpendicular,
  EqualRadius,
  Concentric,
  Distance,
  Radius,
  Diameter,
  Angle,
  PointOnLine,
  Fixed,
  EllipseMajorRadius,
  EllipseMinorRadius,
  Symmetric,
};

struct SketchConstraint {
  std::string id;
  SketchConstraintKind kind;
  // Entity/point ids, kind-dependent:
  //  Coincident/Distance: [pointA, pointB]; Horizontal/Vertical: [line];
  //  Parallel/Perpendicular/Angle: [lineA, lineB];
  //  EqualRadius/Concentric: [circleA, circleB];
  //  Radius/Diameter: [circle]; PointOnLine: [point, line]; Fixed: [point].
  //  Symmetric: [pointA, pointB, mirrorAxisLine].
  std::vector<std::string> refs;
  double value = 0.0;  // Distance/Radius/Diameter/Angle(rad); else unused
};

struct SketchModel {
  std::vector<SketchPoint> points;
  std::vector<SketchLine> lines;
  std::vector<SketchCircle> circles;
  std::vector<SketchArc> arcs;
  std::vector<SketchEllipse> ellipses;
  std::vector<SketchSpline> splines;
  std::vector<std::string> constructionIds; // entities ignored by profile, still solver-visible
  std::vector<SketchConstraint> constraints;
};

struct SolveOptions {
  // Temporary drag target (§21.5): excluded from unknowns at (x, y).
  bool hasDragTarget = false;
  std::string dragPointId;
  double dragX = 0.0;
  double dragY = 0.0;
  double residualTolerance = 1e-3;
};

struct SolveResult {
  bool ok = false;
  double residual = 0.0;
  int dofs = -1;
  std::map<std::string, std::pair<double, double>> points;  // id → (x, y)
  std::map<std::string, double> radii;                      // circle/arc id → r
  std::map<std::string, std::pair<double, double>> ellipseAxes;  // id → (major, minor)
  std::vector<std::string> conflicting;  // constraint ids
  std::vector<std::string> redundant;    // constraint ids
  std::string error;
};

// Apply and validate solved ellipse axes before committing or returning a preview.
inline bool ApplySolvedEllipseAxes(const SolveResult& result, SketchModel* model,
                                   std::string* error) {
  if (!model) {
    if (error) *error="ellipse solve target is missing";
    return false;
  }
  for (const auto& ellipse : model->ellipses) {
    const auto it=result.ellipseAxes.find(ellipse.id);
    if (it==result.ellipseAxes.end()) {
      if (error) *error="solver omitted solved ellipse axes";
      return false;
    }
    const double major=it->second.first;
    const double minor=it->second.second;
    if (!std::isfinite(major) || !std::isfinite(minor) ||
        !(major>minor && minor>1e-9)) {
      if (error) *error="solved ellipse axes must satisfy majorRadius > minorRadius > 1e-9";
      return false;
    }
  }
  for (auto& ellipse : model->ellipses) {
    const auto& axes=result.ellipseAxes.at(ellipse.id);
    ellipse.majorRadius=axes.first;
    ellipse.minorRadius=axes.second;
  }
  return true;
}

struct SolverDiagnostics {
  int dofs = -1;
  bool underConstrained = false;
  bool overConstrained = false;
  std::vector<std::string> conflicting;
  std::vector<std::string> redundant;
};

// Project-owned solver interface (§5.1): PlaneGCS behind this wall, so the
// backend can be replaced (e.g. D-Cubed 2D DCM) without touching the app.
class ISketchSolver {
 public:
  virtual SolveResult solve(const SketchModel& model,
                            const SolveOptions& opts) = 0;
  virtual SolverDiagnostics diagnose(const SketchModel& model) = 0;
  virtual ~ISketchSolver() = default;
};

// Factory: PlaneGCS backend when built (Eigen+Boost), else a solver that
// reports "unavailable" instead of faking results (§41).
std::unique_ptr<ISketchSolver> CreateSketchSolver();

}  // namespace kreoda
