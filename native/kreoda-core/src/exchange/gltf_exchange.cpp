// glTF 2.0 mesh-profile exchange (cgltf parser + shared sew path).

#include "exchange/gltf_exchange.h"

#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <memory>
#include <sstream>

#ifdef _MSC_VER
#pragma warning(push, 0)
#endif
// Single-header cgltf (vcpkg): JSON + GLB framing, base64 data URIs,
// external .bin loads. The strict mesh-profile gates stay ours (below).
#define CGLTF_IMPLEMENTATION
#include <cgltf.h>
#ifdef _MSC_VER
#pragma warning(pop)
#endif

#include "exchange/sew.h"
#include "model/shapes.h"
#include "tessellation/mesh.h"

#if KREODA_WITH_OCCT
#include <TopoDS_Shape.hxx>
#endif

namespace kreoda {

namespace {

bool ReadFileBytes(const std::string& path, std::vector<uint8_t>* out,
                   std::string* error) {
  // DoS bound (C9): never resize to an attacker's length prefix.
  constexpr size_t kMaxFileBytes = 512u * 1024u * 1024u;
  std::ifstream f(path, std::ios::binary | std::ios::ate);
  if (!f) {
    if (error) *error = "cannot open file: " + path;
    return false;
  }
  const std::streampos end = f.tellg();
  if (end < 0) {
    if (error) *error = "cannot stat file: " + path;
    return false;
  }
  if (static_cast<uint64_t>(end) > kMaxFileBytes) {
    if (error) *error = "file too large (over 512MB): " + path;
    return false;
  }
  f.seekg(0, std::ios::beg);
  out->resize(static_cast<size_t>(end));
  if (!out->empty() && !f.read(reinterpret_cast<char*>(out->data()),
                               static_cast<std::streamsize>(out->size()))) {
    if (error) *error = "cannot read file: " + path;
    return false;
  }
  return true;
}

// 4x4 column-major node transform (glTF `matrix`, TRS, or identity).
struct Mat4 {
  double m[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
};

// glTF Y-up meters → model Z-up mm (inverse of the writer mapping).
inline void ToModel(double x, double y, double z, float* ox, float* oy,
                    float* oz) {
  *ox = static_cast<float>(x * 1000.0);
  *oy = static_cast<float>(-z * 1000.0);
  *oz = static_cast<float>(y * 1000.0);
}

// ── cgltf reader (strict mesh profile, same contract as before) ──

// Context for bounded external .bin loads (C9 DoS bound preserved).
struct CgltfLoadCtx {
  std::string message;
};

cgltf_result CgltfReadFile(const cgltf_memory_options*,
                           const cgltf_file_options* fo, const char* path,
                           cgltf_size* size, void** data) {
  auto* ctx = static_cast<CgltfLoadCtx*>(fo ? fo->user_data : nullptr);
  const std::string p = path ? path : "";
  const cgltf_size declared = size ? *size : 0;
  std::vector<uint8_t> bytes;
  std::string err;
  // ReadFileBytes bounds the read (512MB) and names failures; pass through.
  if (!ReadFileBytes(p, &bytes, &err)) {
    if (ctx) ctx->message = err;
    return cgltf_result_io_error;
  }
  if (declared > bytes.size()) {
    if (ctx) ctx->message = "buffer shorter than byteLength";
    return cgltf_result_io_error;
  }
  void* mem = std::malloc(bytes.empty() ? 1 : bytes.size());
  if (!mem) return cgltf_result_out_of_memory;
  if (!bytes.empty()) std::memcpy(mem, bytes.data(), bytes.size());
  *size = static_cast<cgltf_size>(bytes.size());
  *data = mem;
  return cgltf_result_success;
}

void CgltfReleaseFile(const cgltf_memory_options*,
                      const cgltf_file_options*, void* data) {
  std::free(data);
}

// Local node matrix: glTF `matrix`, TRS, or identity (matrix wins, as before).
bool LocalMatrix(const cgltf_node* node, Mat4* out, std::string* error) {
  Mat4 m;
  if (node->has_matrix) {
    for (int i = 0; i < 16; ++i)
      m.m[i] = static_cast<double>(node->matrix[i]);
    *out = m;
    return true;
  }
  const double t[3] = {node->translation[0], node->translation[1],
                       node->translation[2]};
  double q[4] = {node->rotation[0], node->rotation[1], node->rotation[2],
                 node->rotation[3]};
  const double s[3] = {node->scale[0], node->scale[1], node->scale[2]};
  // Normalize the quaternion (M5): un-normalized input would skew R.
  {
    const double l = std::sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] +
                               q[3] * q[3]);
    if (!(l > 0) || !std::isfinite(l)) {
      if (error) *error = "glTF: node rotation is not a quaternion";
      return false;
    }
    q[0] /= l;
    q[1] /= l;
    q[2] /= l;
    q[3] /= l;
  }
  // quat → 3x3 (column-major), then T * R * S.
  const double x = q[0], y = q[1], z = q[2], w = q[3];
  const double r[9] = {
      1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)};
  for (int c = 0; c < 3; ++c)
    for (int rI = 0; rI < 3; ++rI)
      m.m[c * 4 + rI] = r[c * 3 + rI] * s[c];
  m.m[12] = t[0];
  m.m[13] = t[1];
  m.m[14] = t[2];
  *out = m;
  return true;
}

// Storage gate shared by POSITION and indices: the accessor range must fit
// its view, and the view must fit the loaded buffer. Loads are
// declared-capped (callback + data-URI prescan), so `buffer->size` is safe.
bool CheckAccessorStorage(const cgltf_accessor* acc, cgltf_size elem,
                          std::string* error) {
  if (acc->count == 0) {
    if (error) *error = "glTF: accessor with no elements";
    return false;
  }
  if (!acc->buffer_view) {
    if (error) *error = "glTF: accessor missing 'bufferView'";
    return false;
  }
  const cgltf_buffer_view* view = acc->buffer_view;
  if (!view->buffer || !view->buffer->data) {
    if (error) *error = "glTF: accessor reads past buffer end";
    return false;
  }
  // Strict profile: interleaved layouts rejected honestly.
  if (acc->stride != elem) {
    if (error) *error = "glTF: interleaved bufferViews unsupported";
    return false;
  }
  const double viewEnd =
      static_cast<double>(view->offset) + static_cast<double>(view->size);
  if (viewEnd > static_cast<double>(view->buffer->size)) {
    if (error) *error = "glTF: accessor reads past buffer end";
    return false;
  }
  const double need = static_cast<double>(acc->offset) +
                      static_cast<double>(acc->count - 1) *
                          static_cast<double>(acc->stride) +
                      static_cast<double>(elem);
  if (need > static_cast<double>(view->size)) {
    if (error) *error = "glTF: accessor reads past buffer end";
    return false;
  }
  return true;
}

// Strict POSITION gate: float32 VEC3, dense, non-normalized.
bool CheckPositions(const cgltf_accessor* acc, std::string* error) {
  if (!acc) {
    if (error) *error = "glTF: primitive without POSITION";
    return false;
  }
  if (acc->type != cgltf_type_vec3) {
    if (error) *error = "glTF: accessor must be VEC3";
    return false;
  }
  if (acc->component_type != cgltf_component_type_r_32f) {
    if (error) *error = "glTF: unsupported componentType (float/u16/u32 only)";
    return false;
  }
  if (acc->normalized) {
    if (error) *error = "glTF: normalized accessors unsupported";
    return false;
  }
  if (acc->is_sparse) {
    if (error) *error = "glTF: sparse accessors unsupported";
    return false;
  }
  return CheckAccessorStorage(acc, 12, error);
}

// Strict index gate: uint16/uint32 SCALAR, dense, non-normalized.
bool CheckIndices(const cgltf_accessor* acc, std::string* error) {
  if (!acc) {
    if (error) *error = "glTF: bad indices accessor";
    return false;
  }
  if (acc->type != cgltf_type_scalar) {
    if (error) *error = "glTF: accessor must be SCALAR";
    return false;
  }
  const bool isU16 = (acc->component_type == cgltf_component_type_r_16u);
  const bool isU32 = (acc->component_type == cgltf_component_type_r_32u);
  if (!isU16 && !isU32) {
    if (error) *error = "glTF: unsupported componentType (float/u16/u32 only)";
    return false;
  }
  if (acc->normalized) {
    if (error) *error = "glTF: normalized accessors unsupported";
    return false;
  }
  if (acc->is_sparse) {
    if (error) *error = "glTF: sparse accessors unsupported";
    return false;
  }
  return CheckAccessorStorage(acc, isU16 ? 2 : 4, error);
}

}  // namespace

#if KREODA_WITH_OCCT
namespace {

// Column-major 4x4 product (glTF node hierarchy, C7).
Mat4 MulMat4(const Mat4& a, const Mat4& b) {
  Mat4 o;
  for (int c = 0; c < 4; ++c) {
    for (int r = 0; r < 4; ++r) {
      o.m[c * 4 + r] = a.m[r] * b.m[c * 4] + a.m[4 + r] * b.m[c * 4 + 1] +
                       a.m[8 + r] * b.m[c * 4 + 2] +
                       a.m[12 + r] * b.m[c * 4 + 3];
    }
  }
  return o;
}

// Pre-order DFS with a hierarchy guard (glTF forbids cycles, but hostile
// files should error, not recurse forever). File order: meshes commit in
// the order their nodes appear, per the createdIds contract.
bool VisitNode(const cgltf_node* node, const Mat4& parentWorld, int depth,
               std::vector<std::pair<Mat4, const cgltf_mesh*>>* out,
               std::string* error) {
  if (depth > 64) {
    if (error) *error = "glTF: node hierarchy too deep";
    return false;
  }
  Mat4 local;
  // LocalMatrix prefixes its own errors; pass through.
  if (!LocalMatrix(node, &local, error)) return false;
  const Mat4 world = MulMat4(parentWorld, local);
  if (node->mesh) out->emplace_back(world, node->mesh);
  for (cgltf_size i = 0; i < node->children_count; ++i) {
    if (!node->children[i]) {
      if (error) *error = "glTF: bad child index";
      return false;
    }
    if (!VisitNode(node->children[i], world, depth + 1, out, error)) {
      return false;
    }
  }
  return true;
}

// One (world, mesh) pair sewn into model-space soup (mm, Z-up).
bool ReadMeshNode(const cgltf_mesh* mesh, const Mat4& world,
                  std::vector<float>* verts, std::vector<uint32_t>* indices,
                  std::string* error) {
  if (!mesh || mesh->primitives_count == 0) {
    if (error) *error = "glTF: mesh without primitives";
    return false;
  }
  const Mat4 xf = world;
  auto xPoint = [&](double x, double y, double z, float* o) {
    // Column-major 4x4, then Y-up/m → Z-up/mm.
    const double wx = xf.m[0] * x + xf.m[4] * y + xf.m[8] * z + xf.m[12];
    const double wy = xf.m[1] * x + xf.m[5] * y + xf.m[9] * z + xf.m[13];
    const double wz = xf.m[2] * x + xf.m[6] * y + xf.m[10] * z + xf.m[14];
    ToModel(wx, wy, wz, o, o + 1, o + 2);
  };
  for (cgltf_size pi = 0; pi < mesh->primitives_count; ++pi) {
    const cgltf_primitive& prim = mesh->primitives[pi];
    if (prim.type != cgltf_primitive_type_triangles) {
      if (error) *error = "glTF: only triangle meshes (mode 4) supported";
      return false;
    }
    const cgltf_accessor* pos =
        cgltf_find_accessor(&prim, cgltf_attribute_type_position, 0);
    if (!CheckPositions(pos, error)) return false;
    const cgltf_accessor* nrm =
        cgltf_find_accessor(&prim, cgltf_attribute_type_normal, 0);
    if (nrm) {
      // Validated like POSITION (count must match); values stay unused —
      // sewn solids tessellate their own normals, as before.
      if (!CheckPositions(nrm, error)) return false;
      if (nrm->count != pos->count) {
        if (error) *error = "glTF: POSITION/NORMAL count mismatch";
        return false;
      }
    }
    const uint32_t base = static_cast<uint32_t>(verts->size() / 3);
    for (cgltf_size i = 0; i < pos->count; ++i) {
      cgltf_float p[3] = {0, 0, 0};
      if (!cgltf_accessor_read_float(pos, i, p, 3)) {
        if (error) *error = "glTF: accessor reads past buffer end";
        return false;
      }
      float o[3];
      xPoint(p[0], p[1], p[2], o);
      verts->insert(verts->end(), {o[0], o[1], o[2]});
    }
    if (prim.indices) {
      if (!CheckIndices(prim.indices, error)) return false;
      if (prim.indices->count % 3 != 0) {
        if (error) *error = "glTF: index count not a multiple of 3";
        return false;
      }
      for (cgltf_size i = 0; i < prim.indices->count; ++i) {
        const cgltf_size v = cgltf_accessor_read_index(prim.indices, i);
        if (v >= pos->count) {
          if (error) *error = "glTF: index out of range";
          return false;
        }
        indices->push_back(base + static_cast<uint32_t>(v));
      }
    } else {
      // Non-indexed soup: every three vertices are one triangle.
      if (pos->count % 3 != 0) {
        if (error) *error = "glTF: vertex count not a multiple of 3";
        return false;
      }
      for (cgltf_size i = 0; i < pos->count; ++i)
        indices->push_back(base + static_cast<uint32_t>(i));
    }
  }
  return true;
}

}  // namespace
#endif

#if KREODA_WITH_OCCT
namespace {

// Shared .gltf/.glb document builder (minor: .glb write removes the
// asymmetry of read-only GLB). Tessellated blocks + JSON text; callers add
// the container (.bin sidecar vs GLB chunks).
struct Block {
  std::string name;
  size_t nv = 0;
  size_t nt = 0;
  size_t posOff = 0;
  size_t nrmOff = 0;
  size_t idxOff = 0;
  float pmin[3] = {1e30f, 1e30f, 1e30f};
  float pmax[3] = {-1e30f, -1e30f, -1e30f};
};

struct TessMesh {
  std::string name;
  CoreMesh mesh;
};

bool CollectTessellated(std::vector<TessMesh>* out, std::string* error) {
  std::vector<std::string> skipped;
  for (const ShapeRecord& rec : ShapeStore::instance().listInOrder()) {
    if (rec.shape.IsNull()) continue;
    std::string terr;
    CoreMesh mesh = TessellateRecord(rec, 2, &terr);
    // Fail LOUD on partial export (M6): a file missing a body with an "ok"
    // status is silent corruption — name the bodies instead.
    if (mesh.indices.empty() || mesh.positions.empty()) {
      skipped.push_back(rec.featureId);
      continue;
    }
    out->push_back({rec.featureId + " " + rec.type, std::move(mesh)});
  }
  if (!skipped.empty()) {
    if (error) {
      *error = "cannot tessellate for export: " + skipped[0];
      for (size_t i = 1; i < skipped.size(); ++i)
        *error += ", " + skipped[i];
    }
    return false;
  }
  if (out->empty()) {
    if (error) *error = "nothing to export: the document has no solids";
    return false;
  }
  return true;
}

void FillBlocks(const std::vector<TessMesh>& meshes, std::vector<Block>* blocks,
                std::vector<uint8_t>* bin) {
  for (const TessMesh& src : meshes) {
    const CoreMesh& m = src.mesh;
    Block b;
    b.name = src.name;
    b.nv = m.positions.size() / 3;
    b.nt = m.indices.size() / 3;
    b.posOff = bin->size();
    for (size_t v = 0; v < b.nv; ++v) {
      const float p[3] = {m.positions[v * 3] / 1000.0f,
                          m.positions[v * 3 + 2] / 1000.0f,
                          -m.positions[v * 3 + 1] / 1000.0f};
      for (int k = 0; k < 3; ++k) {
        b.pmin[k] = std::min(b.pmin[k], p[k]);
        b.pmax[k] = std::max(b.pmax[k], p[k]);
        const uint8_t* by = reinterpret_cast<const uint8_t*>(&p[k]);
        bin->insert(bin->end(), by, by + 4);
      }
    }
    b.nrmOff = bin->size();
    for (size_t v = 0; v < b.nv; ++v) {
      const float n[3] = {m.normals[v * 3], m.normals[v * 3 + 2],
                          -m.normals[v * 3 + 1]};
      for (int k = 0; k < 3; ++k) {
        const uint8_t* by = reinterpret_cast<const uint8_t*>(&n[k]);
        bin->insert(bin->end(), by, by + 4);
      }
    }
    b.idxOff = bin->size();
    for (size_t t = 0; t < b.nt * 3; ++t) {
      const uint32_t id = m.indices[t];
      const uint8_t* by = reinterpret_cast<const uint8_t*>(&id);
      bin->insert(bin->end(), by, by + 4);
    }
    blocks->push_back(std::move(b));
  }
}

void EscapeJsonString(const std::string& in, std::ostringstream* out) {
  for (char c : in) {
    if (c == '"' || c == '\\') {
      *out << '\\';
      *out << c;
    } else if (static_cast<unsigned char>(c) < 0x20) {
      continue;  // controls never belong in names; drop, don't emit
    } else {
      *out << c;
    }
  }
}

// binUri empty → GLB-style buffer entry (no uri); else .gltf with uri.
std::string BuildJsonText(const std::vector<Block>& blocks,
                          const std::vector<uint8_t>& bin,
                          const std::string& binUri) {
  std::ostringstream json;
  json << std::setprecision(9);
  json << "{\"asset\":{\"version\":\"2.0\",\"generator\":\"Kreoda\"},";
  json << "\"scene\":0,\"scenes\":[{\"nodes\":[";
  for (size_t i = 0; i < blocks.size(); ++i) json << (i ? "," : "") << i;
  json << "]}],\"nodes\":[";
  for (size_t i = 0; i < blocks.size(); ++i) {
    json << (i ? "," : "") << "{\"mesh\":" << i << ",\"name\":\"";
    EscapeJsonString(blocks[i].name, &json);
    json << "\"}";
  }
  json << "],\"meshes\":[";
  for (size_t i = 0; i < blocks.size(); ++i) {
    json << (i ? "," : "") << "{\"name\":\"mesh" << i
         << "\",\"primitives\":[{\"attributes\":{\"POSITION\":" << i * 3
         << ",\"NORMAL\":" << i * 3 + 1 << "},\"indices\":" << i * 3 + 2
         << "}]}";
  }
  json << "],\"bufferViews\":[";
  for (size_t i = 0; i < blocks.size(); ++i) {
    const Block& b = blocks[i];
    json << (i ? "," : "")
         << "{\"buffer\":0,\"byteOffset\":" << b.posOff << ",\"byteLength\":"
         << b.nv * 12 << ",\"target\":34962}"
         << ",{\"buffer\":0,\"byteOffset\":" << b.nrmOff << ",\"byteLength\":"
         << b.nv * 12 << ",\"target\":34962}"
         << ",{\"buffer\":0,\"byteOffset\":" << b.idxOff << ",\"byteLength\":"
         << b.nt * 12 << ",\"target\":34963}";
  }
  json << "],\"accessors\":[";
  for (size_t i = 0; i < blocks.size(); ++i) {
    const Block& b = blocks[i];
    json << (i ? "," : "")
         << "{\"bufferView\":" << i * 3 << ",\"componentType\":5126"
         << ",\"count\":" << b.nv << ",\"type\":\"VEC3\""
         << ",\"min\":[" << b.pmin[0] << "," << b.pmin[1] << "," << b.pmin[2]
         << "]"
         << ",\"max\":[" << b.pmax[0] << "," << b.pmax[1] << "," << b.pmax[2]
         << "]}"
         << ",{\"bufferView\":" << i * 3 + 1 << ",\"componentType\":5126"
         << ",\"count\":" << b.nv << ",\"type\":\"VEC3\"}"
         << ",{\"bufferView\":" << i * 3 + 2 << ",\"componentType\":5125"
         << ",\"count\":" << b.nt * 3 << ",\"type\":\"SCALAR\"}";
  }
  json << "],\"buffers\":[{\"byteLength\":" << bin.size();
  if (!binUri.empty()) {
    json << ",\"uri\":\"";
    EscapeJsonString(binUri, &json);
    json << "\"";
  }
  json << "}]}";
  return json.str();
}

bool WriteBytes(const std::string& path, const void* data, size_t n,
                std::string* error) {
  std::ofstream f(path, std::ios::binary);
  if (!f) {
    if (error) *error = "cannot write file: " + path;
    return false;
  }
  if (n > 0) {
    f.write(static_cast<const char*>(data), static_cast<std::streamsize>(n));
  }
  f.close();
  if (!f) {
    if (error) *error = "cannot write file: " + path;
    return false;
  }
  return true;
}

std::string StemOf(const std::string& path) {
  const size_t dot = path.find_last_of('.');
  const size_t sep = path.find_last_of("/\\");
  if (dot != std::string::npos && (sep == std::string::npos || dot > sep)) {
    return path.substr(0, dot);
  }
  return path;
}

}  // namespace
#endif

bool ExportGltf(const std::string& path, std::string* error) {
#if KREODA_WITH_OCCT
  if (path.empty()) {
    if (error) *error = "path is required";
    return false;
  }
  // Tessellate first (also validates the doc has solids) — exact errors.
  std::vector<TessMesh> meshes;
  if (!CollectTessellated(&meshes, error)) return false;
  try {
    // .bin sidecar next to the .gltf (same stem).
    const std::string binPath = StemOf(path) + ".bin";
    const size_t binSep = binPath.find_last_of("/\\");
    const std::string binName =
        binSep == std::string::npos ? binPath : binPath.substr(binSep + 1);
    // Model Z-up mm → glTF Y-up m: (x, y, z) → (x/1000, z/1000, −y/1000).
    std::vector<Block> blocks;
    std::vector<uint8_t> bin;
    FillBlocks(meshes, &blocks, &bin);
    const std::string text = BuildJsonText(blocks, bin, binName);
    if (!WriteBytes(binPath, bin.data(), bin.size(), error)) return false;
    if (!WriteBytes(path, text.data(), text.size(), error)) return false;
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("glTF export failed: ") + f.what();
    return false;
  }
#else
  (void)path;
  if (error) *error = "glTF export requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool ExportGlb(const std::string& path, std::string* error) {
#if KREODA_WITH_OCCT
  if (path.empty()) {
    if (error) *error = "path is required";
    return false;
  }
  std::vector<TessMesh> meshes;
  if (!CollectTessellated(&meshes, error)) return false;
  try {
    std::vector<Block> blocks;
    std::vector<uint8_t> bin;
    FillBlocks(meshes, &blocks, &bin);
    const std::string text = BuildJsonText(blocks, bin, "");
    // GLB container: 12-byte header + JSON chunk + BIN chunk, chunk
    // payloads 4-byte padded (spaces for JSON, zeros for BIN).
    const size_t jsonPad = (4 - (text.size() % 4)) % 4;
    const size_t binPad = (4 - (bin.size() % 4)) % 4;
    const uint32_t total = static_cast<uint32_t>(
        12 + 8 + text.size() + jsonPad + 8 + bin.size() + binPad);
    std::vector<uint8_t> out;
    out.reserve(total);
    auto put32 = [&](uint32_t v) {
      out.push_back(static_cast<uint8_t>(v & 0xFF));
      out.push_back(static_cast<uint8_t>((v >> 8) & 0xFF));
      out.push_back(static_cast<uint8_t>((v >> 16) & 0xFF));
      out.push_back(static_cast<uint8_t>((v >> 24) & 0xFF));
    };
    put32(0x46546C67);
    put32(2);
    put32(total);
    put32(static_cast<uint32_t>(text.size() + jsonPad));
    put32(0x4E4F534A);
    out.insert(out.end(), text.begin(), text.end());
    out.insert(out.end(), jsonPad, ' ');
    put32(static_cast<uint32_t>(bin.size() + binPad));
    put32(0x004E4942);
    out.insert(out.end(), bin.begin(), bin.end());
    out.insert(out.end(), binPad, 0);
    if (!WriteBytes(path, out.data(), out.size(), error)) return false;
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("GLB export failed: ") + f.what();
    return false;
  }
#else
  (void)path;
  if (error) *error = "GLB export requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool ImportGltf(const std::string& path, std::vector<std::string>* createdIds,
                std::string* error) {
#if KREODA_WITH_OCCT
  if (path.empty()) {
    if (error) *error = "path is required";
    return false;
  }
  if (!createdIds) {
    if (error) *error = "internal error: null out-param";
    return false;
  }
  // Parse with cgltf (JSON + GLB framing, strict mesh profile below).
  bool isGlb = false;
  {
    std::string lower = path;
    for (char& c : lower) c = static_cast<char>(std::tolower(c));
    isGlb = lower.size() >= 4 && lower.compare(lower.size() - 4, 4, ".glb") == 0;
  }
  // Load the document itself (bounded, C9); buffers stream via callback.
  std::vector<uint8_t> bytes;
  if (!ReadFileBytes(path, &bytes, error)) {
    if (error) *error = "glTF: " + *error;
    return false;
  }
  cgltf_options options = {};
  options.type = isGlb ? cgltf_file_type_glb : cgltf_file_type_gltf;
  CgltfLoadCtx loadCtx;
  options.file.user_data = &loadCtx;
  options.file.read = &CgltfReadFile;
  options.file.release = &CgltfReleaseFile;
  cgltf_data* raw = nullptr;
  const void* docBytes =
      bytes.empty() ? static_cast<const void*>("") : bytes.data();
  const cgltf_result parsed =
      cgltf_parse(&options, docBytes, bytes.size(), &raw);
  if (parsed != cgltf_result_success || !raw) {
    if (error) {
      switch (parsed) {
        case cgltf_result_legacy_gltf:
          *error = "glTF: only 2.x assets supported";
          break;
        case cgltf_result_data_too_short:
          *error = isGlb ? "glTF: truncated GLB header" : "glTF: invalid JSON";
          break;
        case cgltf_result_invalid_json:
        case cgltf_result_unknown_format:
          *error = isGlb ? "glTF: bad GLB header (magic/version/length)"
                          : "glTF: invalid JSON";
          break;
        default:
          *error = "glTF: cannot parse asset";
          break;
      }
    }
    return false;
  }
  std::unique_ptr<cgltf_data, decltype(&cgltf_free)> data(raw, &cgltf_free);
  if (!data->asset.version ||
      std::strncmp(data->asset.version, "2.", 2) != 0) {
    if (error) *error = "glTF: only 2.x assets supported";
    return false;
  }
  if (data->buffers_count == 0) {
    if (error) *error = "glTF: no buffers";
    return false;
  }
  // Strict container gates (same honesty as before): one BIN for GLB,
  // base64-only data URIs, no directory escape, no uri-less .gltf buffers.
  // Declared byteLength is capped by actual bytes (data URIs here, external
  // files inside the read callback) so cgltf never reads past a buffer.
  if (isGlb && data->buffers_count > 1) {
    if (error) *error = "glTF: multi-buffer GLB unsupported";
    return false;
  }
  for (cgltf_size bi = 0; bi < data->buffers_count; ++bi) {
    const char* uri = data->buffers[bi].uri;
    if (isGlb) {
      // One BIN chunk serves buffer 0; anything else would alias it.
      if (uri) {
        if (error) *error = "glTF: multi-buffer GLB unsupported";
        return false;
      }
      continue;
    }
    if (!uri) {
      if (error) *error = "glTF: buffer without uri (GLB?)";
      return false;
    }
    if (std::strncmp(uri, "data:", 5) == 0) {
      const char* comma = std::strchr(uri, ',');
      if (!comma || !std::strstr(uri, ";base64,")) {
        if (error) *error = "glTF: only base64 data URIs supported";
        return false;
      }
      const char* payload = comma + 1;
      const size_t b64len = std::strlen(payload);
      size_t decoded = (b64len / 4) * 3;
      size_t tail = b64len;
      while (tail > 0 && payload[tail - 1] == '=') {
        if (decoded == 0) break;
        --decoded;
        --tail;
      }
      if (data->buffers[bi].size > static_cast<cgltf_size>(decoded)) {
        if (error) *error = "glTF: buffer shorter than byteLength";
        return false;
      }
      continue;
    }
    // External file: stay inside the document directory (no traversal).
    if (std::strstr(uri, "..") != nullptr) {
      if (error) *error = "glTF: buffer path escapes document directory";
      return false;
    }
  }
  if (cgltf_load_buffers(&options, data.get(), path.c_str()) !=
      cgltf_result_success) {
    if (error) {
      *error = loadCtx.message.empty() ? "glTF: cannot load buffers"
                                       : "glTF: " + loadCtx.message;
    }
    return false;
  }
  if (data->nodes_count == 0) {
    if (error) *error = "glTF: no nodes";
    return false;
  }
  // Scene traversal (C7): pre-order DFS from scene roots in file order,
  // threading parent→child world transforms. Nested meshes land in world
  // space; nothing is silently dropped.
  std::vector<const cgltf_node*> roots;
  if (data->scenes_count > 0) {
    const cgltf_scene* scene = data->scene ? data->scene : &data->scenes[0];
    if (scene->nodes_count > 0) {
      for (cgltf_size i = 0; i < scene->nodes_count; ++i) {
        if (!scene->nodes[i]) {
          if (error) *error = "glTF: bad scene node index";
          return false;
        }
        roots.push_back(scene->nodes[i]);
      }
    } else {
      for (cgltf_size i = 0; i < data->nodes_count; ++i)
        roots.push_back(&data->nodes[i]);
    }
  } else {
    for (cgltf_size i = 0; i < data->nodes_count; ++i)
      roots.push_back(&data->nodes[i]);
  }
  std::vector<std::pair<Mat4, const cgltf_mesh*>> nodeMeshes;  // (world, mesh)
  {
    const Mat4 identity;
    for (const cgltf_node* root : roots) {
      if (!root) {
        if (error) *error = "glTF: bad scene node index";
        return false;
      }
      // VisitNode prefixes its own errors; pass through.
      if (!VisitNode(root, identity, 0, &nodeMeshes, error)) return false;
    }
  }
  if (nodeMeshes.empty()) {
    if (error) *error = "glTF: scene has no meshes";
    return false;
  }
  std::vector<TopoDS_Shape> solids;
  for (const auto& nm : nodeMeshes) {
    std::vector<float> verts;
    std::vector<uint32_t> indices;
    // ReadMeshNode prefixes its own errors; pass through.
    if (!ReadMeshNode(nm.second, nm.first, &verts, &indices, error)) {
      return false;
    }
    if (!SewTrianglesToSolids(verts, indices, &solids, error)) {
      if (error) *error = "glTF: " + *error;
      return false;
    }
  }
  if (solids.empty()) {
    if (error) *error = "glTF: no closed solids";
    return false;
  }
  // One OCAF command for the whole import (shared helper).
  if (!CommitImportedSolids(solids, "MeshImport", "gltf-", createdIds, error)) {
    return false;
  }
  return true;
#else
  (void)path;
  (void)createdIds;
  if (error) *error = "glTF import requires OCCT (link via vcpkg)";
  return false;
#endif
}

}  // namespace kreoda
