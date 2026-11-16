#pragma once

#include <string>

#if KREODA_WITH_OCCT
#include <TopoDS_Shape.hxx>
#include <gp_Trsf.hxx>
#endif

namespace kreoda {

// Mirrored copy of a solid across a principal plane at the origin:
// XY (z=0), XZ (y=0) or YZ (x=0). The copy follows target edits through
// dependsOn, and is a normal editable body.
bool CreateMirrorFeature(const std::string& featureId,
                         const std::string& targetId,
                         const std::string& planeKind, std::string* error);

// DAG recompute step (features/rebuild.cpp calls this).
bool RebuildMirrorFromStore(const std::string& featureId, std::string* error);

#if KREODA_WITH_OCCT
bool BuildMirrorTransform(const std::string& planeKind, gp_Trsf* out,
                          std::string* error);
bool BuildMirrorShape(const TopoDS_Shape& target, const std::string& planeKind,
                      TopoDS_Shape* out, std::string* error);
#endif

}  // namespace kreoda
