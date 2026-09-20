#pragma once

#include <string>
#include <vector>

#include "../model/shapes.h"

namespace intentcad {

// OCAF binary persistence (§30: document.xbf inside .icad).
// Thin wrappers over the live OCAF document (persistence/ocaf_live.h):
// the live doc owns labels + TNaming evolution, Save/Load serialize it.
bool SaveXbf(const std::string& xbfPath, std::string* error);
bool LoadXbf(const std::string& xbfPath, std::vector<ShapeRecord>* records,
             std::string* error);

}  // namespace intentcad
