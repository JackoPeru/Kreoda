#include <gtest/gtest.h>
#include "features/surface/loft_sew.h"
#include "features/surface/face_thicken.h"
#include "model/body.h"
#include "features/datum/datum_commands.h"
#include "features/sketch/sketch_commands.h"
#include "document/document_store.h"
#include "persistence/ocaf_live.h"
#include "protocol/dispatcher.h"
#include "protocol/json_fields.h"
#include "protocol/generated/cad_protocol_generated.h"
#include "features/primitives/primitives.h"
#include <filesystem>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <gp_Circ.hxx>
#include <gp_Ax2.hxx>

namespace {
kreoda::ShapeRecord circle(const char* id, double z, double radius) {
  kreoda::ShapeRecord section;
  section.featureId = id;
  section.type = "Sketch";
  const auto edge = BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(0,0,z),gp_Dir(0,0,1)),radius)).Edge();
  section.shape = BRepBuilderAPI_MakeWire(edge).Wire();
  return section;
}
}

TEST(SurfaceLoft, ClosedProfilesProduceSewnValidSolidWithoutStoreMutation) {
  const auto bottom=circle("profile-bottom",0,10);
  const auto top=circle("profile-top",20,10);
  kreoda::ShapeRecord result;
  std::string error;
  ASSERT_TRUE(kreoda::BuildLoftSewnSolid({bottom,top},"loft-solid",&result,&error)) << error;
  EXPECT_EQ(result.featureId,"loft-solid");
  EXPECT_EQ(result.type,"SurfaceLoftSewnSolid");
  EXPECT_EQ(result.dependsOn,(std::vector<std::string>{"profile-bottom","profile-top"}));
  EXPECT_NEAR(result.volumeMm3,2000*std::acos(-1.0),0.01);
  EXPECT_TRUE(BRepCheck_Analyzer(result.shape).IsValid());
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("loft-solid"));
}

TEST(SurfaceLoft, PlanarFaceThickenCanonicalHistoryUndoRedoAndSaveOpen) {
  kreoda::DocumentStore::instance().create("surface-thicken-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("thicken-source",20,10,5,&error))<<error;
  auto rpc=[](kreoda::Json request) {
    request["protocolVersion"]=1;
    request["documentId"]="surface-thicken-doc";
    const auto bytes=kreoda::handle_command(request.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  const auto bad=rpc({{"type",46},{"requestId","thicken-bad"},
      {"featureId","invalid-thicken"},{"sourceFeatureId","thicken-source"},
      {"faceRole","box.+Z"},{"thicknessMm",-3}});
  EXPECT_EQ(bad["status"],"error");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("invalid-thicken"));
  const auto wrong=rpc({{"type",46},{"requestId","thicken-owner"},
      {"featureId","invalid-owner"},{"sourceFeatureId","thicken-source"},
      {"faceRole","other:box.+Z"},{"thicknessMm",3}});
  EXPECT_EQ(wrong["status"],"error");
  const auto created=rpc({{"type",46},{"requestId","thicken-create"},
      {"featureId","thickened-face"},{"sourceFeatureId","thicken-source"},
      {"faceRole","thicken-source:box.+Z"},{"thicknessMm",3}});
  ASSERT_EQ(created["status"],"ok")<<created;
  kreoda::ShapeRecord thickened,source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("thickened-face",&thickened));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("thicken-source",&source));
  EXPECT_EQ(thickened.type,"SurfaceFaceThicken");
  EXPECT_EQ(kreoda::FeatureBodySemantics(thickened.type),kreoda::BodySemantics::NewBody);
  EXPECT_EQ(kreoda::BodyStore::BodyIdForRoot("thickened-face"),"body-thickened-face");
  EXPECT_EQ(thickened.dependsOn,(std::vector<std::string>{"thicken-source"}));
  EXPECT_NEAR(thickened.volumeMm3,600,1e-5);
  EXPECT_NEAR(source.volumeMm3,1000,1e-5);
  EXPECT_TRUE(BRepCheck_Analyzer(thickened.shape).IsValid());
  ASSERT_EQ(rpc({{"type",8},{"requestId","thicken-undo"}})["status"],"ok");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("thickened-face"));
  ASSERT_EQ(rpc({{"type",9},{"requestId","thicken-redo"}})["status"],"ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("thickened-face",&thickened));
  EXPECT_NEAR(thickened.volumeMm3,600,1e-5);
  const auto path=(std::filesystem::temp_directory_path()/"kreoda-face-thicken.icad").string();
  ASSERT_EQ(rpc({{"type",10},{"requestId","thicken-save"},{"path",path}})["status"],"ok");
  ASSERT_EQ(rpc({{"type",2},{"requestId","thicken-new"}})["status"],"ok");
  ASSERT_EQ(rpc({{"type",11},{"requestId","thicken-open"},{"path",path}})["status"],"ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("thickened-face",&thickened));
  EXPECT_NEAR(thickened.volumeMm3,600,1e-5);
  ASSERT_TRUE(kreoda::RebuildSurfaceFaceThickenFromStore("thickened-face",&error))<<error;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("thickened-face",&thickened));
  EXPECT_NEAR(thickened.volumeMm3,600,1e-5);
  std::filesystem::remove(path);
}

TEST(SurfaceLoft, RejectsOpenOrInvalidSectionsWithoutChangingOutput) {
  auto a=circle("a",0,10),b=circle("b",20,10);
  kreoda::ShapeRecord result;
  result.featureId="unchanged";
  std::string error;
  EXPECT_FALSE(kreoda::BuildLoftSewnSolid({a},"loft",&result,&error));
  EXPECT_EQ(result.featureId,"unchanged");
  b.shape=BRepPrimAPI_MakeBox(10,10,10).Shape();
  EXPECT_FALSE(kreoda::BuildLoftSewnSolid({a,b},"loft",&result,&error));
  EXPECT_EQ(result.featureId,"unchanged");
}

TEST(SurfaceLoft, CanonicalSketchDependenciesAndUndo) {
  kreoda::DocumentStore::instance().create("loft-doc");
  std::string error;
  kreoda::SketchModel rectangle;
  rectangle.points={{"a",0,0},{"b",10,0},{"c",10,10},{"d",0,10}};
  rectangle.lines={{"ab","a","b"},{"bc","b","c"},{"cd","c","d"},{"da","d","a"}};
  ASSERT_TRUE(kreoda::CreateSketchFeature("loft-base","XY",rectangle,&error)) << error;
  ASSERT_TRUE(kreoda::CreateDatumFeature("loft-plane",kreoda::DatumKind::Plane,
    R"({"type":"offset","base":{"type":"principal","planeKind":"XY"},"offsetMm":20})",&error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchOnDatumFeature("loft-top","loft-plane",rectangle,&error)) << error;
  const auto createBytes=kreoda::handle_command(kreoda::Json{
    {"protocolVersion",1},{"requestId","loft-create"},{"documentId","loft-doc"},
    {"type",39},{"featureId","loft-result"},{"sketchIds",{"loft-base","loft-top"}}}.dump());
  const auto createReply=kreoda::Json::parse(createBytes.begin(),createBytes.end());
  ASSERT_EQ(createReply["status"],"ok") << createReply;
  kreoda::ShapeRecord created;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("loft-result",&created));
  EXPECT_NEAR(created.volumeMm3,2000,1e-5);
  EXPECT_EQ(created.dependsOn,(std::vector<std::string>{"loft-base","loft-top"}));
  const auto path=(std::filesystem::temp_directory_path()/"kreoda-surface-loft-roundtrip.icad").generic_string();
  auto rpc=[](const kreoda::Json& packet) {
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  const auto saved=rpc({{"protocolVersion",1},{"requestId","loft-save"},
                        {"documentId","loft-doc"},{"type",10},{"path",path}});
  ASSERT_EQ(saved["status"],"ok") << saved;
  const auto newDoc=rpc({{"protocolVersion",1},{"requestId","loft-reset"},
                         {"documentId","loft-doc-new"},{"type",2}});
  ASSERT_EQ(newDoc["status"],"ok") << newDoc;
  const auto opened=rpc({{"protocolVersion",1},{"requestId","loft-open"},
                         {"documentId","loft-doc-new"},{"type",11},{"path",path}});
  ASSERT_EQ(opened["status"],"ok") << opened;
  kreoda::ShapeRecord restored;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("loft-result",&restored));
  EXPECT_EQ(restored.type,"SurfaceLoftSewnSolid");
  EXPECT_EQ(restored.dependsOn,created.dependsOn);
  EXPECT_NEAR(restored.volumeMm3,created.volumeMm3,1e-5);
  ASSERT_TRUE(kreoda::RebuildSurfaceLoftSewnSolidFromStore("loft-result",&error)) << error;
  kreoda::ShapeRecord recomputed;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("loft-result",&recomputed));
  EXPECT_NEAR(recomputed.volumeMm3,created.volumeMm3,1e-5);
  std::filesystem::remove(path);
}

TEST(SurfaceLoft, UndoOfNewCanonicalFeature) {
  kreoda::DocumentStore::instance().create("loft-undo-doc");
  std::string error;
  kreoda::SketchModel rectangle;
  rectangle.points={{"a",0,0},{"b",10,0},{"c",10,10},{"d",0,10}};
  rectangle.lines={{"ab","a","b"},{"bc","b","c"},{"cd","c","d"},{"da","d","a"}};
  ASSERT_TRUE(kreoda::CreateSketchFeature("undo-base","XY",rectangle,&error)) << error;
  ASSERT_TRUE(kreoda::CreateDatumFeature("undo-plane",kreoda::DatumKind::Plane,
    R"({"type":"offset","base":{"type":"principal","planeKind":"XY"},"offsetMm":20})",&error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchOnDatumFeature("undo-top","undo-plane",rectangle,&error)) << error;
  EXPECT_EQ(static_cast<int>(kreoda::kCreateSurfaceLoftSewnSolid),
            static_cast<int>(Kreoda::Protocol::CommandType_CreateSurfaceLoftSewnSolid));
  auto rpc=[](const kreoda::Json& packet) {
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  const auto created=rpc({{"protocolVersion",1},{"requestId","loft-undo-create"},
    {"documentId","loft-undo-doc"},{"type",39},{"featureId","undo-loft"},
    {"sketchIds",{"undo-base","undo-top"}}});
  ASSERT_EQ(created["status"],"ok") << created;
  const auto undone=rpc({{"protocolVersion",1},{"requestId","loft-undo"},
    {"documentId","loft-undo-doc"},{"type",8}});
  ASSERT_EQ(undone["status"],"ok") << undone;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("undo-loft"));
  const auto redone=rpc({{"protocolVersion",1},{"requestId","loft-redo"},
    {"documentId","loft-undo-doc"},{"type",9}});
  ASSERT_EQ(redone["status"],"ok") << redone;
  kreoda::ShapeRecord restored;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("undo-loft",&restored));
  EXPECT_NEAR(restored.volumeMm3,2000,1e-5);
  EXPECT_EQ(restored.dependsOn,(std::vector<std::string>{"undo-base","undo-top"}));
}
