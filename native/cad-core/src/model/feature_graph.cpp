#include "feature_graph.h"

#include <algorithm>
#include <set>

namespace kreoda {

void FeatureGraph::addFeature(const std::string& id,
                              const std::vector<std::string>& dependsOn) {
  Node& node = nodes_[id];
  node.dependsOn = dependsOn;
  node.geometryDirty = true;
  node.tessellationDirty = true;
}

void FeatureGraph::removeFeature(const std::string& id) {
  nodes_.erase(id);
  for (auto& [other, node] : nodes_) {
    node.dependsOn.erase(
        std::remove(node.dependsOn.begin(), node.dependsOn.end(), id),
        node.dependsOn.end());
  }
}

void FeatureGraph::clear() { nodes_.clear(); }

FeatureGraph& TheFeatureGraph() {
  static FeatureGraph graph;
  return graph;
}

void FeatureGraph::markDirty(const std::string& id) {
  auto it = nodes_.find(id);
  if (it == nodes_.end()) return;
  it->second.geometryDirty = true;
  it->second.tessellationDirty = true;
  std::vector<std::string> dependents;
  collectDependents(id, &dependents);
  for (const auto& dep : dependents) {
    nodes_[dep].geometryDirty = true;
    nodes_[dep].tessellationDirty = true;
  }
}

void FeatureGraph::markTessellationDirty(const std::string& id) {
  auto it = nodes_.find(id);
  if (it == nodes_.end()) return;
  it->second.tessellationDirty = true;
}

void FeatureGraph::clearDirty(const std::string& id) {
  auto it = nodes_.find(id);
  if (it == nodes_.end()) return;
  it->second.geometryDirty = false;
  it->second.tessellationDirty = false;
}

bool FeatureGraph::isGeometryDirty(const std::string& id) const {
  const auto it = nodes_.find(id);
  return it != nodes_.end() && it->second.geometryDirty;
}

bool FeatureGraph::hasFeature(const std::string& id) const {
  return nodes_.find(id) != nodes_.end();
}

void FeatureGraph::collectDependents(const std::string& id,
                                     std::vector<std::string>* out) const {
  // Transitive closure over reverse edges (DFS with visited set).
  std::set<std::string> visited{id};
  std::vector<std::string> stack{id};
  while (!stack.empty()) {
    const std::string cur = stack.back();
    stack.pop_back();
    for (const auto& [other, node] : nodes_) {
      if (visited.count(other)) continue;
      for (const auto& dep : node.dependsOn) {
        if (dep == cur) {
          visited.insert(other);
          stack.push_back(other);
          out->push_back(other);
          break;
        }
      }
    }
  }
}

bool FeatureGraph::dirtyOrder(std::vector<std::string>* order,
                              std::string* error) const {
  // Kahn's algorithm restricted to dirty nodes (ordered map → deterministic).
  std::map<std::string, int> indegree;
  for (const auto& [id, node] : nodes_) {
    if (!node.geometryDirty) continue;
    indegree[id] = 0;
  }
  for (const auto& [id, node] : nodes_) {
    if (!node.geometryDirty) continue;
    for (const auto& dep : node.dependsOn) {
      const auto dit = nodes_.find(dep);
      if (dit != nodes_.end() && dit->second.geometryDirty) {
        indegree[id]++;
      }
    }
  }
  std::vector<std::string> ready;
  for (const auto& [id, deg] : indegree) {
    if (deg == 0) ready.push_back(id);
  }
  order->clear();
  while (!ready.empty()) {
    // Deterministic: ordered map iteration already sorted; take front.
    const std::string cur = ready.front();
    ready.erase(ready.begin());
    order->push_back(cur);
    for (const auto& [other, node] : nodes_) {
      if (!indegree.count(other)) continue;
      bool edge = false;
      for (const auto& dep : node.dependsOn) {
        if (dep == cur) {
          edge = true;
          break;
        }
      }
      if (edge && --indegree[other] == 0) ready.push_back(other);
    }
  }
  if (order->size() != indegree.size()) {
    if (error) *error = "dependency cycle in feature graph";
    return false;
  }
  return true;
}

FeatureGraph::RecomputeReport FeatureGraph::recompute(const RecomputeFn& fn) {
  RecomputeReport report;
  std::vector<std::string> order;
  std::string error;
  if (!dirtyOrder(&order, &error)) {
    report.ok = false;
    report.firstError = error;
    return report;
  }
  std::set<std::string> failed;
  for (const auto& id : order) {
    // Skip nodes whose upstream failed (§53.4): mark, don't fake.
    bool upstreamFailed = false;
    const auto& deps = nodes_[id].dependsOn;
    for (const auto& dep : deps) {
      if (failed.count(dep)) {
        upstreamFailed = true;
        break;
      }
    }
    if (upstreamFailed) {
      failed.insert(id);
      report.skippedUpstreamFailure.push_back(id);
      continue;
    }
    std::string nodeError;
    if (fn(id, &nodeError)) {
      clearDirty(id);
      report.recomputed.push_back(id);
    } else {
      failed.insert(id);
      report.ok = false;
      if (report.firstError.empty()) {
        report.firstError = id + ": " + nodeError;
      }
    }
  }
  return report;
}

}  // namespace kreoda
