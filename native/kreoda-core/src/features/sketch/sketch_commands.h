#pragma once

#include <string>

#include "sketch_store.h"

namespace kreoda {

// Sketch CRUD with solve-before-commit (§21, §41).
// Every mutation solves first; unsolvable edits are rejected with the
// solver's conflicting constraint ids — the stored sketch never holds
// inconsistent coordinates.
bool CreateSketchFeature(const std::string& sketchId,
                         const std::string& planeKind,
                         const SketchModel& model, std::string* error);
bool UpdateSketchFeature(const std::string& sketchId,
                         const SketchModel& model, std::string* error);

// Full-replace used by open/resync paths (model already validated).
bool PutSketchDirect(const SketchFeature& sketch);

}  // namespace kreoda
