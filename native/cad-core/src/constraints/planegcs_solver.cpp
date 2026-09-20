#include "planegcs_solver.h"

#include <cmath>
#include <deque>
#include <set>

#include "planegcs/GCS.h"

namespace intentcad {

namespace {

// Tag = constraint index + 1 (PlaneGCS tags are ints; 0 = untagged).
int TagFor(size_t i) { return static_cast<int>(i) + 1; }

}  // namespace

SolveResult PlaneGcsSolver::solve(const SketchModel& model,
                                  const SolveOptions& opts) {
  SolveResult result;
  try {
    // Owned pools (stable addresses via deque): unknowns point here.
    std::deque<double> coords;  // 2 per point, in point order
    std::deque<double> radii;   // 1 per circle/arc, in order
    std::deque<double> values;  // driving magnitudes (never unknowns)
    std::deque<double> angles;  // arc angles (constants in Phase 4)
    std::map<std::string, size_t> pointIndex;
    std::map<std::string, size_t> circleIndex;
    std::map<std::string, size_t> arcIndex;

    for (size_t i = 0; i < model.points.size(); ++i) {
      pointIndex[model.points[i].id] = i;
      coords.push_back(model.points[i].x);
      coords.push_back(model.points[i].y);
    }
    for (size_t i = 0; i < model.circles.size(); ++i) {
      circleIndex[model.circles[i].id] = i;
      radii.push_back(model.circles[i].r);
    }
    for (size_t i = 0; i < model.arcs.size(); ++i) {
      arcIndex[model.arcs[i].id] = i;
      radii.push_back(model.arcs[i].r);
    }
    const size_t circleCount = model.circles.size();

    auto pointAt = [&](size_t i) -> GCS::Point {
      return GCS::Point(&coords[2 * i], &coords[2 * i + 1]);
    };
    // GCS objects share the pool pointers (copies are shallow by design).
    std::vector<GCS::Point> points;
    for (size_t i = 0; i < model.points.size(); ++i) points.push_back(pointAt(i));

    std::vector<GCS::Line> lines;
    std::map<std::string, size_t> lineIndex;
    for (size_t i = 0; i < model.lines.size(); ++i) {
      const auto& l = model.lines[i];
      if (!pointIndex.count(l.p1) || !pointIndex.count(l.p2)) {
        result.error = "line references unknown point";
        return result;
      }
      GCS::Line gl;
      gl.p1 = points[pointIndex[l.p1]];
      gl.p2 = points[pointIndex[l.p2]];
      lineIndex[l.id] = lines.size();
      lines.push_back(gl);
    }

    std::vector<GCS::Circle> circles;
    for (size_t i = 0; i < model.circles.size(); ++i) {
      const auto& c = model.circles[i];
      if (!pointIndex.count(c.center)) {
        result.error = "circle references unknown point";
        return result;
      }
      GCS::Circle gc;
      gc.center = points[pointIndex[c.center]];
      gc.rad = &radii[i];
      circles.push_back(gc);
    }
    std::vector<GCS::Arc> arcs;
    for (size_t i = 0; i < model.arcs.size(); ++i) {
      const auto& a = model.arcs[i];
      if (!pointIndex.count(a.center)) {
        result.error = "arc references unknown point";
        return result;
      }
      GCS::Arc ga;
      ga.center = points[pointIndex[a.center]];
      ga.rad = &radii[circleCount + i];
      angles.push_back(a.startAngleRad);
      angles.push_back(a.endAngleRad);
      ga.startAngle = &angles[angles.size() - 2];
      ga.endAngle = &angles[angles.size() - 1];
      arcs.push_back(ga);
    }

    GCS::System sys;
    std::vector<std::string> tagToId;
    tagToId.reserve(model.constraints.size());
    std::set<double*> radiusUnknowns;
    std::set<std::string> fixedPointIds;  // from Fixed-kind constraints
    std::vector<int> solvedTags;  // tags that added a real GCS constraint
    auto needRadiusUnknown = [&](double* r) { radiusUnknowns.insert(r); };

    for (size_t ci = 0; ci < model.constraints.size(); ++ci) {
      const auto& c = model.constraints[ci];
      const int tag = TagFor(ci);
      tagToId.push_back(c.id);
      solvedTags.push_back(tag);  // Fixed-kind removes itself below
      auto needPoints = [&](size_t n) -> bool {
        if (c.refs.size() < n) {
          result.error = "constraint refs missing";
          return false;
        }
        for (size_t k = 0; k < n; ++k) {
          if (!pointIndex.count(c.refs[k])) {
            result.error = "constraint references unknown point";
            return false;
          }
        }
        return true;
      };
      auto needLines = [&](size_t n) -> bool {
        if (c.refs.size() < n) {
          result.error = "constraint refs missing";
          return false;
        }
        for (size_t k = 0; k < n; ++k) {
          if (!lineIndex.count(c.refs[k])) {
            result.error = "constraint references unknown line";
            return false;
          }
        }
        return true;
      };
      auto needCircles = [&](size_t n) -> bool {
        if (c.refs.size() < n) {
          result.error = "constraint refs missing";
          return false;
        }
        for (size_t k = 0; k < n; ++k) {
          if (!circleIndex.count(c.refs[k]) && !arcIndex.count(c.refs[k])) {
            result.error = "constraint references unknown circle";
            return false;
          }
        }
        return true;
      };
      auto circleAt = [&](const std::string& id) -> GCS::Circle* {
        if (circleIndex.count(id)) return &circles[circleIndex[id]];
        return nullptr;  // arcs handled by caller where needed
      };
      switch (c.kind) {
        case SketchConstraintKind::Coincident: {
          if (!needPoints(2)) return result;
          sys.addConstraintP2PCoincident(points[pointIndex[c.refs[0]]],
                                         points[pointIndex[c.refs[1]]], tag);
          break;
        }
        case SketchConstraintKind::Horizontal: {
          if (!needLines(1)) return result;
          sys.addConstraintHorizontal(lines[lineIndex[c.refs[0]]], tag);
          break;
        }
        case SketchConstraintKind::Vertical: {
          if (!needLines(1)) return result;
          sys.addConstraintVertical(lines[lineIndex[c.refs[0]]], tag);
          break;
        }
        case SketchConstraintKind::Parallel: {
          if (!needLines(2)) return result;
          sys.addConstraintParallel(lines[lineIndex[c.refs[0]]],
                                    lines[lineIndex[c.refs[1]]], tag);
          break;
        }
        case SketchConstraintKind::Perpendicular: {
          if (!needLines(2)) return result;
          sys.addConstraintPerpendicular(lines[lineIndex[c.refs[0]]],
                                         lines[lineIndex[c.refs[1]]], tag);
          break;
        }
        case SketchConstraintKind::EqualRadius: {
          if (!needCircles(2)) return result;
          GCS::Circle* a = circleAt(c.refs[0]);
          GCS::Circle* b = circleAt(c.refs[1]);
          if (!a || !b) {
            result.error = "EqualRadius needs circles (arcs: Phase 4.1)";
            return result;
          }
          sys.addConstraintEqualRadius(*a, *b, tag);
          break;
        }
        case SketchConstraintKind::Concentric: {
          if (!needCircles(2)) return result;
          GCS::Circle* a = circleAt(c.refs[0]);
          GCS::Circle* b = circleAt(c.refs[1]);
          if (!a || !b) {
            result.error = "Concentric needs circles (arcs: Phase 4.1)";
            return result;
          }
          sys.addConstraintEqual(a->center.x, b->center.x, tag);
          sys.addConstraintEqual(a->center.y, b->center.y, tag);
          break;
        }
        case SketchConstraintKind::Distance: {
          if (!needPoints(2)) return result;
          values.push_back(c.value);
          sys.addConstraintP2PDistance(points[pointIndex[c.refs[0]]],
                                       points[pointIndex[c.refs[1]]],
                                       &values.back(), tag);
          break;
        }
        case SketchConstraintKind::Radius: {
          if (!needCircles(1)) return result;
          GCS::Circle* a = circleAt(c.refs[0]);
          if (!a) {
            result.error = "Radius needs a circle (arcs: Phase 4.1)";
            return result;
          }
          values.push_back(c.value);
          sys.addConstraintCircleRadius(*a, &values.back(), tag);
          break;
        }
        case SketchConstraintKind::Diameter: {
          if (!needCircles(1)) return result;
          GCS::Circle* a = circleAt(c.refs[0]);
          if (!a) {
            result.error = "Diameter needs a circle (arcs: Phase 4.1)";
            return result;
          }
          values.push_back(c.value);
          sys.addConstraintCircleDiameter(*a, &values.back(), tag);
          break;
        }
        case SketchConstraintKind::Angle: {
          if (!needLines(2)) return result;
          values.push_back(c.value);
          sys.addConstraintL2LAngle(lines[lineIndex[c.refs[0]]],
                                    lines[lineIndex[c.refs[1]]],
                                    &values.back(), tag);
          break;
        }
        case SketchConstraintKind::PointOnLine: {
          if (c.refs.size() < 2 || !pointIndex.count(c.refs[0]) ||
              !lineIndex.count(c.refs[1])) {
            result.error = "PointOnLine needs [point, line]";
            return result;
          }
          sys.addConstraintPointOnLine(points[pointIndex[c.refs[0]]],
                                       lines[lineIndex[c.refs[1]]], tag);
          break;
        }
        case SketchConstraintKind::Fixed: {
          if (!needPoints(1)) return result;
          // Fixed = pinned at current values: enforced by unknown-exclusion
          // below (fixedPointIds set). Adds NO GCS constraint, so its tag
          // carries no residual — drop it from the solved-tag list.
          fixedPointIds.insert(c.refs[0]);
          solvedTags.pop_back();
          break;
        }
      }
    }

    // Unknowns: all point coords except fixed/dragged; radii only when a
    // radius-class constraint references them (no drift otherwise).
    for (size_t i = 0; i < model.circles.size(); ++i) {
      for (const auto& c : model.constraints) {
        if ((c.kind == SketchConstraintKind::Radius ||
             c.kind == SketchConstraintKind::Diameter) &&
            !c.refs.empty() && c.refs[0] == model.circles[i].id) {
          needRadiusUnknown(&radii[i]);
        }
        if (c.kind == SketchConstraintKind::EqualRadius && c.refs.size() >= 2 &&
            (c.refs[0] == model.circles[i].id ||
             c.refs[1] == model.circles[i].id)) {
          needRadiusUnknown(&radii[i]);
        }
      }
    }
    GCS::VEC_pD unknowns;
    if (opts.hasDragTarget && !pointIndex.count(opts.dragPointId)) {
      result.error = "unknown drag point " + opts.dragPointId;
      return result;
    }
    for (size_t i = 0; i < model.points.size(); ++i) {
      const auto& p = model.points[i];
      bool pinned = p.fixed || fixedPointIds.count(p.id) > 0;
      if (opts.hasDragTarget && opts.dragPointId == p.id) {
        pinned = true;
        coords[2 * i] = opts.dragX;
        coords[2 * i + 1] = opts.dragY;
      }
      if (!pinned) {
        unknowns.push_back(&coords[2 * i]);
        unknowns.push_back(&coords[2 * i + 1]);
      }
    }
    for (double* r : radiusUnknowns) unknowns.push_back(r);

    sys.declareUnknowns(unknowns);
    sys.initSolution();
    const GCS::SolveStatus st = sys.solve();
    sys.applySolution();

    // Residual proof (§41): ALWAYS verified numerically, on every status.
    // A blind-trust `Success` could store fixed-point violations as solved.
    // Only tags that added a real GCS constraint carry a residual (Fixed
    // pins unknowns without adding constraints).
    double worst = 0.0;
    bool residualOk = true;
    for (int tag : solvedTags) {
      const double e = sys.calculateConstraintErrorByTag(tag);
      if (std::isnan(e) || std::fabs(e) > opts.residualTolerance) {
        residualOk = false;
        break;
      }
      worst = std::max(worst, std::fabs(e));
    }
    if (st == GCS::SolveStatus::Failed ||
        st == GCS::SolveStatus::SuccessfulSolutionInvalid) {
      residualOk = false;
    }
    result.residual = worst;

    sys.diagnose();
    result.dofs = sys.dofsNumber();
    GCS::VEC_I conflicting, redundant;
    sys.getConflicting(conflicting);
    sys.getRedundant(redundant);
    for (int tag : conflicting) {
      if (tag >= 1 && static_cast<size_t>(tag) <= tagToId.size()) {
        result.conflicting.push_back(tagToId[static_cast<size_t>(tag) - 1]);
      }
    }
    for (int tag : redundant) {
      if (tag >= 1 && static_cast<size_t>(tag) <= tagToId.size()) {
        result.redundant.push_back(tagToId[static_cast<size_t>(tag) - 1]);
      }
    }

    result.ok = residualOk;
    if (!residualOk && result.error.empty()) {
      result.error = "solver did not converge (over-constrained?)";
    }
    if (result.ok) {
      for (size_t i = 0; i < model.points.size(); ++i) {
        result.points[model.points[i].id] = {coords[2 * i],
                                             coords[2 * i + 1]};
      }
      for (size_t i = 0; i < model.circles.size(); ++i) {
        result.radii[model.circles[i].id] = radii[i];
      }
      for (size_t i = 0; i < model.arcs.size(); ++i) {
        result.radii[model.arcs[i].id] = radii[circleCount + i];
      }
    }
    return result;
  } catch (const std::exception& e) {
    result.error = std::string("solver exception: ") + e.what();
    return result;
  } catch (...) {
    result.error = "solver exception";
    return result;
  }
}

SolverDiagnostics PlaneGcsSolver::diagnose(const SketchModel& model) {
  SolverDiagnostics diag;
  SolveOptions opts;
  const SolveResult r = solve(model, opts);
  diag.dofs = r.dofs;
  diag.conflicting = r.conflicting;
  diag.redundant = r.redundant;
  diag.overConstrained = !r.conflicting.empty();
  diag.underConstrained = r.dofs > 0;
  return diag;
}

std::unique_ptr<ISketchSolver> CreateSketchSolver() {
  return std::make_unique<PlaneGcsSolver>();
}

}  // namespace intentcad
