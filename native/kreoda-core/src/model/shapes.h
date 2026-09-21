#pragma once

#include <cstdint>
#include <map>
#include <mutex>
#include <string>
#include <vector>

#if KREODA_WITH_OCCT
#include <TopoDS_Shape.hxx>
#endif

namespace kreoda {

// Canonical in-memory feature record (§9–§10). The B-Rep shape lives here;
// OCAF persistence serializes it in Phase 1 (§30), the feature DAG and
// TNaming references arrive in Phase 2–3. Params are canonical mm.
struct ShapeRecord {
  std::string featureId;
  std::string type;  // "Box" | "Cylinder" | "Sphere" | "Sketch" | "Extrude" | ...
  std::vector<double> paramsMm;
  std::vector<std::string> dependsOn;  // DAG edges (§53): sketch/feature UUIDs
  // Non-numeric reference payload (§10): hole face role, fillet edge-id list
  // (comma-joined full persistent ids), boolean op name. Never an index.
  std::string refExtra;
#if KREODA_WITH_OCCT
  TopoDS_Shape shape;
#endif
  double volumeMm3 = 0.0;
  // xmin, ymin, zmin, xmax, ymax, zmax (mm)
  double bboxMm[6] = {0, 0, 0, 0, 0, 0};
};

// Serialized mutation owner (§40): one lock, topological recompute later.
class ShapeStore {
 public:
  static ShapeStore& instance();

  void clear();
  void put(ShapeRecord record);
  bool remove(const std::string& featureId);
  bool get(const std::string& featureId, ShapeRecord* out) const;
  bool contains(const std::string& featureId) const;
  // Stable creation order (persistence + re-mesh-all ordering).
  std::vector<ShapeRecord> listInOrder() const;

  // Feature-id charset (§10): UUIDs may only use [A-Za-z0-9_-]. Delimiters
  // (| , : ; =) would corrupt OCAF comments (@deps=/@ref= splits), edge-id
  // joins and owner splits — reject at every create entry, never silently
  // drop on Load.
  static bool ValidFeatureId(const std::string& id);

 private:
  ShapeStore() = default;
  mutable std::mutex mutex_;
  std::map<std::string, ShapeRecord> shapes_;
  std::vector<std::string> order_;
};

// Canonical per-type parameter slots (mm), single source of truth for
// ResolveParamsForEdit (features/primitives) and ParamIndexOf
// (expressions). Placement slots (Instance tx/ty/tz) may be negative/zero,
// unlike part dimensions — only the slot mapping lives here, never ranges.
// Empty = unknown type.
std::vector<std::string> DescribeParams(const std::string& type);

}  // namespace kreoda
