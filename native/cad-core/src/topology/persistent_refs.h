#pragma once
#include <string>
// Persistent topology references (§3–§4): TNaming primary, role + semantic
// fallback second. Array indices are transient iteration values ONLY.
std::string MakeRoleRef(const std::string& featureId, const std::string& role);
