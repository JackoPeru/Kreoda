#pragma once

#include <cmath>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>
#include <nlohmann/json.hpp>

namespace kreoda {
using Json = nlohmann::json;

class JsonFieldError : public std::runtime_error {
 public:
  explicit JsonFieldError(const std::string& message) : std::runtime_error(message) {}
};

inline Json parse_json_object(const std::string& text) {
  Json value = Json::parse(text, nullptr, false);
  return value.is_object() ? value : Json(Json::value_t::discarded);
}
inline bool json_has_key(const Json& value, const char* key) {
  return value.is_object() && value.contains(key);
}
inline std::string json_string_field(const Json& value, const char* key,
                                     const std::string& fallback = "") {
  if (!json_has_key(value, key)) return fallback;
  if (!value.at(key).is_string()) throw JsonFieldError(std::string(key) + " must be a JSON string");
  return value.at(key).get<std::string>();
}
inline std::string json_string_field_strict(const Json& value, const char* key,
                                            const std::string& fallback = "") {
  return json_string_field(value, key, fallback);
}
inline bool json_double_strict(const Json& value, const char* key, double* out) {
  if (!json_has_key(value, key) || !value.at(key).is_number()) return false;
  const double number = value.at(key).get<double>();
  if (!std::isfinite(number)) return false;
  if (out) *out = number;
  return true;
}
inline double json_double_field(const Json& value, const char* key, double fallback = 0) {
  if (!json_has_key(value, key)) return fallback;
  double number;
  if (!json_double_strict(value, key, &number)) throw JsonFieldError(std::string(key) + " must be a finite JSON number");
  return number;
}
inline int json_int_field(const Json& value, const char* key, int fallback = 0) {
  if (!json_has_key(value, key)) return fallback;
  if (!value.at(key).is_number_integer()) throw JsonFieldError(std::string(key) + " must be a JSON integer");
  const double number = value.at(key).get<double>();
  if (number < std::numeric_limits<int>::min() || number > std::numeric_limits<int>::max())
    throw JsonFieldError(std::string(key) + " is outside the integer range");
  return static_cast<int>(number);
}
inline bool json_bool_field(const Json& value, const char* key, bool fallback = false) {
  if (!json_has_key(value, key)) return fallback;
  if (!value.at(key).is_boolean()) throw JsonFieldError(std::string(key) + " must be a JSON boolean");
  return value.at(key).get<bool>();
}
inline bool json_value_field(const Json& value, const char* key, std::string* raw) {
  if (!json_has_key(value, key)) return false;
  if (raw) *raw = value.at(key).dump();
  return true;
}
inline std::vector<std::string> json_string_array(const Json& value, const char* key) {
  if (!json_has_key(value, key)) return {};
  const auto& items = value.at(key);
  if (!items.is_array()) throw JsonFieldError(std::string(key) + " must be a JSON string array");
  std::vector<std::string> result;
  for (const auto& item : items) {
    if (!item.is_string()) throw JsonFieldError(std::string(key) + " must contain JSON strings");
    result.push_back(item.get<std::string>());
  }
  return result;
}
inline std::vector<double> json_number_array(const Json& value, const char* key) {
  if (!json_has_key(value, key)) return {};
  const auto& items = value.at(key);
  if (!items.is_array()) throw JsonFieldError(std::string(key) + " must be a JSON number array");
  std::vector<double> result;
  for (const auto& item : items) {
    if (!item.is_number() || !std::isfinite(item.get<double>()))
      throw JsonFieldError(std::string(key) + " must contain finite JSON numbers");
    result.push_back(item.get<double>());
  }
  return result;
}
}  // namespace kreoda
