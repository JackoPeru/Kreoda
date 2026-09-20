#include "persistent_refs.h"
std::string MakeRoleRef(const std::string& featureId, const std::string& role) {
  return featureId + ":" + role;  // e.g. "uuid:extrusion.cap.end"
}
