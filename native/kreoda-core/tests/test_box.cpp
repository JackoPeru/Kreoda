#include <gtest/gtest.h>

#include "../src/features/primitives/primitives.h"
#include "../src/tessellation/box_tessellator.h"
#include "../src/analysis/mass_properties.h"

// §49: known dimensions, volume, validity, failure cases. No fake geometry.

TEST(Box, ExactDimensionsAndVolume) {
  std::string err;
  EXPECT_TRUE(kreoda::CreateBoxFeature("box-test-1", 100, 50, 20, &err))
      << err;
  const auto mesh = kreoda::TessellateBoxExact(100, 50, 20);
  EXPECT_EQ(mesh.indices.size(), 36u);  // 12 triangles
  EXPECT_EQ(mesh.faces.size(), 6u);
  EXPECT_DOUBLE_EQ(mesh.volumeMm3, 100 * 50 * 20);
  // Persistent face ids (§0.2): role-based strings, never bare indices.
  EXPECT_EQ(mesh.faces[1].persistentFaceId, "box.+Z");
  EXPECT_EQ(mesh.faces[1].triangleStart, 2u);
}

TEST(Box, RejectsNonPositive) {
  std::string err;
  EXPECT_FALSE(kreoda::CreateBoxFeature("box-bad", -5, 50, 20, &err));
  EXPECT_FALSE(err.empty());
}

#if KREODA_WITH_OCCT
TEST(Box, NativeMassAreaAndCentroid) {
  kreoda::ShapeStore::instance().clear();
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("mass-box", 100, 50, 20, &error)) << error;
  kreoda::ShapeRecord record;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("mass-box", &record));
  kreoda::MassProperties props;
  ASSERT_TRUE(kreoda::MeasureMassProperties(record, 7.85e-6, &props, &error)) << error;
  EXPECT_NEAR(props.volumeMm3, 100000, 1e-6);
  EXPECT_NEAR(props.surfaceAreaMm2, 16000, 1e-6);
  EXPECT_NEAR(props.massKg, 0.785, 1e-8);
  EXPECT_NEAR(props.centroidMm[0], 50, 1e-6);
  EXPECT_NEAR(props.centroidMm[1], 25, 1e-6);
  EXPECT_NEAR(props.centroidMm[2], 10, 1e-6);
  const auto previous = props;
  EXPECT_FALSE(kreoda::MeasureMassProperties(record, -1, &props, &error));
  EXPECT_DOUBLE_EQ(props.massKg, previous.massKg);
}
#endif
