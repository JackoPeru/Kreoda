#pragma once

#include <string>
#include <vector>

#if KREODA_WITH_OCCT
// NOTE: OCCT includes must stay OUTSIDE namespace kreoda.
#include <TopoDS_Shape.hxx>
#endif

namespace kreoda {

// Hollow a solid with a constant wall thickness, removing the selected
// persistent face references (open faces). Face ids use the same full
// "<target>:<face role>" semantics as the direct-face features and re-resolve
// on every rebuild. Oversize thickness reports an actionable safe range.
bool CreateShellFeature(const std::string& featureId, const std::string& targetId,
                        const std::vector<std::string>& faceIds,
                        double thicknessMm, std::string* error);

bool RebuildShellFromStore(const std::string& featureId, std::string* error);

#if KREODA_WITH_OCCT
bool BuildShellShape(const TopoDS_Shape& target, const std::string& targetId,
                     const std::string& targetType,
                     const std::vector<std::string>& faceIds, double thickness,
                     TopoDS_Shape* out, std::string* error);
#endif

}  // namespace kreoda
