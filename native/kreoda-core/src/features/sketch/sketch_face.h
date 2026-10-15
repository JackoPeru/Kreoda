#pragma once

#include <string>
#include <vector>

#include "sketch_store.h"

#if KREODA_WITH_OCCT
// NOTE: OCCT includes must stay OUTSIDE namespace kreoda.
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#endif

namespace kreoda {

#if KREODA_WITH_OCCT
// Builds native material regions from exact coplanar edges. Nested boundaries
// alternate material/hole by containment depth; disconnected regions compound.
bool BuildPlanarProfileFromEdges(const std::vector<TopoDS_Edge>& edges,
                                 const SketchPlane& plane,
                                 TopoDS_Shape* output, std::string* error);
bool BuildProfileFromSketch(const SketchFeature& sketch,
                            TopoDS_Shape* output, std::string* error);
bool BuildSketchEntityEdges(const SketchFeature& sketch,
                            const std::vector<std::string>& entityIds,
                            std::vector<TopoDS_Edge>* output,
                            std::string* error);
// Compatibility API: succeeds only when the sketch has exactly one region.
bool BuildFaceFromSketch(const SketchFeature& sketch, TopoDS_Face* out,
                         std::string* error);
#endif

// Sketch-local 2D point → 3D model point (mm) through the plane frame.
void SketchToModel(const SketchPlane& plane, double x, double y,
                   double out3[3]);

}  // namespace kreoda
