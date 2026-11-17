#pragma once

#include <algorithm>
#include <cmath>
#include <limits>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include "sketch_commands.h"

namespace kreoda {
namespace sketch_transform_detail {

inline bool Fail(std::string* error, const std::string& message) {
  if (error) *error = message;
  return false;
}

inline const SketchPoint* FindPoint(const SketchModel& model, const std::string& id) {
  for (const auto& point : model.points) if (point.id == id) return &point;
  return nullptr;
}

inline const SketchLine* FindLine(const SketchModel& model, const std::string& id) {
  for (const auto& line : model.lines) if (line.id == id) return &line;
  return nullptr;
}

inline bool InsertUnique(std::unordered_set<std::string>* ids, const std::string& id) {
  return !id.empty() && ids->insert(id).second;
}

inline bool CollectIds(const SketchModel& model, std::unordered_set<std::string>* ids) {
  for (const auto& item : model.points) if (!InsertUnique(ids, item.id)) return false;
  for (const auto& item : model.lines) if (!InsertUnique(ids, item.id)) return false;
  for (const auto& item : model.circles) if (!InsertUnique(ids, item.id)) return false;
  for (const auto& item : model.arcs) if (!InsertUnique(ids, item.id)) return false;
  for (const auto& item : model.ellipses) if (!InsertUnique(ids, item.id)) return false;
  for (const auto& item : model.splines) if (!InsertUnique(ids, item.id)) return false;
  for (const auto& item : model.constraints) if (!InsertUnique(ids, item.id)) return false;
  return true;
}

inline bool Near(double a, double b, double scale = 1.0) {
  const double magnitude = std::max({1.0, std::fabs(a), std::fabs(b), std::fabs(scale)});
  const double ulpAllowance = 64.0 * std::numeric_limits<double>::epsilon() * magnitude;
  return std::fabs(a - b) <= 1e-7 + ulpAllowance;
}

inline std::string CopyId(const std::string& prefix, int copy, const std::string& source) {
  return prefix + "-" + std::to_string(copy) + "-" + source;
}

inline bool TransformSketchLinesImpl(const std::string& sketchId,
                                     const std::vector<std::string>& lineIds,
                                     const std::string& prefix,
                                     bool mirror, double axisX, double axisY,
                                     double axisOriginX, double axisOriginY,
                                     double offsetX, double offsetY, int copies,
                                     std::string* error) {
  if (prefix.empty() || lineIds.empty() || copies < 1 || copies > 64 ||
      !std::isfinite(axisX) || !std::isfinite(axisY) ||
      !std::isfinite(axisOriginX) || !std::isfinite(axisOriginY) ||
      !std::isfinite(offsetX) || !std::isfinite(offsetY)) {
    return Fail(error, "invalid sketch transformation");
  }
  const double axisLength = std::hypot(axisX, axisY);
  if (mirror && (!std::isfinite(axisLength) || axisLength < 1e-12))
    return Fail(error, "mirror axis is degenerate");

  SketchFeature sketch;
  if (!SketchStore::instance().get(sketchId, &sketch)) return Fail(error, "sketch not found");

  std::unordered_set<std::string> reservedIds;
  if (!CollectIds(sketch.model, &reservedIds)) return Fail(error, "duplicate or empty source ID");
  std::unordered_set<std::string> closureIds;
  std::unordered_set<std::string> selectedIds;
  std::vector<const SketchLine*> selected;
  selected.reserve(lineIds.size());
  for (const auto& id : lineIds) {
    if (!selectedIds.insert(id).second) return Fail(error, "duplicate source line selection");
    const auto* line = FindLine(sketch.model, id);
    if (!line) return Fail(error, "unknown source line " + id);
    const auto* a = FindPoint(sketch.model, line->p1);
    const auto* b = FindPoint(sketch.model, line->p2);
    if (!a || !b) return Fail(error, "source line has missing point");
    if (!std::isfinite(a->x) || !std::isfinite(a->y) ||
        !std::isfinite(b->x) || !std::isfinite(b->y) || line->p1 == line->p2 ||
        std::hypot(b->x - a->x, b->y - a->y) < 1e-12) {
      return Fail(error, "source line is non-finite or degenerate");
    }
    selected.push_back(line);
    closureIds.insert(id);
    closureIds.insert(line->p1);
    closureIds.insert(line->p2);
  }

  std::vector<const SketchConstraint*> copiedConstraints;
  for (const auto& constraint : sketch.model.constraints) {
    bool touches = false;
    for (const auto& ref : constraint.refs) {
      if (reservedIds.find(ref) == reservedIds.end()) return Fail(error, "constraint has missing reference");
      touches = touches || closureIds.find(ref) != closureIds.end();
    }
    if (!touches) continue;
    for (const auto& ref : constraint.refs) {
      if (closureIds.find(ref) == closureIds.end())
        return Fail(error, "constraint crosses selected line closure");
    }
    copiedConstraints.push_back(&constraint);
  }

  SketchModel next = sketch.model;
  for (int copy = 1; copy <= copies; ++copy) {
    std::unordered_map<std::string, std::string> remap;
    std::unordered_map<std::string, std::pair<double, double>> copiedPointPositions;
    std::unordered_map<std::string, std::string> copiedLineIds;
    std::vector<SketchPoint> newPoints;
    std::vector<SketchLine> newLines;
    std::vector<SketchConstraint> newConstraints;
    newPoints.reserve(closureIds.size() - selectedIds.size());
    newLines.reserve(selected.size());
    newConstraints.reserve(copiedConstraints.size());

    auto reserveGenerated = [&](const std::string& source) {
      const auto generated = CopyId(prefix, copy, source);
      return InsertUnique(&reservedIds, generated) ? generated : std::string{};
    };

    for (const auto& line : selected) {
      const auto lineId = reserveGenerated(line->id);
      if (lineId.empty()) return Fail(error, "transformed ID collision");
      remap.emplace(line->id, lineId);
      copiedLineIds.emplace(line->id, lineId);
    }
    for (const auto& line : selected) {
      for (const auto& pointId : {line->p1, line->p2}) {
        if (remap.find(pointId) != remap.end()) continue;
        const auto pointIdCopy = reserveGenerated(pointId);
        if (pointIdCopy.empty()) return Fail(error, "transformed ID collision");
        remap.emplace(pointId, pointIdCopy);
      }
    }
    for (const auto* constraint : copiedConstraints) {
      const auto constraintIdCopy = reserveGenerated(constraint->id);
      if (constraintIdCopy.empty()) return Fail(error, "transformed constraint ID collision");
      remap.emplace(constraint->id, constraintIdCopy);
    }

    for (const auto& line : selected) {
      for (const auto& pointId : {line->p1, line->p2}) {
        if (copiedPointPositions.find(pointId) != copiedPointPositions.end()) continue;
        const auto* source = FindPoint(sketch.model, pointId);
        if (!source) return Fail(error, "source line has missing point");
        double x = source->x;
        double y = source->y;
        if (mirror) {
          const double ux = axisX / axisLength;
          const double uy = axisY / axisLength;
          const double dx = x - axisOriginX;
          const double dy = y - axisOriginY;
          const double along = dx * ux + dy * uy;
          x = axisOriginX + 2.0 * along * ux - dx;
          y = axisOriginY + 2.0 * along * uy - dy;
        }
        x += copy * offsetX;
        y += copy * offsetY;
        if (!std::isfinite(x) || !std::isfinite(y)) return Fail(error, "transformed coordinates are non-finite");
        copiedPointPositions.emplace(pointId, std::make_pair(x, y));
        auto point = *source;
        point.id = remap.at(pointId);
        point.x = x;
        point.y = y;
        newPoints.push_back(std::move(point));
      }
    }
    for (const auto* source : selected) {
      newLines.push_back({remap.at(source->id), remap.at(source->p1), remap.at(source->p2)});
    }
    for (const auto* source : copiedConstraints) {
      auto constraint = *source;
      constraint.id = remap.at(source->id);
      for (auto& ref : constraint.refs) ref = remap.at(ref);
      if (mirror && constraint.kind == SketchConstraintKind::Angle) constraint.value = -constraint.value;
      if (mirror && (constraint.kind == SketchConstraintKind::Horizontal ||
                     constraint.kind == SketchConstraintKind::Vertical)) {
        if (constraint.refs.size() != 1) return Fail(error, "axis constraint has invalid references");
        const auto* sourceLine = FindLine(sketch.model, source->refs.front());
        if (!sourceLine) return Fail(error, "axis constraint references a missing line");
        const auto a = copiedPointPositions.at(sourceLine->p1);
        const auto b = copiedPointPositions.at(sourceLine->p2);
        const double dx = b.first - a.first;
        const double dy = b.second - a.second;
        const double tolerance = 1e-8 * std::max({1.0, std::fabs(dx), std::fabs(dy)});
        if (std::fabs(dy) <= tolerance) constraint.kind = SketchConstraintKind::Horizontal;
        else if (std::fabs(dx) <= tolerance) constraint.kind = SketchConstraintKind::Vertical;
        else return Fail(error, "oblique mirror cannot preserve horizontal or vertical constraint");
      }
      newConstraints.push_back(std::move(constraint));
    }

    next.points.insert(next.points.end(), newPoints.begin(), newPoints.end());
    next.lines.insert(next.lines.end(), newLines.begin(), newLines.end());
    next.constraints.insert(next.constraints.end(), newConstraints.begin(), newConstraints.end());
    for (const auto* line : selected) {
      if (std::find(sketch.model.constructionIds.begin(), sketch.model.constructionIds.end(), line->id) !=
          sketch.model.constructionIds.end()) {
        next.constructionIds.push_back(remap.at(line->id));
      }
    }
  }
  return UpdateSketchFeature(sketchId, next, error);
}

}  // namespace sketch_transform_detail

// Exact supporting-line intersection. The candidate is solved before commit;
// reject solver movement that would defeat the chosen intersection or move
// unrelated canonical geometry.
inline bool TrimExtendSketchLine(const std::string& sketchId,
                                 const std::string& targetLineId,
                                 const std::string& boundaryLineId,
                                 bool moveStart, bool extend,
                                 std::string* error) {
  using namespace sketch_transform_detail;
  SketchFeature sketch;
  if (!SketchStore::instance().get(sketchId, &sketch)) return Fail(error, "sketch not found");
  const auto* target = FindLine(sketch.model, targetLineId);
  const auto* boundary = FindLine(sketch.model, boundaryLineId);
  if (!target || !boundary || targetLineId == boundaryLineId)
    return Fail(error, "trim/extend requires distinct existing lines");
  const auto* a = FindPoint(sketch.model, target->p1);
  const auto* b = FindPoint(sketch.model, target->p2);
  const auto* c = FindPoint(sketch.model, boundary->p1);
  const auto* d = FindPoint(sketch.model, boundary->p2);
  if (!a || !b || !c || !d) return Fail(error, "trim/extend has missing endpoints");
  const double rx = b->x - a->x, ry = b->y - a->y;
  const double sx = d->x - c->x, sy = d->y - c->y;
  const double det = rx * sy - ry * sx;
  if (!std::isfinite(det) || std::fabs(det) < 1e-10 * std::hypot(rx, ry) * std::hypot(sx, sy))
    return Fail(error, "trim/extend lines parallel or degenerate");
  const double t = ((c->x - a->x) * sy - (c->y - a->y) * sx) / det;
  const double u = ((c->x - a->x) * ry - (c->y - a->y) * rx) / det;
  constexpr double tol = 1e-8;
  if (!std::isfinite(t) || !std::isfinite(u) || u < -tol || u > 1 + tol ||
      (extend ? (t >= -tol && t <= 1 + tol) : !(t > tol && t < 1 - tol)) ||
      (!extend && (moveStart ? t <= tol : t >= 1 - tol)) ||
      (extend && (moveStart ? t >= -tol : t <= 1 + tol)))
    return Fail(error, "trim/extend intersection outside supported region");

  const std::string endpoint = moveStart ? target->p1 : target->p2;
  const auto* chosen = moveStart ? a : b;
  if (chosen->fixed) return Fail(error, "trim/extend endpoint is fixed");
  for (const auto& constraint : sketch.model.constraints) {
    if (constraint.kind == SketchConstraintKind::Fixed &&
        std::find(constraint.refs.begin(), constraint.refs.end(), endpoint) != constraint.refs.end())
      return Fail(error, "trim/extend endpoint is fixed by a constraint");
  }

  SketchModel candidate = sketch.model;
  bool found = false;
  double exactX = 0.0, exactY = 0.0;
  for (auto& point : candidate.points) if (point.id == endpoint) {
    point.x = a->x + t * rx;
    point.y = a->y + t * ry;
    exactX = point.x;
    exactY = point.y;
    found = true;
  }
  if (!found) return Fail(error, "trim/extend endpoint not found");

  auto solver = CreateSketchSolver();
  SolveOptions options;
  const SolveResult solved = solver->solve(candidate, options);
  if (!solved.ok) return Fail(error, solved.error.empty() ? "trim/extend sketch solve failed" : solved.error);
  const auto moved = solved.points.find(endpoint);
  if (moved == solved.points.end() || !Near(moved->second.first, exactX) || !Near(moved->second.second, exactY))
    return Fail(error, "trim/extend conflicts with constraints at the chosen intersection");
  for (const auto& point : sketch.model.points) {
    if (point.id == endpoint) continue;
    const auto solvedPoint = solved.points.find(point.id);
    if (solvedPoint != solved.points.end() &&
        (!Near(solvedPoint->second.first, point.x) || !Near(solvedPoint->second.second, point.y)))
      return Fail(error, "trim/extend conflicts with constraints on untouched geometry");
  }
  for (const auto& circle : sketch.model.circles) {
    const auto radius = solved.radii.find(circle.id);
    if (radius != solved.radii.end() && !Near(radius->second, circle.r))
      return Fail(error, "trim/extend conflicts with constrained radius");
  }
  for (const auto& arc : sketch.model.arcs) {
    const auto radius = solved.radii.find(arc.id);
    if (radius != solved.radii.end() && !Near(radius->second, arc.r))
      return Fail(error, "trim/extend conflicts with constrained radius");
  }
  for (const auto& ellipse : sketch.model.ellipses) {
    const auto axes = solved.ellipseAxes.find(ellipse.id);
    if (axes != solved.ellipseAxes.end() &&
        (!Near(axes->second.first, ellipse.majorRadius) || !Near(axes->second.second, ellipse.minorRadius)))
      return Fail(error, "trim/extend conflicts with constrained ellipse axes");
  }
  return UpdateSketchFeature(sketchId, candidate, error);
}

// Mirror axis direction passes through the sketch origin; kept for existing
// callers that expose the canonical X/Y axes.
inline bool TransformSketchLines(const std::string& sketchId,
                                 const std::vector<std::string>& lineIds,
                                 const std::string& prefix,
                                 bool mirror, double axisX, double axisY,
                                 double offsetX, double offsetY, int copies,
                                 std::string* error) {
  return sketch_transform_detail::TransformSketchLinesImpl(sketchId, lineIds, prefix, mirror,
      axisX, axisY, 0.0, 0.0, offsetX, offsetY, copies, error);
}

inline bool TransformSketchLinesAboutAxis(const std::string& sketchId,
                                          const std::vector<std::string>& lineIds,
                                          const std::string& prefix,
                                          double axisX, double axisY,
                                          double axisOriginX, double axisOriginY,
                                          std::string* error) {
  return sketch_transform_detail::TransformSketchLinesImpl(sketchId, lineIds, prefix, true,
      axisX, axisY, axisOriginX, axisOriginY, 0.0, 0.0, 1, error);
}

inline bool PatternSketchLines(const std::string& sketchId,
                               const std::vector<std::string>& lineIds,
                               const std::string& prefix,
                               double spacingX, double spacingY, int copies,
                               std::string* error) {
  return sketch_transform_detail::TransformSketchLinesImpl(sketchId, lineIds, prefix, false,
      1.0, 0.0, 0.0, 0.0, spacingX, spacingY, copies, error);
}

}  // namespace kreoda
