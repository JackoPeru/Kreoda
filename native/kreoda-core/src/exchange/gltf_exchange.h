#pragma once

#include <string>
#include <vector>

namespace kreoda {

// glTF 2.0 mesh exchange (cgltf reader + mesh-profile writer), Phase 8
// (§61). Units follow the glTF convention (meters); the model is
// millimeters, converted explicitly both ways. Z-up model data is stored
// Y-up per the glTF convention and converted back on import, so round-trips
// are exact and third-party viewers show the part upright.
//
// Writer: every solid → one mesh (POSITION + NORMAL + indexed TRIANGLES).
// Reader (strict mesh profile): non-interleaved float32 POSITION, optional
// NORMAL (else flat), uint16/uint32 indices (or non-indexed soup),
// node matrix/TRS transforms, external .bin or data: URIs, .gltf + .glb.
// Anything else fails honestly. Imported meshes sew into faceted
// "MeshImport" solids (shared path with STL/3MF/OBJ). Without OCCT: errors.

bool ExportGltf(const std::string& path, std::string* error);

// Binary GLB container of the same document (JSON + BIN chunks).
bool ExportGlb(const std::string& path, std::string* error);

// Reads glTF meshes, sews closed shells into solids and commits one
// MeshImport feature per solid. Fills createdIds in file order.
bool ImportGltf(const std::string& path, std::vector<std::string>* createdIds,
                std::string* error);

}  // namespace kreoda
