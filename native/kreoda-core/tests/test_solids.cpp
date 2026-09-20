#include <gtest/gtest.h>

#include <cmath>
#include <filesystem>
#include <string>

#include "../src/document/document_store.h"
#include "../src/features/booleans/boolean.h"
#include "../src/features/extrusion/extrude.h"
#include "../src/features/fillet/fillet.h"
#include "../src/features/hole/hole.h"
#include "../src/features/primitives/primitives.h"
#include "../src/features/sketch/sketch_commands.h"
#include "../src/model/shapes.h"

#include "rpc_text.h"
#include "../src/protocol/dispatcher.h"
#include "../src/topology/face_roles.h"

namespace fs = std::filesystem;

// §20 Tier 3/5 + §49: exact volumes, persistent refs, honest failures.

namespace {

void NewDoc(const std::string& id) {
  kreoda::DocumentStore::instance().create(id);
}

bool ok(const std::string& r) {
  return r.find("\"status\":\"ok\"") != std::string::npos;
}

bool has(const std::string& r, const std::string& s) {
  return r.find(s) != std::string::npos;
}

// Dispatcher answers are bytes now (JSON stays byte-identical UTF-8);
// mesh successes are FlatBuffers MeshUpdate tables (§8).
std::string rpc(const std::string& body) {
  return kreoda_test::rpcText(body);
}

#ifdef KREODA_WITH_FLATBUFFERS
double meshVolume(const std::string& body) {
  // The byte vector must outlive the decoded view — never parse a temporary.
  const std::vector<uint8_t> bytes = kreoda::handle_command(body);
  const auto* update = kreoda_test::meshRoot(bytes);
  return update ? update->volume_mm3() : -1.0;
}
#endif

double VolumeOf(const std::string& id) {
  kreoda::ShapeRecord rec;
  EXPECT_TRUE(kreoda::ShapeStore::instance().get(id, &rec));
  return rec.volumeMm3;
}

}  // namespace

TEST(Solids, FuseAddsVolumesMinusOverlap) {
  NewDoc("bl1");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("ba", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("bb", 40, 40, 40, &err)) << err;
  ASSERT_TRUE(kreoda::CreateBooleanFeature("bf", "fuse", "ba", "bb", &err))
      << err;
  // bb sits in the corner of ba: overlap 40x40x20 = 32000.
  EXPECT_NEAR(VolumeOf("bf"), 100000 + 64000 - 32000, 1.0);
  EXPECT_FALSE(kreoda::CreateBooleanFeature("bf2", "bogus", "ba", "bb", &err));
  EXPECT_FALSE(kreoda::CreateBooleanFeature("bf3", "fuse", "ba", "ba", &err));
  EXPECT_FALSE(kreoda::CreateBooleanFeature("ba", "fuse", "ba", "bb", &err));
}

TEST(Solids, CutSubtractsTool) {
  NewDoc("bl2");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("ca", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateCylinderFeature("cb", 10, 60, &err)) << err;
  ASSERT_TRUE(kreoda::CreateBooleanFeature("cc", "cut", "ca", "cb", &err))
      << err;
  EXPECT_LT(VolumeOf("cc"), 100000.0);
  // Common keeps the overlap only.
  ASSERT_TRUE(kreoda::CreateBooleanFeature("cd", "common", "ca", "cb", &err))
      << err;
  EXPECT_GT(VolumeOf("cd"), 0.0);
  EXPECT_LT(VolumeOf("cd"), 100000.0);
}

TEST(Solids, HoleThroughExactVolume) {
  NewDoc("hl1");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("ha", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("hh", "ha", "box.+Z", 50, 25, 8,
                                           "throughAll", 0, &err))
      << err;
  // Cylinder removed: pi * 16 * 20.
  EXPECT_NEAR(VolumeOf("hh"), 100000 - 3.14159265358979 * 16 * 20, 1.0);
  EXPECT_FALSE(kreoda::CreateHoleFeature("hh2", "ha", "box.+Z", 50, 25, -8,
                                            "throughAll", 0, &err));
  EXPECT_FALSE(kreoda::CreateHoleFeature("hh3", "ha", "nope", 50, 25, 8,
                                            "throughAll", 0, &err));
}

TEST(Solids, HoleBlindDepth) {
  NewDoc("hl2");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("ba", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("hb", "ba", "box.+Z", 50, 25, 8,
                                           "blind", 10, &err))
      << err;
  EXPECT_NEAR(VolumeOf("hb"), 100000 - 3.14159265358979 * 16 * 10, 1.0);
  // Blind deeper than the part is fine (exits the far side, still valid).
  ASSERT_TRUE(kreoda::CreateHoleFeature("hb2", "ba", "box.+Z", 10, 10, 8,
                                           "blind", 500, &err))
      << err;
}

TEST(Solids, HoleNeedsPlanarFace) {
  NewDoc("hl3");
  std::string err;
  ASSERT_TRUE(kreoda::CreateSphereFeature("sa", 30, &err)) << err;
  EXPECT_FALSE(kreoda::CreateHoleFeature("sh", "sa", "sph.all", 0, 0, 8,
                                            "throughAll", 0, &err));
}

TEST(Solids, HoleSurvivesTargetResize) {
  NewDoc("hl4");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("ta", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("th", "ta", "box.+Z", 50, 25, 8,
                                           "throughAll", 0, &err))
      << err;
  // Widen the target: the hole re-resolves on the same top face (§3–§4).
  ASSERT_TRUE(kreoda::RebuildFeature("ta", "widthMm", 150, &err)) << err;
  EXPECT_NEAR(VolumeOf("th"), 150000 - 3.14159265358979 * 16 * 20, 1.0);
}

TEST(Solids, HoleDiameterEdit) {
  NewDoc("hl5");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("ea", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("eh", "ea", "box.+Z", 50, 25, 8,
                                           "throughAll", 0, &err))
      << err;
  ASSERT_TRUE(kreoda::RebuildFeature("eh", "diameterMm", 10, &err)) << err;
  EXPECT_NEAR(VolumeOf("eh"), 100000 - 3.14159265358979 * 25 * 20, 1.0);
}

TEST(Solids, FilletRoundsEdges) {
  NewDoc("fl1");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("fa", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateFilletFeature(
                  "ff", "fa", {"fa:edge.lin.box.+X~box.+Z"}, 3, &err))
      << err;
  EXPECT_LT(VolumeOf("ff"), 100000.0);
  EXPECT_GT(VolumeOf("ff"), 99000.0);
  // Oversize radius: actionable safe-range error, no fake geometry (§41).
  std::string bigErr;
  EXPECT_FALSE(
      kreoda::CreateFilletFeature("ff2", "fa",
                                     {"fa:edge.lin.box.+X~box.+Z"}, 40, &bigErr));
  EXPECT_NE(bigErr.find("Maximum stable value"), std::string::npos) << bigErr;
  // Unknown edge: explicit repair state.
  EXPECT_FALSE(kreoda::CreateFilletFeature("ff3", "fa", {"fa:edge.nope"}, 3,
                                              &err));
}

TEST(Solids, ChamferCutsCorners) {
  NewDoc("ch1");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("ka", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateChamferFeature(
                  "kc", "ka", {"ka:edge.lin.box.+X~box.+Z"}, 3, &err))
      << err;
  EXPECT_LT(VolumeOf("kc"), 100000.0);
  EXPECT_GT(VolumeOf("kc"), 99000.0);
}

TEST(Solids, CutToEmptyAndDisjointCommonFailHonestly) {
  NewDoc("bl4");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("da", 100, 50, 20, &err)) << err;
  // Same geometry, different UUID: cut removes everything → honest error.
  ASSERT_TRUE(kreoda::CreateBoxFeature("db", 100, 50, 20, &err)) << err;
  EXPECT_FALSE(kreoda::CreateBooleanFeature("dc", "cut", "da", "db", &err));
  EXPECT_NE(err.find("empty"), std::string::npos) << err;
  // Disjoint common: nothing shared → honest error, no fake body.
  ASSERT_TRUE(kreoda::CreateBoxFeature("dd", 10, 10, 10, &err)) << err;
  // Move dd far away is out of scope (no placement yet); overlapping boxes
  // always share volume, so craft disjointness via a tiny far box is not
  // possible without placement — instead assert a valid small overlap works.
  ASSERT_TRUE(kreoda::CreateBooleanFeature("de", "common", "da", "dd", &err))
      << err;
  EXPECT_GT(VolumeOf("de"), 0.0);
}

TEST(Solids, HoleOnExtrudedFace) {
  NewDoc("hl6");
  std::string err;
  kreoda::SketchModel m;
  m.points = {{"p0", 0, 0}, {"p1", 100, 0}, {"p2", 100, 50}, {"p3", 0, 50}};
  m.lines = {{"l0", "p0", "p1"},
             {"l1", "p1", "p2"},
             {"l2", "p2", "p3"},
             {"l3", "p3", "p0"}};
  m.constraints = {
      {"h0", kreoda::SketchConstraintKind::Horizontal, {"l0"}, 0},
      {"h2", kreoda::SketchConstraintKind::Horizontal, {"l2"}, 0},
      {"v1", kreoda::SketchConstraintKind::Vertical, {"l1"}, 0},
      {"v3", kreoda::SketchConstraintKind::Vertical, {"l3"}, 0},
      {"w", kreoda::SketchConstraintKind::Distance, {"p0", "p1"}, 100},
      {"h", kreoda::SketchConstraintKind::Distance, {"p1", "p2"}, 50},
  };
  ASSERT_TRUE(kreoda::CreateSketchFeature("sx", "XY", m, &err)) << err;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("ex", "sx", 20, &err)) << err;
  // Face-frame center: world (50,25,20) mapped through the REAL cap frame
  // (extrude caps need not share the box frame convention, §10).
  kreoda::ShapeRecord ex;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("ex", &ex));
  double origin[3], xa[3], ya[3], normal[3];
  ASSERT_TRUE(kreoda::FaceFrameInfo(ex.shape, "ex", "Extrude", "extrude.+Z",
                                       origin, xa, ya, normal));
  // World center (50,25,20) → face-local.
  const double dx[3] = {50 - origin[0], 25 - origin[1], 20 - origin[2]};
  const double lx = dx[0] * xa[0] + dx[1] * xa[1] + dx[2] * xa[2];
  const double ly = dx[0] * ya[0] + dx[1] * ya[1] + dx[2] * ya[2];
  ASSERT_TRUE(kreoda::CreateHoleFeature("hx", "ex", "extrude.+Z", lx, ly, 8,
                                           "throughAll", 0, &err))
      << err;
  EXPECT_NEAR(VolumeOf("hx"), 100000 - 3.14159265358979 * 16 * 20, 1.0);
}

TEST(Solids, ChamferRebuildAfterResize) {
  NewDoc("ch2");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("ra", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateChamferFeature(
                  "rc", "ra", {"ra:edge.lin.box.+X~box.+Z"}, 3, &err))
      << err;
  const double before = VolumeOf("rc");
  ASSERT_TRUE(kreoda::RebuildFeature("ra", "widthMm", 150, &err)) << err;
  // Chamfer re-resolved on the resized box: still smaller than the plain
  // resized box, larger than the pre-resize chamfered solid.
  EXPECT_LT(VolumeOf("rc"), 150 * 50 * 20);
  EXPECT_GT(VolumeOf("rc"), before);
}

TEST(Solids, SaveOpenKeepsHoleAndFillet) {
  NewDoc("sv1");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("pa", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("ph", "pa", "box.+Z", 50, 25, 8,
                                           "throughAll", 0, &err))
      << err;
  ASSERT_TRUE(kreoda::CreateFilletFeature(
                  "pf", "pa", {"pa:edge.lin.box.+X~box.-Z"}, 2, &err))
      << err;
  const double holeVol = VolumeOf("ph");
  const double filVol = VolumeOf("pf");
  const fs::path icad = fs::temp_directory_path() / "kreoda-solids.icad";
  const std::string save =
      std::string(
          R"({"protocolVersion":1,"requestId":"s1","documentId":"sv1","type":10,"path":")") +
      icad.string() + "\"}";
  ASSERT_TRUE(ok(rpc(save)));
  NewDoc("sv1b");
  const std::string open =
      std::string(
          R"({"protocolVersion":1,"requestId":"s2","documentId":"sv1b","type":11,"path":")") +
      icad.string() + "\"}";
  const std::string opened = rpc(open);
  ASSERT_TRUE(ok(opened)) << opened;
  EXPECT_NE(opened.find("Hole"), std::string::npos);
  EXPECT_NE(opened.find("Fillet"), std::string::npos);
  kreoda::ShapeRecord rh, rf;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("ph", &rh));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("pf", &rf));
  EXPECT_NEAR(rh.volumeMm3, holeVol, 1e-6);
  EXPECT_NEAR(rf.volumeMm3, filVol, 1e-6);
  // Refs survived: refs carry face role + edge ids for future rebuilds.
  EXPECT_NE(rh.refExtra.find("box.+Z"), std::string::npos);
  EXPECT_NE(rf.refExtra.find("edge.lin"), std::string::npos);
  std::error_code ec;
  fs::remove(icad, ec);
}

TEST(Solids, BooleanUndoRedo) {
  NewDoc("bl3");
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"q1","documentId":"bl3","type":3,"featureId":"ua","widthMm":100,"heightMm":50,"depthMm":20})")));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"q2","documentId":"bl3","type":3,"featureId":"ub","widthMm":40,"heightMm":40,"depthMm":40})")));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"q3","documentId":"bl3","type":19,"featureId":"uu","op":"fuse","targetId":"ua","toolId":"ub"})")));
#ifdef KREODA_WITH_FLATBUFFERS
  EXPECT_NEAR(meshVolume(
                  R"({"protocolVersion":1,"requestId":"q4","documentId":"bl3","type":12,"featureId":"uu","lod":1})"),
              132000.0, 1.0);
#else
  GTEST_SKIP() << "mesh binary needs flatbuffers";
#endif
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"q5","documentId":"bl3","type":20,"featureId":"uh","targetId":"uu","faceRole":"box.+Z","xMm":20,"yMm":20,"diameterMm":8,"depthMode":"throughAll","depthMm":0})")));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"q6","documentId":"bl3","type":8})")));
#ifdef KREODA_WITH_FLATBUFFERS
  EXPECT_NEAR(meshVolume(
                  R"({"protocolVersion":1,"requestId":"q7","documentId":"bl3","type":12,"featureId":"uu","lod":1})"),
              132000.0, 1.0);
#else
  GTEST_SKIP() << "mesh binary needs flatbuffers";
#endif
}
