#include <gtest/gtest.h>

#include "../src/features/primitives/primitives.h"
#include "../src/tessellation/box_tessellator.h"
#include "../src/validation/validate.h"

// §49: known dimensions, volume, validity, failure cases. No fake geometry.

TEST(Box, ExactDimensionsAndVolume) {
  std::string err;
  EXPECT_TRUE(intentcad::CreateBoxFeature("box-test-1", 100, 50, 20, &err))
      << err;
  const auto mesh = intentcad::TessellateBoxExact(100, 50, 20);
  EXPECT_EQ(mesh.indices.size(), 36u);  // 12 triangles
  EXPECT_EQ(mesh.faces.size(), 6u);
  EXPECT_DOUBLE_EQ(mesh.volumeMm3, 100 * 50 * 20);
  // Persistent face ids (§0.2): role-based strings, never bare indices.
  EXPECT_EQ(mesh.faces[1].persistentFaceId, "box.+Z");
  EXPECT_EQ(mesh.faces[1].triangleStart, 2u);
}

TEST(Box, RejectsNonPositive) {
  std::string err;
  EXPECT_FALSE(intentcad::CreateBoxFeature("box-bad", -5, 50, 20, &err));
  EXPECT_FALSE(err.empty());
  EXPECT_FALSE(intentcad::ValidateCommittedShape(0, 50, 20));
}
