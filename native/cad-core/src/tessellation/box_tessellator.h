#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "tessellation/mesh.h"

namespace intentcad {

struct BoxMesh {
  std::vector<float> positions;  // xyz * N, mm
  std::vector<float> normals;
  std::vector<uint32_t> indices;
  std::vector<FaceRangeDto> faces;
  double volumeMm3 = 0.0;
};

// Exact box tessellation (12 triangles). Replaced by BRepMesh_IncrementalMesh
// LODs (coarse/interactive/export) once OCCT is linked (§14).
BoxMesh TessellateBoxExact(double wMm, double hMm, double dMm);

}  // namespace intentcad
