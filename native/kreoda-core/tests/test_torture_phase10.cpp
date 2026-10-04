// Phase 10 validation torture suites (§10.3–§10.7):
// persistent-topology mutations, save/open and resource cycles, large-model
// tessellation, undo/redo interleave, atomic-overwrite contract.

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <utility>
#include <vector>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef PSAPI_VERSION
#define PSAPI_VERSION 2
#endif
#include <windows.h>
#include <psapi.h>
#endif

#include "../src/document/document_store.h"
#include "../src/exchange/step_exchange.h"
#include "../src/expressions/expressions.h"
#include "../src/features/booleans/boolean.h"
#include "../src/features/extrusion/extrude.h"
#include "../src/features/fillet/fillet.h"
#include "../src/features/hole/hole.h"
#include "../src/features/instance/instance.h"
#include "../src/features/primitives/primitives.h"
#include "../src/features/sketch/sketch_commands.h"
#include "../src/model/body.h"
#include "../src/model/feature_graph.h"
#include "../src/model/shapes.h"
#include "../src/persistence/ocaf_live.h"
#include "../src/protocol/dispatcher.h"
#include "../src/tessellation/mesh.h"
#include "../src/topology/face_roles.h"
#include "../src/features/sketch/sketch_store.h"

#if KREODA_WITH_OCCT
#include <BRepCheck_Analyzer.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_TShape.hxx>
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

std::string saveRpc(const std::string& req, const std::string& doc, const std::string& path) {
  return rpc(nlohmann::json{{"protocolVersion", 1}, {"requestId", req}, {"documentId", doc}, {"type", 10}, {"path", path}}.dump());
}

std::string openRpc(const std::string& req, const std::string& doc, const std::string& path) {
  return rpc(nlohmann::json{{"protocolVersion", 1}, {"requestId", req}, {"documentId", doc}, {"type", 11}, {"path", path}}.dump());
}

std::string createDocumentRpc(const std::string& req,
                              const std::string& doc) {
  return rpc(std::string(R"({"protocolVersion":1,"requestId":")") + req +
             R"(","documentId":")" + doc + R"(","type":2})");
}

std::string createBoxRpc(const std::string& req, const std::string& doc,
                         const std::string& featureId, double width = 100,
                         double height = 60, double depth = 10) {
  return rpc(std::string(R"({"protocolVersion":1,"requestId":")") + req +
             R"(","documentId":")" + doc + R"(","type":3,"featureId":")" +
             featureId + R"(","widthMm":)" + std::to_string(width) +
             R"(,"heightMm":)" + std::to_string(height) +
             R"(,"depthMm":)" + std::to_string(depth) + "}");
}

std::string deleteFeatureRpc(const std::string& req, const std::string& doc,
                             const std::string& featureId) {
  return rpc(std::string(R"({"protocolVersion":1,"requestId":")") + req +
             R"(","documentId":")" + doc + R"(","type":7,"featureId":")" +
             featureId + "\"}");
}

struct ProcessResources {
  bool available = false;
  std::uint32_t handleCount = 0;
  std::uint64_t workingSetBytes = 0;
  std::uint64_t peakWorkingSetBytes = 0;
  std::uint64_t privateBytes = 0;
};

ProcessResources ReadProcessResources() {
  ProcessResources result;
#if defined(_WIN32)
  PROCESS_MEMORY_COUNTERS_EX memory{};
  memory.cb = static_cast<DWORD>(sizeof(memory));
  DWORD handles = 0;
  const HANDLE process = GetCurrentProcess();
  const BOOL memoryOk = GetProcessMemoryInfo(
      process, reinterpret_cast<PPROCESS_MEMORY_COUNTERS>(&memory),
      static_cast<DWORD>(sizeof(memory)));
  const BOOL handlesOk = GetProcessHandleCount(process, &handles);
  if (memoryOk != FALSE && handlesOk != FALSE) {
    result.available = true;
    result.handleCount = handles;
    result.workingSetBytes = memory.WorkingSetSize;
    result.peakWorkingSetBytes = memory.PeakWorkingSetSize;
    result.privateBytes = memory.PrivateUsage;
  }
#endif
  return result;
}

void PrintResourceCycles(const char* scenario, int cycles, long long elapsedMs,
                         const ProcessResources& baseline,
                         const ProcessResources& afterWarm,
                         const ProcessResources& final) {
  if (!baseline.available || !afterWarm.available || !final.available) {
    std::printf(
        "PHASE10_RESOURCE_NATIVE {\"scenario\":\"%s\",\"cycles\":%d,"
        "\"elapsed_ms\":%lld,\"windows_process_metrics_available\":false}\n",
        scenario, cycles, elapsedMs);
    return;
  }
  std::printf(
      "PHASE10_RESOURCE_NATIVE {\"scenario\":\"%s\",\"cycles\":%d,"
      "\"elapsed_ms\":%lld,\"ms_per_cycle\":%.2f,"
      "\"working_set_baseline_bytes\":%llu,"
      "\"working_set_after_warm_bytes\":%llu,"
      "\"working_set_final_bytes\":%llu,\"peak_working_set_bytes\":%llu,"
      "\"private_baseline_bytes\":%llu,\"private_after_warm_bytes\":%llu,"
      "\"private_final_bytes\":%llu,\"handles_baseline\":%u,"
      "\"handles_after_warm\":%u,\"handles_final\":%u}\n",
      scenario, cycles, elapsedMs,
      cycles > 0 ? static_cast<double>(elapsedMs) / cycles : 0.0,
      static_cast<unsigned long long>(baseline.workingSetBytes),
      static_cast<unsigned long long>(afterWarm.workingSetBytes),
      static_cast<unsigned long long>(final.workingSetBytes),
      static_cast<unsigned long long>(final.peakWorkingSetBytes),
      static_cast<unsigned long long>(baseline.privateBytes),
      static_cast<unsigned long long>(afterWarm.privateBytes),
      static_cast<unsigned long long>(final.privateBytes), baseline.handleCount,
      afterWarm.handleCount, final.handleCount);
}

void PrintPerfResourceSample(const char* scenario, const char* stage,
                             const ProcessResources& sample) {
  if (sample.available) {
    std::printf(
        "PHASE10_PERF_NATIVE {\"scenario\":\"%s\",\"stage\":\"%s\","
        "\"working_set_bytes\":%llu,\"peak_working_set_bytes\":%llu,"
        "\"private_bytes\":%llu,\"handles\":%u}\n",
        scenario, stage,
        static_cast<unsigned long long>(sample.workingSetBytes),
        static_cast<unsigned long long>(sample.peakWorkingSetBytes),
        static_cast<unsigned long long>(sample.privateBytes),
        sample.handleCount);
  } else {
    std::printf(
        "PHASE10_PERF_NATIVE {\"scenario\":\"%s\",\"stage\":\"%s\","
        "\"windows_process_metrics_available\":false}\n",
        scenario, stage);
  }
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

// Slice 3: a downstream failure keeps the tip at last good — old geometry,
// same body/history/tip, honest error, never a silently stale tip.
TEST(Torture10, UpstreamEditFailureKeepsTipAtLastGood) {
  NewDoc("tt-tip");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("tbt", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("tht", "tbt", "box.+Z", 50, 25, 8,
                                        "throughAll", 0, &err))
      << err;
  ASSERT_TRUE(kreoda::CreateFilletFeature(
                  "tft", "tbt", {"tbt:edge.lin.box.+X~box.-Z"}, 2, &err))
      << err;
  kreoda::BodyRecord before;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("tft", &before));
  const double holeVol = VolumeOf("tht");
  const double filletVol = VolumeOf("tft");

  // Shrinking width 100→20 pushes the hole at x=50 off the face: honest
  // failure with everything kept (params, volumes, body, tip).
  EXPECT_FALSE(kreoda::RebuildFeature("tbt", "widthMm", 20, &err));
  EXPECT_NE(err.find("misses the solid"), std::string::npos) << err;
  EXPECT_DOUBLE_EQ(ParamOf("tbt", "widthMm"), 100.0);
  EXPECT_DOUBLE_EQ(VolumeOf("tht"), holeVol);
  EXPECT_DOUBLE_EQ(VolumeOf("tft"), filletVol);
  kreoda::BodyRecord kept;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("tft", &kept));
  EXPECT_EQ(kept.bodyId, before.bodyId);
  EXPECT_EQ(kept.history, before.history);
  EXPECT_EQ(kept.tipFeatureId, "tft");
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
#if KREODA_WITH_OCCT
  kreoda::ShapeRecord tip;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("tft", &tip));
  EXPECT_FALSE(tip.shape.IsNull());
#endif
}

// Slice 3: save/open preserves body/history/tip with refs resolving after.
TEST(Torture10, SaveOpenPreservesTipAndRefs) {
  NewDoc("tt-save");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("tbs", 100, 50, 20, &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("ths", "tbs", "box.+Z", 50, 25, 8,
                                        "throughAll", 0, &err))
      << err;
  ASSERT_TRUE(kreoda::CreateFilletFeature(
                  "tfs", "tbs", {"tbs:edge.lin.box.+X~box.-Z"}, 2, &err))
      << err;
  kreoda::BodyRecord before;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("tfs", &before));
  const double holeVol = VolumeOf("ths");
  const fs::path dir = fs::temp_directory_path() / "kreoda-torture-tip";
  std::error_code ec;
  fs::create_directories(dir, ec);
  // The fixture serializer escapes Windows path separators.
  const std::string path = (dir / "state.icad").string();
  const std::string saved = saveRpc("s", "tt-save", path);
  ASSERT_TRUE(ok(saved)) << saved;

  NewDoc("tt-save2");
  ASSERT_TRUE(ok(openRpc("o", "tt-save2", path)));
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 1u);
  kreoda::BodyRecord after;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("tfs", &after));
  EXPECT_EQ(after.bodyId, before.bodyId);
  EXPECT_EQ(after.history, before.history);
  EXPECT_EQ(after.tipFeatureId, "tfs");
  EXPECT_NEAR(VolumeOf("ths"), holeVol, 1.0);
  EXPECT_TRUE(TopFaceResolves("ths"));
#if KREODA_WITH_OCCT
  kreoda::ShapeRecord box;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("tbs", &box));
  TopoDS_Edge edge;
  EXPECT_TRUE(kreoda::FindEdgeByRole(box.shape, "tbs", box.type,
                                     "edge.lin.box.+X~box.-Z", &edge));
#endif
  fs::remove_all(dir, ec);
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

TEST(Torture10, SketchGeometryAddRemoveReflowsExtrude) {
#if !KREODA_WITH_OCCT
  GTEST_SKIP() << "requires OCCT downstream recompute";
#else
  NewDoc("tt-sketch-entities");
  std::string err;
  ASSERT_TRUE(kreoda::CreateSketchFeature(
      "ts-entities", "XY", RectModel(100, 50), &err)) << err;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("te-entities", "ts-entities", 20,
                                           &err)) << err;
  EXPECT_NEAR(VolumeOf("te-entities"), 100000.0, 1.0);

  auto withHole = RectModel(100, 50);
  withHole.points.push_back({"p-hole", 50, 25, true});
  withHole.circles.push_back({"c-hole", "p-hole", 5});
  ASSERT_TRUE(kreoda::UpdateSketchFeature("ts-entities", withHole, &err))
      << err;
  kreoda::SketchFeature sketch;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("ts-entities", &sketch));
  EXPECT_EQ(sketch.model.points.size(), 5u);
  EXPECT_EQ(sketch.model.circles.size(), 1u);
  EXPECT_NEAR(VolumeOf("te-entities"),
              100000.0 - 3.14159265358979 * 25.0 * 20.0, 2.0);

  auto tinyHole = withHole;
  tinyHole.circles[0].r = 1e-8;
  EXPECT_FALSE(kreoda::UpdateSketchFeature("ts-entities", tinyHole, &err))
      << "a sub-tolerance hole must be refused instead of disappearing";
  ASSERT_TRUE(kreoda::SketchStore::instance().get("ts-entities", &sketch));
  ASSERT_EQ(sketch.model.circles.size(), 1u);
  EXPECT_DOUBLE_EQ(sketch.model.circles[0].r, 5);
  EXPECT_NEAR(VolumeOf("te-entities"),
              100000.0 - 3.14159265358979 * 25.0 * 20.0, 2.0);

  ASSERT_TRUE(kreoda::UpdateSketchFeature(
      "ts-entities", RectModel(100, 50), &err)) << err;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("ts-entities", &sketch));
  EXPECT_EQ(sketch.model.points.size(), 4u);
  EXPECT_TRUE(sketch.model.circles.empty());
  EXPECT_NEAR(VolumeOf("te-entities"), 100000.0, 1.0);
#endif
}

TEST(Torture10, CurvedSketchOuterLoopsAndHoleWinding) {
#if !KREODA_WITH_OCCT
  GTEST_SKIP() << "requires OCCT curved sketch faces";
#else
  for (const std::string plane : {"XY", "XZ", "YZ"}) {
    NewDoc("curved-profile-" + plane);
    std::string err;
    kreoda::SketchModel circle;
    circle.points = {{"center", 0, 0, true}};
    circle.circles = {{"outer", "center", 100}};
    ASSERT_TRUE(kreoda::CreateSketchFeature("curved-sketch", plane, circle, &err)) << err;
    ASSERT_TRUE(kreoda::CreateExtrudeFeature("curved-extrude", "curved-sketch", 3, &err)) << err;
    EXPECT_NEAR(VolumeOf("curved-extrude"), 3.14159265358979 * 10000 * 3, 1.0);

    auto withHole = RectModel(20, 20);
    withHole.points.push_back({"center", 0, 0, true});
    withHole.circles = circle.circles;
    ASSERT_TRUE(kreoda::UpdateSketchFeature("curved-sketch", withHole, &err)) << plane << ": " << err;
    EXPECT_NEAR(VolumeOf("curved-extrude"), (3.14159265358979 * 10000 - 400) * 3, 1.0);
    // Reverse the inner polygon winding while preserving its constraint IDs.
    for (auto& line : withHole.lines) std::swap(line.p1, line.p2);
    ASSERT_TRUE(kreoda::UpdateSketchFeature("curved-sketch", withHole, &err)) << plane << ": " << err;
    EXPECT_NEAR(VolumeOf("curved-extrude"), (3.14159265358979 * 10000 - 400) * 3, 1.0);
  }
#endif
}

TEST(Torture10, InsertUpstreamHoleReflowsHistoryUndoAndReopen) {
#if KREODA_WITH_OCCT
  NewDoc("insert");
  std::string err;
  const auto mesh = [&](const std::string& id) {
    const auto rendered = kreoda::TessellateFeature(id, 1, &err);
    EXPECT_FALSE(rendered.indices.empty()) << id << ": " << err;
  };
  ASSERT_TRUE(kreoda::CreateBoxFeature("plate", 100, 60, 10, &err)) << err;
  mesh("plate");
  ASSERT_TRUE(kreoda::CreateFilletFeature("round", "plate",
      {"plate:edge.lin.box.+X~box.+Z"}, 1, &err)) << err;
  mesh("round");
  const double original = VolumeOf("round");
  const int undos = kreoda::OcafLive::instance().AvailableUndos();
  kreoda::OcafLive::FaceSelection top;
  ASSERT_TRUE(kreoda::OcafLive::instance().SelectFace("round", "box.+Z", &top, &err));
  EXPECT_EQ(top.entry.rfind("0:1:1001:", 0), 0u);
  const auto reply = rpc(R"({"protocolVersion":1,"requestId":"i","documentId":"insert","type":20,"featureId":"inserted","targetId":"plate","faceRole":"box.+Z","xMm":50,"yMm":30,"diameterMm":8,"depthMode":"throughAll","depthMm":0,"insertBeforeId":"round"})");
  ASSERT_TRUE(ok(reply)) << reply;
  kreoda::BodyRecord body;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("round", &body));
  ASSERT_EQ(body.history, (std::vector<std::string>{"plate", "inserted", "round"}));
  EXPECT_EQ(body.tipFeatureId, "round");
  kreoda::ShapeRecord rounded;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("round", &rounded));
  EXPECT_EQ(rounded.dependsOn, (std::vector<std::string>{"inserted"}));
  EXPECT_EQ(rounded.refExtra, "inserted:edge.lin.box.+X~box.+Z");
  EXPECT_NEAR(VolumeOf("round"), original - 3.14159265358979 * 16 * 10, 1);
  EXPECT_TRUE(kreoda::OcafLive::instance().ResolveSelection(top).valid);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos + 1);
  mesh("round");
  ASSERT_TRUE(ok(rpc(R"({"protocolVersion":1,"requestId":"u","documentId":"insert","type":8})")));
  mesh("round");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("inserted"));
  EXPECT_NEAR(VolumeOf("round"), original, 1e-6);
  ASSERT_TRUE(ok(rpc(R"({"protocolVersion":1,"requestId":"r","documentId":"insert","type":9})")));
  mesh("round");
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("round", &body));
  EXPECT_EQ(body.history, (std::vector<std::string>{"plate", "inserted", "round"}));
#if KREODA_WITH_MINIZIP
  const auto file = fs::temp_directory_path() / "kreoda-upstream-insert.icad";
  auto fileRpc = [&](int type) {
    return rpc("{\"protocolVersion\":1,\"requestId\":\"file\",\"documentId\":\"insert\",\"type\":" + std::to_string(type) + ",\"path\":\"" + file.generic_string() + "\"}");
  };
  ASSERT_TRUE(ok(fileRpc(10)));
  NewDoc("insert");
  ASSERT_TRUE(ok(fileRpc(11)));
  fs::remove(file);
#endif
  mesh("round");
  mesh("plate");  // historical face fetched lazily by the dialog after Open
  EXPECT_TRUE(kreoda::OcafLive::instance().ResolveSelection(top).valid);
  ASSERT_TRUE(kreoda::CreateHoleFeature("second", "plate", "box.+Z", 20, 20, 8,
      "throughAll", 0, &err, "inserted")) << err;
  mesh("round");
  ASSERT_TRUE(kreoda::RebuildFeature("plate", "widthMm", 120, &err)) << err;
  EXPECT_NEAR(VolumeOf("round"), original + 12000 - 2 * 3.14159265358979 * 16 * 10, 2);
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("round", &body));
  EXPECT_EQ(body.history, (std::vector<std::string>{"plate", "second", "inserted", "round"}));
#endif
}

TEST(Torture10, UpstreamInsertionFailureRestoresAllState) {
#if KREODA_WITH_OCCT
  NewDoc("insert-fail");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("plate", 100, 60, 10, &err));
  ASSERT_TRUE(kreoda::CreateHoleFeature("old", "plate", "box.+Z", 20, 20, 6, "throughAll", 0, &err));
  const double oldVolume = VolumeOf("old");
  ASSERT_TRUE(kreoda::RebuildFeature("plate", "widthMm", 120, &err)) << err;
  ASSERT_TRUE(kreoda::OcafLive::instance().Undo(&err)) << err;
  ASSERT_EQ(kreoda::OcafLive::instance().AvailableRedos(), 1);
  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();
  const auto insert = [&](const std::string& before) {
    return rpc(R"({"protocolVersion":1,"requestId":"i","documentId":"insert-fail","type":20,"featureId":"new","targetId":"plate","faceRole":"box.+Z","xMm":20,"yMm":20,"diameterMm":8,"depthMode":"throughAll","depthMm":0,"insertBeforeId":")" + before + "\"}");
  };
  EXPECT_FALSE(ok(insert("ghost")));
  const auto failed = insert("old");
  EXPECT_FALSE(ok(failed)) << failed;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("new"));
  EXPECT_FALSE(kreoda::TheFeatureGraph().hasFeature("new"));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableRedos(), 1);
  EXPECT_NEAR(VolumeOf("old"), oldVolume, 1e-6);
  kreoda::BodyRecord body;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("old", &body));
  EXPECT_EQ(body.history, (std::vector<std::string>{"plate", "old"}));
  ASSERT_TRUE(kreoda::OcafLive::instance().BeginTransaction("abort-redo", &err)) << err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("temporary", 10, 10, 10, &err)) << err;
  ASSERT_TRUE(kreoda::OcafLive::instance().RollbackTransaction("abort-redo", &err)) << err;
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableRedos(), 1);
  ASSERT_TRUE(kreoda::OcafLive::instance().Redo(&err)) << err;
  EXPECT_NEAR(VolumeOf("old"), oldVolume + 12000, 1);
  ASSERT_TRUE(kreoda::OcafLive::instance().Undo(&err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("new", "plate", "box.+Z", 70, 40, 8,
      "throughAll", 0, &err, "old")) << err;  // the aborted id remains reusable
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableRedos(), 0);
#endif
}

TEST(Torture10, UpstreamInsertionRejectsIndexedReferencesAndAmbiguousFaces) {
#if KREODA_WITH_OCCT
  std::string err;
  const auto setup = [&] {
    NewDoc("insert-guard");
    EXPECT_TRUE(kreoda::CreateBoxFeature("plate", 100, 60, 10, &err));
    EXPECT_TRUE(kreoda::CreateHoleFeature("old", "plate", "box.+Z", 20, 20, 6, "throughAll", 0, &err));
  };
  const auto insert = [&](const std::string& mode, double depth) {
    return rpc(R"({"protocolVersion":1,"requestId":"i","documentId":"insert-guard","type":20,"featureId":"new","targetId":"plate","faceRole":"box.+Z","xMm":70,"yMm":40,"diameterMm":8,"insertBeforeId":"old","depthMode":")" + mode + "\",\"depthMm\":" + std::to_string(depth) + "}");
  };
  setup();
  kreoda::OcafLive::FaceSelection wall;
  ASSERT_TRUE(kreoda::OcafLive::instance().SelectFace("old", "wall.0", &wall, &err));
  auto reply = insert("throughAll", 0);
  EXPECT_FALSE(ok(reply));
  EXPECT_NE(reply.find("needs repair"), std::string::npos) << reply;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("new"));
  EXPECT_TRUE(kreoda::OcafLive::instance().ResolveSelection(wall).valid);
  setup();
  ASSERT_TRUE(kreoda::CreateFilletFeature("rim", "old", {"old:edge.cir.box.+Z~wall.0"}, 1, &err)) << err;
  reply = insert("throughAll", 0);
  EXPECT_FALSE(ok(reply));
  EXPECT_NE(reply.find("indexed topology"), std::string::npos) << reply;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("new"));
  setup();
  const auto volume = VolumeOf("old");
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();
  reply = insert("blind", 3);  // blind cap duplicates box.+Z on the new target
  EXPECT_FALSE(ok(reply));
  EXPECT_NE(reply.find("needs repair"), std::string::npos) << reply;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("new"));
  EXPECT_NEAR(VolumeOf("old"), volume, 1e-6);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
  ASSERT_TRUE(kreoda::OcafLive::instance().BeginTransaction("txn", &err));
  EXPECT_FALSE(ok(insert("throughAll", 0)));
  EXPECT_TRUE(kreoda::OcafLive::instance().InTransaction());
  ASSERT_TRUE(kreoda::OcafLive::instance().RollbackTransaction("txn", &err));
  EXPECT_NEAR(VolumeOf("old"), volume, 1e-6);
  ASSERT_TRUE(kreoda::CreateHoleFeature("sibling", "plate", "box.+Z", 80, 40, 6,
      "throughAll", 0, &err));
  reply = insert("throughAll", 0);
  EXPECT_FALSE(ok(reply));
  EXPECT_NE(reply.find("branched history"), std::string::npos) << reply;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("new"));
  NewDoc("insert-ambiguous");
  ASSERT_TRUE(kreoda::CreateBoxFeature("base", 100, 50, 20, &err));
  ASSERT_TRUE(kreoda::CreateBoxFeature("tool", 40, 40, 40, &err));
  ASSERT_TRUE(kreoda::CreateBooleanFeature("fused", "fuse", "base", "tool", &err));
  ASSERT_TRUE(kreoda::CreateHoleFeature("old", "fused", "box.+Z", 20, 20, 8, "throughAll", 0, &err));
  const auto ambiguousVolume = VolumeOf("old");
  EXPECT_FALSE(kreoda::CreateHoleFeature("new", "fused", "box.+Z", 70, 20, 8,
      "throughAll", 0, &err, "old"));
  EXPECT_NE(err.find("selected face needs repair"), std::string::npos) << err;
  EXPECT_NEAR(VolumeOf("old"), ambiguousVolume, 1e-6);
#endif
}

// §10.3 HolePattern.* covers changing the active count of 1..4 authored
// centers, dimensions, upstream edits, preview, references and atomic failure.
// InsertUpstreamHole* covers a new predecessor in a linear body history,
// preserved UUID/tip, remapped semantic edges and explicit repair failures.

// §10.4: 100 edit/save/close/open cycles — UUIDs, params, expressions stable.
TEST(Torture10, ReferenceMetadata100CyclesAndFailedSave) {
  const fs::path dir = fs::temp_directory_path() / "kreoda-reference-cycles";
  std::error_code ec;
  fs::create_directories(dir, ec);
  const std::string path = (dir / "reference.icad").generic_string();
  const std::string references = R"([{"id":"ref-a","name":"plate \"A\" \\path\nline","dataUrl":"data:image/png;base64,AAAA","imageW":200,"imageH":100,"widthMm":100,"heightMm":50,"mmPerPx":0.5,"plane":"XZ","opacity":0.4}])";
  std::string quoted;
  for (char c : references) {
    if (c == '"' || c == '\\') quoted.push_back('\\');
    quoted.push_back(c);
  }
  NewDoc("references-only");
  // An empty CAD document with only references must still reopen.
  const auto saved = rpc(std::string(R"({"protocolVersion":1,"requestId":"refs","documentId":"references-only","type":10,"path":")") + path + R"(","referencePlanesJson":")" + quoted + "\"}");
  ASSERT_TRUE(ok(saved)) << saved;
  for (int i = 0; i < 100; ++i) {
    NewDoc("references-loaded");
    EXPECT_EQ(kreoda::DocumentStore::instance().referencePlanesJson(), "[]");
    const auto opened = openRpc("refs-open", "references-loaded", path);
    ASSERT_TRUE(ok(opened)) << opened;
    EXPECT_EQ(kreoda::json_string_field_strict(opened, "referencePlanesJson"), references);
    EXPECT_EQ(kreoda::DocumentStore::instance().referencePlanesJson(), references);
    const auto snapshot = rpc(R"({"protocolVersion":1,"requestId":"refs-snapshot","documentId":"references-loaded","type":26,"includeReferencePlanes":true})");
    ASSERT_TRUE(ok(snapshot)) << snapshot;
    EXPECT_EQ(kreoda::json_string_field_strict(snapshot, "referencePlanesJson"), references);
    EXPECT_EQ(kreoda::json_string_field_strict(snapshot, "documentId"), "references-loaded");
    // Old clients omit metadata on save; it must be preserved.
    ASSERT_TRUE(ok(saveRpc("refs-save", "references-loaded", path)));
  }
  const std::string badPath = (dir / "blocked.icad").generic_string();
  fs::create_directory(badPath, ec);
  const auto failed = rpc(std::string(R"({"protocolVersion":1,"requestId":"refs-fail","documentId":"references-loaded","type":10,"path":")") + badPath + R"(","referencePlanesJson":"[]"})");
  EXPECT_FALSE(ok(failed));
  EXPECT_EQ(kreoda::DocumentStore::instance().referencePlanesJson(), references);
  const auto failedOpen = openRpc("refs-bad-open", "references-loaded", badPath);
  EXPECT_FALSE(ok(failedOpen));
  EXPECT_EQ(kreoda::DocumentStore::instance().referencePlanesJson(), references);
  fs::remove_all(dir, ec);
}

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

// §10.4: repeat the complete requested sequence, including a second edit,
// Save As, Undo/Redo and the second close/open. A placed instance and a second
// body share the parametric fixture so assembly references are checked on
// every cycle, alongside UUIDs, expressions, reference metadata and revisions.
TEST(Torture10, CompletePersistenceSequence100Cycles) {
  const auto nonce = std::chrono::steady_clock::now().time_since_epoch().count();
  const fs::path dir = fs::temp_directory_path() /
                       ("kreoda-full-persistence-" + std::to_string(nonce));
  std::error_code ec;
  ASSERT_TRUE(fs::create_directory(dir, ec)) << ec.message();
  struct OwnedDirectory {
    fs::path path;
    ~OwnedDirectory() {
      std::error_code cleanup;
      fs::remove_all(path, cleanup);
    }
  } owned{dir};
  const std::string original = (dir / "original.icad").generic_string();
  const std::string saveAs = (dir / "save-as.icad").generic_string();
  const std::string doc = "full-persistence";
  const auto readOriginal = [&]() {
    std::ifstream input(original, std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(input),
                       std::istreambuf_iterator<char>());
  };
  const std::string references =
      R"([{"id":"reference-plate","name":"plate","dataUrl":"data:image/png;base64,AAAA","imageW":200,"imageH":100,"widthMm":100,"heightMm":50,"mmPerPx":0.5,"plane":"XZ","opacity":0.4}])";
  NewDoc(doc);
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("source", 120, 60, 10, &err)) << err;
  ASSERT_TRUE(kreoda::RebuildFeature("source", "widthMm", 0,
                                      "heightMm * 2", &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("hole", "source", "box.+Z", 30, 20,
                                        6, "throughAll", 0, &err)) << err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("other-body", 10, 20, 30, &err)) << err;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("placed", "hole",
                                            {50, 0, 0, 0, 0, 0}, &err)) << err;
  kreoda::DocumentStore::instance().setReferencePlanesJson(references);
  const auto registry = kreoda::DocumentStore::instance().snapshotRegistry();
  const std::string bodies = kreoda::SerializeBodiesJson();
  ASSERT_EQ(registry.size(), 4u);
  ASSERT_EQ(kreoda::BodyStore::instance().size(), 2u);

  const auto verify = [&](double height) -> ::testing::AssertionResult {
    if (kreoda::DocumentStore::instance().snapshotRegistry() != registry ||
        kreoda::SerializeBodiesJson() != bodies ||
        kreoda::TheFeatureGraph().size() != 4u ||
        kreoda::ShapeStore::instance().listInOrder().size() != 4u)
      return ::testing::AssertionFailure() << "UUIDs, body history or graph changed";
    for (const auto& entry : registry)
      if (!kreoda::TheFeatureGraph().hasFeature(entry.first))
        return ::testing::AssertionFailure() << "graph lost " << entry.first;
    if (ParamOf("source", "heightMm") != height ||
        ParamOf("source", "widthMm") != 2 * height)
      return ::testing::AssertionFailure() << "source parameters/formula changed";
    std::string formula;
    if (!kreoda::ExpressionStore::instance().get("source", "widthMm", &formula) ||
        formula != "heightMm * 2")
      return ::testing::AssertionFailure() << "expression not preserved";
    kreoda::ShapeRecord hole, placed;
    if (!kreoda::ShapeStore::instance().get("hole", &hole) ||
        !kreoda::ShapeStore::instance().get("placed", &placed) ||
        hole.dependsOn != std::vector<std::string>{"source"} ||
        placed.dependsOn != std::vector<std::string>{"hole"})
      return ::testing::AssertionFailure() << "feature/assembly references changed";
    const double volume = 2 * height * height * 10 - std::acos(-1.0) * 9 * 10;
    if (std::abs(hole.volumeMm3 - volume) > 0.1 ||
        std::abs(placed.volumeMm3 - volume) > 0.1 ||
        std::abs(VolumeOf("other-body") - 6000) > 0.1 ||
        placed.paramsMm != std::vector<double>{50, 0, 0, 0, 0, 0})
      return ::testing::AssertionFailure()
             << "dependent geometry/placement changed: expected " << volume
             << ", hole " << hole.volumeMm3 << ", placed " << placed.volumeMm3;
    if (kreoda::DocumentStore::instance().referencePlanesJson() != references)
      return ::testing::AssertionFailure() << "reference metadata changed";
    return ::testing::AssertionSuccess();
  };
  for (int cycle = 0; cycle < 100; ++cycle) {
    SCOPED_TRACE("full persistence cycle " + std::to_string(cycle));
    const double firstHeight = 65 + cycle;
    const double secondHeight = firstHeight + 0.5;
    auto revision = kreoda::DocumentStore::instance().snapshotRevision();
    ASSERT_TRUE(kreoda::RebuildFeature("source", "heightMm", firstHeight, &err)) << err;
    ASSERT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision + 1);
    ASSERT_TRUE(verify(firstHeight));
    revision = kreoda::DocumentStore::instance().snapshotRevision();
    ASSERT_TRUE(ok(saveRpc("full-save", doc, original)));
    ASSERT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
    const std::string originalBytes = readOriginal();
    ASSERT_FALSE(originalBytes.empty());
    ASSERT_TRUE(ok(createDocumentRpc("full-close", doc)));
    ASSERT_TRUE(kreoda::ShapeStore::instance().listInOrder().empty());
    ASSERT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), 0);
    ASSERT_TRUE(ok(openRpc("full-open", doc, original)));
    // Open establishes one new session revision; saved revision numbers are
    // not the contract. Subsequent mutations must still advance exactly once.
    ASSERT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), 1);
    ASSERT_TRUE(verify(firstHeight));
    ASSERT_TRUE(kreoda::RebuildFeature("source", "heightMm", secondHeight, &err)) << err;
    ASSERT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), 2);
    ASSERT_TRUE(verify(secondHeight));
    ASSERT_TRUE(ok(saveRpc("full-save-as", doc, saveAs)));
    ASSERT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), 2);
    ASSERT_TRUE(fs::exists(original) && fs::exists(saveAs));
    ASSERT_EQ(readOriginal(), originalBytes) << "Save As replaced the original file";
    ASSERT_TRUE(ok(rpc(R"({"protocolVersion":1,"requestId":"full-undo","documentId":"full-persistence","type":8})")));
    ASSERT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), 3);
    ASSERT_TRUE(verify(firstHeight));
    ASSERT_TRUE(ok(rpc(R"({"protocolVersion":1,"requestId":"full-redo","documentId":"full-persistence","type":9})")));
    ASSERT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), 4);
    ASSERT_TRUE(verify(secondHeight));
    ASSERT_EQ(readOriginal(), originalBytes) << "Undo/Redo modified the saved original";
    ASSERT_TRUE(ok(createDocumentRpc("full-close-again", doc)));
    ASSERT_TRUE(kreoda::ShapeStore::instance().listInOrder().empty());
    ASSERT_TRUE(ok(openRpc("full-open-as", doc, saveAs)));
    ASSERT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), 1);
    ASSERT_TRUE(verify(secondHeight));
  }
  std::printf("PHASE10_PERSISTENCE_SEQUENCE {\"cycles\":100,\"features\":4,\"bodies\":2,\"placed_instances\":1,\"sequence\":\"edit-save-close-open-edit-save_as-undo-redo-close-open\",\"reference_metadata\":true,\"revision_scope\":\"new session baseline plus one increment per committed mutation\"}\n");
}

// §10.2 workflow A starts at a dimensioned sketch, not a substitute primitive.
// Keep the older box workflow as a separate renderer regression.
TEST(Torture10, GoldenSketchBracketCompleteWorkflow) {
#if !KREODA_WITH_OCCT
  GTEST_SKIP() << "requires real OCCT geometry and persistence";
#else
  const auto nonce = std::chrono::steady_clock::now().time_since_epoch().count();
  const fs::path dir = fs::temp_directory_path() /
                       ("kreoda-sketch-bracket-" + std::to_string(nonce));
  std::error_code ec;
  ASSERT_TRUE(fs::create_directory(dir, ec)) << ec.message();
  struct OwnedDirectory {
    fs::path path;
    ~OwnedDirectory() { std::error_code cleanup; fs::remove_all(path, cleanup); }
  } owned{dir};
  const std::string icad = (dir / "bracket.icad").generic_string();
  const std::string step = (dir / "bracket.step").generic_string();
  NewDoc("sketch-bracket");
  std::string err;
  ASSERT_TRUE(kreoda::CreateSketchFeature("profile", "XY", RectModel(100, 60), &err)) << err;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("plate", "profile", 10, &err)) << err;
  // Face-local axes on a sketch extrusion need not match world XY. Convert
  // authored world positions through the actual surface frame.
  const auto point = [](const std::string& target, const std::string& role,
                        double x, double y) {
    kreoda::ShapeRecord shape;
    EXPECT_TRUE(kreoda::ShapeStore::instance().get(target, &shape));
    double origin[3]{}, u[3]{}, v[3]{}, normal[3]{};
    EXPECT_TRUE(kreoda::FaceFrameInfo(shape.shape, target, shape.type, role,
                                      origin, u, v, normal));
    const double offset[3] = {x - origin[0], y - origin[1], shape.bboxMm[5] - origin[2]};
    return std::pair<double, double>{
        offset[0] * u[0] + offset[1] * u[1] + offset[2] * u[2],
        offset[0] * v[0] + offset[1] * v[1] + offset[2] * v[2]};
  };
  // A second feature precedes the main hole, as required by the workflow.
  const auto pilotPoint = point("plate", "extrude.+Z", 30, 15);
  ASSERT_TRUE(kreoda::CreateHoleFeature("pilot", "plate", "extrude.+Z",
                                        pilotPoint.first, pilotPoint.second,
                                        4, "throughAll", 0, &err)) << err;
  const auto centerPoint = point("pilot", "box.+Z", 50, 30);
  ASSERT_TRUE(kreoda::CreateHoleFeature("center", "pilot", "box.+Z",
                                        centerPoint.first, centerPoint.second,
                                        8, "throughAll", 0, &err)) << err;
  std::vector<std::string> created;
  ASSERT_TRUE(kreoda::CreateHolePatternFeature(
      "center", "box.+Z", {point("center", "box.+Z", 8, 8),
          point("center", "box.+Z", 92, 8), point("center", "box.+Z", 92, 52),
          point("center", "box.+Z", 8, 52)},
      6, "throughAll", 0, {"corners", "corner-2", "corner-3", "corner-4"},
      &created, &err)) << err;
  ASSERT_EQ(created, std::vector<std::string>{"corners"});
  EXPECT_NEAR(VolumeOf("corners"), 60000 - std::acos(-1.0) * 56 * 10, 0.1);
  const std::string edge = "corners:edge.lin.box.+X~box.-Z";
  ASSERT_TRUE(kreoda::CreateFilletFeature("round", "corners", {edge}, 2, &err)) << err;
  ASSERT_TRUE(kreoda::RebuildFeature("plate", "distanceMm", 0, "5 * 3", &err)) << err;
  ASSERT_DOUBLE_EQ(ParamOf("plate", "distanceMm"), 15);
  const auto registry = kreoda::DocumentStore::instance().snapshotRegistry();
  const std::string bodies = kreoda::SerializeBodiesJson();
  const double before = VolumeOf("round");
  ASSERT_TRUE(kreoda::UpdateSketchFeature("profile", RectModel(120, 60), &err)) << err;
  const double after = VolumeOf("round");
  ASSERT_GT(after, before);
  EXPECT_NEAR(VolumeOf("corners"), 120 * 60 * 15 - std::acos(-1.0) * 56 * 15, 0.1);
  ASSERT_TRUE(ok(rpc(R"({"protocolVersion":1,"requestId":"bracket-undo","documentId":"sketch-bracket","type":8})")));
  EXPECT_NEAR(VolumeOf("round"), before, 1e-6);
  ASSERT_TRUE(ok(rpc(R"({"protocolVersion":1,"requestId":"bracket-redo","documentId":"sketch-bracket","type":9})")));
  EXPECT_NEAR(VolumeOf("round"), after, 1e-6);
  ASSERT_TRUE(ok(saveRpc("bracket-save", "sketch-bracket", icad)));
  ASSERT_TRUE(ok(createDocumentRpc("bracket-close", "sketch-bracket")));
  ASSERT_TRUE(kreoda::SketchStore::instance().listInOrder().empty());
  ASSERT_TRUE(ok(openRpc("bracket-open", "sketch-bracket", icad)));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRegistry(), registry);
  EXPECT_EQ(kreoda::SerializeBodiesJson(), bodies);
  EXPECT_NEAR(VolumeOf("round"), after, 1e-6);
  kreoda::SketchFeature reopenedProfile;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("profile", &reopenedProfile));
  const auto width = std::find_if(reopenedProfile.model.constraints.begin(),
      reopenedProfile.model.constraints.end(),
      [](const auto& constraint) { return constraint.id == "w"; });
  ASSERT_NE(width, reopenedProfile.model.constraints.end());
  EXPECT_DOUBLE_EQ(width->value, 120);
  std::string formula;
  ASSERT_TRUE(kreoda::ExpressionStore::instance().get("plate", "distanceMm", &formula));
  EXPECT_EQ(formula, "5 * 3");
  const std::vector<std::pair<std::string, std::vector<std::string>>> dependencies = {
      {"plate", {"profile"}}, {"pilot", {"plate"}}, {"center", {"pilot"}},
      {"corners", {"center"}}, {"round", {"corners"}}};
  for (const auto& entry : dependencies) {
    kreoda::ShapeRecord shape;
    ASSERT_TRUE(kreoda::ShapeStore::instance().get(entry.first, &shape));
    EXPECT_EQ(shape.dependsOn, entry.second);
    EXPECT_TRUE(kreoda::TheFeatureGraph().hasFeature(entry.first));
    EXPECT_TRUE(BRepCheck_Analyzer(shape.shape).IsValid()) << entry.first;
  }
  kreoda::ShapeRecord tip;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("round", &tip));
  TopoDS_Edge resolved;
  EXPECT_TRUE(kreoda::FindEdgeByRole(tip.shape, "round", tip.type,
                                     "edge.lin.box.+X~box.+Z", &resolved));
  ASSERT_TRUE(ok(saveRpc("bracket-step", "sketch-bracket", step)));
  ASSERT_GT(fs::file_size(step), 1000u);
  // A further upstream edit after reopen proves the retained DAG is usable.
  ASSERT_TRUE(kreoda::UpdateSketchFeature("profile", RectModel(130, 60), &err)) << err;
  EXPECT_GT(VolumeOf("round"), after);
  NewDoc("bracket-step-check");
  std::vector<std::string> imported;
  ASSERT_TRUE(kreoda::ImportStep(step, &imported, &err)) << err;
  ASSERT_EQ(imported.size(), 1u);
  EXPECT_NEAR(VolumeOf(imported[0]), after, 0.1);
  kreoda::ShapeRecord exportedTip;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(imported[0], &exportedTip));
  EXPECT_TRUE(BRepCheck_Analyzer(exportedTip.shape).IsValid());
  std::printf("PHASE10_SKETCH_BRACKET {\"workflow\":\"sketch-extrude-second_feature-hole-pattern-fillet-expression-upstream_edit-undo-redo-save-close-open-step\",\"features\":6,\"bodies\":1,\"before_edit_volume_mm3\":%.9f,\"after_edit_volume_mm3\":%.9f,\"step_bytes\":%llu,\"reopened_editable\":true,\"step_round_trip\":true}\n",
      before, after, static_cast<unsigned long long>(fs::file_size(step)));
#endif
}

// Deletion rejects shape and expression dependents, rebuilds body/graph state,
// and survives undo/redo plus save/open through the typed RPC path.
TEST(Torture10, DeleteFeatureDependentsUndoRedoAndPersistence) {
  const auto nonce = std::chrono::steady_clock::now().time_since_epoch().count();
  const fs::path dir = fs::temp_directory_path() /
                       ("kreoda-phase10-delete-" + std::to_string(nonce));
  std::error_code ec;
  fs::create_directories(dir, ec);
  ASSERT_FALSE(ec) << ec.message();
  const std::string path = (dir / "deleted.icad").generic_string();

  ASSERT_TRUE(ok(createDocumentRpc("delete-doc", "delete-doc")));
  std::string sketchError;
  ASSERT_TRUE(kreoda::CreateSketchFeature("delete-sketch", "XY",
                                          RectModel(10, 10), &sketchError))
      << sketchError;
  ASSERT_TRUE(kreoda::SketchStore::instance().contains("delete-sketch"));
  ASSERT_TRUE(ok(createBoxRpc("delete-root", "delete-doc", "delete-root")));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"delete-hole","documentId":"delete-doc","type":20,"featureId":"delete-hole","targetId":"delete-root","faceRole":"box.+Z","xMm":50,"yMm":30,"diameterMm":8,"depthMode":"throughAll"})")));
  ASSERT_TRUE(ok(createBoxRpc("delete-expression", "delete-doc",
                              "delete-expression")));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"delete-expression-ref","documentId":"delete-doc","type":6,"featureId":"delete-expression","paramName":"widthMm","expression":"delete-root.widthMm * 2"})")));

  const int64_t revisionBeforeBlocked = kreoda::DocumentStore::instance().revision();
  std::string blocked = deleteFeatureRpc("delete-root-blocked-1", "delete-doc",
                                         "delete-root");
  EXPECT_FALSE(ok(blocked)) << blocked;
  EXPECT_NE(blocked.find(R"("errorCode":"HAS_DEPENDENTS")"),
            std::string::npos) << blocked;
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revisionBeforeBlocked);
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("delete-root"));
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("delete-hole"));

  const auto deletedHole = deleteFeatureRpc("delete-hole-remove", "delete-doc",
                                            "delete-hole");
  ASSERT_TRUE(ok(deletedHole)) << deletedHole;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("delete-hole"));
  ASSERT_EQ(kreoda::BodyStore::instance().size(), 2u);
  kreoda::BodyRecord rootBody;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("delete-root",
                                                            &rootBody));
  EXPECT_EQ(rootBody.history, (std::vector<std::string>{"delete-root"}));
  EXPECT_EQ(rootBody.tipFeatureId, "delete-root");
  EXPECT_FALSE(kreoda::TheFeatureGraph().hasFeature("delete-hole"));

  const int64_t revisionBeforeExpressionBlock =
      kreoda::DocumentStore::instance().revision();
  blocked = deleteFeatureRpc("delete-root-blocked-2", "delete-doc",
                             "delete-root");
  EXPECT_FALSE(ok(blocked)) << blocked;
  EXPECT_NE(blocked.find(R"("errorCode":"HAS_DEPENDENTS")"),
            std::string::npos) << blocked;
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),
            revisionBeforeExpressionBlock);

  const auto deletedExpressionOwner = deleteFeatureRpc(
      "delete-expression-remove", "delete-doc", "delete-expression");
  ASSERT_TRUE(ok(deletedExpressionOwner)) << deletedExpressionOwner;
  std::string expression;
  EXPECT_FALSE(kreoda::ExpressionStore::instance().get(
      "delete-expression", "widthMm", &expression));

  const auto deletedSketch = deleteFeatureRpc(
      "delete-sketch-remove", "delete-doc", "delete-sketch");
  ASSERT_TRUE(ok(deletedSketch)) << deletedSketch;
  EXPECT_FALSE(kreoda::SketchStore::instance().contains("delete-sketch"));
  EXPECT_FALSE(kreoda::TheFeatureGraph().hasFeature("delete-sketch"));

  const auto deletedRoot = deleteFeatureRpc("delete-root-remove", "delete-doc",
                                            "delete-root");
  ASSERT_TRUE(ok(deletedRoot)) << deletedRoot;
  EXPECT_TRUE(kreoda::ShapeStore::instance().listInOrder().empty());
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 0u);
  EXPECT_FALSE(kreoda::TheFeatureGraph().hasFeature("delete-root"));

  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"delete-undo","documentId":"delete-doc","type":8})")));
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("delete-root"));
  ASSERT_EQ(kreoda::BodyStore::instance().size(), 1u);
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("delete-root",
                                                            &rootBody));
  EXPECT_EQ(rootBody.tipFeatureId, "delete-root");
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"delete-redo","documentId":"delete-doc","type":9})")));
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("delete-root"));
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 0u);

  ASSERT_TRUE(ok(saveRpc("delete-save", "delete-doc", path)));
  const auto reloaded = openRpc("delete-open", "delete-reloaded", path);
  ASSERT_TRUE(ok(reloaded)) << reloaded;
  EXPECT_TRUE(kreoda::ShapeStore::instance().listInOrder().empty());
  EXPECT_TRUE(kreoda::SketchStore::instance().listInOrder().empty());
  EXPECT_EQ(kreoda::BodyStore::instance().size(), 0u);

  fs::remove_all(dir, ec);
  EXPECT_FALSE(ec) << ec.message();
}

// §10.6: repeatedly import the same real STEP solid into a reset OCAF
// document. Validate imported geometry and report resources without thresholds.
TEST(Torture10, StepImportResourceCycles) {
#if !KREODA_WITH_OCCT
  GTEST_SKIP() << "requires real OCCT STEP and OCAF APIs";
#else
  constexpr int kCycles = 25;
  const auto nonce = std::chrono::steady_clock::now().time_since_epoch().count();
  const fs::path dir = fs::temp_directory_path() /
                       ("kreoda-phase10-step-import-" + std::to_string(nonce));
  std::error_code ec;
  fs::create_directories(dir, ec);
  ASSERT_FALSE(ec) << ec.message();
  const std::string path = (dir / "seed.step").string();

  NewDoc("step-import-resource-seed");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("step-resource-box", 100, 60, 10,
                                       &err))
      << err;
  ASSERT_TRUE(kreoda::ExportStep(path, &err)) << err;
  const auto stepBytes = fs::file_size(path, ec);
  ASSERT_FALSE(ec) << ec.message();
  ASSERT_GT(stepBytes, 1000u);

  const ProcessResources baseline = ReadProcessResources();
  ProcessResources afterWarm = baseline;
  const auto started = std::chrono::steady_clock::now();
  for (int i = 0; i < kCycles; ++i) {
    NewDoc("step-import-resource-cycle");
    std::vector<std::string> ids;
    err.clear();
    ASSERT_TRUE(kreoda::ImportStep(path, &ids, &err))
        << "cycle " << i << ": " << err;
    ASSERT_EQ(ids.size(), 1u) << "cycle " << i;
    ASSERT_EQ(kreoda::ShapeStore::instance().listInOrder().size(), 1u)
        << "cycle " << i;
    kreoda::ShapeRecord imported;
    ASSERT_TRUE(kreoda::ShapeStore::instance().get(ids[0], &imported))
        << "cycle " << i;
    EXPECT_EQ(imported.type, "StepImport") << "cycle " << i;
    EXPECT_NEAR(imported.volumeMm3, 60000.0, 0.1) << "cycle " << i;
    EXPECT_NEAR(imported.bboxMm[0], 0.0, 1e-6) << "cycle " << i;
    EXPECT_NEAR(imported.bboxMm[1], 0.0, 1e-6) << "cycle " << i;
    EXPECT_NEAR(imported.bboxMm[2], 0.0, 1e-6) << "cycle " << i;
    EXPECT_NEAR(imported.bboxMm[3], 100.0, 1e-6) << "cycle " << i;
    EXPECT_NEAR(imported.bboxMm[4], 60.0, 1e-6) << "cycle " << i;
    EXPECT_NEAR(imported.bboxMm[5], 10.0, 1e-6) << "cycle " << i;
    EXPECT_FALSE(imported.shape.IsNull()) << "cycle " << i;
    if (i == 4) afterWarm = ReadProcessResources();
  }
  const long long elapsedMs =
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now() - started)
          .count();
  const ProcessResources final = ReadProcessResources();
  PrintResourceCycles("step_import_25", kCycles, elapsedMs, baseline,
                      afterWarm, final);

  NewDoc("step-import-resource-finished");
  fs::remove_all(dir, ec);
  EXPECT_FALSE(ec) << ec.message();
#endif
}

// §10.6: replace the active document by opening a real saved OCAF document,
// then close it through the typed CreateDocument command. This exercises the
// existing lifecycle path.
TEST(Torture10, DocumentOpenClose100Cycles) {
  const auto nonce = std::chrono::steady_clock::now().time_since_epoch().count();
  const fs::path dir = fs::temp_directory_path() /
                       ("kreoda-phase10-openclose-" + std::to_string(nonce));
  std::error_code ec;
  fs::create_directories(dir, ec);
  ASSERT_FALSE(ec) << ec.message();
  const std::string path = (dir / "seed.icad").generic_string();

  ASSERT_TRUE(ok(createDocumentRpc("resource-seed", "resource-seed")));
  const std::string created = rpc(
      R"({"protocolVersion":1,"requestId":"resource-box","documentId":"resource-seed","type":3,"featureId":"resource-box","widthMm":100,"heightMm":60,"depthMm":10})");
  ASSERT_TRUE(ok(created)) << created;
  ASSERT_EQ(kreoda::ShapeStore::instance().listInOrder().size(), 1u);
  ASSERT_EQ(kreoda::BodyStore::instance().size(), 1u);
  ASSERT_TRUE(ok(saveRpc("resource-save", "resource-seed", path)));

  const ProcessResources baseline = ReadProcessResources();
  ProcessResources warm = baseline;
  const auto started = std::chrono::steady_clock::now();
  for (int i = 0; i < 100; ++i) {
    const std::string opened = openRpc(
        "resource-open-" + std::to_string(i), "resource-active", path);
    ASSERT_TRUE(ok(opened)) << "open cycle " << i << ": " << opened;
    ASSERT_TRUE(kreoda::ShapeStore::instance().contains("resource-box"));
    ASSERT_EQ(kreoda::BodyStore::instance().size(), 1u);
    EXPECT_NEAR(VolumeOf("resource-box"), 60000.0, 1e-6)
        << "cycle " << i;

    const std::string closed = createDocumentRpc(
        "resource-close-" + std::to_string(i),
        "resource-empty-" + std::to_string(i));
    ASSERT_TRUE(ok(closed)) << "close cycle " << i << ": " << closed;
    EXPECT_FALSE(kreoda::ShapeStore::instance().contains("resource-box"));
    EXPECT_TRUE(kreoda::ShapeStore::instance().listInOrder().empty());
    EXPECT_EQ(kreoda::BodyStore::instance().size(), 0u);
    if (i == 9) warm = ReadProcessResources();
  }
  const auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                             std::chrono::steady_clock::now() - started)
                             .count();
  const ProcessResources final = ReadProcessResources();

  if (warm.available && final.available) {
    // Allow eight one-time handles for lazy GTest/OCCT/runtime initialization;
    // a per-cycle handle leak across the remaining 90 cycles exceeds this.
    constexpr std::uint32_t kAllowedWarmHandleDrift = 8;
    EXPECT_LE(final.handleCount,
              warm.handleCount + kAllowedWarmHandleDrift)
        << "process handles grew from " << warm.handleCount << " to "
        << final.handleCount << " after warm-up";
  }
  if (baseline.available && warm.available && final.available) {
    std::printf(
        "PHASE10_RESOURCE_NATIVE {\"scenario\":\"document_open_close_100\","
        "\"cycles\":100,\"elapsed_ms\":%lld,\"ms_per_cycle\":%.2f,"
        "\"handles_baseline\":%u,\"handles_after_10\":%u,"
        "\"handles_after_100\":%u,\"working_set_baseline_bytes\":%llu,"
        "\"working_set_final_bytes\":%llu,\"peak_working_set_bytes\":%llu,"
        "\"private_final_bytes\":%llu}\n",
        static_cast<long long>(elapsedMs),
        static_cast<double>(elapsedMs) / 100.0,
        baseline.handleCount, warm.handleCount, final.handleCount,
        static_cast<unsigned long long>(baseline.workingSetBytes),
        static_cast<unsigned long long>(final.workingSetBytes),
        static_cast<unsigned long long>(final.peakWorkingSetBytes),
        static_cast<unsigned long long>(final.privateBytes));
  } else {
    std::printf(
        "PHASE10_RESOURCE_NATIVE {\"scenario\":\"document_open_close_100\","
        "\"cycles\":100,\"elapsed_ms\":%lld,"
        "\"windows_process_metrics_available\":false}\n",
        static_cast<long long>(elapsedMs));
  }

  fs::remove_all(dir, ec);
  EXPECT_FALSE(ec) << ec.message();
}

// §10.6: 1000 real body create/delete cycles over the public command path.
// Reuse one feature id so stale OCAF/store labels also fail the next create.
TEST(Torture10, BodyCreateDelete1000Cycles) {
  ASSERT_TRUE(ok(createDocumentRpc("body-cycle-doc", "body-cycle-doc")));
  const ProcessResources baseline = ReadProcessResources();
  ProcessResources warm = baseline;
  const auto started = std::chrono::steady_clock::now();
  for (int i = 0; i < 1000; ++i) {
    const std::string created = createBoxRpc(
        "body-create-" + std::to_string(i), "body-cycle-doc", "cycle-box",
        10, 10, 10);
    ASSERT_TRUE(ok(created)) << "create cycle " << i << ": " << created;
    ASSERT_EQ(kreoda::ShapeStore::instance().listInOrder().size(), 1u)
        << "create cycle " << i;
    EXPECT_TRUE(kreoda::ShapeStore::instance().contains("cycle-box"))
        << "create cycle " << i;
    ASSERT_EQ(kreoda::BodyStore::instance().size(), 1u)
        << "create cycle " << i;
    kreoda::BodyRecord body;
    ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("cycle-box",
                                                              &body));
    EXPECT_EQ(body.tipFeatureId, "cycle-box") << "create cycle " << i;

    const std::string deleted = deleteFeatureRpc(
        "body-delete-" + std::to_string(i), "body-cycle-doc", "cycle-box");
    ASSERT_TRUE(ok(deleted)) << "delete cycle " << i << ": " << deleted;
    EXPECT_TRUE(kreoda::ShapeStore::instance().listInOrder().empty())
        << "delete cycle " << i;
    EXPECT_EQ(kreoda::BodyStore::instance().size(), 0u) << "cycle " << i;
    EXPECT_FALSE(kreoda::TheFeatureGraph().hasFeature("cycle-box"))
        << "cycle " << i;
    if (i == 9) warm = ReadProcessResources();
  }
  const auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                             std::chrono::steady_clock::now() - started)
                             .count();
  const ProcessResources final = ReadProcessResources();

  if (warm.available && final.available) {
    constexpr std::uint32_t kAllowedWarmHandleDrift = 8;
    EXPECT_LE(final.handleCount,
              warm.handleCount + kAllowedWarmHandleDrift)
        << "process handles grew from " << warm.handleCount << " to "
        << final.handleCount << " after warm-up";
  }
  if (baseline.available && warm.available && final.available) {
    std::printf(
        "PHASE10_RESOURCE_NATIVE {\"scenario\":\"body_create_delete_1000\","
        "\"cycles\":1000,\"elapsed_ms\":%lld,\"ms_per_cycle\":%.2f,"
        "\"handles_baseline\":%u,\"handles_after_10\":%u,"
        "\"handles_after_1000\":%u,\"working_set_baseline_bytes\":%llu,"
        "\"working_set_after_10_bytes\":%llu,"
        "\"working_set_final_bytes\":%llu,\"peak_working_set_bytes\":%llu,"
        "\"private_baseline_bytes\":%llu,\"private_after_10_bytes\":%llu,"
        "\"private_final_bytes\":%llu}\n",
        static_cast<long long>(elapsedMs),
        static_cast<double>(elapsedMs) / 1000.0, baseline.handleCount,
        warm.handleCount, final.handleCount,
        static_cast<unsigned long long>(baseline.workingSetBytes),
        static_cast<unsigned long long>(warm.workingSetBytes),
        static_cast<unsigned long long>(final.workingSetBytes),
        static_cast<unsigned long long>(final.peakWorkingSetBytes),
        static_cast<unsigned long long>(baseline.privateBytes),
        static_cast<unsigned long long>(warm.privateBytes),
        static_cast<unsigned long long>(final.privateBytes));
  } else {
    std::printf(
        "PHASE10_RESOURCE_NATIVE {\"scenario\":\"body_create_delete_1000\","
        "\"cycles\":1000,\"elapsed_ms\":%lld,"
        "\"windows_process_metrics_available\":false}\n",
        static_cast<long long>(elapsedMs));
  }
}

// §10.6: mesh a fresh OCAF-backed OCCT sphere each cycle so BRepMesh runs on
// new geometry; validate mesh structure and log resources without memory caps.
TEST(Torture10, DocumentResetReleasesPreviousShape) {
#if !KREODA_WITH_OCCT
  GTEST_SKIP() << "requires real OCCT shape ownership";
#else
  NewDoc("reset-ownership");
  std::string err;
  ASSERT_TRUE(kreoda::CreateSphereFeature("reset-sphere", 100, &err)) << err;
  Handle(TopoDS_TShape) previous;
  {
    kreoda::ShapeRecord source;
    ASSERT_TRUE(kreoda::ShapeStore::instance().get("reset-sphere", &source));
    previous = source.shape.TShape();
  }
  ASSERT_GT(previous->GetRefCount(), 1);
  NewDoc("reset-empty");
  EXPECT_EQ(previous->GetRefCount(), 1)
      << "the replaced OCAF document still owns the previous shape";
#endif
}

TEST(Torture10, TessellationResourceCycles) {
#if !KREODA_WITH_OCCT
  GTEST_SKIP() << "requires real OCCT BRep tessellation and OCAF APIs";
#else
  constexpr int kCycles = 100;
  constexpr double kRadiusMm = 100.0;
  constexpr double kExpectedVolumeMm3 =
      4.0 / 3.0 * 3.14159265358979323846 * kRadiusMm * kRadiusMm * kRadiusMm;
  const ProcessResources baseline = ReadProcessResources();
  ProcessResources afterWarm = baseline;
  ProcessResources at20;
  ProcessResources at50;
  const auto started = std::chrono::steady_clock::now();
  for (int i = 0; i < kCycles; ++i) {
    NewDoc("tessellation-resource-cycle");
    std::string err;
    ASSERT_TRUE(kreoda::CreateSphereFeature("tess-resource-sphere", kRadiusMm,
                                            &err))
        << "cycle " << i << ": " << err;
    kreoda::ShapeRecord source;
    ASSERT_TRUE(kreoda::ShapeStore::instance().get("tess-resource-sphere",
                                                   &source))
        << "cycle " << i;
    EXPECT_NEAR(source.volumeMm3, kExpectedVolumeMm3, 1.0) << "cycle " << i;

    {
      const kreoda::CoreMesh mesh =
          kreoda::TessellateFeature("tess-resource-sphere", 2, &err);
      ASSERT_FALSE(mesh.indices.empty()) << "cycle " << i << ": " << err;
      ASSERT_EQ(mesh.indices.size() % 3, 0u) << "cycle " << i;
      ASSERT_EQ(mesh.positions.size() % 3, 0u) << "cycle " << i;
      ASSERT_EQ(mesh.normals.size(), mesh.positions.size()) << "cycle " << i;
      ASSERT_FALSE(mesh.faces.empty()) << "cycle " << i;
      EXPECT_NEAR(mesh.volumeMm3, kExpectedVolumeMm3, 1.0) << "cycle " << i;
      // OCCT Bnd_Box includes tessellation tolerance around curved faces.
      EXPECT_NEAR(mesh.bboxMm[0], -kRadiusMm, 0.05) << "cycle " << i;
      EXPECT_NEAR(mesh.bboxMm[1], -kRadiusMm, 0.05) << "cycle " << i;
      EXPECT_NEAR(mesh.bboxMm[2], -kRadiusMm, 0.05) << "cycle " << i;
      EXPECT_NEAR(mesh.bboxMm[3], kRadiusMm, 0.05) << "cycle " << i;
      EXPECT_NEAR(mesh.bboxMm[4], kRadiusMm, 0.05) << "cycle " << i;
      EXPECT_NEAR(mesh.bboxMm[5], kRadiusMm, 0.05) << "cycle " << i;
      const uint32_t maxIndex =
          *std::max_element(mesh.indices.begin(), mesh.indices.end());
      EXPECT_LT(static_cast<size_t>(maxIndex), mesh.positions.size() / 3)
          << "cycle " << i;
    }
    if (i == 4) afterWarm = ReadProcessResources();
    if (i == 19) at20 = ReadProcessResources();
    if (i == 49) at50 = ReadProcessResources();
  }
  const long long elapsedMs =
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now() - started)
          .count();
  const ProcessResources final = ReadProcessResources();
  const auto printSample = [](int cycle, const ProcessResources& sample) {
    if (sample.available) {
      std::printf(
          "PHASE10_RESOURCE_NATIVE {\"scenario\":\"fresh_sphere_tessellation\","
          "\"cycles\":%d,\"working_set_bytes\":%llu,"
          "\"peak_working_set_bytes\":%llu,\"private_bytes\":%llu,"
          "\"handles\":%u}\n",
          cycle, static_cast<unsigned long long>(sample.workingSetBytes),
          static_cast<unsigned long long>(sample.peakWorkingSetBytes),
          static_cast<unsigned long long>(sample.privateBytes),
          sample.handleCount);
    } else {
      std::printf(
          "PHASE10_RESOURCE_NATIVE {\"scenario\":\"fresh_sphere_tessellation\","
          "\"cycles\":%d,\"windows_process_metrics_available\":false}\n",
          cycle);
    }
  };
  printSample(20, at20);
  printSample(50, at50);
  printSample(100, final);
  PrintResourceCycles("fresh_sphere_tessellation_100", kCycles, elapsedMs,
                      baseline, afterWarm, final);
  NewDoc("tessellation-resource-finished");
#endif
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

// §10.7: use successively larger OCCT spheres at the real export LOD. Each
// mesh is produced by BRepMesh_IncrementalMesh, never by synthetic triangles.
TEST(Torture10, LargeModelSphereTessellation500kAnd1M) {
  struct Sample {
    double radiusMm = 0.0;
    size_t triangles = 0;
    long long tessellationMs = 0;
    ProcessResources resources;
  };
  constexpr size_t k500kTriangles = 500000;
  constexpr size_t k1mTriangles = 1000000;
  // OCCT 8.0.1 measured about 1006 triangles/mm here. This bounded sequence
  // keeps a clear 500k sample and reaches slightly above 1M at 1100 mm,
  // avoiding the prior 1600 mm sample's disproportionate cost.
  constexpr double kMaximumRadiusMm = 1100.0;
  constexpr double kRadiiMm[] = {200.0, 600.0, kMaximumRadiusMm};
  Sample at500k;
  Sample at1m;

  for (const double radius : kRadiiMm) {
    if (at1m.triangles >= k1mTriangles) break;
    NewDoc("large-model");
    std::string err;
    ASSERT_TRUE(kreoda::CreateSphereFeature("large-sphere", radius, &err))
        << "radius " << radius << ": " << err;
    const auto started = std::chrono::steady_clock::now();
    const kreoda::CoreMesh mesh =
        kreoda::TessellateFeature("large-sphere", 2, &err);
    const long long elapsedMs =
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started)
            .count();
    ASSERT_FALSE(mesh.indices.empty()) << "radius " << radius << ": " << err;
    ASSERT_EQ(mesh.indices.size() % 3, 0u);
    EXPECT_NEAR(mesh.volumeMm3, 4.0 / 3.0 * 3.14159265358979323846 * radius * radius * radius,
                radius * radius * radius * 1e-9);
    ASSERT_EQ(mesh.positions.size() % 3, 0u);
    EXPECT_EQ(mesh.normals.size(), mesh.positions.size());
    EXPECT_LT(*std::max_element(mesh.indices.begin(), mesh.indices.end()), mesh.positions.size() / 3);
    for (size_t i = 0; i < mesh.positions.size(); i += 3) {
      const double x = mesh.positions[i], y = mesh.positions[i + 1], z = mesh.positions[i + 2];
      ASSERT_NEAR(std::sqrt(x * x + y * y + z * z), radius, 0.05)
          << "sphere mesh vertex " << i / 3;
    }
    const size_t triangles = mesh.indices.size() / 3;
    const ProcessResources resources = ReadProcessResources();
    if (resources.available) {
      // Bounded 1M baseline must fit consumer RAM; this catches the previous
      // Watson 10 GB transient allocation even when final memory is small.
      EXPECT_LT(resources.peakWorkingSetBytes, 2ull * 1024 * 1024 * 1024);
    }
    std::printf(
        "PHASE10_PERF_NATIVE {\"scenario\":\"sphere_lod2\","
        "\"radius_mm\":%.0f,\"triangles\":%zu,"
        "\"tessellation_ms\":%lld,\"windows_process_metrics_available\":%s,"
        "\"working_set_bytes\":%llu,\"peak_working_set_bytes\":%llu,"
        "\"private_bytes\":%llu,\"handles\":%u}\n",
        radius, triangles, elapsedMs, resources.available ? "true" : "false",
        static_cast<unsigned long long>(resources.workingSetBytes),
        static_cast<unsigned long long>(resources.peakWorkingSetBytes),
        static_cast<unsigned long long>(resources.privateBytes),
        resources.handleCount);
    if (at500k.triangles < k500kTriangles && triangles >= k500kTriangles) {
      at500k = {radius, triangles, elapsedMs, resources};
    }
    if (triangles >= k1mTriangles) {
      at1m = {radius, triangles, elapsedMs, resources};
    }
  }

  const auto printTarget = [](const char* name, const Sample& sample) {
    if (sample.resources.available) {
      std::printf(
          "PHASE10_PERF_NATIVE {\"target\":\"%s\","
          "\"radius_mm\":%.0f,\"triangles\":%zu,"
          "\"tessellation_ms\":%lld,\"working_set_bytes\":%llu,"
          "\"peak_working_set_bytes\":%llu,\"private_bytes\":%llu,"
          "\"handles\":%u}\n",
          name, sample.radiusMm, sample.triangles, sample.tessellationMs,
          static_cast<unsigned long long>(sample.resources.workingSetBytes),
          static_cast<unsigned long long>(sample.resources.peakWorkingSetBytes),
          static_cast<unsigned long long>(sample.resources.privateBytes),
          sample.resources.handleCount);
    } else {
      std::printf(
          "PHASE10_PERF_NATIVE {\"target\":\"%s\","
          "\"radius_mm\":%.0f,\"triangles\":%zu,"
          "\"tessellation_ms\":%lld,"
          "\"windows_process_metrics_available\":false}\n",
          name, sample.radiusMm, sample.triangles, sample.tessellationMs);
    }
  };
  printTarget("500k", at500k);
  printTarget("1M", at1m);

  ASSERT_GE(at500k.triangles, k500kTriangles)
      << "no real sphere reached 500k triangles by radius "
      << kMaximumRadiusMm << " mm";
  ASSERT_GE(at1m.triangles, k1mTriangles)
      << "no real sphere reached 1M triangles by radius "
      << kMaximumRadiusMm << " mm";
}

// §10.7: record recompute/save/load costs for a bounded single-body feature
// chain. Each through-hole is a real dependent feature, not a copied shape.
TEST(Torture10, HighFeatureCountRecomputeSaveLoadBaseline) {
#if !KREODA_WITH_OCCT
  GTEST_SKIP() << "requires real OCCT hole, OCAF save and load APIs";
#else
  constexpr int kHoleCount = 40;
  constexpr double kInitialWidthMm = 500.0;
  constexpr double kUpdatedWidthMm = 520.0;
  constexpr double kHeightMm = 400.0;
  constexpr double kDepthMm = 20.0;
  constexpr double kDiameterMm = 7.0;
  const auto nonce = std::chrono::steady_clock::now().time_since_epoch().count();
  const fs::path dir = fs::temp_directory_path() /
                       ("kreoda-phase10-feature-chain-" +
                        std::to_string(nonce));
  std::error_code ec;
  fs::create_directories(dir, ec);
  ASSERT_FALSE(ec) << ec.message();
  const std::string icadPath = (dir / "feature-chain.icad").string();

  NewDoc("phase10-feature-chain");
  const ProcessResources baseline = ReadProcessResources();
  std::string err;
  auto started = std::chrono::steady_clock::now();
  ASSERT_TRUE(kreoda::CreateBoxFeature("fc-plate", kInitialWidthMm,
                                       kHeightMm, kDepthMm, &err))
      << err;
  std::string targetId = "fc-plate";
  for (int i = 0; i < kHoleCount; ++i) {
    const std::string featureId = "fc-hole-" + std::to_string(i);
    const double xMm = 40.0 + static_cast<double>(i % 8) * 55.0;
    const double yMm = 40.0 + static_cast<double>(i / 8) * 65.0;
    ASSERT_TRUE(kreoda::CreateHoleFeature(
                    featureId, targetId, "box.+Z", xMm, yMm,
                    kDiameterMm, "throughAll", 0.0, &err))
        << "hole " << i << ": " << err;
    targetId = featureId;
  }
  const long long featureBuildMs =
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now() - started)
          .count();
  const ProcessResources afterBuild = ReadProcessResources();
  ASSERT_EQ(kreoda::ShapeStore::instance().listInOrder().size(),
            static_cast<size_t>(kHoleCount + 1));
  ASSERT_EQ(kreoda::BodyStore::instance().size(), 1u);
  kreoda::BodyRecord body;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature(targetId, &body));
  ASSERT_EQ(body.history.size(), static_cast<size_t>(kHoleCount + 1));
  EXPECT_EQ(body.tipFeatureId, targetId);

  started = std::chrono::steady_clock::now();
  ASSERT_TRUE(kreoda::RebuildFeature("fc-plate", "widthMm",
                                     kUpdatedWidthMm, &err))
      << err;
  const long long recomputeMs =
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now() - started)
          .count();
  const ProcessResources afterRecompute = ReadProcessResources();
  const double expectedVolume =
      kUpdatedWidthMm * kHeightMm * kDepthMm -
      kHoleCount * 3.14159265358979323846 * (kDiameterMm / 2.0) *
          (kDiameterMm / 2.0) * kDepthMm;
  EXPECT_DOUBLE_EQ(ParamOf("fc-plate", "widthMm"), kUpdatedWidthMm);
  EXPECT_NEAR(VolumeOf(targetId), expectedVolume, 1.0);

  started = std::chrono::steady_clock::now();
  ASSERT_TRUE(ok(saveRpc("fc-save", "phase10-feature-chain", icadPath)));
  const long long saveMs =
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now() - started)
          .count();
  const auto icadBytes = fs::file_size(icadPath, ec);
  ASSERT_FALSE(ec) << ec.message();
  const ProcessResources afterSave = ReadProcessResources();

  NewDoc("phase10-feature-chain-loaded");
  started = std::chrono::steady_clock::now();
  const std::string opened =
      openRpc("fc-open", "phase10-feature-chain-loaded", icadPath);
  const long long loadMs =
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now() - started)
          .count();
  ASSERT_TRUE(ok(opened)) << opened;
  ASSERT_EQ(kreoda::ShapeStore::instance().listInOrder().size(),
            static_cast<size_t>(kHoleCount + 1));
  ASSERT_EQ(kreoda::BodyStore::instance().size(), 1u);
  EXPECT_DOUBLE_EQ(ParamOf("fc-plate", "widthMm"), kUpdatedWidthMm);
  EXPECT_NEAR(VolumeOf(targetId), expectedVolume, 1.0);
  const ProcessResources afterLoad = ReadProcessResources();

  std::printf(
      "PHASE10_PERF_NATIVE {\"scenario\":\"high_feature_chain\","
      "\"hole_features\":%d,\"feature_count\":%d,\"body_count\":1,"
      "\"feature_build_ms\":%lld,\"recompute_ms\":%lld,"
      "\"save_icad_ms\":%lld,\"icad_bytes\":%llu,"
      "\"load_icad_ms\":%lld,\"final_volume_mm3\":%.3f}\n",
      kHoleCount, kHoleCount + 1, featureBuildMs, recomputeMs, saveMs,
      static_cast<unsigned long long>(icadBytes), loadMs, expectedVolume);
  PrintPerfResourceSample("high_feature_chain", "baseline", baseline);
  PrintPerfResourceSample("high_feature_chain", "after_feature_build",
                          afterBuild);
  PrintPerfResourceSample("high_feature_chain", "after_recompute",
                          afterRecompute);
  PrintPerfResourceSample("high_feature_chain", "after_save", afterSave);
  PrintPerfResourceSample("high_feature_chain", "after_load", afterLoad);

  fs::remove_all(dir, ec);
  EXPECT_FALSE(ec) << ec.message();
#endif
}

// §10.7: many independent bodies form a real multi-solid STEP file. Record
// command/recompute, native save/load, STEP export/import, file size and the
// process metrics available on the host; wall-clock values are not gates.
class ManyBodyStepBaseline : public ::testing::TestWithParam<int> {};
TEST_P(ManyBodyStepBaseline, SaveReopenAndStepRoundTrip) {
#if !KREODA_WITH_OCCT
  GTEST_SKIP() << "requires real OCCT STEP, OCAF save and load APIs";
#else
  struct BoxDims {
    std::string id;
    double widthMm;
    double heightMm;
    double depthMm;
  };
  const int kBodyCount = GetParam();
  const auto nonce = std::chrono::steady_clock::now().time_since_epoch().count();
  const fs::path dir = fs::temp_directory_path() /
                       ("kreoda-phase10-many-body-" +
                        std::to_string(nonce));
  std::error_code ec;
  fs::create_directories(dir, ec);
  ASSERT_FALSE(ec) << ec.message();
  const std::string icadPath = (dir / "many-body.icad").string();
  const std::string stepPath = (dir / "many-body.step").string();

  NewDoc("phase10-many-body");
  const ProcessResources baseline = ReadProcessResources();
  std::vector<BoxDims> boxes;
  boxes.reserve(kBodyCount);
  auto started = std::chrono::steady_clock::now();
  for (int i = 0; i < kBodyCount; ++i) {
    const std::string id = "mb-box-" + std::to_string(i);
    const double widthMm = 10.0 + static_cast<double>(i) * 0.125;
    const double heightMm = 10.0 + static_cast<double>(i % 7) * 0.25;
    const double depthMm = 10.0 + static_cast<double>(i % 5) * 0.5;
    const std::string created = createBoxRpc(
        "mb-create-" + std::to_string(i), "phase10-many-body", id,
        widthMm, heightMm, depthMm);
    ASSERT_TRUE(ok(created)) << "body " << i << ": " << created;
    boxes.push_back({id, widthMm, heightMm, depthMm});
  }
  const long long createMs =
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now() - started)
          .count();
  const ProcessResources afterCreate = ReadProcessResources();
  ASSERT_EQ(kreoda::ShapeStore::instance().listInOrder().size(),
            static_cast<size_t>(kBodyCount));
  ASSERT_EQ(kreoda::BodyStore::instance().size(),
            static_cast<size_t>(kBodyCount));

  double expectedVolume = 0.0;
  started = std::chrono::steady_clock::now();
  for (const BoxDims& box : boxes) {
    const double updatedWidthMm = box.widthMm + 0.25;
    std::string err;
    ASSERT_TRUE(kreoda::RebuildFeature(box.id, "widthMm", updatedWidthMm,
                                       &err))
        << box.id << ": " << err;
    expectedVolume += updatedWidthMm * box.heightMm * box.depthMm;
  }
  const long long recomputeMs =
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now() - started)
          .count();
  const ProcessResources afterRecompute = ReadProcessResources();

  started = std::chrono::steady_clock::now();
  ASSERT_TRUE(ok(saveRpc("mb-save", "phase10-many-body", icadPath)));
  const long long saveMs =
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now() - started)
          .count();
  const auto icadBytes = fs::file_size(icadPath, ec);
  ASSERT_FALSE(ec) << ec.message();
  const ProcessResources afterSave = ReadProcessResources();

  NewDoc("phase10-many-body-loaded");
  started = std::chrono::steady_clock::now();
  const std::string opened =
      openRpc("mb-open", "phase10-many-body-loaded", icadPath);
  const long long loadMs =
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now() - started)
          .count();
  ASSERT_TRUE(ok(opened)) << opened;
  ASSERT_EQ(kreoda::ShapeStore::instance().listInOrder().size(),
            static_cast<size_t>(kBodyCount));
  ASSERT_EQ(kreoda::BodyStore::instance().size(),
            static_cast<size_t>(kBodyCount));
  double loadedVolume = 0.0;
  for (const BoxDims& box : boxes) loadedVolume += VolumeOf(box.id);
  EXPECT_NEAR(loadedVolume, expectedVolume, 1.0);
  const ProcessResources afterLoad = ReadProcessResources();

  started = std::chrono::steady_clock::now();
  ASSERT_TRUE(ok(saveRpc("mb-export-step", "phase10-many-body-loaded",
                         stepPath)));
  const long long stepExportMs =
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now() - started)
          .count();
  const auto stepBytes = fs::file_size(stepPath, ec);
  ASSERT_FALSE(ec) << ec.message();
  ASSERT_GT(stepBytes, 1000u);
  if (kBodyCount >= 1024) ASSERT_GT(stepBytes, 10u * 1024u * 1024u);
  const ProcessResources afterStepExport = ReadProcessResources();

  NewDoc("phase10-many-body-step-imported");
  started = std::chrono::steady_clock::now();
  const std::string stepOpened =
      openRpc("mb-import-step", "phase10-many-body-step-imported", stepPath);
  const long long stepImportMs =
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now() - started)
          .count();
  ASSERT_TRUE(ok(stepOpened)) << stepOpened;
  const auto importedRecords = kreoda::ShapeStore::instance().listInOrder();
  ASSERT_EQ(importedRecords.size(), static_cast<size_t>(kBodyCount));
  ASSERT_EQ(kreoda::BodyStore::instance().size(),
            static_cast<size_t>(kBodyCount));
  double importedVolume = 0.0;
  for (const kreoda::ShapeRecord& record : importedRecords) {
    importedVolume += record.volumeMm3;
  }
  EXPECT_NEAR(importedVolume, expectedVolume, 1.0);
  const ProcessResources afterStepImport = ReadProcessResources();

  std::printf(
      "PHASE10_PERF_NATIVE {\"scenario\":\"many_body_step_roundtrip\","
      "\"body_count\":%d,\"feature_count\":%d,\"create_bodies_ms\":%lld,"
      "\"recompute_bodies\":%d,\"recompute_ms\":%lld,"
      "\"save_icad_ms\":%lld,\"icad_bytes\":%llu,"
      "\"load_icad_ms\":%lld,\"step_export_ms\":%lld,"
      "\"step_bytes\":%llu,\"step_import_ms\":%lld,"
      "\"imported_solids\":%zu,\"total_volume_mm3\":%.3f}\n",
      kBodyCount, kBodyCount, createMs, kBodyCount, recomputeMs, saveMs,
      static_cast<unsigned long long>(icadBytes), loadMs, stepExportMs,
      static_cast<unsigned long long>(stepBytes), stepImportMs,
      importedRecords.size(), importedVolume);
  PrintPerfResourceSample("many_body_step_roundtrip", "baseline", baseline);
  PrintPerfResourceSample("many_body_step_roundtrip", "after_create",
                          afterCreate);
  PrintPerfResourceSample("many_body_step_roundtrip", "after_recompute",
                          afterRecompute);
  PrintPerfResourceSample("many_body_step_roundtrip", "after_save", afterSave);
  PrintPerfResourceSample("many_body_step_roundtrip", "after_load", afterLoad);
  PrintPerfResourceSample("many_body_step_roundtrip", "after_step_export",
                          afterStepExport);
  PrintPerfResourceSample("many_body_step_roundtrip", "after_step_import",
                          afterStepImport);

  fs::remove_all(dir, ec);
  EXPECT_FALSE(ec) << ec.message();
#endif
}
INSTANTIATE_TEST_SUITE_P(Phase10, ManyBodyStepBaseline, ::testing::Values(128, 1024));
