#pragma once

#include <string>

#if KREODA_WITH_OCCT
#include <TopoDS_Shape.hxx>
#endif

namespace kreoda {

// Linear pattern: a new editable body containing `count` translated copies of
// a target solid along the global X, Y or Z axis. Negative spacing reverses
// the direction. Bounded to 2..64 copies and 100 m spacing.
bool CreateBodyPatternFeature(const std::string& featureId,
                              const std::string& targetId,
                              const std::string& axis, int count,
                              double spacingMm, std::string* error);

// DAG recompute step (features/rebuild.cpp calls this).
bool RebuildBodyPatternFromStore(const std::string& featureId,
                                 std::string* error);

#if KREODA_WITH_OCCT
bool BuildBodyPatternShape(const TopoDS_Shape& target, const std::string& axis,
                           int count, double spacingMm, TopoDS_Shape* out,
                           std::string* error);
#endif

}  // namespace kreoda
