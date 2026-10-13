#pragma once
#include <map>
#include <mutex>
#include <string>
#include <vector>
#include "../sketch/sketch_store.h"
namespace kreoda {
enum class DatumKind { Plane, Axis, Point };
struct DatumRecord {
  std::string featureId;
  DatumKind kind = DatumKind::Plane;
  std::string definitionJson;
  std::vector<std::string> dependsOn;
  SketchPlane plane;
  double originMm[3] = {0, 0, 0};
  double direction[3] = {0, 0, 1};
  double positionMm[3] = {0, 0, 0};
  std::string status = "ok", error;
};
class DatumStore {
 public:
  static DatumStore& instance();
  void clear();
  void put(DatumRecord record);
  bool get(const std::string& id, DatumRecord* out) const;
  bool contains(const std::string& id) const;
  bool remove(const std::string& id);
  std::vector<DatumRecord> listInOrder() const;
 private:
  DatumStore() = default;
  mutable std::mutex mutex_;
  std::map<std::string, DatumRecord> records_;
  std::vector<std::string> order_;
};
// Definitions and source refs use the discriminant "type". No state mutation.
bool ResolveDatumDefinition(DatumKind kind, const std::string& definitionJson,
                            DatumRecord* out, std::string* error);
}
