#include "geometry_availability.h"

#include <algorithm>
#include <set>
#include <sstream>

#include "../features/datum/datum_store.h"
#include "../features/sketch/sketch_projection.h"

namespace kreoda {
namespace {

struct AvailabilityWalk {
  std::set<std::string> active;
  std::set<std::string> complete;
  std::set<std::string> failed;
  std::set<std::string> blockers;
  std::vector<std::string> reasons;

  bool visit(const std::string& id) {
    if (complete.count(id)) return !failed.count(id);
    if (!active.insert(id).second) {
      blockers.insert(id);
      reasons.push_back("dependency cycle at " + id);
      return false;
    }

    ShapeRecord shape;
    SketchFeature sketch;
    DatumRecord datum;
    const bool hasShape = ShapeStore::instance().get(id, &shape);
    const bool hasSketch = SketchStore::instance().get(id, &sketch);
    const bool hasDatum = DatumStore::instance().get(id, &datum);
    bool ok = true;
    int owners = static_cast<int>(hasShape) + static_cast<int>(hasSketch) +
                 static_cast<int>(hasDatum);
    if (owners != 1) {
      blockers.insert(id);
      reasons.push_back(owners ? "ambiguous feature owner " + id
                               : "missing geometry source " + id);
      ok = false;
    } else if (hasShape) {
#if KREODA_WITH_OCCT
      if (shape.shape.IsNull()) {
        blockers.insert(id);
        reasons.push_back("native B-Rep is missing for " + id);
        ok = false;
      }
#endif
      for (const auto& dependency : shape.dependsOn)
        if (!visit(dependency)) ok = false;
    } else if (hasSketch) {
      for (const auto& group : sketch.projectionGroups) {
        if (group.status != "ok") {
          bool hasBlocker = false;
          if (group.blockingSourceIds.empty()) {
            std::string canonical;
            std::vector<std::string> sources;
            std::string parseError;
            if (ValidateSketchProjectionDefinition(
                    group.groupId, group.definitionJson, &canonical, &sources,
                    &parseError)) {
              blockers.insert(sources.begin(), sources.end());
              hasBlocker = !sources.empty();
            }
          } else {
            blockers.insert(group.blockingSourceIds.begin(),
                            group.blockingSourceIds.end());
            hasBlocker = !group.blockingSourceIds.empty();
          }
          if (!hasBlocker) blockers.insert(sketch.id);
          reasons.push_back("projection group " + group.groupId + " is " +
                            group.status +
                            (group.error.empty() ? "" : ": " + group.error));
          ok = false;
        }
#if KREODA_WITH_OCCT
        else if (group.evaluatedEdges.empty()) {
          blockers.insert(sketch.id);
          reasons.push_back("projection group " + group.groupId +
                            " has no current native edges");
          ok = false;
        }
#endif
      }
      for (const auto& dependency : SketchDependencies(sketch))
        if (!visit(dependency)) ok = false;
    } else {
      if (datum.status != "ok") {
        blockers.insert(id);
        reasons.push_back("datum " + id + " is " + datum.status +
                          (datum.error.empty() ? "" : ": " + datum.error));
        ok = false;
      }
      for (const auto& dependency : datum.dependsOn)
        if (!visit(dependency)) ok = false;
    }

    active.erase(id);
    complete.insert(id);
    if (!ok) failed.insert(id);
    return ok;
  }
};

}  // namespace

GeometryAvailability GetGeometryAvailability(const std::string& featureId) {
  AvailabilityWalk walk;
  GeometryAvailability result;
  result.geometryCurrent = walk.visit(featureId);
  if (result.geometryCurrent) return result;
  result.status = "unavailable";
  result.blockingSourceIds.assign(walk.blockers.begin(), walk.blockers.end());
  std::ostringstream message;
  message << "geometry unavailable for " << featureId;
  if (!result.blockingSourceIds.empty()) {
    message << "; blocked by ";
    for (size_t i = 0; i < result.blockingSourceIds.size(); ++i) {
      if (i) message << ", ";
      message << result.blockingSourceIds[i];
    }
  }
  if (!walk.reasons.empty()) message << ": " << walk.reasons.front();
  result.error = message.str();
  return result;
}

bool EnsureGeometryAvailable(const std::string& featureId, std::string* error) {
  const auto availability = GetGeometryAvailability(featureId);
  if (!availability.geometryCurrent) {
    if (error) *error = availability.error;
    return false;
  }
  if (error) error->clear();
  return true;
}

bool GetCurrentShapeRecord(const std::string& featureId, ShapeRecord* out,
                           std::string* error) {
  ShapeRecord candidate;
  if (!ShapeStore::instance().get(featureId, &candidate)) {
    if (error) *error = "unknown feature " + featureId;
    return false;
  }
  const auto availability = GetGeometryAvailability(featureId);
  if (!availability.geometryCurrent) {
    if (error) *error = availability.error;
    return false;
  }
  if (out) *out = std::move(candidate);
  if (error) error->clear();
  return true;
}

}  // namespace kreoda
