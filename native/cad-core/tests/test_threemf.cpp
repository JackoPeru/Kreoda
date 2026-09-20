// 3MF mesh round-trip, Phase 8 (§61): box → .3mf → MeshImport feature
// with identical volume/bbox, tessellatable, one Undo step.

#include <gtest/gtest.h>

#include <filesystem>
#include <string>
#include <vector>

#include "../src/document/document_store.h"
#include "../src/exchange/threemf_exchange.h"
#include "../src/features/primitives/primitives.h"
#include "../src/model/shapes.h"
#include "../src/persistence/ocaf_live.h"
#include "../src/tessellation/mesh.h"

namespace fs = std::filesystem;

TEST(ThreeMF, ExportImportRoundTrip) {
  intentcad::DocumentStore::instance().create("threemf-test-doc");
  std::string err;
  ASSERT_TRUE(intentcad::CreateBoxFeature("threemf-box", 100, 60, 10, &err))
      << err;

  const fs::path file =
      fs::temp_directory_path() / "intentcad-threemf-roundtrip.3mf";
  std::error_code ec;
  fs::remove(file, ec);
  ASSERT_TRUE(intentcad::ExportThreeMF(file.string(), &err)) << err;
  EXPECT_TRUE(fs::exists(file));
  EXPECT_GT(fs::file_size(file, ec), 500u);

  // Fresh document, like OpenDocument: import replaces the model.
  intentcad::DocumentStore::instance().create("threemf-test-doc");
  std::vector<std::string> ids;
  ASSERT_TRUE(intentcad::ImportThreeMF(file.string(), &ids, &err)) << err;
  ASSERT_EQ(ids.size(), 1u);

  intentcad::ShapeRecord rec;
  ASSERT_TRUE(intentcad::ShapeStore::instance().get(ids[0], &rec));
  EXPECT_EQ(rec.type, "MeshImport");
  // Faceted re-sew: exact for planar boxes, keep tolerance for triangulation.
  EXPECT_NEAR(rec.volumeMm3, 60000.0, 0.5);
  EXPECT_NEAR(rec.bboxMm[0], 0.0, 1e-4);
  EXPECT_NEAR(rec.bboxMm[1], 0.0, 1e-4);
  EXPECT_NEAR(rec.bboxMm[2], 0.0, 1e-4);
  EXPECT_NEAR(rec.bboxMm[3], 100.0, 1e-4);
  EXPECT_NEAR(rec.bboxMm[4], 60.0, 1e-4);
  EXPECT_NEAR(rec.bboxMm[5], 10.0, 1e-4);

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
}

TEST(ThreeMF, EmptyDocumentExportFailsHonestly) {
  intentcad::DocumentStore::instance().create("threemf-test-empty");
  std::string err;
  EXPECT_FALSE(intentcad::ExportThreeMF(
      "C:\\Windows\\Temp\\intentcad-empty.3mf", &err));
  EXPECT_FALSE(err.empty());
}
