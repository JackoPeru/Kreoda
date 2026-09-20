// glTF 2.0 mesh round-trip, Phase 8 (§61): box → .gltf+.bin → MeshImport
// feature with identical volume/bbox (meters convention both ways),
// tessellatable, one Undo step. A hand-wrapped .glb of our own export
// proves the GLB chunk path shares the strict reader.

#include <gtest/gtest.h>

#include <filesystem>
#include <fstream>
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
  intentcad::DocumentStore::instance().create("gltf-test-doc");
  std::string err;
  ASSERT_TRUE(intentcad::CreateBoxFeature("gltf-box", 100, 60, 10, &err))
      << err;

  const fs::path file =
      fs::temp_directory_path() / "intentcad-gltf-roundtrip.gltf";
  const fs::path bin =
      fs::temp_directory_path() / "intentcad-gltf-roundtrip.bin";
  std::error_code ec;
  fs::remove(file, ec);
  fs::remove(bin, ec);
  ASSERT_TRUE(intentcad::ExportGltf(file.string(), &err)) << err;
  EXPECT_TRUE(fs::exists(file));
  EXPECT_TRUE(fs::exists(bin));
  EXPECT_GT(fs::file_size(file, ec), 500u);
  EXPECT_GT(fs::file_size(bin, ec), 100u);

  // Fresh document, like OpenDocument: import replaces the model.
  intentcad::DocumentStore::instance().create("gltf-test-doc");
  std::vector<std::string> ids;
  ASSERT_TRUE(intentcad::ImportGltf(file.string(), &ids, &err)) << err;
  ASSERT_EQ(ids.size(), 1u);

  intentcad::ShapeRecord rec;
  ASSERT_TRUE(intentcad::ShapeStore::instance().get(ids[0], &rec));
  EXPECT_EQ(rec.type, "MeshImport");
  // Meters↔mm + float32 bin: exact for planar boxes, tolerant band kept.
  EXPECT_NEAR(rec.volumeMm3, 60000.0, 0.5);
  EXPECT_NEAR(rec.bboxMm[0], 0.0, 1e-3);
  EXPECT_NEAR(rec.bboxMm[1], 0.0, 1e-3);
  EXPECT_NEAR(rec.bboxMm[2], 0.0, 1e-3);
  EXPECT_NEAR(rec.bboxMm[3], 100.0, 1e-3);
  EXPECT_NEAR(rec.bboxMm[4], 60.0, 1e-3);
  EXPECT_NEAR(rec.bboxMm[5], 10.0, 1e-3);

  const intentcad::CoreMesh mesh =
      intentcad::TessellateFeature(ids[0], 1, &err);
  EXPECT_FALSE(mesh.indices.empty()) << err;
  EXPECT_FALSE(mesh.faces.empty());

  // One Undo step removes the whole import (single OCAF command).
  ASSERT_TRUE(intentcad::OcafLive::instance().Undo(&err)) << err;
  EXPECT_FALSE(intentcad::ShapeStore::instance().contains(ids[0]));
  ASSERT_TRUE(intentcad::OcafLive::instance().Redo(&err)) << err;
  EXPECT_TRUE(intentcad::ShapeStore::instance().contains(ids[0]));

  fs::remove(file, ec);
  fs::remove(bin, ec);
}

TEST(Gltf, GlbExportImports) {
  intentcad::DocumentStore::instance().create("gltf-test-glb");
  std::string err;
  ASSERT_TRUE(intentcad::CreateBoxFeature("gltf-glb-box", 100, 60, 10, &err))
      << err;
  const fs::path glb =
      fs::temp_directory_path() / "intentcad-gltf-export.glb";
  std::error_code ec;
  fs::remove(glb, ec);
  ASSERT_TRUE(intentcad::ExportGlb(glb.string(), &err)) << err;
  EXPECT_TRUE(fs::exists(glb));
  EXPECT_GT(fs::file_size(glb, ec), 500u);
  intentcad::DocumentStore::instance().create("gltf-test-glb");
  std::vector<std::string> ids;
  ASSERT_TRUE(intentcad::ImportGltf(glb.string(), &ids, &err)) << err;
  ASSERT_EQ(ids.size(), 1u);
  intentcad::ShapeRecord rec;
  ASSERT_TRUE(intentcad::ShapeStore::instance().get(ids[0], &rec));
  EXPECT_NEAR(rec.volumeMm3, 60000.0, 0.5);
  fs::remove(glb, ec);
}

TEST(Gltf, RejectsNonGltfHonestly) {  intentcad::DocumentStore::instance().create("gltf-test-bad");
  const fs::path file =
      fs::temp_directory_path() / "intentcad-gltf-bad.gltf";
  {
    std::ofstream f(file, std::ios::binary);
    f << "this is not json";
  }
  std::vector<std::string> ids;
  std::string err;
  EXPECT_FALSE(intentcad::ImportGltf(file.string(), &ids, &err));
  EXPECT_FALSE(err.empty());
  std::error_code ec;
  fs::remove(file, ec);
}

TEST(Gltf, EmptyDocumentExportFailsHonestly) {
  intentcad::DocumentStore::instance().create("gltf-test-empty");
  std::string err;
  EXPECT_FALSE(intentcad::ExportGltf(
      "C:\\Windows\\Temp\\intentcad-empty.gltf", &err));
  EXPECT_FALSE(err.empty());
}
