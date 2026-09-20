// FlatBuffers mesh responses (§61): binary MeshUpdate instead of base64 JSON.

#include "protocol/mesh_fb.h"

#if INTENTCAD_WITH_FLATBUFFERS
#include <flatbuffers/flatbuffers.h>

#include "protocol/generated/cad_protocol_generated.h"
#endif

namespace intentcad {

#if INTENTCAD_WITH_FLATBUFFERS
std::vector<uint8_t> BuildMeshUpdateFb(const std::string& featureId, int lod,
                                       const CoreMesh& mesh, int64_t revision,
                                       const std::string& requestId,
                                       std::string* error) {
  try {
    flatbuffers::FlatBufferBuilder fbb(1 << 20);
    const auto fid = fbb.CreateString(featureId);
    const auto bid = fbb.CreateString(featureId);  // bodies are 1:1 features
    const auto rid = fbb.CreateString(requestId);
    // Empty vectors must not pass possibly-null data() (minor): flatbuffers
    // tolerates null only via the sized overload carefully, so branch.
    auto bytesOf = [&fbb](const void* data, size_t bytes) {
      return bytes == 0
                 ? fbb.CreateVector(
                       static_cast<const uint8_t*>(nullptr), 0)
                 : fbb.CreateVector(static_cast<const uint8_t*>(data), bytes);
    };
    const auto pos = bytesOf(mesh.positions.data(),
                             mesh.positions.size() * sizeof(float));
    const auto nrm = bytesOf(mesh.normals.data(),
                             mesh.normals.size() * sizeof(float));
    const auto idx = bytesOf(mesh.indices.data(),
                             mesh.indices.size() * sizeof(uint32_t));
    const auto edges = bytesOf(mesh.edgeVertices.data(),
                               mesh.edgeVertices.size() * sizeof(float));
    std::vector<flatbuffers::Offset<IntentCad::Protocol::FaceRange>> faces;
    faces.reserve(mesh.faces.size());
    for (const auto& f : mesh.faces) {
      faces.push_back(IntentCad::Protocol::CreateFaceRange(
          fbb, fbb.CreateString(f.persistentFaceId), f.triangleStart,
          f.triangleCount));
    }
    std::vector<flatbuffers::Offset<IntentCad::Protocol::EdgeRange>> eranges;
    eranges.reserve(mesh.edges.size());
    for (const auto& e : mesh.edges) {
      eranges.push_back(IntentCad::Protocol::CreateEdgeRange(
          fbb, fbb.CreateString(e.persistentEdgeId), e.vertexStart,
          e.vertexCount));
    }
    const double bbox[6] = {mesh.bboxMm[0], mesh.bboxMm[1], mesh.bboxMm[2],
                            mesh.bboxMm[3], mesh.bboxMm[4], mesh.bboxMm[5]};
    const auto update = IntentCad::Protocol::CreateMeshUpdate(
        fbb, fid, bid, static_cast<int8_t>(lod), rid,
        static_cast<uint32_t>(mesh.positions.size()),
        static_cast<uint32_t>(mesh.normals.size()),
        static_cast<uint32_t>(mesh.indices.size()), pos, nrm, idx, edges,
        fbb.CreateVector(faces), fbb.CreateVector(eranges), mesh.volumeMm3,
        fbb.CreateVector(bbox, 6), revision);
    fbb.Finish(update);
    return std::vector<uint8_t>(fbb.GetBufferPointer(),
                                fbb.GetBufferPointer() + fbb.GetSize());
  } catch (const std::exception& e) {
    if (error) *error = std::string("mesh encode failed: ") + e.what();
    return {};
  }
}
#endif

}  // namespace intentcad
