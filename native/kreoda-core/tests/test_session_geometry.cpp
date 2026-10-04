#include <gtest/gtest.h>
#include <cmath>
#include "document/document_store.h"
#include "features/primitives/primitives.h"
#include "features/hole/hole.h"
#include "features/instance/instance.h"
#include "protocol/dispatcher.h"
#include "protocol/json_fields.h"
#include "model/shapes.h"
#include "features/extrusion/extrude.h"
#include "features/sketch/sketch_commands.h"
#include <BRep_Builder.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <TopoDS_Compound.hxx>
#include <TopExp_Explorer.hxx>

namespace {
kreoda::Json query(const std::string& method, kreoda::Json params = kreoda::Json::object()) {
  const auto bytes = kreoda::handle_command(kreoda::Json{{"protocolVersion",1},{"requestId","query"},{"documentId","geometry-doc"},{"type",30},{"method",method},{"params",params}}.dump());
  return kreoda::Json::parse(bytes.begin(), bytes.end());
}
void box() {
  kreoda::DocumentStore::instance().create("geometry-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("box",20,30,10,&error)) << error;
}
}

TEST(SessionGeometry, DistanceUsesMinimumBrepDistanceInsteadOfCentroids) {
  box();
  const auto touching=query("measureDistance",{{"a","box:box.+Z"},{"b","box:box.+X"}});
  ASSERT_EQ(touching["status"],"ok") << touching;
  EXPECT_NEAR(touching["result"]["distanceMm"].get<double>(),0,1e-7);
  const auto parallel=query("measureDistance",{{"a","box:box.+Z"},{"b","box:box.-Z"}});
  ASSERT_EQ(parallel["status"],"ok") << parallel;
  EXPECT_NEAR(parallel["result"]["distanceMm"].get<double>(),10,1e-7);
  const auto angle=query("measureAngle",{{"a","box:box.+Z"},{"b","box:box.+X"}});
  ASSERT_EQ(angle["status"],"ok") << angle;
  EXPECT_NEAR(angle["result"]["angleDeg"].get<double>(),90,1e-7);
}

TEST(SessionGeometry, AnalyticAreaRadiusAndTypedSemanticSearch) {
  kreoda::DocumentStore::instance().create("geometry-doc"); std::string error;
  ASSERT_TRUE(kreoda::CreateSphereFeature("sphere",10,&error)) << error;
  const auto area=query("measureArea",{{"featureId","sphere"}});
  ASSERT_EQ(area["status"],"ok") << area;
  EXPECT_NEAR(area["result"]["areaMm2"].get<double>(),400*std::acos(-1.0),1e-7);
  const auto radius=query("measureRadius",{{"featureId","sphere"}});
  ASSERT_EQ(radius["status"],"ok") << radius;
  EXPECT_NEAR(radius["result"]["radiusMm"].get<double>(),10,1e-7);
  const auto faces=query("findFaces",{{"ownerBody","body-sphere"},{"surfaceType","sphere"},{"radiusMm",10}});
  ASSERT_EQ(faces["status"],"ok") << faces;
  ASSERT_EQ(faces["result"]["faces"].size(),1u);
  EXPECT_EQ(faces["result"]["faces"][0]["ownerBody"],"body-sphere");
  EXPECT_TRUE(faces["result"]["faces"][0].contains("description"));
  EXPECT_EQ(query("findFaces",{{"radiusMm","10"}})["errorCode"],"BAD_PARAMS");
}

TEST(SessionGeometry, ModelVolumeCountsOnlyTipsAndDisplayedInstances) {
  box(); std::string error;
  ASSERT_TRUE(kreoda::CreateHoleFeature("hole","box","box.+Z",10,15,4,"throughAll",0,&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("instance","hole",{50,0,0,0,0,90},&error)) << error;
  const auto volume=query("measureVolume");
  ASSERT_EQ(volume["status"],"ok") << volume;
  EXPECT_NEAR(volume["result"]["volumeMm3"].get<double>(),2*(6000-40*std::acos(-1.0)),1e-6);
  const auto bound=query("getBoundingBox",{{"featureId","instance"}});
  ASSERT_EQ(bound["status"],"ok") << bound;
  EXPECT_NEAR(bound["result"]["bboxMm"][0].get<double>(),20,1e-6);
  EXPECT_NEAR(bound["result"]["bboxMm"][3].get<double>(),50,1e-6);
  const auto validation=query("validateDocument");
  ASSERT_EQ(validation["status"],"ok") << validation;
  EXPECT_EQ(validation["result"]["valid"],true) << validation;
}

TEST(SessionGeometry, DuplicateTopologyIsReportedAndNeverSilentlyResolved) {
  box();
  TopoDS_Compound compound; BRep_Builder builder; builder.MakeCompound(compound);
  builder.Add(compound,BRepPrimAPI_MakeBox(gp_Pnt(0,0,0),10,10,10).Shape());
  builder.Add(compound,BRepPrimAPI_MakeBox(gp_Pnt(20,0,0),10,10,10).Shape());
  kreoda::ShapeRecord rec;rec.featureId="compound";rec.type="StepImport";rec.shape=compound;
  kreoda::ShapeStore::instance().put(rec);
  const auto found=query("findFaces",{{"featureId","compound"},{"role","box.+Z"}});
  ASSERT_EQ(found["status"],"ok") << found;
  ASSERT_EQ(found["result"]["faces"].size(),2u);
  EXPECT_EQ(found["result"]["faces"][0]["ambiguous"],true);
  EXPECT_LT(found["result"]["faces"][0]["confidence"].get<double>(),1);
  EXPECT_EQ(query("measureArea",{{"referenceId","compound:box.+Z"}})["errorCode"],"AMBIGUOUS_REFERENCE");
  const auto refs=query("validateReferences",{{"ids",{"compound:box.+Z"}}});
  ASSERT_EQ(refs["status"],"ok");EXPECT_EQ(refs["result"]["valid"],false);
}

TEST(SessionGeometry, DifferentAnalyticRadiiRequireAnExplicitReference) {
  kreoda::DocumentStore::instance().create("geometry-doc");std::string error;
  ASSERT_TRUE(kreoda::CreateCylinderFeature("cylinder",10,20,&error)) << error;
  ASSERT_TRUE(kreoda::CreateHoleFeature("tube","cylinder","cyl.+Z",0,0,4,"throughAll",0,&error)) << error;
  EXPECT_EQ(query("measureRadius",{{"featureId","tube"}})["errorCode"],"AMBIGUOUS_REFERENCE");
  const auto found=query("findFaces",{{"featureId","tube"},{"surfaceType","cylinder"},{"radiusMm",2}});
  ASSERT_EQ(found["status"],"ok") << found;
  ASSERT_EQ(found["result"]["faces"].size(),1u);
  const auto radius=query("measureRadius",{{"referenceId",found["result"]["faces"][0]["persistentId"]}});
  ASSERT_EQ(radius["status"],"ok") << radius;
  EXPECT_NEAR(radius["result"]["radiusMm"].get<double>(),2,1e-7);
}

TEST(SessionGeometry, ValidatesActualTopologyAndRejectsUnknownReferences) {
  box();
  const auto body=query("validateBody",{{"bodyId","body-box"}});
  ASSERT_EQ(body["status"],"ok") << body;
  EXPECT_EQ(body["result"]["scope"],"kernel"); EXPECT_EQ(body["result"]["valid"],true);
  const auto refs=query("validateReferences",{{"ids",{"box","body-box","box:box.+Z","box:missing"}}});
  ASSERT_EQ(refs["status"],"ok") << refs;
  EXPECT_EQ(refs["result"]["valid"],false); ASSERT_EQ(refs["result"]["checks"].size(),4u);
  EXPECT_EQ(refs["result"]["checks"][2]["ok"],true);
  EXPECT_EQ(refs["result"]["checks"][3]["errorCode"],"NOT_FOUND");
  EXPECT_EQ(query("measureDistance",{{"a","box:missing"},{"b","box:box.+Z"}})["errorCode"],"NOT_FOUND");
}

TEST(SessionGeometry, GeometryQueriesNeverChangeRevisionOrUndoHistory) {
  box(); const auto before=kreoda::DocumentStore::instance().revision();
  for(const auto& method:{"findFaces","findEdges","measureVolume","validateDocument"}) {
    const auto result=query(method); ASSERT_EQ(result["status"],"ok") << result;
    EXPECT_EQ(result["revision"],before);
  }
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),before);
}

TEST(SessionGeometry, ExplicitInvalidScopesNeverFallBackToWholeModel) {
  box();
  for(const auto params:{kreoda::Json{{"featureId",""}},kreoda::Json{{"referenceId",""}},kreoda::Json{{"featureId","box"},{"referenceId","box:box.+Z"}}}) {
    EXPECT_EQ(query("measureArea",params)["errorCode"],"BAD_PARAMS");
  }
  EXPECT_EQ(query("findFaces",{{"normal",{0,0,0}}})["errorCode"],"BAD_PARAMS");
  const auto found=query("findFaces",{{"featureId","box"},{"normal",{0,0,1}},{"dimensionsMm",{20,30,0}}});
  ASSERT_EQ(found["status"],"ok") << found;
  ASSERT_EQ(found["result"]["faces"].size(),1u);
  EXPECT_EQ(found["result"]["faces"][0]["persistentId"],"box:box.+Z");
}

TEST(SessionGeometry, AValidFaceIsNotReportedAsAValidSolidFeature) {
  box();
  kreoda::ShapeRecord rec; rec.featureId="invalid-solid";rec.type="StepImport";
  rec.shape=TopExp_Explorer(BRepPrimAPI_MakeBox(10,10,10).Shape(),TopAbs_FACE).Current();
  kreoda::ShapeStore::instance().put(rec);
  const auto valid=query("validateFeature",{{"featureId","invalid-solid"}});
  ASSERT_EQ(valid["status"],"ok") << valid;
  EXPECT_EQ(valid["result"]["valid"],false);
}

TEST(SessionGeometry, ManipulatorUsesStoredSketchFrameRatherThanPlaneKind) {
  kreoda::DocumentStore::instance().create("geometry-doc");
  kreoda::SketchFeature sketch;sketch.id="placed-sketch";sketch.planeKind="XY";
  sketch.plane.origin[0]=50;sketch.plane.origin[1]=60;sketch.plane.origin[2]=70;
  sketch.plane.normal[0]=0;sketch.plane.normal[1]=1;sketch.plane.normal[2]=0;
  sketch.plane.yAxis[0]=0;sketch.plane.yAxis[1]=0;sketch.plane.yAxis[2]=-1;
  sketch.model.points={{"center",0,0,true}};sketch.model.circles={{"circle","center",5}};
  ASSERT_TRUE(kreoda::PutSketchDirect(sketch));std::string error;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("extrude",sketch.id,10,&error)) << error;
  const auto result=query("getManipulators",{{"featureId","extrude"}});
  ASSERT_EQ(result["status"],"ok") << result;
  const auto& manip=result["result"]["manipulators"][0];
  EXPECT_EQ(manip["axis"],kreoda::Json::array({0,1,0}));
  EXPECT_EQ(manip["unit"],"mm");
  EXPECT_NEAR(manip["origin"][0].get<double>(),50,1e-7);
  EXPECT_NEAR(manip["origin"][1].get<double>(),65,1e-7);
  EXPECT_NEAR(manip["origin"][2].get<double>(),70,1e-7);
}
