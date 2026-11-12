#pragma once

#include <nlohmann/json.hpp>
#include <string>

namespace kreoda {

bool CreateMoveFaceFeature(const nlohmann::json& request, std::string* error);
bool CreateOffsetFaceFeature(const nlohmann::json& request, std::string* error);
bool CreateDeleteFaceFeature(const nlohmann::json& request, std::string* error);
bool CreateReplaceFaceFeature(const nlohmann::json& request, std::string* error);

bool RebuildMoveFaceFromStore(const std::string& featureId, std::string* error);
bool RebuildOffsetFaceFromStore(const std::string& featureId, std::string* error);
bool RebuildDeleteFaceFromStore(const std::string& featureId, std::string* error);
bool RebuildReplaceFaceFromStore(const std::string& featureId, std::string* error);

}  // namespace kreoda
