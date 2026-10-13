#include "datum_json.h"
#include "../../protocol/json_fields.h"
#include "../../model/feature_graph.h"
#include <set>
#include <stdexcept>
namespace kreoda {
std::string SerializeDatumRecord(const DatumRecord& record) {
  const auto xyz=[](const double* p){return Json::array({p[0],p[1],p[2]});};
  Json resolved;
  if(record.kind==DatumKind::Plane)
    resolved={{"originMm",xyz(record.plane.origin)},{"xAxis",xyz(record.plane.xAxis)},
              {"yAxis",xyz(record.plane.yAxis)},{"normal",xyz(record.plane.normal)}};
  else if(record.kind==DatumKind::Axis)
    resolved={{"originMm",xyz(record.originMm)},{"direction",xyz(record.direction)}};
  else resolved={{"positionMm",xyz(record.positionMm)}};
  return Json{{"featureId",record.featureId},{"type",DatumTypeName(record.kind)},
              {"kind",DatumTypeName(record.kind)},{"definition",Json::parse(record.definitionJson)},
              {"dependsOn",record.dependsOn},{"resolved",resolved},
              {"status",record.status},{"error",record.error}}.dump();
}
std::string SerializeDatumDefinition(const DatumRecord& record) {
  const auto kind=record.kind==DatumKind::Plane?"DatumPlane":record.kind==DatumKind::Axis?"DatumAxis":"DatumPoint";
  return Json{{"version",1},{"featureId",record.featureId},{"kind",kind},{"definition",Json::parse(record.definitionJson)}}.dump();
}
namespace {
void collectSources(const Json& value, std::set<std::string>* ids, int depth=0) {
  if(depth>8) throw std::runtime_error("datum definition nesting is too deep");
  if(value.is_object()) {
    const auto type=json_string_field(value,"type","");
    if(type=="datum"||type=="face"||type=="edge") {
      const auto id=json_string_field(value,"featureId","");
      if(!ShapeStore::ValidFeatureId(id)) throw std::runtime_error("invalid datum source featureId");
      ids->insert(id);
    }
    for(const auto& item:value.items()) collectSources(item.value(),ids,depth+1);
  } else if(value.is_array()) for(const auto& item:value) collectSources(item,ids,depth+1);
}
}
bool ParseDatumDefinitions(const std::vector<std::string>& jsonRecords,
                           const std::vector<ShapeRecord>& shapes,
                           const std::vector<SketchFeature>& sketches,
                           std::vector<DatumRecord>* out,std::string* error) {
  if(!out) { if(error)*error="datum staging output is required";return false; }
  try {
    std::map<std::string,DatumRecord> definitions;
    std::map<std::string,std::set<std::string>> sourceIds;
    std::set<std::string> allIds;
    FeatureGraph graph;
    for(const auto& shape:shapes) { if(!allIds.insert(shape.featureId).second) throw std::runtime_error("duplicate native feature id"); graph.addFeature(shape.featureId,shape.dependsOn); }
    for(const auto& sketch:sketches) { if(!allIds.insert(sketch.id).second) throw std::runtime_error("duplicate sketch feature id"); graph.addFeature(sketch.id,sketch.supportRef.empty()?std::vector<std::string>{}:std::vector<std::string>{sketch.supportRef}); }
    for(const auto& text:jsonRecords) {
      if(text.size()>65536) throw std::runtime_error("datum record too large");
      const auto json=parse_json_object(text); if(!json.is_object()||json_int_field(json,"version",0)!=1) throw std::runtime_error("unsupported datum record version");
      DatumRecord record; record.featureId=json_string_field(json,"featureId","");
      if(!ShapeStore::ValidFeatureId(record.featureId)||!allIds.insert(record.featureId).second) throw std::runtime_error("invalid or duplicate datum feature id");
      const auto kind=json_string_field(json,"kind","");
      if(kind=="DatumPlane") record.kind=DatumKind::Plane; else if(kind=="DatumAxis") record.kind=DatumKind::Axis; else if(kind=="DatumPoint") record.kind=DatumKind::Point; else throw std::runtime_error("unsupported datum kind");
      const auto& definition=json.at("definition"); if(!definition.is_object()) throw std::runtime_error("datum definition must be an object");
      record.definitionJson=definition.dump(); collectSources(definition,&sourceIds[record.featureId]); definitions.emplace(record.featureId,std::move(record));
    }
    for(const auto& [id,refs]:sourceIds) {
      for(const auto& source:refs) if(!allIds.count(source)) throw std::runtime_error("datum "+id+" references missing source "+source);
      graph.addFeature(id,std::vector<std::string>(refs.begin(),refs.end()));
    }
    std::vector<std::string> order; std::string graphError;
    if(!graph.dirtyOrder(&order,&graphError)) throw std::runtime_error(graphError);
    std::vector<DatumRecord> resolved;
    for(const auto& id:order) {
      auto it=definitions.find(id); if(it==definitions.end()) continue;
      DatumRecord record=it->second; std::string resolveError;
      if(!ResolveDatumDefinition(record.kind,record.definitionJson,DatumSourceRecords{resolved,shapes},&record,&resolveError)) throw std::runtime_error("datum "+id+": "+resolveError);
      const std::set<std::string> actual(record.dependsOn.begin(),record.dependsOn.end());
      if(actual!=sourceIds.at(id)) throw std::runtime_error("datum "+id+" contains unexpected source references");
      resolved.push_back(std::move(record));
    }
    *out=std::move(resolved); return true;
  } catch(const std::exception& failure) { if(error)*error=std::string("datum metadata: ")+failure.what();return false; }
}
}
