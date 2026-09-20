#include "sketch_store.h"

#include <algorithm>

namespace intentcad {

SketchStore& SketchStore::instance() {
  static SketchStore store;
  return store;
}

void SketchStore::clear() {
  std::lock_guard<std::mutex> lock(mutex_);
  sketches_.clear();
  order_.clear();
}

void SketchStore::put(SketchFeature feature) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (sketches_.find(feature.id) == sketches_.end()) {
    order_.push_back(feature.id);
  }
  sketches_[feature.id] = std::move(feature);
}

bool SketchStore::get(const std::string& id, SketchFeature* out) const {
  std::lock_guard<std::mutex> lock(mutex_);
  const auto it = sketches_.find(id);
  if (it == sketches_.end()) return false;
  if (out) *out = it->second;
  return true;
}

bool SketchStore::contains(const std::string& id) const {
  std::lock_guard<std::mutex> lock(mutex_);
  return sketches_.find(id) != sketches_.end();
}

bool SketchStore::remove(const std::string& id) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (sketches_.erase(id) == 0) return false;
  order_.erase(std::remove(order_.begin(), order_.end(), id), order_.end());
  return true;
}

std::vector<SketchFeature> SketchStore::listInOrder() const {
  std::lock_guard<std::mutex> lock(mutex_);
  std::vector<SketchFeature> out;
  out.reserve(order_.size());
  for (const auto& id : order_) {
    const auto it = sketches_.find(id);
    if (it != sketches_.end()) out.push_back(it->second);
  }
  return out;
}

SketchPlane PrincipalPlane(const std::string& kind) {
  SketchPlane p;
  if (kind == "XZ") {
    p.xAxis[0] = 1; p.xAxis[1] = 0; p.xAxis[2] = 0;
    p.yAxis[0] = 0; p.yAxis[1] = 0; p.yAxis[2] = 1;
    p.normal[0] = 0; p.normal[1] = -1; p.normal[2] = 0;
  } else if (kind == "YZ") {
    p.xAxis[0] = 0; p.xAxis[1] = 1; p.xAxis[2] = 0;
    p.yAxis[0] = 0; p.yAxis[1] = 0; p.yAxis[2] = 1;
    p.normal[0] = 1; p.normal[1] = 0; p.normal[2] = 0;
  }
  return p;  // default XY
}

SolveResult SolveStoredSketch(const std::string& id, const SolveOptions& opts,
                              std::string* error) {
  SketchFeature feature;
  if (!SketchStore::instance().get(id, &feature)) {
    SolveResult r;
    r.error = "unknown sketch " + id;
    if (error) *error = r.error;
    return r;
  }
  auto solver = CreateSketchSolver();
  SolveResult r = solver->solve(feature.model, opts);
  if (!r.ok) {
    if (error) {
      *error = r.error.empty() ? "sketch solve failed" : r.error;
      if (!r.conflicting.empty()) {
        *error += " (conflict)";
      }
    }
    return r;
  }
  for (auto& p : feature.model.points) {
    const auto it = r.points.find(p.id);
    if (it != r.points.end()) {
      p.x = it->second.first;
      p.y = it->second.second;
    }
  }
  for (auto& c : feature.model.circles) {
    const auto it = r.radii.find(c.id);
    if (it != r.radii.end()) c.r = it->second;
  }
  for (auto& a : feature.model.arcs) {
    const auto it = r.radii.find(a.id);
    if (it != r.radii.end()) a.r = it->second;
  }
  SketchStore::instance().put(std::move(feature));
  return r;
}

}  // namespace intentcad
