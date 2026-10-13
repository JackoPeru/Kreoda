#pragma once
#include "datum_store.h"
namespace kreoda {
std::string SerializeDatumDefinition(const DatumRecord& record);
bool ParseDatumDefinitions(const std::vector<std::string>& jsonRecords,
                           const std::vector<ShapeRecord>& shapes,
                           const std::vector<SketchFeature>& sketches,
                           std::vector<DatumRecord>* out, std::string* error);
}
