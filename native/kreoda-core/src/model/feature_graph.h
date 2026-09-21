#pragma once

#include <functional>
#include <map>
#include <string>
#include <vector>

namespace kreoda {

// Feature dependency DAG (§53–§54). Nodes are features (by stable UUID),
// edges point from a dependency to its dependent. Dirty flags propagate
// downstream; recompute visits dirty nodes in topological order and marks
// dependents of a failed node as errored without touching healthy branches.
class FeatureGraph {
 public:
  using RecomputeFn =
      std::function<bool(const std::string& featureId, std::string* error)>;

  void addFeature(const std::string& id,
                  const std::vector<std::string>& dependsOn = {});
  void removeFeature(const std::string& id);
  void clear();

  // Marks id and all transitive dependents geometry-dirty.
  void markDirty(const std::string& id);
  void clearDirty(const std::string& id);

  bool isGeometryDirty(const std::string& id) const;
  bool hasFeature(const std::string& id) const;
  size_t size() const { return nodes_.size(); }

  // Topological order over dirty nodes (dependencies first). Returns false
  // with an error on cycles — cycles must never reach the kernel (§63).
  bool dirtyOrder(std::vector<std::string>* order, std::string* error) const;
  struct RecomputeReport {
    bool ok = true;
    std::vector<std::string> recomputed;
    std::vector<std::string> skippedUpstreamFailure;
    std::string firstError;
  };
  // Recomputes dirty nodes in order via fn; a node failure marks its
  // dependents failed-with-upstream-error and continues other branches.
  RecomputeReport recompute(const RecomputeFn& fn);

 private:
  struct Node {
    std::vector<std::string> dependsOn;
    bool geometryDirty = true;
  };
  std::map<std::string, Node> nodes_;  // ordered map: deterministic order

  void collectDependents(const std::string& id,
                         std::vector<std::string>* out) const;
};

// Process-wide graph (the sidecar mutates one document at a time, §40).
// Cleared on CreateDocument/OpenDocument alongside the stores.
FeatureGraph& TheFeatureGraph();

}  // namespace kreoda
