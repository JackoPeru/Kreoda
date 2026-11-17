#include <gtest/gtest.h>

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <map>
#include <string>
#include <utility>
#include <vector>

#if KREODA_WITH_OCCT
#include <BinXCAFDrivers.hxx>
#include <PCDM_StoreStatus.hxx>
#include <Standard_Failure.hxx>
#include <TCollection_AsciiString.hxx>
#include <TCollection_ExtendedString.hxx>
#include <TDataStd_Comment.hxx>
#include <TDataStd_Name.hxx>
#include <TDF_ChildIterator.hxx>
#include <TDF_Label.hxx>
#include <TDocStd_Application.hxx>
#include <TDocStd_Document.hxx>
#endif

#include "../src/document/document_store.h"
#include "../src/features/extrusion/extrude.h"
#include "../src/features/sketch/sketch_commands.h"
#include "../src/features/sketch/sketch_json.h"
#include "../src/features/sketch/sketch_store.h"
#include "../src/model/feature_graph.h"
#include "../src/model/shapes.h"
#include "../src/persistence/icad_zip.h"
#include "../src/persistence/ocaf_live.h"
#include "../src/protocol/dispatcher.h"

#include "rpc_text.h"

namespace fs = std::filesystem;

// §49: save → reopen returns the same solid (volume + feature identity).

namespace {

// Numeric extraction: kernel volumes print at full precision (e.g.
// 99999.99999999997 for a 100x50x20 box), so substring matching is wrong —
// compare with tolerance instead.
double ExtractVolume(const std::string& response) {
  const std::string key = "\"volumeMm3\":";
  const size_t pos = response.find(key);
  if (pos == std::string::npos) return -1.0;
  try {
    return std::stod(response.substr(pos + key.size()));
  } catch (...) {
    return -1.0;
  }
}

kreoda::SketchModel RectModel(double width, double height) {
  kreoda::SketchModel model;
  model.points = {{"p0", 0, 0}, {"p1", width, 0},
                  {"p2", width, height}, {"p3", 0, height}};
  model.lines = {{"l0", "p0", "p1"}, {"l1", "p1", "p2"},
                 {"l2", "p2", "p3"}, {"l3", "p3", "p0"}};
  model.constraints = {
      {"h0", kreoda::SketchConstraintKind::Horizontal, {"l0"}, 0},
      {"h2", kreoda::SketchConstraintKind::Horizontal, {"l2"}, 0},
      {"v1", kreoda::SketchConstraintKind::Vertical, {"l1"}, 0},
      {"v3", kreoda::SketchConstraintKind::Vertical, {"l3"}, 0},
      {"w", kreoda::SketchConstraintKind::Distance, {"p0", "p1"}, width},
      {"h", kreoda::SketchConstraintKind::Distance, {"p1", "p2"}, height},
  };
  return model;
}

kreoda::SketchPlane OffsetFrame() {
  kreoda::SketchPlane plane;
  plane.origin[0] = 10;
  plane.origin[1] = 20;
  plane.origin[2] = 30;
  plane.xAxis[0] = 0;
  plane.xAxis[1] = 1;
  plane.xAxis[2] = 0;
  plane.yAxis[0] = 0;
  plane.yAxis[1] = 0;
  plane.yAxis[2] = 1;
  plane.normal[0] = 1;
  plane.normal[1] = 0;
  plane.normal[2] = 0;
  return plane;
}

std::string CorruptSketchFrame(const kreoda::SketchFeature& sketch) {
  std::string json = kreoda::SerializeSketchFeature(sketch);
  const std::string validAxis = "\"xAxis\":[0,1,0]";
  const size_t at = json.find(validAxis);
  if (at == std::string::npos) return {};
  json.replace(at, validAxis.size(), "\"xAxis\":[0,2,0]");
  return json;
}

std::string UniqueStamp() {
  return std::to_string(
      std::chrono::steady_clock::now().time_since_epoch().count());
}

bool MakeMalformedIcad(const fs::path& icad, std::string* error) {
  kreoda::DocumentStore::instance().create("malformed-source");
  if (!kreoda::CreateSketchFeature("corrupt-sketch", "XY", RectModel(10, 5),
                                   OffsetFrame(), error) ||
      !kreoda::CreateExtrudeFeature("corrupt-extrude", "corrupt-sketch", 7,
                                    error)) {
    return false;
  }
  kreoda::SketchFeature sketch;
  if (!kreoda::SketchStore::instance().get("corrupt-sketch", &sketch)) {
    if (error) *error = "source sketch missing";
    return false;
  }
  const std::string malformed = CorruptSketchFrame(sketch);
  if (malformed.empty()) {
    if (error) *error = "could not corrupt source sketch frame";
    return false;
  }
  auto& ocaf = kreoda::OcafLive::instance();
  if (!ocaf.BeginCommand(error)) return false;
  if (!ocaf.UpsertSketch("corrupt-sketch", malformed, error)) {
    ocaf.AbortCommand();
    return false;
  }
  bool hadDelta = false;
  if (!ocaf.CommitCommand(&hadDelta, error) || !hadDelta) {
    if (error && error->empty()) *error = "malformed sketch mirror had no OCAF delta";
    return false;
  }

  const std::string save =
      "{\"protocolVersion\":1,\"requestId\":\"bad-save-" + UniqueStamp() +
      "\",\"documentId\":\"malformed-source\",\"type\":10,\"path\":\"" +
      icad.generic_string() + "\"}";
  const std::string saved = kreoda_test::rpcText(save);
  if (saved.find("\"status\":\"ok\"") == std::string::npos) {
    if (error) *error = saved;
    return false;
  }
  return true;
}

bool MakeDuplicateSketchRootsIcad(const fs::path& icad, bool malformedFirst,
                                  std::string* error) {
  const std::string suffix = UniqueStamp();
  const fs::path originalXbf = fs::temp_directory_path() /
                               ("kreoda-duplicate-original-" + suffix + ".xbf");
  const fs::path duplicateXbf = fs::temp_directory_path() /
                                ("kreoda-duplicate-mutated-" + suffix + ".xbf");
  kreoda::DocumentStore::instance().create("duplicate-source");
  if (!kreoda::CreateSketchFeature("duplicate-sketch", "XY", RectModel(10, 5),
                                   OffsetFrame(), error) ||
      !kreoda::CreateExtrudeFeature("duplicate-extrude", "duplicate-sketch", 7,
                                    error)) {
    return false;
  }
  kreoda::SketchFeature sketch;
  if (!kreoda::SketchStore::instance().get("duplicate-sketch", &sketch)) {
    if (error) *error = "source sketch missing";
    return false;
  }
  const std::string validJson = kreoda::SerializeSketchFeature(sketch);
  const std::string malformedJson = CorruptSketchFrame(sketch);
  if (malformedJson.empty() ||
      !kreoda::OcafLive::instance().Save(originalXbf.string(), error)) {
    if (error && error->empty()) *error = "could not save duplicate-root source";
    return false;
  }

  Handle(TDocStd_Application) app;
  const auto closeDocuments = [&]() {
    if (app.IsNull()) return;
    try {
      while (app->NbDocuments() > 0) app->Close(app->GetDocument(1));
    } catch (const Standard_Failure&) {
    }
  };
  try {
    app = new TDocStd_Application;
    BinXCAFDrivers::DefineFormat(app);
    Handle(TDocStd_Document) doc;
    app->NewDocument("BinXCAF", doc);
    app->Close(doc);
    if (app->Open(TCollection_ExtendedString(originalXbf.string().c_str()), doc) !=
            PCDM_RS_OK ||
        doc.IsNull()) {
      if (error) *error = "could not open duplicate-root source XBF";
      closeDocuments();
      return false;
    }

    TDF_Label originalRoot;
    for (TDF_ChildIterator it(doc->Main(), Standard_False); it.More(); it.Next()) {
      Handle(TDataStd_Name) name;
      if (it.Value().FindAttribute(TDataStd_Name::GetID(), name) &&
          TCollection_AsciiString(name->Get(), '?').ToCString() ==
              std::string("Sketches")) {
        originalRoot = it.Value();
        break;
      }
    }
    if (originalRoot.IsNull()) {
      if (error) *error = "original Sketches metadata root missing";
      closeDocuments();
      return false;
    }
    TDF_Label originalSketch;
    for (TDF_ChildIterator it(originalRoot, Standard_False); it.More(); it.Next()) {
      Handle(TDataStd_Name) name;
      if (it.Value().FindAttribute(TDataStd_Name::GetID(), name) &&
          TCollection_AsciiString(name->Get(), '?').ToCString() ==
              std::string("duplicate-sketch")) {
        originalSketch = it.Value();
        break;
      }
    }
    if (originalSketch.IsNull()) {
      if (error) *error = "original sketch metadata label missing";
      closeDocuments();
      return false;
    }
    if (malformedFirst) {
      TDataStd_Comment::Set(originalSketch,
                            TCollection_AsciiString(malformedJson.c_str()));
    }

    // The first three tags on Main are owned by XCAF; reserve a later stable
    // tag so this fixture does not rename the Shapes root.
    const TDF_Label duplicateRoot = doc->Main().FindChild(1004);
    TDataStd_Name::Set(duplicateRoot, "Sketches");
    const TDF_Label duplicateSketch = duplicateRoot.NewChild();
    TDataStd_Name::Set(
        duplicateSketch,
        TCollection_ExtendedString("duplicate-sketch"));
    TDataStd_Comment::Set(
        duplicateSketch,
        TCollection_AsciiString((malformedFirst ? validJson : malformedJson)
                                    .c_str()));
    if (app->SaveAs(doc, TCollection_ExtendedString(duplicateXbf.string().c_str())) !=
        PCDM_SS_OK) {
      if (error) *error = "could not save duplicate-root XBF";
      closeDocuments();
      return false;
    }
    closeDocuments();
  } catch (const Standard_Failure& failure) {
    closeDocuments();
    if (error) *error = std::string("duplicate-root fixture failed: ") + failure.what();
    return false;
  }

  const bool written =
      kreoda::WriteIcad(icad.string(), "{}", duplicateXbf.string(), error);
  std::error_code ec;
  fs::remove(originalXbf, ec);
  fs::remove(duplicateXbf, ec);
  return written;
}

bool MakeHealthyUndoRedoState(const std::string& documentId,
                              std::string* error) {
  kreoda::DocumentStore::instance().create(documentId);
  if (!kreoda::CreateSketchFeature("healthy-sketch", "XY", RectModel(10, 5),
                                   OffsetFrame(), error) ||
      !kreoda::CreateExtrudeFeature("healthy-extrude", "healthy-sketch", 7,
                                    error) ||
      !kreoda::UpdateSketchFeature("healthy-sketch", RectModel(12, 6), error)) {
    return false;
  }
  const std::string undo =
      "{\"protocolVersion\":1,\"requestId\":\"healthy-undo-" +
      documentId + "\",\"documentId\":\"" + documentId + "\",\"type\":8}";
  const std::string undone = kreoda_test::rpcText(undo);
  if (undone.find("\"status\":\"ok\"") == std::string::npos) {
    if (error) *error = undo + " -> " + undone;
    return false;
  }
  return true;
}

struct LiveState {
  std::string documentId;
  int64_t revision = 0;
  std::map<std::string, std::string> registry;
  std::string referencePlanes;
  std::vector<std::pair<std::string, double>> shapes;
  std::vector<std::string> sketches;
  size_t graphSize = 0;
  bool graphHasSketch = false;
  bool graphHasExtrude = false;
  bool sketchDirty = false;
  bool extrudeDirty = false;
  int undos = 0;
  int redos = 0;
};

LiveState CaptureLiveState() {
  LiveState state;
  auto& docs = kreoda::DocumentStore::instance();
  state.documentId = docs.snapshotDocumentId();
  state.revision = docs.snapshotRevision();
  state.registry = docs.snapshotRegistry();
  state.referencePlanes = docs.referencePlanesJson();
  for (const auto& rec : kreoda::ShapeStore::instance().listInOrder()) {
    state.shapes.emplace_back(rec.featureId, rec.volumeMm3);
  }
  for (const auto& sketch : kreoda::SketchStore::instance().listInOrder()) {
    state.sketches.push_back(kreoda::SerializeSketchFeature(sketch));
  }
  const auto& graph = kreoda::TheFeatureGraph();
  state.graphSize = graph.size();
  state.graphHasSketch = graph.hasFeature("healthy-sketch");
  state.graphHasExtrude = graph.hasFeature("healthy-extrude");
  state.sketchDirty = graph.isGeometryDirty("healthy-sketch");
  state.extrudeDirty = graph.isGeometryDirty("healthy-extrude");
  state.undos = kreoda::OcafLive::instance().AvailableUndos();
  state.redos = kreoda::OcafLive::instance().AvailableRedos();
  return state;
}

void ExpectLiveStateUnchanged(const LiveState& expected) {
  const LiveState actual = CaptureLiveState();
  EXPECT_EQ(actual.documentId, expected.documentId);
  EXPECT_EQ(actual.revision, expected.revision);
  EXPECT_EQ(actual.registry, expected.registry);
  EXPECT_EQ(actual.referencePlanes, expected.referencePlanes);
  ASSERT_EQ(actual.shapes.size(), expected.shapes.size());
  for (size_t i = 0; i < expected.shapes.size(); ++i) {
    EXPECT_EQ(actual.shapes[i].first, expected.shapes[i].first);
    EXPECT_DOUBLE_EQ(actual.shapes[i].second, expected.shapes[i].second);
  }
  EXPECT_EQ(actual.sketches, expected.sketches);
  EXPECT_EQ(actual.graphSize, expected.graphSize);
  EXPECT_EQ(actual.graphHasSketch, expected.graphHasSketch);
  EXPECT_EQ(actual.graphHasExtrude, expected.graphHasExtrude);
  EXPECT_EQ(actual.sketchDirty, expected.sketchDirty);
  EXPECT_EQ(actual.extrudeDirty, expected.extrudeDirty);
  EXPECT_EQ(actual.undos, expected.undos);
  EXPECT_EQ(actual.redos, expected.redos);
}

}  // namespace

TEST(Persistence, SaveReopenRoundTrip) {
#if KREODA_WITH_OCCT && KREODA_WITH_MINIZIP
  ASSERT_NE(kreoda_test::rpcText(
                R"({"protocolVersion":1,"requestId":"p1","documentId":"dp","type":2})")
                .find("\"status\":\"ok\""),
            std::string::npos);
  const std::string mk =
      R"({"protocolVersion":1,"requestId":"p2","documentId":"dp","type":3,"featureId":"persist-box","widthMm":100,"heightMm":50,"depthMm":20})";
  const std::string created = kreoda_test::rpcText(mk);
  ASSERT_NE(created.find("\"status\":\"ok\""), std::string::npos);
  EXPECT_NEAR(ExtractVolume(created), 100000.0, 1.0);

  const fs::path icad =
      fs::temp_directory_path() / "kreoda-roundtrip.icad";
  const std::string save =
      std::string(
          R"({"protocolVersion":1,"requestId":"p3","documentId":"dp","type":10,"path":")") +
      icad.generic_string() + "\"}";
  const std::string saved = kreoda_test::rpcText(save);
  ASSERT_NE(saved.find("\"status\":\"ok\""), std::string::npos)
      << saved;
  ASSERT_TRUE(fs::exists(icad));

  // Fresh document, then reopen: identical solid must come back.
  kreoda_test::rpcText(
      R"({"protocolVersion":1,"requestId":"p4","documentId":"dp2","type":2})");
  const std::string open =
      std::string(
          R"({"protocolVersion":1,"requestId":"p5","documentId":"dp2","type":11,"path":")") +
      icad.generic_string() + "\"}";
  const std::string opened = kreoda_test::rpcText(open);
  ASSERT_NE(opened.find("\"status\":\"ok\""), std::string::npos) << opened;
  EXPECT_NE(opened.find("persist-box"), std::string::npos);
  EXPECT_NEAR(ExtractVolume(opened), 100000.0, 1.0) << opened;

  // Mesh after reopen: same 12 triangles, persistent face still mapped (§8).
  const std::vector<uint8_t> meshed = kreoda_test::rpcBytes(
      R"({"protocolVersion":1,"requestId":"p6","documentId":"dp2","type":12,"featureId":"persist-box","lod":1})");
#ifdef KREODA_WITH_FLATBUFFERS
  const auto* update = kreoda_test::meshRoot(meshed);
  ASSERT_NE(update, nullptr);
  EXPECT_EQ(update->indices_count() / 3, 12u);
  ASSERT_NE(update->faces(), nullptr);
  // Persistent top-face role survives the round-trip (any position — face
  // order is tessellator-defined, never an index contract).
  bool topFound = false;
  for (flatbuffers::uoffset_t i = 0; i < update->faces()->size(); ++i) {
    const auto* f = update->faces()->Get(i);
    if (f && f->persistent_face_id() &&
        f->persistent_face_id()->str() == "persist-box:box.+Z") {
      topFound = true;
    }
  }
  EXPECT_TRUE(topFound);
#else
  GTEST_SKIP() << "mesh binary needs flatbuffers";
#endif

  std::error_code ec;
  fs::remove(icad, ec);
#else
  GTEST_SKIP() << "needs OCCT + minizip-ng (vcpkg build)";
#endif
}

TEST(Persistence, OpenMissingFileFailsHonestly) {
  const std::string open =
      R"({"protocolVersion":1,"requestId":"p7","documentId":"dp","type":11,"path":"Z:/definitely/not/here.icad"})";
  EXPECT_NE(kreoda_test::rpcText(open).find("\"status\":\"error\""),
            std::string::npos);
}

TEST(Persistence, CustomSketchFrameSurvivesOCAFOpenAndPostOpenEdit) {
#if KREODA_WITH_OCCT && KREODA_WITH_MINIZIP
  const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
  const fs::path icad = fs::temp_directory_path() /
                        ("kreoda-frame-" + std::to_string(stamp) + ".icad");
  kreoda::DocumentStore::instance().create("frame-save-open");
  std::string error;
  const auto plane = OffsetFrame();
  ASSERT_TRUE(kreoda::CreateSketchFeature(
      "frame-persist-sketch", "XY", RectModel(10, 5), plane, &error)) << error;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("frame-persist-extrude",
                                          "frame-persist-sketch", 7, &error))
      << error;

  const std::string save =
      std::string(R"({"protocolVersion":1,"requestId":"frame-save","documentId":"frame-save-open","type":10,"path":")") +
      icad.generic_string() + "\"}";
  const std::string saved = kreoda_test::rpcText(save);
  ASSERT_NE(saved.find("\"status\":\"ok\""), std::string::npos) << saved;
  ASSERT_TRUE(fs::exists(icad));

  kreoda::DocumentStore::instance().create("frame-open-target");
  const std::string open =
      std::string(R"({"protocolVersion":1,"requestId":"frame-open","documentId":"frame-open-target","type":11,"path":")") +
      icad.generic_string() + "\"}";
  const std::string opened = kreoda_test::rpcText(open);
  ASSERT_NE(opened.find("\"status\":\"ok\""), std::string::npos) << opened;

  kreoda::SketchFeature sketch;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("frame-persist-sketch", &sketch));
  EXPECT_TRUE(sketch.supportRef.empty());
  for (int i = 0; i < 3; ++i) {
    EXPECT_DOUBLE_EQ(sketch.plane.origin[i], plane.origin[i]);
    EXPECT_DOUBLE_EQ(sketch.plane.xAxis[i], plane.xAxis[i]);
    EXPECT_DOUBLE_EQ(sketch.plane.yAxis[i], plane.yAxis[i]);
    EXPECT_DOUBLE_EQ(sketch.plane.normal[i], plane.normal[i]);
  }
  kreoda::ShapeRecord extrusion;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("frame-persist-extrude", &extrusion));
  EXPECT_NEAR(extrusion.volumeMm3, 350, 1e-6);
  const double loadedBounds[6] = {10, 20, 30, 17, 30, 35};
  for (int i = 0; i < 6; ++i) EXPECT_NEAR(extrusion.bboxMm[i], loadedBounds[i], 1e-6);

  ASSERT_TRUE(kreoda::UpdateSketchFeature("frame-persist-sketch", RectModel(12, 6),
                                          &error)) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("frame-persist-sketch", &sketch));
  EXPECT_TRUE(sketch.supportRef.empty());
  for (int i = 0; i < 3; ++i) {
    EXPECT_DOUBLE_EQ(sketch.plane.origin[i], plane.origin[i]);
    EXPECT_DOUBLE_EQ(sketch.plane.xAxis[i], plane.xAxis[i]);
    EXPECT_DOUBLE_EQ(sketch.plane.yAxis[i], plane.yAxis[i]);
    EXPECT_DOUBLE_EQ(sketch.plane.normal[i], plane.normal[i]);
  }
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("frame-persist-extrude", &extrusion));
  EXPECT_NEAR(extrusion.volumeMm3, 504, 1e-6);
  const double editedBounds[6] = {10, 20, 30, 17, 32, 36};
  for (int i = 0; i < 6; ++i) EXPECT_NEAR(extrusion.bboxMm[i], editedBounds[i], 1e-6);

  std::error_code ec;
  fs::remove(icad, ec);
#else
  GTEST_SKIP() << "needs OCCT + minizip-ng (vcpkg build)";
#endif
}

TEST(Persistence, ResyncRejectsMalformedSketchWithoutChangingLiveCaches) {
#if KREODA_WITH_OCCT
  std::string error;
  ASSERT_TRUE(MakeHealthyUndoRedoState("resync-healthy", &error)) << error;
  const LiveState before = CaptureLiveState();
  ASSERT_GT(before.undos, 0);
  ASSERT_GT(before.redos, 0);

  kreoda::SketchFeature sketch;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("healthy-sketch", &sketch));
  const std::string malformed = CorruptSketchFrame(sketch);
  ASSERT_FALSE(malformed.empty());
  auto& ocaf = kreoda::OcafLive::instance();
  ASSERT_TRUE(ocaf.BeginCommand(&error)) << error;
  if (!ocaf.UpsertSketch("healthy-sketch", malformed, &error)) {
    ocaf.AbortCommand();
    FAIL() << error;
  }

  error.clear();
  EXPECT_FALSE(ocaf.ResyncStore(&error));
  EXPECT_NE(error.find("healthy-sketch"), std::string::npos) << error;
  EXPECT_NE(error.find("plane"), std::string::npos) << error;
  ocaf.AbortCommand();
  ExpectLiveStateUnchanged(before);
#else
  GTEST_SKIP() << "needs OCCT";
#endif
}

TEST(Persistence, LoadRejectsMalformedSketchBeforeResettingLiveDocument) {
#if KREODA_WITH_OCCT && KREODA_WITH_MINIZIP
  const fs::path icad = fs::temp_directory_path() /
                        ("kreoda-bad-load-" + UniqueStamp() + ".icad");
  const fs::path extracted = fs::temp_directory_path() /
                            ("kreoda-bad-load-xbf-" + UniqueStamp());
  std::string error;
  ASSERT_TRUE(MakeMalformedIcad(icad, &error)) << error;
  ASSERT_TRUE(MakeHealthyUndoRedoState("load-healthy", &error)) << error;
  const LiveState before = CaptureLiveState();
  ASSERT_GT(before.undos, 0);
  ASSERT_GT(before.redos, 0);

  std::string manifest, xbf;
  fs::create_directories(extracted);
  ASSERT_TRUE(kreoda::ReadIcad(icad.string(), extracted.string(), &manifest,
                               &xbf, &error)) << error;
  std::vector<kreoda::ShapeRecord> records;
  std::vector<std::string> sketchJsons;
  error.clear();
  EXPECT_FALSE(kreoda::OcafLive::instance().Load(xbf, &records, &sketchJsons,
                                                 &error));
  EXPECT_NE(error.find("corrupt-sketch"), std::string::npos) << error;
  EXPECT_NE(error.find("plane"), std::string::npos) << error;
  ExpectLiveStateUnchanged(before);

  std::error_code ec;
  fs::remove(icad, ec);
  fs::remove_all(extracted, ec);
#else
  GTEST_SKIP() << "needs OCCT + minizip-ng (vcpkg build)";
#endif
}

TEST(Persistence, OpenRejectsMalformedSketchWithoutLosingUndoRedo) {
#if KREODA_WITH_OCCT && KREODA_WITH_MINIZIP
  const fs::path icad = fs::temp_directory_path() /
                        ("kreoda-bad-open-" + UniqueStamp() + ".icad");
  std::string error;
  ASSERT_TRUE(MakeMalformedIcad(icad, &error)) << error;
  ASSERT_TRUE(MakeHealthyUndoRedoState("open-healthy", &error)) << error;
  const LiveState before = CaptureLiveState();
  ASSERT_GT(before.undos, 0);
  ASSERT_GT(before.redos, 0);

  const std::string open =
      std::string(R"({"protocolVersion":1,"requestId":"bad-open","documentId":"open-healthy","type":11,"path":")") +
      icad.generic_string() + "\"}";
  const std::string rejected = kreoda_test::rpcText(open);
  EXPECT_NE(rejected.find("\"status\":\"error\""), std::string::npos)
      << rejected;
  EXPECT_NE(rejected.find("OPEN_FAILED"), std::string::npos) << rejected;
  EXPECT_NE(rejected.find("corrupt-sketch"), std::string::npos) << rejected;
  EXPECT_NE(rejected.find("plane"), std::string::npos) << rejected;
  ExpectLiveStateUnchanged(before);

  const std::string redo =
      R"({"protocolVersion":1,"requestId":"bad-open-redo","documentId":"open-healthy","type":9})";
  const std::string redone = kreoda_test::rpcText(redo);
  ASSERT_NE(redone.find("\"status\":\"ok\""), std::string::npos) << redone;
  kreoda::ShapeRecord extrusion;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("healthy-extrude", &extrusion));
  EXPECT_NEAR(extrusion.volumeMm3, 504, 1e-6);
  const std::string undo =
      R"({"protocolVersion":1,"requestId":"bad-open-undo","documentId":"open-healthy","type":8})";
  const std::string undone = kreoda_test::rpcText(undo);
  ASSERT_NE(undone.find("\"status\":\"ok\""), std::string::npos) << undone;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("healthy-extrude", &extrusion));
  EXPECT_NEAR(extrusion.volumeMm3, 350, 1e-6);

  std::error_code ec;
  fs::remove(icad, ec);
#else
  GTEST_SKIP() << "needs OCCT + minizip-ng (vcpkg build)";
#endif
}

TEST(Persistence, DuplicateSketchMetadataRootsRejectEitherRootOrder) {
#if KREODA_WITH_OCCT && KREODA_WITH_MINIZIP
  for (const bool malformedFirst : {false, true}) {
    const std::string suffix = UniqueStamp();
    const fs::path icad = fs::temp_directory_path() /
                          ("kreoda-duplicate-roots-" + suffix + ".icad");
    const fs::path extracted = fs::temp_directory_path() /
                               ("kreoda-duplicate-roots-xbf-" + suffix);
    std::string error;
    ASSERT_TRUE(MakeDuplicateSketchRootsIcad(icad, malformedFirst, &error))
        << error;
    const std::string documentId = "duplicate-target-" + suffix;
    ASSERT_TRUE(MakeHealthyUndoRedoState(documentId, &error)) << error;
    const LiveState before = CaptureLiveState();
    ASSERT_GT(before.undos, 0);
    ASSERT_GT(before.redos, 0);

    std::string manifest, xbf;
    fs::create_directories(extracted);
    ASSERT_TRUE(kreoda::ReadIcad(icad.string(), extracted.string(), &manifest,
                                 &xbf, &error)) << error;
    std::vector<kreoda::SketchFeature> sketches;
    error.clear();
    EXPECT_FALSE(kreoda::OcafLive::instance().ValidateSketchesInFile(
        xbf, &sketches, &error));
    EXPECT_NE(error.find("metadata"), std::string::npos) << error;
    EXPECT_NE(error.find("Sketches"), std::string::npos) << error;
    ExpectLiveStateUnchanged(before);

    std::vector<kreoda::ShapeRecord> records;
    error.clear();
    EXPECT_FALSE(kreoda::OcafLive::instance().Load(xbf, &records, &error));
    EXPECT_NE(error.find("metadata"), std::string::npos) << error;
    EXPECT_NE(error.find("Sketches"), std::string::npos) << error;
    ExpectLiveStateUnchanged(before);

    const std::string open =
        "{\"protocolVersion\":1,\"requestId\":\"duplicate-open-" + suffix +
        "\",\"documentId\":\"" + documentId + "\",\"type\":11,\"path\":\"" +
        icad.generic_string() + "\"}";
    const std::string rejected = kreoda_test::rpcText(open);
    EXPECT_NE(rejected.find("\"status\":\"error\""), std::string::npos)
        << rejected;
    EXPECT_NE(rejected.find("OPEN_FAILED"), std::string::npos) << rejected;
    EXPECT_NE(rejected.find("metadata"), std::string::npos) << rejected;
    EXPECT_NE(rejected.find("Sketches"), std::string::npos) << rejected;
    ExpectLiveStateUnchanged(before);

    const std::string redo =
        "{\"protocolVersion\":1,\"requestId\":\"duplicate-redo-" + suffix +
        "\",\"documentId\":\"" + documentId + "\",\"type\":9}";
    const std::string redone = kreoda_test::rpcText(redo);
    ASSERT_NE(redone.find("\"status\":\"ok\""), std::string::npos) << redone;
    kreoda::ShapeRecord extrusion;
    ASSERT_TRUE(kreoda::ShapeStore::instance().get("healthy-extrude", &extrusion));
    EXPECT_NEAR(extrusion.volumeMm3, 504, 1e-6);
    const std::string undo =
        "{\"protocolVersion\":1,\"requestId\":\"duplicate-undo-" + suffix +
        "\",\"documentId\":\"" + documentId + "\",\"type\":8}";
    const std::string undone = kreoda_test::rpcText(undo);
    ASSERT_NE(undone.find("\"status\":\"ok\""), std::string::npos) << undone;
    ASSERT_TRUE(kreoda::ShapeStore::instance().get("healthy-extrude", &extrusion));
    EXPECT_NEAR(extrusion.volumeMm3, 350, 1e-6);

    std::error_code ec;
    fs::remove(icad, ec);
    fs::remove_all(extracted, ec);
  }
#else
  GTEST_SKIP() << "needs OCCT + minizip-ng (vcpkg build)";
#endif
}
