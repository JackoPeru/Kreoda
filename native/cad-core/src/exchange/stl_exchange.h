#pragma once

#include <string>
#include <vector>

namespace kreoda {

// STL exchange via OCCT DataExchange (DESTL_Provider), Phase 8 (§61).
// STL is unitless triangles: export writes binary STL of every solid
// (millimeters by convention, like the 3MF slice); import extracts the
// triangulation and sews it back into faceted "MeshImport" solids — the
// same shared path as 3MF (see sew.{h,cpp}). Parametric rebuild honestly
// refuses MeshImport. Without OCCT: honest errors.

bool ExportStl(const std::string& path, std::string* error);

// Reads STL triangles, sews closed shells into solids and commits one
// MeshImport feature per solid. Fills createdIds in file order.
bool ImportStl(const std::string& path, std::vector<std::string>* createdIds,
               std::string* error);

}  // namespace kreoda
