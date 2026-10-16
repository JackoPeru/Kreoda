#pragma once

#include <string>
#include <vector>

#include "sketch_store.h"

#if KREODA_WITH_OCCT
#include <TopoDS_Edge.hxx>
#include <TopoDS_Shape.hxx>

namespace kreoda {

bool ProjectNativeEdgesToPlane(const std::vector<TopoDS_Edge>& source,
                               const SketchPlane& target,
                               std::vector<TopoDS_Edge>* output,
                               std::string* error);

bool ProjectNativeSilhouetteToPlane(const TopoDS_Shape& source,
                                    const SketchPlane& target,
                                    std::vector<TopoDS_Edge>* output,
                                    std::string* error);

bool IntersectNativeShapeWithPlane(const TopoDS_Shape& source,
                                   const SketchPlane& target,
                                   std::vector<TopoDS_Edge>* output,
                                   std::string* error);

}  // namespace kreoda
#endif
