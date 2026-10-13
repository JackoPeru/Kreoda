#include "datum_commands.h"
#include "datum_json.h"
#include "../../protocol/json_fields.h"
#include <cmath>
#include "../../document/document_store.h"
#include "../../model/body.h"
#include "../../model/commit.h"
#include "../../model/feature_graph.h"
#include "../../model/model_snapshot.h"
#include "../../features/evaluate.h"
#include "../../persistence/ocaf_live.h"
#include <exception>
#include <optional>
namespace kreoda {
bool SetDatumParameter(const std::string& id,const std::string& name,double value,std::string* error) {
  try {
    DatumRecord record;
    if(!DatumStore::instance().get(id,&record))throw std::runtime_error("datum feature not found");
    if(!std::isfinite(value))throw std::runtime_error("datum parameter must be finite");
    auto definition=Json::parse(record.definitionJson);
    const auto type=definition.value("type","");
    bool found=false;
    if(((type=="offset"&&name=="offsetMm")||(type=="angle"&&name=="angleDeg"))&&definition.contains(name)&&definition[name].is_number()) {
      definition[name]=value;found=true;
    } else {
      const auto coordinate=[&](Json& source,const std::string& prefix) {
        if(!source.is_object()||source.value("type","")!="coordinates")return;
        for(int axis=0;axis<3;++axis) {
          const std::string parameter=prefix.empty()?std::string(1,"xyz"[axis])+"Mm":prefix+"XYZ"[axis]+"Mm";
          if(name==parameter){source.at("positionMm").at(axis)=value;found=true;}
        }
      };
      if(type=="coordinates")coordinate(definition,"");
      if(type=="threePoint"||type=="twoPoint"||type=="midpoint") {
        for(const auto* key:{"first","second"})if(definition.contains(key))coordinate(definition[key],key);
        if(type=="threePoint"&&definition.contains("third"))coordinate(definition["third"],"third");
      }
      if(type=="planeNormal"&&definition.contains("through"))coordinate(definition["through"],"through");
    }
    if(!found)throw std::runtime_error("unknown numeric datum parameter: "+name);
    return UpdateDatumFeature(id,definition.dump(),error);
  } catch(const std::exception& exception) {if(error)*error=exception.what();return false;}
}
namespace {
bool stage(const DatumRecord& next,DatumRecord* resolved,std::string* error) {
  auto datums=DatumStore::instance().listInOrder(); bool replaced=false;
  for(auto& record:datums)if(record.featureId==next.featureId){record=next;replaced=true;}
  if(!replaced)datums.push_back(next);
  std::vector<std::string> definitions;for(const auto& record:datums)definitions.push_back(SerializeDatumDefinition(record));
  std::vector<DatumRecord> validated;
  if(!ParseDatumDefinitions(definitions,ShapeStore::instance().listInOrder(),SketchStore::instance().listInOrder(),&validated,error))return false;
  for(const auto& record:validated)if(record.featureId==next.featureId){*resolved=record;return true;}
  if(error)*error="datum staging lost the requested feature";return false;
}
bool mutate(const std::string& id,DatumKind kind,const std::string& definition,bool create,std::string* error) {
  std::optional<ModelSnapshot> before; bool commandStarted=false;
  try {
    if(create&&!CheckNewId(id,error))return false;
    DatumRecord next;next.featureId=id;
    if(!ResolveDatumDefinition(kind,definition,&next,error))return false;
    DatumRecord staged;if(!stage(next,&staged,error))return false;
    before.emplace();
#if KREODA_WITH_OCCT
    if(!OcafLive::instance().BeginCommand(error))return false;
    commandStarted=true;
#endif
    DatumStore::instance().put(staged);
    TheFeatureGraph().addFeature(id,staged.dependsOn);TheFeatureGraph().markDirty(id);
    const auto report=TheFeatureGraph().recompute([](const std::string& feature,std::string* err){return RebuildNodeFromStore(feature,err);});
    if(!report.ok) {
#if KREODA_WITH_OCCT
      OcafLive::instance().AbortCommand();if(create)OcafLive::instance().ForgetFeatures({id});
#endif
      before->restore();if(error)*error=report.firstError;return false;
    }
#if KREODA_WITH_OCCT
    if(OcafLive::instance().InTransaction())DocumentStore::instance().noteFeature(id,DatumTypeName(kind));
    else DocumentStore::instance().registerFeature(id,DatumTypeName(kind));
    if(!OcafLive::instance().CommitCommand(nullptr,error)) { OcafLive::instance().AbortCommand();if(create)OcafLive::instance().ForgetFeatures({id});before->restore();return false; }
#else
    DocumentStore::instance().registerFeature(id,DatumTypeName(kind));
#endif
    commandStarted=false;return true;
  } catch(const std::exception& failure) {
#if KREODA_WITH_OCCT
    if(commandStarted) { OcafLive::instance().AbortCommand();if(create)OcafLive::instance().ForgetFeatures({id}); }
#endif
    if(before)before->restore();if(error)*error=failure.what();return false;
  } catch(...) {
#if KREODA_WITH_OCCT
    if(commandStarted) { OcafLive::instance().AbortCommand();if(create)OcafLive::instance().ForgetFeatures({id}); }
#endif
    if(before)before->restore();if(error)*error="datum operation failed";return false;
  }
}
}
bool CreateDatumFeature(const std::string& id,DatumKind kind,const std::string& definition,std::string* error) { return mutate(id,kind,definition,true,error); }
bool UpdateDatumFeature(const std::string& id,const std::string& definition,std::string* error) {
  DatumRecord previous;if(!DatumStore::instance().get(id,&previous)){if(error)*error="unknown datum "+id;return false;}
  return mutate(id,previous.kind,definition,false,error);
}
bool RebuildDatumFromStore(const std::string& id,std::string* error) {
  DatumRecord record;if(!DatumStore::instance().get(id,&record)){if(error)*error="unknown datum "+id;return false;}
  DatumRecord next;next.featureId=id;
  if(!ResolveDatumDefinition(record.kind,record.definitionJson,&next,error))return false;
#if KREODA_WITH_OCCT
  if(!OcafLive::instance().UpsertDatum(id,SerializeDatumDefinition(next),error))return false;
#endif
  DatumStore::instance().put(std::move(next));return true;
}
}
