#pragma once

#include <string>

#include "sketch_store.h"

#if KREODA_WITH_OCCT
// NOTE: OCCT includes must stay OUTSIDE namespace kreoda.
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#endif

namespace kreoda {

// Builds a planar face from a solved sketch (§21): entities → 3D edges via
// the plane frame → closed loops (greedy endpoint chaining) → outer wire +
// hole wires → BRepBuilderAPI_MakeFace. Rejects open/degenrate profiles (§41).
#if KREODA_WITH_OCCT
bool BuildFaceFromSketch(const SketchFeature& sketch, TopoDS_Face* out,
                         std::string* error);
#endif

// Sketch-local 2D point → 3D model point (mm) through the plane frame.
void SketchToModel(const SketchPlane& plane, double x, double y,
                   double out3[3]);

}  // namespace kreoda
