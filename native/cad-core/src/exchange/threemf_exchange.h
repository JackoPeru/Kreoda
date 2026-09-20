#pragma once

#include <string>
#include <vector>

namespace intentcad {

// 3MF exchange via lib3mf, Phase 8 (§61). Mesh-based round-trip at export LOD:
// every solid exports tessellated (millimeters) as one mesh object; every
// mesh object imports sewn back into a faceted "MeshImport" solid (one OCAF
// command = one Undo step). Parametric rebuild honestly refuses MeshImport.
// Without lib3mf (or without OCCT): both calls fail with an honest error.

bool ExportThreeMF(const std::string& path, std::string* error);

// Reads 3MF mesh objects, sews closed shells into solids and commits one
// MeshImport feature per solid. Fills createdIds in file order.
bool ImportThreeMF(const std::string& path, std::vector<std::string>* createdIds,
                   std::string* error);

}  // namespace intentcad
