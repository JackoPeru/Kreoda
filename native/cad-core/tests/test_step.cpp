// STEP AP214 round-trip, Phase 8 (§61): box → .step → StepImport feature
// with identical volume/bbox, tessellatable, one Undo step, persists.

#include <gtest/gtest.h>

#include <filesystem>
#include <string>
#include <vector>

#include "../src/document/document_store.h"
#include "../src/exchange/step_exchange.h"
#include "../src/features/primitives/primitives.h"
#include "../src/model/shapes.h"
#include "../src/persistence/ocaf_live.h"
#include "../src/tessellation/mesh.h"

namespace fs = std::filesystem;

TEST(Step, ExportImportRoundTrip) {
  kreoda::DocumentStore::instance().create("step-test-doc");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("step-box", 100, 60, 10, &err))
      << err;

  const fs::path file =
      fs::temp_directory_path() / "kreoda-step-roundtrip.step";
  std::error_code ec;
  fs::remove(file, ec);
  ASSERT_TRUE(kreoda::ExportStep(file.string(), &err)) << err;
  EXPECT_TRUE(fs::exists(file));
  EXPECT_GT(fs::file_size(file, ec), 1000u);

  // Fresh document, like OpenDocument: import replaces the model.
  kreoda::DocumentStore::instance().create("step-test-doc");
  std::vector<std::string> ids;
  ASSERT_TRUE(kreoda::ImportStep(file.string(), &ids, &err)) << err;
  ASSERT_EQ(ids.size(), 1u);

  kreoda::ShapeRecord rec;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(ids[0], &rec));
  EXPECT_EQ(rec.type, "StepImport");
  EXPECT_NEAR(rec.volumeMm3, 60000.0, 0.1);
  EXPECT_NEAR(rec.bboxMm[0], 0.0, 1e-6);
  EXPECT_NEAR(rec.bboxMm[1], 0.0, 1e-6);
  EXPECT_NEAR(rec.bboxMm[2], 0.0, 1e-6);
  EXPECT_NEAR(rec.bboxMm[3], 100.0, 1e-6);
  EXPECT_NEAR(rec.bboxMm[4], 60.0, 1e-6);
  EXPECT_NEAR(rec.bboxMm[5], 10.0, 1e-6);

  // Imported solids tessellate like any body (viewport-ready).
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
}

TEST(Step, EmptyDocumentExportFailsHonestly) {
  kreoda::DocumentStore::instance().create("step-test-empty");
  std::string err;
  EXPECT_FALSE(
      kreoda::ExportStep("C:\\Windows\\Temp\\kreoda-empty.step", &err));
  EXPECT_FALSE(err.empty());
}
