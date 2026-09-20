#include <gtest/gtest.h>

#include <filesystem>

#include "../src/document/document_store.h"
#include "../src/features/primitives/primitives.h"
#include "../src/model/shapes.h"
#include "../src/persistence/ocaf_live.h"
#include "../src/protocol/dispatcher.h"
#include "../src/topology/face_roles.h"
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopoDS_Face.hxx>

#include "rpc_text.h"

namespace fs = std::filesystem;

// Phase 2 topology regression tests (§3–§4, §49):
// persistent face references must survive parameter changes and save/open.
// A face is NEVER identified by array index — only UUID + TNaming/role.

namespace {

void NewDoc(const std::string& id) {
  intentcad::DocumentStore::instance().create(id);
}

double FaceArea(const TopoDS_Shape& shape, const std::string& featureId,
                const std::string& type, const std::string& role) {
  TopoDS_Face face;
  if (!intentcad::FindFaceByRole(shape, featureId, type, role, &face)) {
    return -1.0;
  }
  GProp_GProps props;
  BRepGProp::SurfaceProperties(face, props);
  return props.Mass();
}

intentcad::ShapeRecord Get(const std::string& id) {
  intentcad::ShapeRecord rec;
  EXPECT_TRUE(intentcad::ShapeStore::instance().get(id, &rec));
  return rec;
}

}  // namespace

TEST(Topology, BoxTopFaceSurvivesWidthChange) {
  NewDoc("topo1");
  std::string err;
  ASSERT_TRUE(intentcad::CreateBoxFeature("tbox", 100, 50, 20, &err)) << err;
  EXPECT_DOUBLE_EQ(FaceArea(Get("tbox").shape, "tbox", "Box", "box.+Z"),
                   100 * 50);

  intentcad::OcafLive::FaceSelection sel;
  ASSERT_TRUE(intentcad::OcafLive::instance().SelectFace("tbox", "box.+Z",
                                                        &sel, &err))
      << err;
  EXPECT_FALSE(sel.entry.empty());

  ASSERT_TRUE(intentcad::RebuildFeature("tbox", "widthMm", 150, &err)) << err;
  EXPECT_DOUBLE_EQ(Get("tbox").volumeMm3, 150 * 50 * 20);
  // Same face, new size — reference intact, geometry updated.
  EXPECT_DOUBLE_EQ(FaceArea(Get("tbox").shape, "tbox", "Box", "box.+Z"),
                   150 * 50);

  const auto resolved =
      intentcad::OcafLive::instance().ResolveSelection(sel);
  EXPECT_TRUE(resolved.valid);
  EXPECT_NE(resolved.role.find("box.+Z"), std::string::npos);
}

TEST(Topology, CylinderCapSurvivesHeightChange) {
  NewDoc("topo2");
  std::string err;
  ASSERT_TRUE(intentcad::CreateCylinderFeature("tcyl", 10, 40, &err)) << err;

  intentcad::OcafLive::FaceSelection sel;
  ASSERT_TRUE(intentcad::OcafLive::instance().SelectFace("tcyl", "cyl.+Z",
                                                        &sel, &err))
      << err;
  ASSERT_TRUE(intentcad::RebuildFeature("tcyl", "heightMm", 80, &err)) << err;

  const auto resolved =
      intentcad::OcafLive::instance().ResolveSelection(sel);
  EXPECT_TRUE(resolved.valid);
  EXPECT_NE(resolved.role.find("cyl.+Z"), std::string::npos);
  // Cap area unchanged by a height edit (radius untouched).
  EXPECT_NEAR(FaceArea(Get("tcyl").shape, "tcyl", "Cylinder", "cyl.+Z"),
              3.14159265358979 * 100, 1e-3);
}

TEST(Topology, SphereFaceSurvivesRadiusChange) {
  NewDoc("topo3");
  std::string err;
  ASSERT_TRUE(intentcad::CreateSphereFeature("tsph", 15, &err)) << err;

  intentcad::OcafLive::FaceSelection sel;
  ASSERT_TRUE(intentcad::OcafLive::instance().SelectFace("tsph", "sph.all",
                                                        &sel, &err))
      << err;
  ASSERT_TRUE(intentcad::RebuildFeature("tsph", "radiusMm", 25, &err)) << err;

  const auto resolved =
      intentcad::OcafLive::instance().ResolveSelection(sel);
  EXPECT_TRUE(resolved.valid);
  EXPECT_NE(resolved.role.find("sph.all"), std::string::npos);
}

TEST(Topology, ResolutionLayerIsReportedHonestly) {
  NewDoc("topo4");
  std::string err;
  ASSERT_TRUE(intentcad::CreateBoxFeature("tvia", 100, 50, 20, &err)) << err;
  intentcad::OcafLive::FaceSelection sel;
  ASSERT_TRUE(intentcad::OcafLive::instance().SelectFace("tvia", "box.+Z",
                                                        &sel, &err))
      << err;
  ASSERT_TRUE(intentcad::RebuildFeature("tvia", "widthMm", 120, &err)) << err;
  const auto resolved =
      intentcad::OcafLive::instance().ResolveSelection(sel);
  EXPECT_TRUE(resolved.valid);
  // No post-rebuild re-solve yet: the semantic role layer resolves.
  // When TNaming re-solve lands, this flips to "naming" (by geometric proof).
  EXPECT_EQ(resolved.via, "role");
}

TEST(Topology, InvalidRebuildKeepsOldGeometry) {
  NewDoc("topo5");
  std::string err;
  ASSERT_TRUE(intentcad::CreateBoxFeature("tkeep", 100, 50, 20, &err)) << err;
  const int64_t rev = intentcad::DocumentStore::instance().revision();
  EXPECT_FALSE(intentcad::RebuildFeature("tkeep", "widthMm", -5, &err));
  EXPECT_FALSE(err.empty());
  EXPECT_FALSE(intentcad::RebuildFeature("tkeep", "depthZZ", 5, &err));
  EXPECT_DOUBLE_EQ(Get("tkeep").volumeMm3, 100000);
  EXPECT_EQ(intentcad::DocumentStore::instance().revision(), rev);
}

TEST(Topology, PreviewDoesNotCommit) {
  NewDoc("topo6");
  ASSERT_NE(intentcad_test::rpcText(
                R"({"protocolVersion":1,"requestId":"v1","documentId":"topo6","type":3,"featureId":"vbox","widthMm":100,"heightMm":50,"depthMm":20})")
                .find("\"status\":\"ok\""),
            std::string::npos);
  const int64_t rev = intentcad::DocumentStore::instance().revision();
  const std::vector<uint8_t> pv = intentcad_test::rpcBytes(
      R"({"protocolVersion":1,"requestId":"v2","documentId":"topo6","type":6,"featureId":"vbox","paramName":"widthMm","valueMm":999,"isPreview":true})");
#ifdef INTENTCAD_WITH_FLATBUFFERS
  // Preview arrives as a FlatBuffers mesh (§8): would-be width 999.
  const auto* update = intentcad_test::meshRoot(pv);
  ASSERT_NE(update, nullptr);
  EXPECT_DOUBLE_EQ(update->volume_mm3(), 999.0 * 50.0 * 20.0);
#else
  GTEST_SKIP() << "preview binary needs flatbuffers";
#endif
  // Committed state untouched: same revision, same volume.
  EXPECT_EQ(intentcad::DocumentStore::instance().revision(), rev);
  EXPECT_DOUBLE_EQ(Get("vbox").volumeMm3, 100000);
}

TEST(Topology, SelectionSurvivesSaveOpen) {
  NewDoc("topo7");
  std::string err;
  ASSERT_TRUE(intentcad::CreateBoxFeature("tsave", 100, 50, 20, &err)) << err;
  intentcad::OcafLive::FaceSelection sel;
  ASSERT_TRUE(intentcad::OcafLive::instance().SelectFace("tsave", "box.+Z",
                                                        &sel, &err))
      << err;
  const fs::path icad = fs::temp_directory_path() / "intentcad-topo.icad";
  const std::string save =
      std::string(
          R"({"protocolVersion":1,"requestId":"t1","documentId":"topo7","type":10,"path":")") +
      icad.string() + "\"}";
  ASSERT_NE(intentcad_test::rpcText(save).find("\"status\":\"ok\""),
            std::string::npos);

  NewDoc("topo7b");
  const std::string open =
      std::string(
          R"({"protocolVersion":1,"requestId":"t2","documentId":"topo7b","type":11,"path":")") +
      icad.string() + "\"}";
  const std::string opened = intentcad_test::rpcText(open);
  ASSERT_NE(opened.find("\"status\":\"ok\""), std::string::npos) << opened;

  // Entry strings are tag paths: stable across save/load by OCAF design.
  const auto resolved =
      intentcad::OcafLive::instance().ResolveSelection(sel);
  EXPECT_TRUE(resolved.valid);
  EXPECT_NE(resolved.role.find("box.+Z"), std::string::npos);
  EXPECT_DOUBLE_EQ(Get("tsave").volumeMm3, 100000);

  std::error_code ec;
  fs::remove(icad, ec);
}

TEST(Topology, FallbackOnlyResolvesRealRoles) {
  NewDoc("topo8");
  std::string err;
  ASSERT_TRUE(intentcad::CreateBoxFeature("tunk", 100, 50, 20, &err)) << err;
  // Dead entry + genuine role: fallback resolves by design (§4 order).
  intentcad::OcafLive::FaceSelection stale{"0:9:9:9", "tunk", "box.+Z"};
  const auto via_role =
      intentcad::OcafLive::instance().ResolveSelection(stale);
  EXPECT_TRUE(via_role.valid);
  EXPECT_EQ(via_role.via, "role");
  // Dead entry + invented role: must be invalid, never guessed.
  intentcad::OcafLive::FaceSelection wrongRole{"0:9:9:9", "tunk", "nope"};
  EXPECT_FALSE(
      intentcad::OcafLive::instance().ResolveSelection(wrongRole).valid);
}
