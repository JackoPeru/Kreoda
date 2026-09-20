#include "ocaf_store.h"

#include "ocaf_live.h"

namespace kreoda {

bool SaveXbf(const std::string& xbfPath, std::string* error) {
  return OcafLive::instance().Save(xbfPath, error);
}

bool LoadXbf(const std::string& xbfPath, std::vector<ShapeRecord>* records,
             std::string* error) {
  return OcafLive::instance().Load(xbfPath, records, error);
}

}  // namespace kreoda
