#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <filesystem>

#include "../src/features/extrusion/extrude.h"
#include "../src/features/primitives/primitives.h"
#include "../src/features/revolve/revolve.h"
#include "../src/features/sketch/sketch_commands.h"
#include "../src/features/sketch/sketch_json.h"
#include "../src/features/sketch/sketch_store.h"
#include "../src/tessellation/mesh.h"
#include "../src/topology/face_roles.h"

#include "rpc_text.h"
#include "../src/document/document_store.h"
#include "../src/model/shapes.h"
#include "../src/protocol/dispatcher.h"

namespace fs = std::filesystem;

// §21 + §49: sketches solve exactly; extrude gives exact volumes;
// sketch edits propagate downstream; open profile rejected; save/open keeps
// the sketch + solid identical.

namespace {

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

void NewDoc(const std::string& id) {
  kreoda::DocumentStore::instance().create(id);
}

bool ok(const std::string& r) {
  return r.find("\"status\":\"ok\"") != std::string::npos;
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

}  // namespace

TEST(Sketch, DuplicateIdsRejected) {
  NewDoc("skd");
  std::string err;
  auto dupLine = RectModel(100, 50);
  dupLine.lines.push_back({"l0", "p2", "p3"});  // l0 twice
  EXPECT_FALSE(kreoda::CreateSketchFeature("sk-d1", "XY", dupLine, &err));
  auto dupPt = RectModel(100, 50);
  dupPt.points.push_back({"p0", 5, 5});
  EXPECT_FALSE(kreoda::CreateSketchFeature("sk-d2", "XY", dupPt, &err));
  auto dupCon = RectModel(100, 50);
  dupCon.constraints.push_back(
      {"h0", kreoda::SketchConstraintKind::Fixed, {"p0"}, 0});
  EXPECT_FALSE(kreoda::CreateSketchFeature("sk-d3", "XY", dupCon, &err));
  // Cross-type circle/arc collision.
  auto cross = RectModel(100, 50);
  cross.circles.push_back({"k", "p0", 10});
  cross.arcs.push_back({"k", "p0", 5, 0, 1});
  EXPECT_FALSE(kreoda::CreateSketchFeature("sk-d4", "XY", cross, &err));
}

TEST(Sketch, IdCollisionAcrossStoresRejected) {
  NewDoc("skc");
  std::string err;
  ASSERT_TRUE(
      kreoda::CreateSketchFeature("same-id", "XY", RectModel(100, 50), &err))
      << err;
  // Solid with a sketch id, and sketch with a solid id: both refused.
  EXPECT_FALSE(kreoda::CreateBoxFeature("same-id", 10, 10, 10, &err));
  ASSERT_TRUE(kreoda::CreateBoxFeature("solid-id", 10, 10, 10, &err)) << err;
  EXPECT_FALSE(
      kreoda::CreateSketchFeature("solid-id", "XY", RectModel(10, 10), &err));
  EXPECT_FALSE(kreoda::CreateExtrudeFeature("same-id", "same-id", 5, &err));
}

TEST(Sketch, FixedConstraintPinsPoint) {
  NewDoc("skf");
  std::string err;
  kreoda::SketchModel m;
  m.points = {{"a", 0, 0}, {"b", 30, 40}};
  m.constraints = {
      {"fix", kreoda::SketchConstraintKind::Fixed, {"a"}, 0},
      {"d", kreoda::SketchConstraintKind::Distance, {"a", "b"}, 50},
  };
  ASSERT_TRUE(kreoda::CreateSketchFeature("sk-f", "XY", m, &err)) << err;
  kreoda::SketchFeature sk;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("sk-f", &sk));
  // a pinned at origin, b at distance 50 along the original direction.
  EXPECT_NEAR(sk.model.points[0].x, 0.0, 1e-3);
  EXPECT_NEAR(sk.model.points[0].y, 0.0, 1e-3);
  EXPECT_NEAR(
      std::hypot(sk.model.points[1].x, sk.model.points[1].y), 50.0, 1e-3);
}

TEST(Sketch, UnknownDragPointRejected) {
  using namespace kreoda;
  auto solver = CreateSketchSolver();
  SolveOptions opts;
  opts.hasDragTarget = true;
  opts.dragPointId = "ghost";
  opts.dragX = 1;
  opts.dragY = 1;
  const auto r = solver->solve(RectModel(100, 50), opts);
  EXPECT_FALSE(r.ok);
  EXPECT_NE(r.error.find("ghost"), std::string::npos);
}

TEST(Sketch, ExtrudeRolesStableAcrossDistanceEdit) {
  NewDoc("skr");
  std::string err;
  ASSERT_TRUE(
      kreoda::CreateSketchFeature("sk-r", "XY", RectModel(100, 50), &err))
      << err;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("ex-r", "sk-r", 20, &err))
      << err;
  auto rolesBefore =
      kreoda::ClassifyFaceRoles(kreoda::ShapeStore::instance()
                                       .listInOrder()
                                       .back()
                                       .shape,
                                   "Extrude", "ex-r");
  ASSERT_TRUE(kreoda::RebuildFeature("ex-r", "distanceMm", 40, &err))
      << err;
  kreoda::ShapeRecord rec;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("ex-r", &rec));
  auto rolesAfter = kreoda::ClassifyFaceRoles(rec.shape, "Extrude", "ex-r");
  EXPECT_EQ(rolesBefore, rolesAfter);
  EXPECT_NE(std::find(rolesAfter.begin(), rolesAfter.end(),
                      "ex-r:extrude.+Z"),
            rolesAfter.end());
}

TEST(Sketch, JsonRoundTrip) {  const auto m = RectModel(100, 50);
  const std::string js = kreoda::SerializeSketchModel(m);
  kreoda::SketchModel back;
  std::string err;
  ASSERT_TRUE(kreoda::ParseSketchModel(js, &back, &err)) << err;
  EXPECT_EQ(back.points.size(), 4u);
  EXPECT_EQ(back.lines.size(), 4u);
  EXPECT_EQ(back.constraints.size(), 6u);
  EXPECT_EQ(back.points[1].x, 100);
  std::string bad;
  kreoda::SketchModel junk;
  EXPECT_FALSE(kreoda::ParseSketchModel("{bad", &junk, &bad));
  // Unknown constraint kind rejected (never silently dropped).
  EXPECT_FALSE(kreoda::ParseSketchModel(
      R"({"constraints":[{"id":"x","kind":"nope","refs":[]}]})", &junk, &bad));
}

TEST(Sketch, CreateSolvesExactly) {
  NewDoc("sk1");
  std::string err;
  ASSERT_TRUE(
      kreoda::CreateSketchFeature("sk-a", "XY", RectModel(100, 50), &err))
      << err;
  kreoda::SketchFeature sk;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("sk-a", &sk));
  EXPECT_EQ(sk.planeKind, "XY");
  // Solved coordinates written back.
  for (const auto& p : sk.model.points) {
    if (p.id == "p1") EXPECT_NEAR(p.x, 100.0, 1e-3);
    if (p.id == "p2") EXPECT_NEAR(p.y, 50.0, 1e-3);
  }
  // Duplicate id rejected.
  EXPECT_FALSE(
      kreoda::CreateSketchFeature("sk-a", "XY", RectModel(10, 10), &err));
  // Bad plane rejected.
  EXPECT_FALSE(
      kreoda::CreateSketchFeature("sk-b", "NOPE", RectModel(10, 10), &err));
  // Dangling ref rejected.
  auto bad = RectModel(10, 10);
  bad.lines.push_back({"lx", "p0", "ghost"});
  EXPECT_FALSE(kreoda::CreateSketchFeature("sk-c", "XY", bad, &err));
}

TEST(Sketch, ExtrudeGivesExactVolume) {
  NewDoc("sk2");
  std::string err;
  ASSERT_TRUE(
      kreoda::CreateSketchFeature("sk-r", "XY", RectModel(100, 50), &err))
      << err;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("ex-r", "sk-r", 20, &err))
      << err;
  kreoda::ShapeRecord rec;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("ex-r", &rec));
  EXPECT_NEAR(rec.volumeMm3, 100000.0, 1e-3);
  EXPECT_EQ(rec.dependsOn, std::vector<std::string>{"sk-r"});
}

TEST(Sketch, OpenProfileRejected) {
  NewDoc("sk3");
  std::string err;
  auto m = RectModel(100, 50);
  m.lines.pop_back();  // open chain (drop l3 + its constraints)
  m.constraints.erase(
      std::remove_if(m.constraints.begin(), m.constraints.end(),
                     [](const kreoda::SketchConstraint& c) {
                       return c.id == "v3" || c.id == "h2";
                     }),
      m.constraints.end());
  // Keep one width + height dimension so the sketch itself still solves.
  ASSERT_TRUE(kreoda::CreateSketchFeature("sk-o", "XY", m, &err)) << err;
  // Sketch solves (constraints fine) but extrude must refuse the open loop.
  EXPECT_FALSE(kreoda::CreateExtrudeFeature("ex-o", "sk-o", 20, &err));
  EXPECT_FALSE(err.empty());
}

TEST(Sketch, UpdatePropagatesDownstream) {
  NewDoc("sk4");
  std::string err;
  ASSERT_TRUE(
      kreoda::CreateSketchFeature("sk-u", "XY", RectModel(100, 50), &err))
      << err;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("ex-u", "sk-u", 20, &err))
      << err;
  const int64_t rev = kreoda::DocumentStore::instance().revision();
  ASSERT_TRUE(kreoda::UpdateSketchFeature("sk-u", RectModel(150, 50), &err))
      << err;
  kreoda::ShapeRecord rec;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("ex-u", &rec));
  EXPECT_NEAR(rec.volumeMm3, 150000.0, 1e-3);
  // One revision step for the sketch edit + downstream recompute (§12).
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), rev + 1);
}

TEST(Sketch, ConflictingEditRejectedKeepsOld) {
  NewDoc("sk5");
  std::string err;
  ASSERT_TRUE(
      kreoda::CreateSketchFeature("sk-k", "XY", RectModel(100, 50), &err))
      << err;
  auto conflict = RectModel(100, 50);
  conflict.constraints.push_back(
      {"w2", kreoda::SketchConstraintKind::Distance, {"p0", "p1"}, 999});
  EXPECT_FALSE(kreoda::UpdateSketchFeature("sk-k", conflict, &err));
  kreoda::SketchFeature sk;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("sk-k", &sk));
  EXPECT_NEAR(sk.model.points[1].x, 100.0, 1e-3);
}

TEST(Sketch, RevolveFullCircleExactVolume) {
  NewDoc("sk6");
  std::string err;
  // Rectangle in XZ from z=0..50, x=0..100, revolved 360° about the X axis
  // through the origin: volume = 100 * π * 50² (Pappus with centroid r=25
  // gives the same: 5000 * 2π * 25).
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
  ASSERT_TRUE(kreoda::CreateSketchFeature("sk-v", "XZ", m, &err)) << err;
  ASSERT_TRUE(kreoda::CreateRevolveFeature("rv-v", "sk-v", 360, &err))
      << err;
  kreoda::ShapeRecord rec;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("rv-v", &rec));
  // Pappus: area 5000, centroid radius 25 (z 0..50) → 5000*2π*25.
  EXPECT_NEAR(rec.volumeMm3, 5000.0 * 2 * 3.14159265358979 * 25.0,
              5000.0 * 2 * 3.14159265358979 * 25.0 * 1e-3);
  EXPECT_FALSE(kreoda::CreateRevolveFeature("rv-bad", "sk-v", 0, &err));
  EXPECT_FALSE(kreoda::CreateRevolveFeature("rv-bad2", "nope", 90, &err));
}

TEST(Sketch, ExtrudePreviewDoesNotCommit) {
  NewDoc("skp");
  std::string err;
  ASSERT_TRUE(
      kreoda::CreateSketchFeature("sk-p", "XY", RectModel(100, 50), &err))
      << err;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("ex-p", "sk-p", 20, &err))
      << err;
  const int64_t rev = kreoda::DocumentStore::instance().revision();
  kreoda::CoreMesh preview;
  ASSERT_TRUE(kreoda::BuildPreviewMesh("ex-p", "distanceMm", 40, &preview,
                                          &err))
      << err;
  EXPECT_NEAR(preview.volumeMm3, 200000.0, 1e-3);
  // Stored solid untouched: same revision, same volume.
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), rev);
  kreoda::ShapeRecord rec;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("ex-p", &rec));
  EXPECT_NEAR(rec.volumeMm3, 100000.0, 1e-3);
}

TEST(Sketch, UndoSketchEditRestoresDownstream) {
  NewDoc("sku");
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"z1","documentId":"sku","type":13,"featureId":"sk-z","planeKind":"XY","model":{"points":[{"id":"p0","x":0,"y":0},{"id":"p1","x":100,"y":0},{"id":"p2","x":100,"y":50},{"id":"p3","x":0,"y":50}],"lines":[{"id":"l0","p1":"p0","p2":"p1"},{"id":"l1","p1":"p1","p2":"p2"},{"id":"l2","p1":"p2","p2":"p3"},{"id":"l3","p1":"p3","p2":"p0"}],"constraints":[{"id":"h0","kind":"horizontal","refs":["l0"]},{"id":"h2","kind":"horizontal","refs":["l2"]},{"id":"v1","kind":"vertical","refs":["l1"]},{"id":"v3","kind":"vertical","refs":["l3"]},{"id":"w","kind":"distance","refs":["p0","p1"],"value":100},{"id":"h","kind":"distance","refs":["p1","p2"],"value":50}]}})")));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"z2","documentId":"sku","type":15,"featureId":"ex-z","sketchId":"sk-z","distanceMm":20})")));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"z3","documentId":"sku","type":14,"featureId":"sk-z","model":{"points":[{"id":"p0","x":0,"y":0},{"id":"p1","x":150,"y":0},{"id":"p2","x":150,"y":50},{"id":"p3","x":0,"y":50}],"lines":[{"id":"l0","p1":"p0","p2":"p1"},{"id":"l1","p1":"p1","p2":"p2"},{"id":"l2","p1":"p2","p2":"p3"},{"id":"l3","p1":"p3","p2":"p0"}],"constraints":[{"id":"h0","kind":"horizontal","refs":["l0"]},{"id":"h2","kind":"horizontal","refs":["l2"]},{"id":"v1","kind":"vertical","refs":["l1"]},{"id":"v3","kind":"vertical","refs":["l3"]},{"id":"w","kind":"distance","refs":["p0","p1"],"value":150},{"id":"h","kind":"distance","refs":["p1","p2"],"value":50}]}})")));
#ifdef KREODA_WITH_FLATBUFFERS
  EXPECT_NEAR(meshVolume(
                  R"({"protocolVersion":1,"requestId":"z4","documentId":"sku","type":12,"featureId":"ex-z","lod":1})"),
              150000.0, 1.0);
#else
  GTEST_SKIP() << "mesh binary needs flatbuffers";
#endif
  // Undo the sketch edit: solid AND sketch restore together.
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"z5","documentId":"sku","type":8})")));
#ifdef KREODA_WITH_FLATBUFFERS
  EXPECT_NEAR(meshVolume(
                  R"({"protocolVersion":1,"requestId":"z6","documentId":"sku","type":12,"featureId":"ex-z","lod":1})"),
              100000.0, 1.0);
#else
  GTEST_SKIP() << "mesh binary needs flatbuffers";
#endif
  // Sketch registry survived the round-trip (ResyncStore re-notes it).
  EXPECT_GT(kreoda::DocumentStore::instance().snapshotRegistry().count("sk-z"), 0u);
  // Redo re-applies.
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"z7","documentId":"sku","type":9})")));
#ifdef KREODA_WITH_FLATBUFFERS
  EXPECT_NEAR(meshVolume(
                  R"({"protocolVersion":1,"requestId":"z8","documentId":"sku","type":12,"featureId":"ex-z","lod":1})"),
              150000.0, 1.0);
#else
  GTEST_SKIP() << "mesh binary needs flatbuffers";
#endif
}

TEST(Sketch, SaveOpenKeepsSketchAndSolid) {
  NewDoc("sk7");
  std::string err;
  ASSERT_TRUE(
      kreoda::CreateSketchFeature("sk-s", "XY", RectModel(100, 50), &err))
      << err;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("ex-s", "sk-s", 20, &err))
      << err;
  const fs::path icad = fs::temp_directory_path() / "kreoda-sketch.icad";
  const std::string save =
      std::string(
          R"({"protocolVersion":1,"requestId":"q1","documentId":"sk7","type":10,"path":")") +
      icad.string() + "\"}";
  ASSERT_TRUE(ok(rpc(save))) << save;
  NewDoc("sk7b");
  const std::string open =
      std::string(
          R"({"protocolVersion":1,"requestId":"q2","documentId":"sk7b","type":11,"path":")") +
      icad.string() + "\"}";
  const std::string opened = rpc(open);
  ASSERT_TRUE(ok(opened)) << opened;
  EXPECT_NE(opened.find("sk-s"), std::string::npos);
  EXPECT_NE(opened.find("ex-s"), std::string::npos);
  kreoda::SketchFeature sk;
  EXPECT_TRUE(kreoda::SketchStore::instance().get("sk-s", &sk));
  EXPECT_EQ(sk.model.points.size(), 4u);
  kreoda::ShapeRecord rec;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("ex-s", &rec));
  EXPECT_NEAR(rec.volumeMm3, 100000.0, 1e-3);
  std::error_code ec;
  fs::remove(icad, ec);
}
