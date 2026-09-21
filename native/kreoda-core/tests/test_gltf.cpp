// glTF 2.0 mesh round-trip, Phase 8 (§61): box → .gltf+.bin → MeshImport
// feature with identical volume/bbox (meters convention both ways),
// tessellatable, one Undo step. A hand-wrapped .glb of our own export
// proves the GLB chunk path shares the strict reader.

#include <gtest/gtest.h>

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "../src/document/document_store.h"
#include "../src/exchange/gltf_exchange.h"
#include "../src/features/primitives/primitives.h"
#include "../src/model/shapes.h"
#include "../src/persistence/ocaf_live.h"
#include "../src/tessellation/mesh.h"

namespace fs = std::filesystem;

TEST(Gltf, ExportImportRoundTrip) {
  kreoda::DocumentStore::instance().create("gltf-test-doc");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("gltf-box", 100, 60, 10, &err))
      << err;

  const fs::path file =
      fs::temp_directory_path() / "kreoda-gltf-roundtrip.gltf";
  const fs::path bin =
      fs::temp_directory_path() / "kreoda-gltf-roundtrip.bin";
  std::error_code ec;
  fs::remove(file, ec);
  fs::remove(bin, ec);
  ASSERT_TRUE(kreoda::ExportGltf(file.string(), &err)) << err;
  EXPECT_TRUE(fs::exists(file));
  EXPECT_TRUE(fs::exists(bin));
  EXPECT_GT(fs::file_size(file, ec), 500u);
  EXPECT_GT(fs::file_size(bin, ec), 100u);

  // Fresh document, like OpenDocument: import replaces the model.
  kreoda::DocumentStore::instance().create("gltf-test-doc");
  std::vector<std::string> ids;
  ASSERT_TRUE(kreoda::ImportGltf(file.string(), &ids, &err)) << err;
  ASSERT_EQ(ids.size(), 1u);

  kreoda::ShapeRecord rec;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(ids[0], &rec));
  EXPECT_EQ(rec.type, "MeshImport");
  // Meters↔mm + float32 bin: exact for planar boxes, tolerant band kept.
  EXPECT_NEAR(rec.volumeMm3, 60000.0, 0.5);
  EXPECT_NEAR(rec.bboxMm[0], 0.0, 1e-3);
  EXPECT_NEAR(rec.bboxMm[1], 0.0, 1e-3);
  EXPECT_NEAR(rec.bboxMm[2], 0.0, 1e-3);
  EXPECT_NEAR(rec.bboxMm[3], 100.0, 1e-3);
  EXPECT_NEAR(rec.bboxMm[4], 60.0, 1e-3);
  EXPECT_NEAR(rec.bboxMm[5], 10.0, 1e-3);

  const kreoda::CoreMesh mesh =
      kreoda::TessellateFeature(ids[0], 1, &err);
  EXPECT_FALSE(mesh.indices.empty()) << err;
  EXPECT_FALSE(mesh.faces.empty());

  // One Undo step removes the whole import (single OCAF command).
  ASSERT_TRUE(kreoda::OcafLive::instance().Undo(&err)) << err;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains(ids[0]));
  ASSERT_TRUE(kreoda::OcafLive::instance().Redo(&err)) << err;
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains(ids[0]));

  fs::remove(file, ec);
  fs::remove(bin, ec);
}

TEST(Gltf, GlbExportImports) {
  kreoda::DocumentStore::instance().create("gltf-test-glb");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("gltf-glb-box", 100, 60, 10, &err))
      << err;
  const fs::path glb =
      fs::temp_directory_path() / "kreoda-gltf-export.glb";
  std::error_code ec;
  fs::remove(glb, ec);
  ASSERT_TRUE(kreoda::ExportGlb(glb.string(), &err)) << err;
  EXPECT_TRUE(fs::exists(glb));
  EXPECT_GT(fs::file_size(glb, ec), 500u);
  kreoda::DocumentStore::instance().create("gltf-test-glb");
  std::vector<std::string> ids;
  ASSERT_TRUE(kreoda::ImportGltf(glb.string(), &ids, &err)) << err;
  ASSERT_EQ(ids.size(), 1u);
  kreoda::ShapeRecord rec;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(ids[0], &rec));
  EXPECT_NEAR(rec.volumeMm3, 60000.0, 0.5);
  fs::remove(glb, ec);
}

TEST(Gltf, RejectsNonGltfHonestly) {  kreoda::DocumentStore::instance().create("gltf-test-bad");
  const fs::path file =
      fs::temp_directory_path() / "kreoda-gltf-bad.gltf";
  {
    std::ofstream f(file, std::ios::binary);
    f << "this is not json";
  }
  std::vector<std::string> ids;
  std::string err;
  EXPECT_FALSE(kreoda::ImportGltf(file.string(), &ids, &err));
  EXPECT_FALSE(err.empty());
  std::error_code ec;
  fs::remove(file, ec);
}

TEST(Gltf, EmptyDocumentExportFailsHonestly) {
  kreoda::DocumentStore::instance().create("gltf-test-empty");
  std::string err;
  EXPECT_FALSE(kreoda::ExportGltf(
      "C:\\Windows\\Temp\\kreoda-empty.gltf", &err));
  EXPECT_FALSE(err.empty());
}

namespace {

// Hand-built foreign glTF samples (Fase 1): pin the strict mesh profile the
// reader claims — external .bin vs data: URIs, uint16 vs uint32 indices,
// non-indexed soup, node matrix vs TRS — independent of our own writer.

// Unit-cube corners (glTF Y-up meters); kCubeIdx winds outward.
const float kCube[8][3] = {
    {0, 0, 0}, {1, 0, 0}, {1, 1, 0}, {0, 1, 0},
    {0, 0, 1}, {1, 0, 1}, {1, 1, 1}, {0, 1, 1},
};
const uint32_t kCubeIdx[36] = {
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5,
    0, 5, 4, 2, 3, 7, 2, 7, 6, 0, 4, 7, 0, 7, 3,
    1, 2, 6, 1, 6, 5,
};

void AppendF32(std::vector<uint8_t>* bin, float v) {
  uint8_t b[4];
  std::memcpy(b, &v, 4);
  bin->insert(bin->end(), b, b + 4);
}

void AppendU16LE(std::vector<uint8_t>* bin, uint16_t v) {
  bin->push_back(static_cast<uint8_t>(v & 0xFF));
  bin->push_back(static_cast<uint8_t>((v >> 8) & 0xFF));
}

void AppendU32LE(std::vector<uint8_t>* bin, uint32_t v) {
  for (int i = 0; i < 4; ++i)
    bin->push_back(static_cast<uint8_t>((v >> (8 * i)) & 0xFF));
}

void AppendCubePositions(std::vector<uint8_t>* bin) {
  for (const auto& p : kCube)
    for (float c : p) AppendF32(bin, c);
}

std::string Base64Encode(const std::vector<uint8_t>& in) {
  static const char* kA =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  for (size_t i = 0; i < in.size(); i += 3) {
    uint32_t n = static_cast<uint32_t>(in[i]) << 16;
    if (i + 1 < in.size()) n |= static_cast<uint32_t>(in[i + 1]) << 8;
    if (i + 2 < in.size()) n |= in[i + 2];
    out.push_back(kA[(n >> 18) & 63]);
    out.push_back(kA[(n >> 12) & 63]);
    out.push_back(i + 1 < in.size() ? kA[(n >> 6) & 63] : '=');
    out.push_back(i + 2 < in.size() ? kA[n & 63] : '=');
  }
  return out;
}

bool WriteBytes(const fs::path& p, const void* d, size_t n) {
  std::ofstream f(p, std::ios::binary);
  if (!f) return false;
  if (n > 0) f.write(static_cast<const char*>(d), static_cast<std::streamsize>(n));
  f.close();
  return !!f;
}

bool WriteText(const fs::path& p, const std::string& t) {
  return WriteBytes(p, t.data(), t.size());
}

std::string ReadText(const fs::path& p) {
  std::ifstream f(p, std::ios::binary);
  std::ostringstream ss;
  ss << f.rdbuf();
  return ss.str();
}

// First `"key":[a,b,c]` triple in writer JSON (POSITION min/max).
bool FirstTriple(const std::string& json, const char* key, double out[3]) {
  const std::string pat = std::string("\"") + key + "\":[";
  const size_t at = json.find(pat);
  if (at == std::string::npos) return false;
  const char* p = json.c_str() + at + pat.size();
  for (int i = 0; i < 3; ++i) {
    char* end = nullptr;
    out[i] = std::strtod(p, &end);
    if (end == p) return false;
    p = end;
    if (i < 2) {
      if (*p != ',') return false;
      ++p;
    }
  }
  return true;
}

size_t TriCount(const kreoda::CoreMesh& m) { return m.indices.size() / 3; }

}  // namespace

TEST(Gltf, RoundTripGeometryMetersYUp) {
  kreoda::DocumentStore::instance().create("gltf-test-rtup");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("gltf-rtup-box", 100, 60, 10, &err))
      << err;
  const size_t origTris =
      TriCount(kreoda::TessellateFeature("gltf-rtup-box", 1, &err));
  ASSERT_EQ(origTris, 12u) << err;

  const fs::path file = fs::temp_directory_path() / "kreoda-gltf-rtup.gltf";
  const fs::path bin = fs::temp_directory_path() / "kreoda-gltf-rtup.bin";
  std::error_code ec;
  fs::remove(file, ec);
  fs::remove(bin, ec);
  ASSERT_TRUE(kreoda::ExportGltf(file.string(), &err)) << err;

  // Meters + Y-up pinned on the file itself: 100mm -> 0.1m on X, the 10mm
  // model height rides glTF Y (third-party viewers upright).
  const std::string text = ReadText(file);
  double mn[3] = {0, 0, 0}, mx[3] = {0, 0, 0};
  ASSERT_TRUE(FirstTriple(text, "min", mn));
  ASSERT_TRUE(FirstTriple(text, "max", mx));
  EXPECT_NEAR(mx[0], 0.1, 1e-6);
  EXPECT_NEAR(mx[1], 0.01, 1e-6);
  EXPECT_NEAR(mn[2], -0.06, 1e-6);

  kreoda::DocumentStore::instance().create("gltf-test-rtup");
  std::vector<std::string> ids;
  ASSERT_TRUE(kreoda::ImportGltf(file.string(), &ids, &err)) << err;
  ASSERT_EQ(ids.size(), 1u);
  kreoda::ShapeRecord rec;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(ids[0], &rec));
  EXPECT_EQ(rec.type, "MeshImport");
  EXPECT_NEAR(rec.volumeMm3, 60000.0, 0.5);
  // Height is back on model Z after the Y-up -> Z-up import mapping.
  EXPECT_NEAR(rec.bboxMm[5] - rec.bboxMm[2], 10.0, 1e-3);
  const kreoda::CoreMesh back =
      kreoda::TessellateFeature(ids[0], 1, &err);
  EXPECT_EQ(TriCount(back), origTris) << err;

  fs::remove(file, ec);
  fs::remove(bin, ec);
}

TEST(Gltf, ImportExternalBinUint16MatrixKeepsOrder) {
  kreoda::DocumentStore::instance().create("gltf-test-ext16");
  const fs::path file = fs::temp_directory_path() / "kreoda-gltf-ext16.gltf";
  const std::string binName = "kreoda-gltf-ext16.bin";
  const fs::path binPath = fs::temp_directory_path() / binName;
  std::vector<uint8_t> bin;
  AppendCubePositions(&bin);  // 8 verts x 12B = 96B @0
  for (uint32_t i : kCubeIdx) AppendU16LE(&bin, static_cast<uint16_t>(i));
  ASSERT_EQ(bin.size(), 168u);
  // Two nodes sharing one mesh layout: file order must win, one feature
  // per solid. Node matrices translate +2m / +5m on X.
  const std::string json =
      std::string("{\"asset\":{\"version\":\"2.0\"},\"scene\":0,") +
      "\"scenes\":[{\"nodes\":[0,1]}],"
      "\"nodes\":["
      "{\"mesh\":0,\"matrix\":[1,0,0,0,0,1,0,0,0,0,1,0,2,0,0,1]},"
      "{\"mesh\":1,\"matrix\":[1,0,0,0,0,1,0,0,0,0,1,0,5,0,0,1]}],"
      "\"meshes\":["
      "{\"primitives\":[{\"attributes\":{\"POSITION\":0},\"indices\":1}]},"
      "{\"primitives\":[{\"attributes\":{\"POSITION\":0},\"indices\":1}]}],"
      "\"bufferViews\":["
      "{\"buffer\":0,\"byteOffset\":0,\"byteLength\":96},"
      "{\"buffer\":0,\"byteOffset\":96,\"byteLength\":72}],"
      "\"accessors\":["
      "{\"bufferView\":0,\"componentType\":5126,\"count\":8,\"type\":\"VEC3\"},"
      "{\"bufferView\":1,\"componentType\":5123,\"count\":36,\"type\":\"SCALAR\"}],"
      "\"buffers\":[{\"byteLength\":" +
      std::to_string(bin.size()) + ",\"uri\":\"" + binName + "\"}]}";
  ASSERT_TRUE(WriteBytes(binPath, bin.data(), bin.size()));
  ASSERT_TRUE(WriteText(file, json));

  std::vector<std::string> ids;
  std::string err;
  ASSERT_TRUE(kreoda::ImportGltf(file.string(), &ids, &err)) << err;
  ASSERT_EQ(ids.size(), 2u);
  kreoda::ShapeRecord r0, r1;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(ids[0], &r0));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(ids[1], &r1));
  EXPECT_EQ(r0.type, "MeshImport");
  EXPECT_EQ(r1.type, "MeshImport");
  EXPECT_NEAR(r0.volumeMm3, 1e9, 1e4);
  EXPECT_NEAR(r1.volumeMm3, 1e9, 1e4);
  // glTF (x+t,y,z)m -> model ((x+t)*1000,-z*1000,y*1000)mm. The two node
  // matrices translate +2m / +5m on X; both solids must land, and file
  // order wins (node 0 first): ids[0] is the +2m solid, ids[1] the +5m one.
  const double x0min = std::min(r0.bboxMm[0], r1.bboxMm[0]);
  const double x0max = std::max(r0.bboxMm[0], r1.bboxMm[0]);
  const double x1max = std::max(r0.bboxMm[3], r1.bboxMm[3]);
  EXPECT_NEAR(x0min, 2000.0, 1.0);
  EXPECT_NEAR(x0max, 5000.0, 1.0);
  EXPECT_NEAR(x1max, 6000.0, 1.0);
  EXPECT_NEAR(r0.bboxMm[0], 2000.0, 1.0);
  EXPECT_NEAR(r0.bboxMm[3], 3000.0, 1.0);
  EXPECT_NEAR(r1.bboxMm[0], 5000.0, 1.0);
  EXPECT_NEAR(r1.bboxMm[3], 6000.0, 1.0);

  std::error_code ec;
  fs::remove(file, ec);
  fs::remove(binPath, ec);
}

TEST(Gltf, RejectsSparseAndFloatIndices) {
  kreoda::DocumentStore::instance().create("gltf-test-rejectidx");
  std::vector<std::string> ids;
  std::string err;
  std::error_code ec;

  // Sparse POSITION: honestly rejected (never silently read as dense).
  {
    const fs::path file =
        fs::temp_directory_path() / "kreoda-gltf-sparse.gltf";
    const std::string binName = "kreoda-gltf-sparse.bin";
    std::vector<uint8_t> bin;
    AppendCubePositions(&bin);  // 96B @0
    for (uint32_t i : kCubeIdx) AppendU16LE(&bin, static_cast<uint16_t>(i));
    AppendU16LE(&bin, 0);  // sparse index payload @168 (2B)
    AppendF32(&bin, 0.0f);
    AppendF32(&bin, 0.0f);
    AppendF32(&bin, 0.0f);  // sparse value payload @170 (12B)
    ASSERT_EQ(bin.size(), 182u);
    const std::string json =
        std::string("{\"asset\":{\"version\":\"2.0\"},\"scene\":0,") +
        "\"scenes\":[{\"nodes\":[0]}],"
        "\"nodes\":[{\"mesh\":0}],"
        "\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},"
        "\"indices\":1}]}],"
        "\"bufferViews\":["
        "{\"buffer\":0,\"byteOffset\":0,\"byteLength\":96},"
        "{\"buffer\":0,\"byteOffset\":96,\"byteLength\":72},"
        "{\"buffer\":0,\"byteOffset\":168,\"byteLength\":2},"
        "{\"buffer\":0,\"byteOffset\":170,\"byteLength\":12}],"
        "\"accessors\":["
        "{\"bufferView\":0,\"componentType\":5126,\"count\":8,"
        "\"type\":\"VEC3\",\"sparse\":{\"count\":1,"
        "\"indices\":{\"bufferView\":2,\"componentType\":5123,\"count\":1},"
        "\"values\":{\"bufferView\":3}}},"
        "{\"bufferView\":1,\"componentType\":5123,\"count\":36,"
        "\"type\":\"SCALAR\"}],"
        "\"buffers\":[{\"byteLength\":" +
        std::to_string(bin.size()) + ",\"uri\":\"" + binName + "\"}]}";
    ASSERT_TRUE(
        WriteBytes(fs::temp_directory_path() / binName, bin.data(), bin.size()));
    ASSERT_TRUE(WriteText(file, json));
    EXPECT_FALSE(kreoda::ImportGltf(file.string(), &ids, &err));
    EXPECT_FALSE(err.empty());
    fs::remove(file, ec);
    fs::remove(fs::temp_directory_path() / binName, ec);
  }

  // Float indices: only uint16/uint32 SCALAR accepted.
  {
    const fs::path file =
        fs::temp_directory_path() / "kreoda-gltf-floatidx.gltf";
    const std::string binName = "kreoda-gltf-floatidx.bin";
    std::vector<uint8_t> bin;
    AppendCubePositions(&bin);
    for (uint32_t i : kCubeIdx) AppendU16LE(&bin, static_cast<uint16_t>(i));
    ASSERT_EQ(bin.size(), 168u);
    const std::string json =
        std::string("{\"asset\":{\"version\":\"2.0\"},\"scene\":0,") +
        "\"scenes\":[{\"nodes\":[0]}],"
        "\"nodes\":[{\"mesh\":0}],"
        "\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},"
        "\"indices\":1}]}],"
        "\"bufferViews\":["
        "{\"buffer\":0,\"byteOffset\":0,\"byteLength\":96},"
        "{\"buffer\":0,\"byteOffset\":96,\"byteLength\":72}],"
        "\"accessors\":["
        "{\"bufferView\":0,\"componentType\":5126,\"count\":8,\"type\":\"VEC3\"},"
        "{\"bufferView\":1,\"componentType\":5126,\"count\":36,"
        "\"type\":\"SCALAR\"}],"
        "\"buffers\":[{\"byteLength\":" +
        std::to_string(bin.size()) + ",\"uri\":\"" + binName + "\"}]}";
    ASSERT_TRUE(
        WriteBytes(fs::temp_directory_path() / binName, bin.data(), bin.size()));
    ASSERT_TRUE(WriteText(file, json));
    err.clear();
    EXPECT_FALSE(kreoda::ImportGltf(file.string(), &ids, &err));
    EXPECT_FALSE(err.empty());
    fs::remove(file, ec);
    fs::remove(fs::temp_directory_path() / binName, ec);
  }
}

TEST(Gltf, ImportDataUriUint32TRS) {
  kreoda::DocumentStore::instance().create("gltf-test-datauri");
  const fs::path file =
      fs::temp_directory_path() / "kreoda-gltf-datauri.gltf";
  std::vector<uint8_t> bin;
  AppendCubePositions(&bin);  // 96B @0
  for (uint32_t i : kCubeIdx) AppendU32LE(&bin, i);  // 144B @96
  ASSERT_EQ(bin.size(), 240u);
  // No "scenes": every node is a root. TRS = T([1,0,0]) * I * S(2):
  // unit cube -> [1,3]x[0,2]x[0,2]m.
  const std::string json =
      std::string("{\"asset\":{\"version\":\"2.0\"},") +
      "\"nodes\":[{\"mesh\":0,\"translation\":[1,0,0],"
      "\"rotation\":[0,0,0,1],\"scale\":[2,2,2]}],"
      "\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},"
      "\"indices\":1}]}],"
      "\"bufferViews\":["
      "{\"buffer\":0,\"byteOffset\":0,\"byteLength\":96},"
      "{\"buffer\":0,\"byteOffset\":96,\"byteLength\":144}],"
      "\"accessors\":["
      "{\"bufferView\":0,\"componentType\":5126,\"count\":8,\"type\":\"VEC3\"},"
      "{\"bufferView\":1,\"componentType\":5125,\"count\":36,\"type\":\"SCALAR\"}],"
      "\"buffers\":[{\"byteLength\":" +
      std::to_string(bin.size()) +
      ",\"uri\":\"data:application/octet-stream;base64," + Base64Encode(bin) +
      "\"}]}";
  ASSERT_TRUE(WriteText(file, json));

  std::vector<std::string> ids;
  std::string err;
  ASSERT_TRUE(kreoda::ImportGltf(file.string(), &ids, &err)) << err;
  ASSERT_EQ(ids.size(), 1u);
  kreoda::ShapeRecord rec;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(ids[0], &rec));
  EXPECT_EQ(rec.type, "MeshImport");
  EXPECT_NEAR(rec.volumeMm3, 8e9, 1e5);
  EXPECT_NEAR(rec.bboxMm[0], 1000.0, 1.0);
  EXPECT_NEAR(rec.bboxMm[3], 3000.0, 1.0);
  EXPECT_NEAR(rec.bboxMm[1], -2000.0, 1.0);
  EXPECT_NEAR(rec.bboxMm[5], 2000.0, 1.0);

  std::error_code ec;
  fs::remove(file, ec);
}

TEST(Gltf, ImportMinimalGlbNonIndexed) {
  kreoda::DocumentStore::instance().create("gltf-test-miniglb");
  const fs::path file = fs::temp_directory_path() / "kreoda-gltf-mini.glb";
  // Non-indexed soup: every 3 verts are one triangle; foreign NORMALs ride
  // along (count must match POSITION).
  std::vector<uint8_t> bin;
  for (uint32_t i : kCubeIdx)
    for (int k = 0; k < 3; ++k) AppendF32(&bin, kCube[i][k]);  // 432B @0
  for (int v = 0; v < 36; ++v) {
    AppendF32(&bin, 0.0f);
    AppendF32(&bin, 0.0f);
    AppendF32(&bin, 1.0f);
  }  // 432B @432
  ASSERT_EQ(bin.size(), 864u);
  const std::string json =
      std::string("{\"asset\":{\"version\":\"2.0\"},\"scene\":0,") +
      "\"scenes\":[{\"nodes\":[0]}],"
      "\"nodes\":[{\"mesh\":0,\"matrix\":[1,0,0,0,0,1,0,0,0,0,1,0,0,2,0,1]}],"
      "\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0,"
      "\"NORMAL\":1}}]}],"
      "\"bufferViews\":["
      "{\"buffer\":0,\"byteOffset\":0,\"byteLength\":432},"
      "{\"buffer\":0,\"byteOffset\":432,\"byteLength\":432}],"
      "\"accessors\":["
      "{\"bufferView\":0,\"componentType\":5126,\"count\":36,\"type\":\"VEC3\"},"
      "{\"bufferView\":1,\"componentType\":5126,\"count\":36,\"type\":\"VEC3\"}],"
      "\"buffers\":[{\"byteLength\":" +
      std::to_string(bin.size()) + "}]}";
  std::vector<uint8_t> glb;
  const size_t jsonPad = (4 - (json.size() % 4)) % 4;
  AppendU32LE(&glb, 0x46546C67u);
  AppendU32LE(&glb, 2u);
  AppendU32LE(&glb, static_cast<uint32_t>(12 + 8 + json.size() + jsonPad + 8 +
                                          bin.size()));
  AppendU32LE(&glb, static_cast<uint32_t>(json.size() + jsonPad));
  AppendU32LE(&glb, 0x4E4F534Au);
  glb.insert(glb.end(), json.begin(), json.end());
  glb.insert(glb.end(), jsonPad, ' ');
  AppendU32LE(&glb, static_cast<uint32_t>(bin.size()));
  AppendU32LE(&glb, 0x004E4942u);
  glb.insert(glb.end(), bin.begin(), bin.end());
  ASSERT_TRUE(WriteBytes(file, glb.data(), glb.size()));

  std::vector<std::string> ids;
  std::string err;
  ASSERT_TRUE(kreoda::ImportGltf(file.string(), &ids, &err)) << err;
  ASSERT_EQ(ids.size(), 1u);
  kreoda::ShapeRecord rec;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(ids[0], &rec));
  EXPECT_EQ(rec.type, "MeshImport");
  EXPECT_NEAR(rec.volumeMm3, 1e9, 1e4);
  // Node translation +2m on glTF Y lands on model +Z (upright).
  EXPECT_NEAR(rec.bboxMm[2], 2000.0, 1.0);
  EXPECT_NEAR(rec.bboxMm[5], 3000.0, 1.0);
  const kreoda::CoreMesh mesh = kreoda::TessellateFeature(ids[0], 1, &err);
  EXPECT_EQ(TriCount(mesh), 12u) << err;

  std::error_code ec;
  fs::remove(file, ec);
}
