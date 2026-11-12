#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

#include <atomic>
#include <cmath>
#include <filesystem>
#include <functional>
#include <sstream>
#include <system_error>
#include <vector>

#if KREODA_WITH_OCCT
#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <BRep_Builder.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Precision.hxx>
#include <STEPControl_StepModelType.hxx>
#include <STEPControl_Writer.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Dir.hxx>
#include <gp_Ax1.hxx>
#include <gp_Pnt.hxx>
#include <gp_Pln.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#endif

#include "analysis/mass_properties.h"
#include "document/document_store.h"
#include "expressions/expressions.h"
#include "exchange/step_exchange.h"
#include "features/direct/face_history.h"
#include "features/instance/instance.h"
#include "features/primitives/primitives.h"
#include "model/body.h"
#include "model/geometry_kind.h"
#include "model/shapes.h"
#include "persistence/ocaf_live.h"
#include "protocol/dispatcher.h"
#include "topology/face_roles.h"

namespace {
using Json = nlohmann::json;

Json send(int type, Json fields, const std::string& requestId,
          const std::string& documentId = "face-history-red") {
  Json packet = {{"protocolVersion", 1}, {"requestId", requestId},
                 {"documentId", documentId}, {"type", type}};
  packet.update(fields);
  const auto bytes = kreoda::handle_command(packet.dump());
  return Json::parse(bytes.begin(), bytes.end());
}

#if KREODA_WITH_OCCT
namespace fs = std::filesystem;

struct TemporaryStep {
  fs::path path;

  explicit TemporaryStep(const std::string& label,
                         const std::string& extension = ".step") {
    static std::atomic<unsigned> sequence{0};
    path = fs::temp_directory_path() /
        ("kreoda-face-history-" + label + "-" +
         std::to_string(sequence.fetch_add(1)) + extension);
  }

  ~TemporaryStep() {
    std::error_code ignored;
    fs::remove(path, ignored);
  }
};

bool writeStep(const TopoDS_Shape& shape, const fs::path& path,
               std::string* error) {
  STEPControl_Writer writer;
  if (writer.Transfer(shape, STEPControl_AsIs) != IFSelect_RetDone) {
    if (error) *error = "STEP writer could not transfer the test shape";
    return false;
  }
  if (writer.Write(path.string().c_str()) != IFSelect_RetDone) {
    if (error) *error = "STEP writer could not write the test shape";
    return false;
  }
  return true;
}

std::vector<std::string> importStepShape(const TopoDS_Shape& shape,
                                         const std::string& label,
                                         std::string* error) {
  TemporaryStep file(label);
  if (!writeStep(shape, file.path, error)) return {};
  kreoda::DocumentStore::instance().create("face-history-red");
  std::vector<std::string> ids;
  if (!kreoda::ImportStep(file.path.string(), &ids, error)) return {};
  return ids;
}

template <typename Predicate>
std::string faceRole(const kreoda::ShapeRecord& owner, Predicate predicate) {
  const auto roles = kreoda::ClassifyFaceRoles(
      owner.shape, owner.type, owner.featureId);
  std::size_t index = 0;
  for (TopExp_Explorer it(owner.shape, TopAbs_FACE); it.More(); it.Next(), ++index) {
    if (index < roles.size() &&
        predicate(TopoDS::Face(it.Current()))) return roles[index];
  }
  return {};
}

gp_Dir outwardNormal(const TopoDS_Face& face) {
  gp_Dir normal = BRepAdaptor_Surface(face).Plane().Axis().Direction();
  if (face.Orientation() == TopAbs_REVERSED) normal.Reverse();
  return normal;
}

std::string topFaceRole(const kreoda::ShapeRecord& owner, double z) {
  return faceRole(owner, [z](const TopoDS_Face& face) {
    if (BRepAdaptor_Surface(face).GetType() != GeomAbs_Plane ||
        outwardNormal(face).Dot(gp_Dir(0, 0, 1)) < 1.0 - 1e-8)
      return false;
    return std::abs(BRepAdaptor_Surface(face).Plane().Location().Z() - z) < 1e-6;
  });
}

std::string cylinderFaceRole(const kreoda::ShapeRecord& owner, double radius) {
  return faceRole(owner, [radius](const TopoDS_Face& face) {
    const BRepAdaptor_Surface surface(face);
    return surface.GetType() == GeomAbs_Cylinder &&
           std::abs(surface.Cylinder().Radius() - radius) < 1e-6;
  });
}

std::string sphereFaceRole(const kreoda::ShapeRecord& owner, double radius) {
  return faceRole(owner, [radius](const TopoDS_Face& face) {
    const BRepAdaptor_Surface surface(face);
    return surface.GetType() == GeomAbs_Sphere &&
           std::abs(surface.Sphere().Radius() - radius) < 1e-6;
  });
}

std::string obliqueFaceRole(const kreoda::ShapeRecord& owner) {
  return faceRole(owner, [](const TopoDS_Face& face) {
    if (BRepAdaptor_Surface(face).GetType() != GeomAbs_Plane) return false;
    const auto normal = outwardNormal(face);
    return std::abs(normal.X()) > 1e-3 && std::abs(normal.Z()) > 1e-3;
  });
}

Json publicFace(const std::string& owner, const std::string& role) {
  return {{"type", "face"}, {"featureId", owner},
          {"persistentFaceId", role}};
}

Json moveFields(const std::string& featureId, const std::string& owner,
                const std::string& role, std::int64_t revision,
                Json translation, Json rotation, Json pivot) {
  return {{"featureId", featureId}, {"sourceFeatureId", owner},
          {"sourceFace", publicFace(owner, role)}, {"captureRevision", revision},
          {"translationMm", std::move(translation)},
          {"rotationDeg", std::move(rotation)}, {"pivotMm", std::move(pivot)}};
}

std::string serializedShape(const TopoDS_Shape& shape) {
  std::ostringstream out;
  BRepTools::Write(shape, out);
  return out.str();
}

double shapeVolume(const TopoDS_Shape& shape) {
  GProp_GProps props;
  BRepGProp::VolumeProperties(shape, props);
  return props.Mass();
}

bool validOneSolid(const TopoDS_Shape& shape) {
  if (shape.IsNull() || !BRepCheck_Analyzer(shape).IsValid()) return false;
  int solids = 0;
  for (TopExp_Explorer it(shape, TopAbs_SOLID); it.More(); it.Next()) ++solids;
  if (solids != 1) return false;
  for (TopExp_Explorer solid(shape, TopAbs_SOLID); solid.More(); solid.Next()) {
    for (TopExp_Explorer shell(solid.Current(), TopAbs_SHELL);
         shell.More(); shell.Next()) {
      if (!BRep_Tool::IsClosed(shell.Current())) return false;
    }
  }
  return true;
}

TopoDS_Shape replacementFixture() {
  BRepBuilderAPI_MakePolygon outline;
  outline.Add(gp_Pnt(0, 0, 0));
  outline.Add(gp_Pnt(20, 0, 0));
  outline.Add(gp_Pnt(20, 0, 7));
  outline.Add(gp_Pnt(0, 0, 5));
  outline.Close();
  BRepBuilderAPI_MakeFace section(outline.Wire());
  return BRepPrimAPI_MakePrism(section.Face(), gp_Vec(0, 10, 0)).Shape();
}

TopoDS_Shape replacementCompoundFixture() {
  TopoDS_Compound compound;
  BRep_Builder builder;
  builder.MakeCompound(compound);
  builder.Add(compound, BRepPrimAPI_MakeBox(20, 10, 5).Shape());
  builder.Add(compound, replacementFixture());
  return compound;
}

TopoDS_Shape importedBoreFixture() {
  const auto outer = BRepPrimAPI_MakeCylinder(10, 20).Shape();
  const auto inner = BRepPrimAPI_MakeCylinder(3, 20).Shape();
  BRepAlgoAPI_Cut cut(outer, inner);
  cut.Build();
  return cut.IsDone() ? cut.Shape() : TopoDS_Shape();
}

std::vector<std::string> importBox(const std::string& label,
                                   std::string* error,
                                   const gp_Pnt& origin = gp_Pnt(0, 0, 0)) {
  return importStepShape(BRepPrimAPI_MakeBox(origin, 20, 10, 5).Shape(),
                         label, error);
}

std::vector<std::string> importOffsetFixture(const std::string& kind,
                                             std::string* error) {
  if (kind == "plane")
    return importBox("offset-plane", error);
  if (kind == "cylinder")
    return importStepShape(BRepPrimAPI_MakeCylinder(10, 20).Shape(),
                           "offset-cylinder", error);
  return importStepShape(BRepPrimAPI_MakeSphere(10).Shape(),
                         "offset-sphere", error);
}

std::string outerFaceRole(const kreoda::ShapeRecord& owner) {
  return cylinderFaceRole(owner, 10.0);
}

bool hasCylindricalFace(const TopoDS_Shape& shape, double radius) {
  for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next()) {
    const BRepAdaptor_Surface surface(TopoDS::Face(it.Current()));
    if (surface.GetType() == GeomAbs_Cylinder &&
        std::abs(surface.Cylinder().Radius() - radius) < 1e-6)
      return true;
  }
  return false;
}

std::size_t planarFacesAtZ(const TopoDS_Shape& shape, double z) {
  std::size_t count = 0;
  for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next()) {
    const BRepAdaptor_Surface surface(TopoDS::Face(it.Current()));
    if (surface.GetType() == GeomAbs_Plane &&
        std::abs(surface.Plane().Location().Z() - z) < 1e-6)
      ++count;
  }
  return count;
}

double sphereRadius(const TopoDS_Shape& shape) {
  for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next()) {
    const BRepAdaptor_Surface surface(TopoDS::Face(it.Current()));
    if (surface.GetType() == GeomAbs_Sphere) return surface.Sphere().Radius();
  }
  return -1;
}

std::string selectionEntry(const kreoda::ShapeRecord& feature,
                           const std::string& key = "sourceFace") {
  return Json::parse(feature.refExtra).at(key).at("selectionEntry")
      .get<std::string>();
}
#endif
}  // namespace

TEST(DirectFaceHistory, MoveFaceCommandCreatesHistoryFromCurrentFaceCapture) {
#if KREODA_WITH_OCCT
  kreoda::DocumentStore::instance().create("face-history-red");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("face-history-source", 20, 10, 5,
                                       &error)) << error;

  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("face-history-source", &source));
  std::string persistentFaceId;
  for (const auto& role : kreoda::ClassifyFaceRoles(
           source.shape, source.type, source.featureId)) {
    if (role == "face-history-source:box.+Z") persistentFaceId = role;
  }
  ASSERT_FALSE(persistentFaceId.empty());

  const auto response = send(57, {
      {"featureId", "face-history-move"},
      {"sourceFeatureId", source.featureId},
      {"sourceFace", {{"type", "face"}, {"featureId", source.featureId},
                       {"persistentFaceId", persistentFaceId}}},
      {"captureRevision", kreoda::DocumentStore::instance().revision()},
      {"translationMm", {{"x", 0}, {"y", 0}, {"z", 1}}},
      {"rotationDeg", {{"x", 0}, {"y", 0}, {"z", 0}}},
      {"pivotMm", {{"x", 0}, {"y", 0}, {"z", 0}}},
  }, "face-history-move");

  ASSERT_EQ(response["status"], "ok") << response.dump();
  kreoda::ShapeRecord moved;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("face-history-move", &moved));
  EXPECT_EQ(moved.type, "MoveFace");
  EXPECT_EQ(moved.dependsOn, (std::vector<std::string>{source.featureId}));
  EXPECT_EQ(moved.paramsMm, (std::vector<double>{0, 0, 1, 0, 0, 0, 0, 0, 0}));
  EXPECT_EQ(kreoda::DescribeParams("MoveFace"),
            (std::vector<std::string>{"txMm", "tyMm", "tzMm", "rxDeg",
                                      "ryDeg", "rzDeg", "pxMm", "pyMm", "pzMm"}));
  kreoda::BodyRecord body;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature(source.featureId, &body));
  EXPECT_EQ(body.tipFeatureId, "face-history-move");
  EXPECT_EQ(body.history, (std::vector<std::string>{
      "face-history-source", "face-history-move"}));
  EXPECT_EQ(kreoda::FeatureBodySemantics("MoveFace"),
            kreoda::BodySemantics::AdvancesBody);

  ASSERT_TRUE(kreoda::RebuildFeature("face-history-move", "tzMm", 2,
                                     std::string{}, &error)) << error;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("face-history-move", &moved));
  EXPECT_DOUBLE_EQ(moved.paramsMm[2], 2);
  kreoda::MassProperties mass;
  ASSERT_TRUE(kreoda::MeasureMassProperties(moved, 0, &mass, &error)) << error;
  EXPECT_DOUBLE_EQ(mass.volumeMm3, 1400);
#else
  kreoda::DocumentStore::instance().create("face-history-red");
  const Json request = {
      {"protocolVersion", 1}, {"requestId", "no-occt-direct-face"},
      {"documentId", "face-history-red"}, {"type", 57},
      {"featureId", "face-history-move"},
      {"sourceFeatureId", "face-history-source"},
      {"sourceFace", {{"type", "face"}, {"featureId", "face-history-source"},
                       {"persistentFaceId", "box.+Z"}}},
      {"captureRevision", kreoda::DocumentStore::instance().snapshotRevision()},
      {"translationMm", {{"x", 0}, {"y", 0}, {"z", 1}}},
      {"rotationDeg", {{"x", 0}, {"y", 0}, {"z", 0}}},
      {"pivotMm", {{"x", 0}, {"y", 0}, {"z", 0}}},
  };
  std::string error;
  EXPECT_FALSE(kreoda::CreateMoveFaceFeature(request, &error));
  EXPECT_NE(error.find("requires OCCT"), std::string::npos);
#endif
}

#if KREODA_WITH_OCCT
TEST(DirectFaceHistory, SourceOwnerAndCaptureRevisionFailBeforeAcquisition) {
  kreoda::DocumentStore::instance().create("face-history-red");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("face-history-source", 20, 10, 5,
                                       &error)) << error;
  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  const auto shapesBefore = kreoda::ShapeStore::instance().listInOrder().size();

  Json common = {
      {"featureId", "face-history-rejected"},
      {"sourceFeatureId", "face-history-source"},
      {"sourceFace", {{"type", "face"}, {"featureId", "face-history-source"},
                       {"persistentFaceId", "face-history-source:box.+Z"}}},
      {"captureRevision", revision},
      {"translationMm", {{"x", 0}, {"y", 0}, {"z", 1}}},
      {"rotationDeg", {{"x", 0}, {"y", 0}, {"z", 0}}},
      {"pivotMm", {{"x", 0}, {"y", 0}, {"z", 0}}},
  };
  common["sourceFace"]["featureId"] = "other-owner";
  auto response = send(57, common, "face-history-wrong-owner");
  EXPECT_EQ(response["status"], "error");
  EXPECT_NE(response["errorMessage"].get<std::string>().find(
                "must match its source feature"), std::string::npos);
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("face-history-rejected"));
  EXPECT_EQ(kreoda::ShapeStore::instance().listInOrder().size(), shapesBefore);
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);

  common["sourceFace"]["featureId"] = "face-history-source";
  common["captureRevision"] = revision - 1;
  response = send(57, common, "face-history-stale-capture");
  EXPECT_EQ(response["status"], "error");
  EXPECT_NE(response["errorMessage"].get<std::string>().find(
                "captureRevision"), std::string::npos);
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("face-history-rejected"));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
}

TEST(DirectFaceHistory, InstanceTargetIsRejectedAndTaintsJoinedDraft) {
  kreoda::DocumentStore::instance().create("face-history-red");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("face-history-instance-source",
                                       20, 10, 5, &error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature(
      "face-history-instance", "face-history-instance-source",
      {100, 0, 0, 0, 0, 0}, &error)) << error;
  kreoda::ShapeRecord instance;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("face-history-instance", &instance));
  const auto roles = kreoda::ClassifyFaceRoles(
      instance.shape, instance.type, instance.featureId);
  ASSERT_FALSE(roles.empty());
  const auto bodyCount = kreoda::BodyStore::instance().bodies().size();
  const auto shapeCount = kreoda::ShapeStore::instance().listInOrder().size();
  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();

  Json request = {
      {"featureId", "face-history-instance-edit"},
      {"sourceFeatureId", instance.featureId},
      {"sourceFace", {{"type", "face"}, {"featureId", instance.featureId},
                       {"persistentFaceId", roles.front()}}},
      {"captureRevision", revision},
      {"translationMm", {{"x", 0}, {"y", 0}, {"z", 1}}},
      {"rotationDeg", {{"x", 0}, {"y", 0}, {"z", 0}}},
      {"pivotMm", {{"x", 0}, {"y", 0}, {"z", 0}}},
  };
  auto response = send(57, request, "face-history-instance-rejected");
  EXPECT_EQ(response["status"], "error");
  EXPECT_NE(response["errorMessage"].get<std::string>().find(
                "current tip of an existing solid body"), std::string::npos);
  EXPECT_EQ(kreoda::BodyStore::instance().bodies().size(), bodyCount);
  EXPECT_EQ(kreoda::ShapeStore::instance().listInOrder().size(), shapeCount);
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);

  ASSERT_EQ(send(27, {{"transactionId", "face-history-joined"}},
                 "face-history-begin")["status"], "ok");
  ASSERT_EQ(send(3, {{"transactionId", "face-history-joined"},
                     {"featureId", "face-history-joined-draft"},
                     {"widthMm", 2}, {"heightMm", 3}, {"depthMm", 4}},
                 "face-history-draft")["status"], "ok");
  request["featureId"] = "face-history-joined-edit";
  request["transactionId"] = "face-history-joined";
  response = send(57, request, "face-history-joined-rejected");
  EXPECT_EQ(response["status"], "error");
  EXPECT_EQ(send(28, {{"transactionId", "face-history-joined"}},
                 "face-history-commit")["errorCode"], "TRANSACTION_TAINTED");
  EXPECT_FALSE(kreoda::OcafLive::instance().InTransaction());
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("face-history-joined-draft"));
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("face-history-joined-edit"));
  EXPECT_EQ(kreoda::BodyStore::instance().bodies().size(), bodyCount);
  EXPECT_EQ(kreoda::ShapeStore::instance().listInOrder().size(), shapeCount);
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
}

TEST(DirectFaceHistory, ImportedStepMoveFaceSupportsSignedRigidAndOffOriginEdits) {
  struct MoveCase {
    std::string name;
    Json translation;
    Json rotation;
    Json pivot;
    gp_Pnt origin;
    double topZ;
    double expectedVolume;
  };
  const std::vector<MoveCase> cases = {
      {"plus-two", {{"x", 0}, {"y", 0}, {"z", 2}},
       {{"x", 0}, {"y", 0}, {"z", 0}},
       {{"x", 0}, {"y", 0}, {"z", 0}}, gp_Pnt(0, 0, 0), 5, 1400},
      {"minus-one", {{"x", 0}, {"y", 0}, {"z", -1}},
       {{"x", 0}, {"y", 0}, {"z", 0}},
       {{"x", 0}, {"y", 0}, {"z", 0}}, gp_Pnt(0, 0, 0), 5, 800},
      {"rigid", {{"x", 0}, {"y", 0}, {"z", 0}},
       {{"x", 10}, {"y", 0}, {"z", 0}},
       {{"x", 10}, {"y", 5}, {"z", 5}}, gp_Pnt(0, 0, 0), 5, 1000},
      {"off-origin-pivot", {{"x", 0}, {"y", 0}, {"z", 0}},
       {{"x", 0.1}, {"y", 0}, {"z", 0}},
       {{"x", 10}, {"y", 1001}, {"z", 5}}, gp_Pnt(0, 0, 0), 5, -1},
      {"far-body-plus-two", {{"x", 0}, {"y", 0}, {"z", 2}},
       {{"x", 0}, {"y", 0}, {"z", 0}},
       {{"x", 0}, {"y", 0}, {"z", 0}}, gp_Pnt(2500, -4000, 5000), 5005, 1400},
  };

  for (const auto& test : cases) {
    SCOPED_TRACE(test.name);
    std::string error;
    const auto ids = importBox(test.name, &error, test.origin);
    ASSERT_EQ(ids.size(), 1u) << error;
    kreoda::ShapeRecord source;
    ASSERT_TRUE(kreoda::ShapeStore::instance().get(ids.front(), &source));
    ASSERT_EQ(source.type, "StepImport");
    const auto role = topFaceRole(source, test.topZ);
    ASSERT_FALSE(role.empty());
    const auto sourceBefore = serializedShape(source.shape);
    const auto featureId = "face-history-move-" + test.name;
    const auto response = send(57,
        moveFields(featureId, source.featureId, role,
                   kreoda::DocumentStore::instance().snapshotRevision(),
                   test.translation, test.rotation, test.pivot),
        "face-history-move-" + test.name);
    ASSERT_EQ(response.value("status", std::string{}), "ok") << response.dump();

    kreoda::ShapeRecord moved;
    ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &moved));
    EXPECT_EQ(moved.type, "MoveFace");
    EXPECT_EQ(moved.dependsOn, (std::vector<std::string>{source.featureId}));
    EXPECT_TRUE(validOneSolid(moved.shape));
    EXPECT_NE(serializedShape(moved.shape), sourceBefore);
    EXPECT_GT(shapeVolume(moved.shape), 0);
    if (test.expectedVolume > 0)
      EXPECT_NEAR(shapeVolume(moved.shape), test.expectedVolume, 0.1);
    if (test.name == "rigid") EXPECT_DOUBLE_EQ(moved.paramsMm[3], 10);
    if (test.name == "off-origin-pivot")
      EXPECT_DOUBLE_EQ(moved.paramsMm[7], 1001);
    if (test.name == "far-body-plus-two") {
      EXPECT_NEAR(moved.bboxMm[0], 2500, 0.05);
      EXPECT_NEAR(moved.bboxMm[1], -4000, 0.05);
      EXPECT_NEAR(moved.bboxMm[2], 5000, 0.05);
      EXPECT_NEAR(moved.bboxMm[3], 2520, 0.05);
      EXPECT_NEAR(moved.bboxMm[4], -3990, 0.05);
      EXPECT_NEAR(moved.bboxMm[5], 5007, 0.05);
    }
    EXPECT_FALSE(selectionEntry(moved).empty());

    kreoda::ShapeRecord unchangedSource;
    ASSERT_TRUE(kreoda::ShapeStore::instance().get(source.featureId,
                                                    &unchangedSource));
    EXPECT_EQ(serializedShape(unchangedSource.shape), sourceBefore);
    kreoda::BodyRecord body;
    ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature(source.featureId,
                                                              &body));
    EXPECT_EQ(body.tipFeatureId, featureId);
  }
}

TEST(DirectFaceHistory, TinyRotationWithLongLeverArmIsNotAFalseNoOp) {
  kreoda::DocumentStore::instance().create("face-history-red");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("face-history-tiny-source",
                                       20, 10, 5, &error)) << error;
  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("face-history-tiny-source",
                                                  &source));
  const auto role = topFaceRole(source, 5.0);
  ASSERT_FALSE(role.empty());

  const auto noOpRevision = kreoda::DocumentStore::instance().snapshotRevision();
  const auto noOp = send(57,
      moveFields("face-history-exact-noop", source.featureId, role,
                 noOpRevision, {{"x", 0}, {"y", 0}, {"z", 0}},
                 {{"x", 360}, {"y", 0}, {"z", 0}},
                 {{"x", 0}, {"y", -1e11}, {"z", 0}}),
      "face-history-exact-noop");
  EXPECT_EQ(noOp.value("status", std::string{}), "error");
  EXPECT_NE(noOp.value("errorMessage", std::string{}).find("true no-op"),
            std::string::npos);
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("face-history-exact-noop"));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), noOpRevision);

  constexpr double angleDegrees = 1e-13;
  constexpr double leverArmMm = 1e11;
  gp_Trsf measuredRotation;
  measuredRotation.SetRotation(
      gp_Ax1(gp_Pnt(0, -leverArmMm, 0), gp_Dir(1, 0, 0)),
      angleDegrees * 3.141592653589793 / 180.0);
  const gp_Pln originalPlane(gp_Pnt(0, 0, 5), gp_Dir(0, 0, 1));
  const double planeDistance = originalPlane.Distance(
      gp_Pnt(0, 0, 5).Transformed(measuredRotation));
  SCOPED_TRACE("measured_plane_distance_mm=" + std::to_string(planeDistance));
  ASSERT_GT(planeDistance, 1e-5);
  ASSERT_NEAR(planeDistance, 0.0001745329252, 1e-9);
  EXPECT_GT(planeDistance, Precision::Confusion());

  const auto sourceBefore = serializedShape(source.shape);
  const auto featureId = "face-history-tiny-move";
  const auto response = send(57,
      moveFields(featureId, source.featureId, role,
                 kreoda::DocumentStore::instance().snapshotRevision(),
                 {{"x", 0}, {"y", 0}, {"z", 0}},
                 {{"x", angleDegrees}, {"y", 0}, {"z", 0}},
                 {{"x", 0}, {"y", -leverArmMm}, {"z", 0}}),
      "face-history-tiny-move");
  ASSERT_EQ(response.value("status", std::string{}), "ok") << response.dump();
  kreoda::ShapeRecord moved;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &moved));
  EXPECT_TRUE(validOneSolid(moved.shape));
  EXPECT_NE(serializedShape(moved.shape), sourceBefore);
  EXPECT_NEAR(shapeVolume(moved.shape), 1000 + 200 * planeDistance, 0.01);
}

TEST(DirectFaceHistory, TwoMillimeterMoveDoesNotRetainNumericalEnvelopeCap) {
  kreoda::DocumentStore::instance().create("face-history-red");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("face-history-small-move-source",
                                       2, 2, 2, &error)) << error;
  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("face-history-small-move-source",
                                                  &source));
  ASSERT_NEAR(shapeVolume(source.shape), 8.0, 1e-8);
  const auto role = topFaceRole(source, 2.0);
  ASSERT_FALSE(role.empty());
  const auto original = serializedShape(source.shape);
  const auto response = send(57,
      moveFields("face-history-small-move", source.featureId, role,
                 kreoda::DocumentStore::instance().snapshotRevision(),
                 {{"x", 0}, {"y", 0}, {"z", 0.5}},
                 {{"x", 0}, {"y", 0}, {"z", 0}},
                 {{"x", 0}, {"y", 0}, {"z", 0}}),
      "face-history-small-move");
  ASSERT_EQ(response.value("status", std::string{}), "ok") << response.dump();
  kreoda::ShapeRecord moved;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("face-history-small-move", &moved));
  EXPECT_TRUE(validOneSolid(moved.shape));
  EXPECT_NEAR(shapeVolume(moved.shape), 10.0, 1e-8);
  EXPECT_NE(serializedShape(moved.shape), original);
  EXPECT_EQ(serializedShape(source.shape), original);
}

TEST(DirectFaceHistory, SubConfusionVolumeOffsetAcceptsPositivePhysicalSolid) {
  kreoda::DocumentStore::instance().create("face-history-red");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("face-history-tiny-offset-source",
                                       0.002, 0.002, 0.002, &error)) << error;
  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("face-history-tiny-offset-source",
                                                  &source));
  ASSERT_NEAR(shapeVolume(source.shape), 8e-9, 1e-15);
  const auto role = topFaceRole(source, 0.002);
  ASSERT_FALSE(role.empty());
  const auto original = serializedShape(source.shape);
  const auto response = send(58,
      {{"featureId", "face-history-tiny-offset"},
       {"sourceFeatureId", source.featureId},
       {"sourceFace", publicFace(source.featureId, role)},
       {"captureRevision", kreoda::DocumentStore::instance().snapshotRevision()},
       {"distanceMm", 0.001}},
      "face-history-tiny-offset");
  ASSERT_EQ(response.value("status", std::string{}), "ok") << response.dump();
  kreoda::ShapeRecord offset;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("face-history-tiny-offset", &offset));
  EXPECT_TRUE(validOneSolid(offset.shape));
  EXPECT_NEAR(shapeVolume(offset.shape), 1.2e-8, 1e-14);
  EXPECT_NEAR(offset.bboxMm[5], 0.003, 1.1 * Precision::Confusion());
  EXPECT_NE(serializedShape(offset.shape), original);
  EXPECT_EQ(serializedShape(source.shape), original);
}

TEST(DirectFaceHistory, ImportedStepSignedOffsetEditsPlanarCylindricalAndSphericalFaces) {
  for (const auto& kind : {std::string("plane"), std::string("cylinder"),
                           std::string("sphere")}) {
    for (const double distance : {1.0, -1.0}) {
      SCOPED_TRACE(kind + " offset " + std::to_string(distance));
      std::string error;
      const auto ids = importOffsetFixture(kind, &error);
      ASSERT_EQ(ids.size(), 1u) << error;
      kreoda::ShapeRecord source;
      ASSERT_TRUE(kreoda::ShapeStore::instance().get(ids.front(), &source));
      ASSERT_EQ(source.type, "StepImport");
      std::string role;
      if (kind == "plane") role = topFaceRole(source, 5.0);
      else if (kind == "cylinder") role = outerFaceRole(source);
      else role = sphereFaceRole(source, 10.0);
      ASSERT_FALSE(role.empty());
      const auto original = serializedShape(source.shape);
      const auto originalVolume = shapeVolume(source.shape);
      const auto featureId = "face-history-offset-" + kind +
          (distance > 0 ? "-positive" : "-negative");
      const auto response = send(58,
          {{"featureId", featureId}, {"sourceFeatureId", source.featureId},
           {"sourceFace", publicFace(source.featureId, role)},
           {"captureRevision", kreoda::DocumentStore::instance().snapshotRevision()},
           {"distanceMm", distance}},
          "face-history-offset-" + kind +
              (distance > 0 ? "-positive" : "-negative"));
      ASSERT_EQ(response.value("status", std::string{}), "ok") << response.dump();

      kreoda::ShapeRecord offset;
      ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &offset));
      EXPECT_EQ(offset.type, "OffsetFace");
      EXPECT_EQ(offset.dependsOn, (std::vector<std::string>{source.featureId}));
      EXPECT_EQ(offset.paramsMm, (std::vector<double>{distance}));
      EXPECT_TRUE(validOneSolid(offset.shape));
      EXPECT_NE(serializedShape(offset.shape), original);
      const double pi = 3.141592653589793;
      const double expectedVolume = kind == "plane"
          ? 200.0 * (5.0 + distance)
          : kind == "cylinder"
              ? pi * std::pow(10.0 + distance, 2) * 20.0
              : 4.0 * pi * std::pow(10.0 + distance, 3) / 3.0;
      EXPECT_NEAR(shapeVolume(offset.shape), expectedVolume, 0.1);
      EXPECT_GT(std::abs(shapeVolume(offset.shape) - originalVolume), 1e-5);
      if (kind == "plane") {
        EXPECT_NEAR(offset.bboxMm[0], 0, 0.1);
        EXPECT_NEAR(offset.bboxMm[1], 0, 0.1);
        EXPECT_NEAR(offset.bboxMm[2], 0, 0.1);
        EXPECT_NEAR(offset.bboxMm[3], 20, 0.1);
        EXPECT_NEAR(offset.bboxMm[4], 10, 0.1);
        EXPECT_NEAR(offset.bboxMm[5], 5.0 + distance, 0.1);
      } else if (kind == "cylinder") {
        const double radius = 10.0 + distance;
        EXPECT_TRUE(hasCylindricalFace(offset.shape, radius));
        EXPECT_EQ(planarFacesAtZ(offset.shape, 0), 1u);
        EXPECT_EQ(planarFacesAtZ(offset.shape, 20), 1u);
        EXPECT_NEAR(offset.bboxMm[0], -radius, 0.1);
        EXPECT_NEAR(offset.bboxMm[1], -radius, 0.1);
        EXPECT_NEAR(offset.bboxMm[2], 0, 0.1);
        EXPECT_NEAR(offset.bboxMm[3], radius, 0.1);
        EXPECT_NEAR(offset.bboxMm[4], radius, 0.1);
        EXPECT_NEAR(offset.bboxMm[5], 20, 0.1);
      } else {
        const double radius = 10.0 + distance;
        EXPECT_NEAR(sphereRadius(offset.shape), radius, 1e-6);
        EXPECT_NEAR(offset.bboxMm[0], -radius, 0.1);
        EXPECT_NEAR(offset.bboxMm[1], -radius, 0.1);
        EXPECT_NEAR(offset.bboxMm[2], -radius, 0.1);
        EXPECT_NEAR(offset.bboxMm[3], radius, 0.1);
        EXPECT_NEAR(offset.bboxMm[4], radius, 0.1);
        EXPECT_NEAR(offset.bboxMm[5], radius, 0.1);
      }
      EXPECT_FALSE(selectionEntry(offset).empty());

      kreoda::ShapeRecord unchangedSource;
      ASSERT_TRUE(kreoda::ShapeStore::instance().get(source.featureId,
                                                      &unchangedSource));
      EXPECT_EQ(serializedShape(unchangedSource.shape), original);
      kreoda::BodyRecord body;
      ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature(source.featureId,
                                                                &body));
      EXPECT_EQ(body.tipFeatureId, featureId);
    }
  }
}

TEST(DirectFaceHistory, ImportedStepBoreDeleteHealsAndLostIndexedBindingRequiresRepair) {
  std::string error;
  const auto ids = importStepShape(importedBoreFixture(), "bore-delete", &error);
  ASSERT_EQ(ids.size(), 1u) << error;
  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(ids.front(), &source));
  ASSERT_EQ(source.type, "StepImport");
  const auto role = cylinderFaceRole(source, 3.0);
  ASSERT_FALSE(role.empty());
  ASSERT_TRUE(kreoda::HasIndexedTopologyRole(role)) << role;
  const auto original = serializedShape(source.shape);
  const auto featureId = "face-history-delete-bore";
  const auto response = send(59,
      {{"featureId", featureId}, {"sourceFeatureId", source.featureId},
       {"sourceFace", publicFace(source.featureId, role)},
       {"captureRevision", kreoda::DocumentStore::instance().snapshotRevision()}},
      "face-history-delete-bore");
  ASSERT_EQ(response.value("status", std::string{}), "ok") << response.dump();

  kreoda::ShapeRecord deleted;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &deleted));
  EXPECT_EQ(deleted.type, "DeleteFace");
  EXPECT_EQ(deleted.dependsOn, (std::vector<std::string>{source.featureId}));
  EXPECT_TRUE(validOneSolid(deleted.shape));
  EXPECT_FALSE(hasCylindricalFace(deleted.shape, 3.0));
  EXPECT_TRUE(hasCylindricalFace(deleted.shape, 10.0));
  EXPECT_NE(serializedShape(deleted.shape), original);
  EXPECT_NEAR(shapeVolume(deleted.shape), 2000.0 * 3.141592653589793, 0.1);
  EXPECT_FALSE(selectionEntry(deleted).empty());
  EXPECT_EQ(Json::parse(deleted.refExtra).at("sourceFace")
                .at("persistentFaceId").get<std::string>(), role);
  EXPECT_EQ(serializedShape(source.shape), original);

  BRepBuilderAPI_Copy copy(source.shape, true, false);
  ASSERT_FALSE(copy.Shape().IsNull());
  auto changedSource = source;
  changedSource.shape = copy.Shape();
  kreoda::ShapeStore::instance().put(changedSource);
  error.clear();
  ASSERT_TRUE(kreoda::OcafLive::instance().BeginCommand(&error)) << error;
  EXPECT_FALSE(kreoda::RebuildDeleteFaceFromStore(featureId, &error));
  EXPECT_NE(error.find("needs repair"), std::string::npos) << error;
  EXPECT_NE(error.find("ordinal fallback is disabled"), std::string::npos) << error;
  kreoda::OcafLive::instance().AbortCommand();
  ASSERT_TRUE(kreoda::OcafLive::instance().ResyncStore(&error)) << error;
  kreoda::ShapeStore::instance().put(source);

  kreoda::ShapeRecord unchangedDelete;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &unchangedDelete));
  EXPECT_EQ(unchangedDelete.refExtra, deleted.refExtra);
  EXPECT_EQ(serializedShape(unchangedDelete.shape), serializedShape(deleted.shape));
}

TEST(DirectFaceHistory, ImportedStepReplaceUsesDistinctObliqueSupportBody) {
  std::string error;
  const auto ids = importStepShape(replacementCompoundFixture(), "replace", &error);
  ASSERT_EQ(ids.size(), 2u) << error;
  kreoda::ShapeRecord target, support;
  for (const auto& id : ids) {
    kreoda::ShapeRecord candidate;
    ASSERT_TRUE(kreoda::ShapeStore::instance().get(id, &candidate));
    if (std::abs(shapeVolume(candidate.shape) - 1000.0) < 0.1)
      target = candidate;
    else if (std::abs(shapeVolume(candidate.shape) - 1200.0) < 0.1)
      support = candidate;
  }
  ASSERT_FALSE(target.featureId.empty());
  ASSERT_FALSE(support.featureId.empty());
  ASSERT_NE(target.featureId, support.featureId);
  const auto targetRole = topFaceRole(target, 5.0);
  const auto supportRole = obliqueFaceRole(support);
  ASSERT_FALSE(targetRole.empty());
  ASSERT_FALSE(supportRole.empty());
  const auto targetBefore = serializedShape(target.shape);
  const auto supportBefore = serializedShape(support.shape);
  const auto featureId = "face-history-replace-oblique";
  const auto response = send(60,
      {{"featureId", featureId}, {"sourceFeatureId", target.featureId},
       {"sourceFace", publicFace(target.featureId, targetRole)},
       {"replacementFace", publicFace(support.featureId, supportRole)},
       {"captureRevision", kreoda::DocumentStore::instance().snapshotRevision()}},
      "face-history-replace-oblique");
  ASSERT_EQ(response.value("status", std::string{}), "ok") << response.dump();

  kreoda::ShapeRecord replaced;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &replaced));
  EXPECT_EQ(replaced.type, "ReplaceFace");
  EXPECT_EQ(replaced.dependsOn,
            (std::vector<std::string>{target.featureId, support.featureId}));
  EXPECT_TRUE(validOneSolid(replaced.shape));
  EXPECT_NE(serializedShape(replaced.shape), targetBefore);
  EXPECT_NEAR(shapeVolume(replaced.shape), 1200.0, 0.1);
  EXPECT_FALSE(selectionEntry(replaced).empty());
  EXPECT_FALSE(selectionEntry(replaced, "replacementFace").empty());
  kreoda::ShapeRecord unchangedTarget, unchangedSupport;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(target.featureId, &unchangedTarget));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(support.featureId, &unchangedSupport));
  EXPECT_EQ(serializedShape(unchangedTarget.shape), targetBefore);
  EXPECT_EQ(serializedShape(unchangedSupport.shape), supportBefore);
  kreoda::BodyRecord targetBody, supportBody;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature(target.featureId,
                                                            &targetBody));
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature(support.featureId,
                                                            &supportBody));
  EXPECT_EQ(targetBody.tipFeatureId, featureId);
  EXPECT_EQ(supportBody.tipFeatureId, support.featureId);
}

TEST(DirectFaceHistory, ImportedMoveBindingSurvivesUndoRedoSaveOpenAndEdit) {
  std::string error;
  const auto ids = importBox("history-roundtrip", &error);
  ASSERT_EQ(ids.size(), 1u) << error;
  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(ids.front(), &source));
  const auto role = topFaceRole(source, 5.0);
  ASSERT_FALSE(role.empty());
  const auto featureId = "face-history-persistent-move";
  const auto undosBefore = kreoda::OcafLive::instance().AvailableUndos();
  auto response = send(57,
      moveFields(featureId, source.featureId, role,
                 kreoda::DocumentStore::instance().snapshotRevision(),
                 {{"x", 0}, {"y", 0}, {"z", 1}},
                 {{"x", 0}, {"y", 0}, {"z", 0}},
                 {{"x", 0}, {"y", 0}, {"z", 0}}),
      "face-history-persistent-move");
  ASSERT_EQ(response.value("status", std::string{}), "ok") << response.dump();
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undosBefore + 1);

  ASSERT_TRUE(kreoda::OcafLive::instance().Undo(&error)) << error;
  ASSERT_TRUE(kreoda::OcafLive::instance().ResyncStore(&error)) << error;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains(featureId));
  ASSERT_TRUE(kreoda::OcafLive::instance().Redo(&error)) << error;
  ASSERT_TRUE(kreoda::OcafLive::instance().ResyncStore(&error)) << error;
  kreoda::ShapeRecord moved;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &moved));
  ASSERT_FALSE(selectionEntry(moved).empty());

  TemporaryStep archive("history", ".icad");
  response = send(kreoda::kSaveDocument, {{"path", archive.path.generic_string()}},
                  "face-history-save");
  ASSERT_EQ(response.value("status", std::string{}), "ok") << response.dump();
  kreoda::DocumentStore::instance().create("face-history-open");
  response = send(kreoda::kOpenDocument, {{"path", archive.path.generic_string()}},
                  "face-history-open", "face-history-open");
  ASSERT_EQ(response.value("status", std::string{}), "ok") << response.dump();
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &moved));
  EXPECT_EQ(moved.type, "MoveFace");
  EXPECT_FALSE(selectionEntry(moved).empty());

  response = send(kreoda::kSetFeatureParameter,
      {{"featureId", featureId}, {"paramName", "tzMm"}, {"valueMm", 2.0}},
      "face-history-post-open-edit", "face-history-open");
  ASSERT_EQ(response.value("status", std::string{}), "ok") << response.dump();
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &moved));
  EXPECT_DOUBLE_EQ(moved.paramsMm[2], 2.0);
  EXPECT_TRUE(validOneSolid(moved.shape));
  EXPECT_NEAR(shapeVolume(moved.shape), 1400.0, 0.1);
  ASSERT_EQ(send(kreoda::kUndo, Json::object(), "face-history-edit-undo",
                 "face-history-open").value("status", std::string{}), "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &moved));
  EXPECT_DOUBLE_EQ(moved.paramsMm[2], 1.0);
  EXPECT_NEAR(shapeVolume(moved.shape), 1200.0, 0.1);
  ASSERT_EQ(send(kreoda::kRedo, Json::object(), "face-history-edit-redo",
                 "face-history-open").value("status", std::string{}), "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &moved));
  EXPECT_DOUBLE_EQ(moved.paramsMm[2], 2.0);
  EXPECT_NEAR(shapeVolume(moved.shape), 1400.0, 0.1);
}

TEST(DirectFaceHistory, JoinedMoveAndSourceUndoAsOneGroup) {
  kreoda::DocumentStore::instance().create("face-history-red");
  const auto undosBefore = kreoda::OcafLive::instance().AvailableUndos();
  ASSERT_EQ(send(27, {{"transactionId", "face-history-group"}},
                 "face-history-group-begin").value("status", std::string{}), "ok");
  ASSERT_EQ(send(3, {{"transactionId", "face-history-group"},
                     {"featureId", "face-history-group-source"},
                     {"widthMm", 20}, {"heightMm", 10}, {"depthMm", 5}},
                 "face-history-group-box").value("status", std::string{}), "ok");
  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("face-history-group-source",
                                                  &source));
  const auto role = topFaceRole(source, 5.0);
  ASSERT_FALSE(role.empty());
  auto request = moveFields("face-history-group-move", source.featureId, role,
      kreoda::DocumentStore::instance().snapshotRevision(),
      {{"x", 0}, {"y", 0}, {"z", 1}}, {{"x", 0}, {"y", 0}, {"z", 0}},
      {{"x", 0}, {"y", 0}, {"z", 0}});
  request["transactionId"] = "face-history-group";
  auto response = send(57, request, "face-history-group-move");
  ASSERT_EQ(response.value("status", std::string{}), "ok") << response.dump();
  ASSERT_EQ(send(28, {{"transactionId", "face-history-group"}},
                 "face-history-group-commit").value("status", std::string{}), "ok");
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undosBefore + 1);

  std::string error;
  ASSERT_TRUE(kreoda::OcafLive::instance().Undo(&error)) << error;
  ASSERT_TRUE(kreoda::OcafLive::instance().ResyncStore(&error)) << error;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("face-history-group-source"));
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("face-history-group-move"));
  EXPECT_TRUE(kreoda::BodyStore::instance().bodies().empty());
  ASSERT_TRUE(kreoda::OcafLive::instance().Redo(&error)) << error;
  ASSERT_TRUE(kreoda::OcafLive::instance().ResyncStore(&error)) << error;
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("face-history-group-source"));
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("face-history-group-move"));
  kreoda::BodyRecord body;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature(
      "face-history-group-source", &body));
  EXPECT_EQ(body.tipFeatureId, "face-history-group-move");
}

TEST(DirectFaceHistory, SourceEditRebuildsMoveDependencyAndNumericFormulaUndo) {
  kreoda::DocumentStore::instance().create("face-history-red");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("face-history-dependent-source",
                                       20, 10, 5, &error)) << error;
  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(
      "face-history-dependent-source", &source));
  const auto role = topFaceRole(source, 5.0);
  ASSERT_FALSE(role.empty());
  const auto featureId = "face-history-dependent-move";
  auto response = send(57,
      moveFields(featureId, source.featureId, role,
                 kreoda::DocumentStore::instance().snapshotRevision(),
                 {{"x", 0}, {"y", 0}, {"z", 1}},
                 {{"x", 0}, {"y", 0}, {"z", 0}},
                 {{"x", 0}, {"y", 0}, {"z", 0}}),
      "face-history-dependent-move");
  ASSERT_EQ(response.value("status", std::string{}), "ok") << response.dump();

  response = send(kreoda::kSetFeatureParameter,
      {{"featureId", source.featureId}, {"paramName", "widthMm"},
       {"valueMm", 30.0}},
      "face-history-edit-source");
  ASSERT_EQ(response.value("status", std::string{}), "ok") << response.dump();
  kreoda::ShapeRecord editedSource, moved;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(source.featureId, &editedSource));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &moved));
  EXPECT_DOUBLE_EQ(editedSource.paramsMm[0], 30.0);
  EXPECT_TRUE(validOneSolid(moved.shape));
  EXPECT_NEAR(shapeVolume(moved.shape), 1800.0, 0.1);
  auto metadata = Json::parse(moved.refExtra);
  EXPECT_EQ(metadata.at("sourceFace").at("persistentFaceId").get<std::string>(),
            role);
  EXPECT_FALSE(selectionEntry(moved).empty());

  ASSERT_EQ(send(kreoda::kUndo, Json::object(), "face-history-source-undo")
                .value("status", std::string{}), "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &moved));
  EXPECT_NEAR(shapeVolume(moved.shape), 1200.0, 0.1);
  ASSERT_EQ(send(kreoda::kRedo, Json::object(), "face-history-source-redo")
                .value("status", std::string{}), "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &moved));
  EXPECT_NEAR(shapeVolume(moved.shape), 1800.0, 0.1);

  response = send(kreoda::kSetFeatureParameter,
      {{"featureId", featureId}, {"paramName", "tzMm"}, {"valueMm", 2.0}},
      "face-history-edit-numeric");
  ASSERT_EQ(response.value("status", std::string{}), "ok") << response.dump();
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &moved));
  EXPECT_DOUBLE_EQ(moved.paramsMm[2], 2.0);
  EXPECT_NEAR(shapeVolume(moved.shape), 2100.0, 0.1);
  ASSERT_EQ(send(kreoda::kUndo, Json::object(), "face-history-numeric-undo")
                .value("status", std::string{}), "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &moved));
  EXPECT_DOUBLE_EQ(moved.paramsMm[2], 1.0);
  ASSERT_EQ(send(kreoda::kRedo, Json::object(), "face-history-numeric-redo")
                .value("status", std::string{}), "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &moved));
  EXPECT_DOUBLE_EQ(moved.paramsMm[2], 2.0);

  response = send(kreoda::kSetFeatureParameter,
      {{"featureId", featureId}, {"paramName", "tzMm"},
       {"expression", "txMm + 3"}},
      "face-history-edit-formula");
  ASSERT_EQ(response.value("status", std::string{}), "ok") << response.dump();
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &moved));
  EXPECT_DOUBLE_EQ(moved.paramsMm[2], 3.0);
  EXPECT_NEAR(shapeVolume(moved.shape), 2400.0, 0.1);
  std::string formula;
  ASSERT_TRUE(kreoda::ExpressionStore::instance().get(featureId, "tzMm", &formula));
  EXPECT_EQ(formula, "txMm + 3");
  ASSERT_EQ(send(kreoda::kUndo, Json::object(), "face-history-formula-undo")
                .value("status", std::string{}), "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &moved));
  EXPECT_DOUBLE_EQ(moved.paramsMm[2], 2.0);
  EXPECT_FALSE(kreoda::ExpressionStore::instance().get(featureId, "tzMm", &formula));
  ASSERT_EQ(send(kreoda::kRedo, Json::object(), "face-history-formula-redo")
                .value("status", std::string{}), "ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(featureId, &moved));
  EXPECT_DOUBLE_EQ(moved.paramsMm[2], 3.0);
  EXPECT_NEAR(shapeVolume(moved.shape), 2400.0, 0.1);
}
#endif
