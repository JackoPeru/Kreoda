#pragma once

#include <string>

#if KREODA_WITH_OCCT
#include <TopoDS_Shape.hxx>
#endif

namespace kreoda {

// Circular pattern: a new editable body containing `count` copies rotated
// around a global X, Y or Z axis through the origin. A 360-degree pattern
// spaces all copies evenly; smaller angles include both endpoints.
bool CreateCircularBodyPatternFeature(const std::string& featureId,
                                      const std::string& targetId,
                                      const std::string& axis, int count,
                                      double totalAngleDeg, std::string* error);

// DAG recompute step (features/rebuild.cpp calls this).
bool RebuildCircularBodyPatternFromStore(const std::string& featureId,
                                         std::string* error);

#if KREODA_WITH_OCCT
bool BuildCircularBodyPatternShape(const TopoDS_Shape& target,
                                   const std::string& axis, int count,
                                   double totalAngleDeg, TopoDS_Shape* out,
                                   std::string* error);
#endif

}  // namespace kreoda
