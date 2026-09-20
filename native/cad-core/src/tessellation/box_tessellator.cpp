#include "box_tessellator.h"

namespace intentcad {

BoxMesh TessellateBoxExact(double wMm, double hMm, double dMm) {
  BoxMesh m;
  const float x0 = 0, y0 = 0, z0 = 0;
  const auto x1 = static_cast<float>(wMm);
  const auto y1 = static_cast<float>(hMm);
  const auto z1 = static_cast<float>(dMm);
  // 8 corners
  const float c[8][3] = {{x0, y0, z0}, {x1, y0, z0}, {x1, y1, z0}, {x0, y1, z0},
                         {x0, y0, z1}, {x1, y0, z1}, {x1, y1, z1}, {x0, y1, z1}};
  // 6 faces as quads with outward normals; each quad -> 2 triangles.
  const int quads[6][4] = {{0, 1, 2, 3}, {4, 6, 5, 7}, {0, 4, 5, 1},
                           {2, 6, 7, 3}, {0, 3, 7, 4}, {1, 5, 6, 2}};
  const float normals[6][3] = {{0, 0, -1}, {0, 0, 1},  {0, -1, 0},
                               {0, 1, 0},  {-1, 0, 0}, {1, 0, 0}};
  const char* names[6] = {"box.-Z", "box.+Z", "box.-Y",
                          "box.+Y", "box.-X", "box.+X"};
  for (int f = 0; f < 6; ++f) {
    const uint32_t base = static_cast<uint32_t>(m.positions.size() / 3);
    for (int k = 0; k < 4; ++k) {
      m.positions.insert(m.positions.end(), c[quads[f][k]],
                         c[quads[f][k]] + 3);
      m.normals.insert(m.normals.end(), normals[f], normals[f] + 3);
    }
    m.indices.insert(m.indices.end(),
                     {base, base + 1, base + 2, base, base + 2, base + 3});
    m.faces.push_back({names[f], static_cast<uint32_t>(f * 2), 2});
  }
  m.volumeMm3 = wMm * hMm * dMm;
  return m;
}

}  // namespace intentcad
