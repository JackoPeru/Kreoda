#pragma once

#include <string>
#include <vector>

#include "shapes.h"

namespace kreoda {

struct GeometryAvailability {
  bool geometryCurrent = true;
  std::string status = "ok";
  std::string error;
  std::vector<std::string> blockingSourceIds;
};

GeometryAvailability GetGeometryAvailability(const std::string& featureId);
bool EnsureGeometryAvailable(const std::string& featureId, std::string* error);
bool GetCurrentShapeRecord(const std::string& featureId, ShapeRecord* out,
                           std::string* error);

}  // namespace kreoda
