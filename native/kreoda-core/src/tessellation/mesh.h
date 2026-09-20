#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "../model/shapes.h"

namespace kreoda {

// Render-neutral mesh DTO (§67): core has no Three.js awareness.
// Binary float32 positions/normals + uint32 indices + persistent FaceRanges
// so a picked triangle maps back to a persistent CAD face (§14).
struct FaceRangeDto {
  std::string persistentFaceId;  // e.g. "<feat>:box.+Z" — never an index
  uint32_t triangleStart = 0;
  uint32_t triangleCount = 0;
};

struct EdgeRangeDto {
  std::string persistentEdgeId;  // e.g. "<feat>:edge.lin.box.+Z~box.+X"
  uint32_t vertexStart = 0;
  uint32_t vertexCount = 0;
};

struct CoreMesh {
  std::vector<float> positions;  // xyz * N, mm
  std::vector<float> normals;    // xyz * N
  std::vector<uint32_t> indices;
  std::vector<FaceRangeDto> faces;
  std::vector<float> edgeVertices;  // xyz polylines, mm (viewport overlay)
  std::vector<EdgeRangeDto> edges;
  double volumeMm3 = 0.0;
  double bboxMm[6] = {0, 0, 0, 0, 0, 0};
};

// LOD policy (§14): 0 = coarse/preview, 1 = interactive, 2 = export.
CoreMesh TessellateFeature(const std::string& featureId, int lod,
                           std::string* error);

// Tessellates an explicit record (no store lookup) — used by previews (§13).
CoreMesh TessellateRecord(const ShapeRecord& rec, int lod,
                          std::string* error);

}  // namespace kreoda
