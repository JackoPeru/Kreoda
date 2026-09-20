#pragma once

#include <string>
#include <vector>

namespace kreoda {

// OBJ exchange via OCCT DataExchange (DEOBJ_Provider), Phase 8 (§61).
// OBJ is unitless triangles: export pre-meshes every solid at export
// deflection (millimeters by convention); import extracts the triangulation
// and sews it back into faceted "MeshImport" solids — the shared path with
// STL/3MF (see sew.{h,cpp}). Parametric rebuild honestly refuses MeshImport.
// Without OCCT: honest errors.

bool ExportObj(const std::string& path, std::string* error);

// Reads OBJ triangles, sews closed shells into solids and commits one
// MeshImport feature per solid. Fills createdIds in file order.
bool ImportObj(const std::string& path, std::vector<std::string>* createdIds,
               std::string* error);

}  // namespace kreoda
