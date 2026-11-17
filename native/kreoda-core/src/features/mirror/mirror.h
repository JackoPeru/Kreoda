#pragma once

#include <string>

#if KREODA_WITH_OCCT
#include <TopoDS_Shape.hxx>
#include <gp_Trsf.hxx>
#endif

namespace kreoda {

// Mirrored copy of a solid across a principal plane at the origin
// (XY, XZ, YZ) or an existing DatumPlane. Exactly one plane source is used;
// no source means XY. The copy follows target/datum edits through dependsOn
// and is a normal editable body.
bool CreateMirrorFeature(const std::string& featureId,
                         const std::string& targetId,
                         const std::string& planeKind,
                         const std::string& datumId, std::string* error);

// DAG recompute step (features/rebuild.cpp calls this).
bool RebuildMirrorFromStore(const std::string& featureId, std::string* error);

#if KREODA_WITH_OCCT
bool BuildMirrorTransform(const std::string& planeKind,
                          const std::string& datumId, gp_Trsf* out,
                          std::string* error);
bool BuildMirrorShape(const TopoDS_Shape& target, const std::string& planeKind,
                      const std::string& datumId, TopoDS_Shape* out,
                      std::string* error);
#endif

}  // namespace kreoda
