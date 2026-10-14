#pragma once
#include <map>
#include <mutex>
#include <string>
#include <vector>
#include <functional>
#include "../sketch/sketch_store.h"
#include "../../model/shapes.h"
namespace kreoda {
enum class DatumKind { Plane, Axis, Point };
inline const char* DatumTypeName(DatumKind kind) {
  return kind == DatumKind::Plane ? "DatumPlane" : kind == DatumKind::Axis ? "DatumAxis" : "DatumPoint";
}
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
#if KREODA_WITH_OCCT
using DatumSelectionResolver=std::function<bool(const std::string&,const std::string&,const std::string&,const std::string&,bool,TopoDS_Shape*,std::string*)>;
#else
using DatumSelectionResolver=std::nullptr_t;
#endif
struct DatumSourceRecords {
  const std::vector<DatumRecord>& datums;
  const std::vector<ShapeRecord>& shapes;
  DatumSelectionResolver selectionResolver={};
  bool allowUnboundIndexed=false;
};
// Definitions and source refs use the discriminant "type". No state mutation.
bool ResolveDatumDefinition(DatumKind kind, const std::string& definitionJson,
                            DatumRecord* out, std::string* error);
bool ResolveDatumDefinition(DatumKind kind, const std::string& definitionJson,
                            const DatumSourceRecords& sources,
                            DatumRecord* out, std::string* error);
}
