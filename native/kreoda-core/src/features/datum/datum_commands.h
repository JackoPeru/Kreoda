#pragma once
#include "datum_store.h"
namespace kreoda {
bool CreateDatumFeature(const std::string& featureId,DatumKind kind,const std::string& definitionJson,std::string* error);
bool UpdateDatumFeature(const std::string& featureId,const std::string& definitionJson,std::string* error);
bool RebuildDatumFromStore(const std::string& featureId,std::string* error);
}
