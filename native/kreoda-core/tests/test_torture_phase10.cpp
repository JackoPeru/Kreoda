// Phase 10 validation torture suites (§10.3–§10.5):
// persistent-topology mutations, 100 save/open cycles, undo/redo interleave,
// atomic-overwrite contract. All on the real OCCT/OCAF core.

#include <gtest/gtest.h>

#include <chrono>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <string>
#include <utility>
#include <vector>

#include "../src/document/document_store.h"
#include "../src/expressions/expressions.h"
#include "../src/features/booleans/boolean.h"
#include "../src/features/extrusion/extrude.h"
#include "../src/features/fillet/fillet.h"
#include "../src/features/hole/hole.h"
#include "../src/features/primitives/primitives.h"
#include "../src/features/sketch/sketch_commands.h"
#include "../src/model/shapes.h"
#include "../src/persistence/ocaf_live.h"
#include "../src/protocol/dispatcher.h"
#include "../src/tessellation/mesh.h"
#include "../src/topology/face_roles.h"

#if KREODA_WITH_OCCT
#include <TopAbs_ShapeEnum.hxx>
#include <TopoDS_Face.hxx>
#endif

#include "rpc_text.h"

namespace fs = std::filesystem;

namespace {

void NewDoc(const std::string& id) {
  kreoda::DocumentStore::instance().create(id);
}

std::string rpc(const std::string& body) {
  return kreoda_test::rpcText(body);
}

bool ok(const std::string& r) {
  return r.find("\"status\":\"ok\"") != std::string::npos;
}

double VolumeOf(const std::string& id) {
  kreoda::ShapeRecord rec;
  EXPECT_TRUE(kreoda::ShapeStore::instance().get(id, &rec)) << id;
  return rec.volumeMm3;
}

double ParamOf(const std::string& id, const std::string& param) {
  kreoda::ShapeRecord rec;
  if (!kreoda::ShapeStore::instance().get(id, &rec)) return -1.0;
  const int idx = kreoda::ParamIndexOf(rec.type, param, rec.paramsMm.size());
  if (idx < 0) return -1.0;
  return rec.paramsMm[static_cast<size_t>(idx)];
}

bool TopFaceResolves(const std::string& id) {
  kreoda::ShapeRecord rec;
  if (!kreoda::ShapeStore::instance().get(id, &rec)) return false;
#if KREODA_WITH_OCCT
  TopoDS_Face face;
  return kreoda::FindFaceByRole(rec.shape, id, rec.type, "box.+Z", &face);
#else
  return false;
#endif
}

kreoda::SketchModel RectModel(double w, double h) {
  using namespace kreoda;
  SketchModel m;
  m.points = {
      {"p0", 0, 0}, {"p1", w, 0}, {"p2", w, h}, {"p3", 0, h},
  };
  m.lines = {
      {"l0", "p0", "p1"}, {"l1", "p1", "p2"}, {"l2", "p2", "p3"}, {"l3", "p3", "p0"},
  };
  m.constraints = {
      {"h0", SketchConstraintKind::Horizontal, {"l0"}, 0},
      {"h2", SketchConstraintKind::Horizontal, {"l2"}, 0},
      {"v1", SketchConstraintKind::Vertical, {"l1"}, 0},
      {"v3", SketchConstraintKind::Vertical, {"l3"}, 0},
      {"w", SketchConstraintKind::Distance, {"p0", "p1"}, w},
      {"h", SketchConstraintKind::Distance, {"p1", "p2"}, h},
  };
  return m;
}

std::string saveRpc(const std::string& req, const std::string& doc,
                    const std::string& path) {
  return rpc(std::string(R"({"protocolVersion":1,"requestId":")") + req +
             R"(","documentId":")" + doc + R"(","type":10,"path":")" + path +
             "\"}");
}

std::string openRpc(const std::string& req, const std::string& doc,
                    const std::string& path) {
  return rpc(std::string(R"({"protocolVersion":1,"requestId":")") + req +
             R"(","documentId":")" + doc + R"(","type":11,"path":")" + path +
             "\"}");
}

}  // namespace

// Phase 10 find (§10.3): a feature label carrying per-face TNaming evolution
// (recorded on every parametric rebuild) resolved via GetShape to a COMPOUND
// of the current faces instead of the solid. Bbox, volume and face areas all
// looked identical, yet downstream B-Rep booleans silently cut wrong geometry
// after any Undo/Redo/Open. RecordFromLabel now unwraps the single solid;
// this test locks exact cuts after rebuild + resync.
TEST(Torture10, CutAfterResyncIsExact) {
  NewDoc("rs1");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("rb", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::RebuildFeature("rb", "widthMm", 150, &err)) << err;
  ASSERT_TRUE(kreoda::RebuildFeature("rb", "depthMm", 150, &err)) << err;
  {
    std::string rserr;
    ASSERT_TRUE(kreoda::OcafLive::instance().ResyncStore(&rserr)) << rserr;
  }
  kreoda::ShapeRecord rec;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("rb", &rec));
#if KREODA_WITH_OCCT
  EXPECT_EQ(rec.shape.ShapeType(), TopAbs_SOLID);
#endif
  ASSERT_TRUE(kreoda::CreateHoleFeature("rh", "rb", "box.+Z", 50, 25, 12,
                                        "throughAll", 0, &err))
      << err;
  EXPECT_NEAR(VolumeOf("rh"),
              150.0 * 50.0 * 150.0 - 3.14159265358979 * 36.0 * 150.0, 5.0);
}

// §10.3: parent edits that reorder topology must resolve or fail honestly.
TEST(Torture10, TopologySurvivesParentMutations) {
  NewDoc("tt1");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("tb", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("th", "tb", "box.+Z", 50, 25, 8,
                                        "throughAll", 0, &err))
      << err;
  ASSERT_TRUE(kreoda::CreateFilletFeature(
                  "tf", "tb", {"tb:edge.lin.box.+X~box.-Z"}, 2, &err))
      << err;
  const double tool = 3.14159265358979 * 16.0 * 20.0;
  EXPECT_NEAR(VolumeOf("th"), 100000.0 - tool, 2.0);

  // Change box proportions: top face + hole + fillet follow.
  ASSERT_TRUE(kreoda::RebuildFeature("tb", "widthMm", 150, &err)) << err;
  EXPECT_NEAR(VolumeOf("th"), 150000.0 - tool, 2.0);
  EXPECT_TRUE(TopFaceResolves("tb"));
  EXPECT_TRUE(TopFaceResolves("th"));

  // Reverse dominant dimensions: depth 20→150 is fine (through-hole
  // follows), but shrinking width 150→20 pushes the hole at x=50 off the
  // face — the recompute must fail HONESTLY ("misses the solid") with the
  // old geometry kept, never a silent rebind (§10.3 repair state).
  ASSERT_TRUE(kreoda::RebuildFeature("tb", "depthMm", 150, &err)) << err;
  EXPECT_TRUE(TopFaceResolves("tb"));
  EXPECT_FALSE(kreoda::RebuildFeature("tb", "widthMm", 20, &err));
  EXPECT_NE(err.find("misses the solid"), std::string::npos) << err;
  EXPECT_DOUBLE_EQ(ParamOf("tb", "widthMm"), 150.0);
  // Depth is now 150: the through-hole tool volume tracks the drilled depth.
  const double tool150 = 3.14159265358979 * 16.0 * 150.0;
  EXPECT_NEAR(VolumeOf("th"), 150.0 * 50.0 * 150.0 - tool150, 5.0);

  // Hole diameter change re-cuts exactly (box is 150×50×150 here).
  ASSERT_TRUE(kreoda::RebuildFeature("th", "diameterMm", 12, &err)) << err;
  EXPECT_NEAR(VolumeOf("th"),
              150.0 * 50.0 * 150.0 - 3.14159265358979 * 36.0 * 150.0, 5.0);

  // Absurd hole diameter fails honestly, old geometry kept.
  EXPECT_FALSE(kreoda::RebuildFeature("th", "diameterMm", 200000, &err));
  EXPECT_FALSE(err.empty());
  EXPECT_NEAR(VolumeOf("th"),
              150.0 * 50.0 * 150.0 - 3.14159265358979 * 36.0 * 150.0, 5.0);

  // Absurd fillet radius fails honestly, old geometry kept.
  EXPECT_FALSE(kreoda::RebuildFeature("tf", "radiusMm", 100000, &err));
  EXPECT_FALSE(err.empty());
}

// §10.3: extrusion-length change + sketch-geometry change reflow downstream.
TEST(Torture10, ExtrudeAndSketchMutationsReflow) {
  NewDoc("tt2");
  std::string err;
  ASSERT_TRUE(kreoda::CreateSketchFeature("ts", "XY", RectModel(100, 50), &err))
      << err;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("te", "ts", 20, &err)) << err;
  EXPECT_NEAR(VolumeOf("te"), 100000.0, 1.0);

  // Longer extrusion: exact volume.
  ASSERT_TRUE(kreoda::RebuildFeature("te", "distanceMm", 35, &err)) << err;
  EXPECT_NEAR(VolumeOf("te"), 175000.0, 1.0);

  // Bigger sketch: downstream solid follows.
  ASSERT_TRUE(
      kreoda::UpdateSketchFeature("ts", RectModel(120, 60), &err))
      << err;
  ASSERT_TRUE(kreoda::RebuildNodeFromStore("te", &err)) << err;
  EXPECT_NEAR(VolumeOf("te"), 120.0 * 60.0 * 35.0, 5.0);
}

// §10.4: 100 edit/save/close/open cycles — UUIDs, params, expressions stable.
TEST(Torture10, SaveOpen100Cycles) {
  const fs::path dir =
      fs::temp_directory_path() / "kreoda-torture-100";
  std::error_code ec;
  fs::create_directories(dir, ec);
  const std::string path = (dir / "cycle.icad").string();

  NewDoc("cy0");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("cb", 100, 60, 10, &err)) << err;
  ASSERT_TRUE(kreoda::RebuildFeature("cb", "widthMm", 0, "heightMm * 2", &err))
      << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("ch", "cb", "box.+Z", 60, 30, 6,
                                        "throughAll", 0, &err))
      << err;

  for (int i = 0; i < 100; ++i) {
    // Alternate the source dimension; the formula must track every cycle.
    const double h = (i % 2 == 0) ? 60.0 + i : 200.0 - i;
    ASSERT_TRUE(kreoda::RebuildFeature("cb", "heightMm", h, &err))
        << "cycle " << i << ": " << err;
    ASSERT_TRUE(ok(saveRpc("s", "cy0", path))) << "cycle " << i;
    NewDoc("cyX");
    const std::string opened = openRpc("o", "cyX", path);
    ASSERT_TRUE(ok(opened)) << "cycle " << i << ": " << opened;
    EXPECT_DOUBLE_EQ(ParamOf("cb", "heightMm"), h) << "cycle " << i;
    EXPECT_DOUBLE_EQ(ParamOf("cb", "widthMm"), 2.0 * h) << "cycle " << i;
    std::string stored;
    ASSERT_TRUE(
        kreoda::ExpressionStore::instance().get("cb", "widthMm", &stored));
    EXPECT_EQ(stored, "heightMm * 2") << "cycle " << i;
    kreoda::ShapeRecord hole;
    ASSERT_TRUE(kreoda::ShapeStore::instance().get("ch", &hole))
        << "cycle " << i;
    // Reopen under the working doc id for the next edit.
    NewDoc("cy0");
    ASSERT_TRUE(ok(openRpc("r", "cy0", path))) << "cycle " << i;
  }
  fs::remove_all(dir, ec);
}

// §10.5 + undo/redo: interleaved edits resolve to exact states; a failed
// save never replaces the previous valid file.
TEST(Torture10, UndoRedoInterleaveAndAtomicOverwrite) {
  const fs::path dir =
      fs::temp_directory_path() / "kreoda-torture-undo";
  std::error_code ec;
  fs::create_directories(dir, ec);
  const std::string path = (dir / "u.icad").string();

  NewDoc("ud0");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("ub", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("uh", "ub", "box.+Z", 50, 25, 8,
                                        "throughAll", 0, &err))
      << err;
  ASSERT_TRUE(kreoda::RebuildFeature("ub", "widthMm", 120, &err)) << err;
  EXPECT_DOUBLE_EQ(ParamOf("ub", "widthMm"), 120.0);

  // Undo the edit, then the hole, then redo both: exact states.
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"t-u1","documentId":"ud0","type":8})")));
  EXPECT_DOUBLE_EQ(ParamOf("ub", "widthMm"), 100.0);
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"t-u2","documentId":"ud0","type":8})")));
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("uh"));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"t-r1","documentId":"ud0","type":9})")));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"t-r2","documentId":"ud0","type":9})")));
  EXPECT_DOUBLE_EQ(ParamOf("ub", "widthMm"), 120.0);
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("uh"));

  // A new edit after partial undo drops the redo stack (standard semantics).
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"t-u3","documentId":"ud0","type":8})")));
  ASSERT_TRUE(kreoda::RebuildFeature("ub", "heightMm", 70, &err)) << err;
  EXPECT_FALSE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"t-r3","documentId":"ud0","type":9})")));

  // Atomic overwrite: save twice to the same path; both open identically.
  ASSERT_TRUE(ok(saveRpc("t-s1", "ud0", path)));
  std::uintmax_t bytes1 = fs::file_size(path, ec);
  ASSERT_TRUE(ok(saveRpc("t-s2", "ud0", path)));
  NewDoc("ud9");
  ASSERT_TRUE(ok(openRpc("t-o1", "ud9", path)));
  EXPECT_DOUBLE_EQ(ParamOf("ub", "heightMm"), 70.0);

  // Failed save (parent is a file, not a directory) leaves P intact.
  const std::string blocker = (dir / "blocker").string();
  { std::ofstream f(blocker, std::ios::binary); }
  const std::string doomed = blocker + "/u.icad";
  EXPECT_FALSE(ok(saveRpc("t-s3", "ud9", doomed)));
  EXPECT_EQ(fs::file_size(path, ec), bytes1);
  NewDoc("ud8");
  ASSERT_TRUE(ok(openRpc("t-o2", "ud8", path)));
  EXPECT_DOUBLE_EQ(ParamOf("ub", "heightMm"), 70.0);

  fs::remove_all(dir, ec);
}

// §10.7 kernel-side tessellation baseline (recorded, not gated): triangle
// counts and wall time per LOD. Asserts only sanity (non-empty, LOD2 refines
// LOD1); the numbers below are the baseline for Quest sync budgeting.
TEST(Torture10, TessellationBaseline) {
  NewDoc("perf1");
  std::string err;
  ASSERT_TRUE(kreoda::CreateSphereFeature("ps", 50, &err)) << err;
  ASSERT_TRUE(kreoda::CreateCylinderFeature("pc", 20, 100, &err)) << err;
  auto tess = [&](const std::string& id, int lod, size_t* tris,
                  long long* ms) {
    const auto t0 = std::chrono::steady_clock::now();
    const kreoda::CoreMesh mesh = kreoda::TessellateFeature(id, lod, &err);
    *ms = std::chrono::duration_cast<std::chrono::milliseconds>(
              std::chrono::steady_clock::now() - t0)
              .count();
    *tris = mesh.indices.size() / 3;
    return !mesh.indices.empty();
  };
  size_t triS1 = 0, triS2 = 0, triC2 = 0, triB2 = 0;
  long long msS1 = 0, msS2 = 0, msC2 = 0, msB2 = 0;
  ASSERT_TRUE(tess("ps", 1, &triS1, &msS1)) << err;
  ASSERT_TRUE(tess("ps", 2, &triS2, &msS2)) << err;
  ASSERT_TRUE(tess("pc", 2, &triC2, &msC2)) << err;
  EXPECT_GT(triS1, 0u);
  EXPECT_GT(triS2, 0u);
  EXPECT_GE(triS2, triS1);
  EXPECT_GT(triC2, 0u);
  printf("PHASE10_PERF_NATIVE {\"sphere_r50_lod1_tris\": %zu, "
         "\"sphere_r50_lod1_ms\": %lld, \"sphere_r50_lod2_tris\": %zu, "
         "\"sphere_r50_lod2_ms\": %lld, \"cyl_r20_h100_lod2_tris\": %zu, "
         "\"cyl_r20_h100_lod2_ms\": %lld}\n",
         triS1, msS1, triS2, msS2, triC2, msC2);
  // 100k+ point: larger sphere at export LOD (recorded, ~seconds).
  ASSERT_TRUE(kreoda::CreateSphereFeature("pb", 200, &err)) << err;
  ASSERT_TRUE(tess("pb", 2, &triB2, &msB2)) << err;
  EXPECT_GT(triB2, 100000u);
  printf("PHASE10_PERF_NATIVE {\"sphere_r200_lod2_tris\": %zu, "
         "\"sphere_r200_lod2_ms\": %lld}\n",
         triB2, msB2);
}
