// Phase 10 validation torture suites (§10.3–§10.7):
// persistent-topology mutations, save/open and resource cycles, large-model
// tessellation, undo/redo interleave, atomic-overwrite contract.

#include <gtest/gtest.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <fstream>
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
  // NOTE: filename must avoid \t \n \r sequences (JSON escapes in rpc).
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

  ASSERT_TRUE(kreoda::UpdateSketchFeature(
      "ts-entities", RectModel(100, 50), &err)) << err;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("ts-entities", &sketch));
  EXPECT_EQ(sketch.model.points.size(), 4u);
  EXPECT_TRUE(sketch.model.circles.empty());
  EXPECT_NEAR(VolumeOf("te-entities"), 100000.0, 1.0);
#endif
}

// §10.3 API limits: HolePattern creation accepts 1..4 points, but its rebuild
// replays the stored refExtra point list and no feature-update API changes its
// count. Feature dependencies are fixed at creation; no command/API inserts a
// node into or reparents an existing history.

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
    EXPECT_GT(mesh.volumeMm3, 0.0);
    const size_t triangles = mesh.indices.size() / 3;
    const ProcessResources resources = ReadProcessResources();
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
TEST(Torture10, ManyBodyLargeStepRoundTripBaseline) {
#if !KREODA_WITH_OCCT
  GTEST_SKIP() << "requires real OCCT STEP, OCAF save and load APIs";
#else
  struct BoxDims {
    std::string id;
    double widthMm;
    double heightMm;
    double depthMm;
  };
  constexpr int kBodyCount = 128;
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
