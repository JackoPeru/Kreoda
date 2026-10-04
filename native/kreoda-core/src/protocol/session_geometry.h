#pragma once
#include "protocol/json_fields.h"

namespace kreoda {
class SessionQueryError : public std::runtime_error {
 public:
  SessionQueryError(std::string code, std::string message)
      : std::runtime_error(std::move(message)), code(std::move(code)) {}
  const std::string code;
};
// Read-only OCCT projections. Never returns B-Rep or chooses a duplicate role.
Json RunSessionGeometryQuery(const std::string& method, const Json& params);
}
