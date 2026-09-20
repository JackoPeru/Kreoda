#pragma once

#include <map>
#include <mutex>
#include <string>
#include <vector>

#include "../../constraints/solver.h"

namespace kreoda {

// Sketch feature (§21): local 2D coords + plane frame + solved state.
// The SketchModel holds CURRENT (solved) coordinates; every mutation
// re-solves before commit (§41 for sketches: unsolvable edits rejected).
struct SketchPlane {
  double origin[3] = {0, 0, 0};
  double xAxis[3] = {1, 0, 0};
  double yAxis[3] = {0, 1, 0};
  double normal[3] = {0, 0, 1};
};

struct SketchFeature {
  std::string id;
  std::string planeKind = "XY";  // XY | XZ | YZ (offset via origin)
  SketchPlane plane;
  SketchModel model;
  std::string supportRef;  // "" = principal plane (Phase 4)
};

class SketchStore {
 public:
  static SketchStore& instance();

  void clear();
  void put(SketchFeature feature);
  bool get(const std::string& id, SketchFeature* out) const;
  bool contains(const std::string& id) const;
  bool remove(const std::string& id);
  std::vector<SketchFeature> listInOrder() const;

 private:
  SketchStore() = default;
  mutable std::mutex mutex_;
  std::map<std::string, SketchFeature> sketches_;
  std::vector<std::string> order_;
};

// Principal plane frames (mm, right-handed, orthonormal).
SketchPlane PrincipalPlane(const std::string& kind);

// Solve + write back into the stored sketch. Returns solver result;
// on failure the stored sketch is untouched.
SolveResult SolveStoredSketch(const std::string& id, const SolveOptions& opts,
                              std::string* error);

}  // namespace kreoda
