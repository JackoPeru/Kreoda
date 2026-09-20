#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "tessellation/mesh.h"

namespace intentcad {

// FlatBuffers mesh responses (Phase 8 §61 — mesh data must not be JSON).
// Builds a finished MeshUpdate buffer (framing stays [u32 len][payload]).
// Requires FlatBuffers (always present in the vcpkg build).
#if INTENTCAD_WITH_FLATBUFFERS
std::vector<uint8_t> BuildMeshUpdateFb(const std::string& featureId, int lod,
                                       const CoreMesh& mesh, int64_t revision,
                                       const std::string& requestId,
                                       std::string* error);
#endif

}  // namespace intentcad
