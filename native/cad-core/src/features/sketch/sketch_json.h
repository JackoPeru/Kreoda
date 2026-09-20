#pragma once

#include <string>

#include "../../constraints/solver.h"
#include "sketch_store.h"

namespace intentcad {

// Minimal JSON (de)serialization for sketches — no external dep in core.
// The wire format mirrors the TS types (SketchModel JSON):
// {points:[{id,x,y,fixed?}], lines:[{id,p1,p2}], circles:[{id,center,r}],
//  arcs:[{id,center,r,startAngleRad,endAngleRad}], constraints:[{id,kind,refs,value?}]}
bool ParseSketchModel(const std::string& json, SketchModel* out,
                      std::string* error);
std::string SerializeSketchModel(const SketchModel& model);
std::string SerializeSketchFeature(const SketchFeature& sketch);
bool ParseSketchFeature(const std::string& json, SketchFeature* out,
                        std::string* error);

// Constraint kind names (wire): "coincident","horizontal","vertical",
// "parallel","perpendicular","equalRadius","concentric","distance",
// "radius","diameter","angle","pointOnLine","fixed".
bool ConstraintKindFromString(const std::string& s, SketchConstraintKind* out);
std::string ConstraintKindToString(SketchConstraintKind kind);

// Extracts a raw JSON value (object/array/string/number) for a top-level key.
// Returns false when the key is absent. Handles nested brackets + strings.
bool ExtractJsonValue(const std::string& json, const std::string& key,
                      std::string* rawOut);

}  // namespace intentcad
