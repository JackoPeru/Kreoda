#include <gtest/gtest.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <vector>
#include "document/document_store.h"
#include "features/primitives/primitives.h"
#include "features/hole/hole.h"
#include "features/instance/instance.h"
#include "features/datum/datum_commands.h"
#include "features/datum/datum_store.h"
#include "protocol/dispatcher.h"
#include "protocol/json_fields.h"
#include "model/shapes.h"
#include "model/body_visibility.h"
#include "features/extrusion/extrude.h"
#include "features/sketch/sketch_commands.h"
#include "features/surface/surface_modeling.h"
#include "model/body.h"
#include "persistence/ocaf_live.h"
#include "topology/face_roles.h"
#include <BRep_Builder.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepBuilderAPI_GTransform.hxx>
#include <gp_GTrsf.hxx>
#include <gp_Ax1.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <gp_Pln.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopExp_Explorer.hxx>
#include <Precision.hxx>

namespace {
kreoda::Json query(const std::string& method, kreoda::Json params = kreoda::Json::object()) {
  const auto bytes = kreoda::handle_command(kreoda::Json{{"protocolVersion",1},{"requestId","query"},{"documentId","geometry-doc"},{"type",30},{"method",method},{"params",params}}.dump());
  return kreoda::Json::parse(bytes.begin(), bytes.end());
}
kreoda::Json rpc(kreoda::Json request) {
  static int sequence = 0;
  request["protocolVersion"] = 1;
  request["requestId"] = "session-geometry-" + std::to_string(++sequence);
  request["documentId"] = "geometry-doc";
  const auto bytes = kreoda::handle_command(request.dump());
  return kreoda::Json::parse(bytes.begin(), bytes.end());
}
void box() {
  kreoda::DocumentStore::instance().create("geometry-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("box",20,30,10,&error)) << error;
}
kreoda::SketchModel rectangleSketch() {
  kreoda::SketchModel model;
  model.points={{"p0",0,0},{"p1",100,0},{"p2",100,50},{"p3",0,50}};
  model.lines={{"l0","p0","p1"},{"l1","p1","p2"},{"l2","p2","p3"},{"l3","p3","p0"}};
  return model;
}
void datumSketchAndSolid() {
  kreoda::DocumentStore::instance().create("geometry-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateDatumFeature("plane",kreoda::DatumKind::Plane,
      R"({"type":"offset","base":{"type":"principal","planeKind":"XY"},"offsetMm":24})",&error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchOnDatumFeature("sketch","plane",rectangleSketch(),&error)) << error;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("solid","sketch",7,&error)) << error;
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

TEST(SessionGeometry, InstanceFaceQueriesExposeSourceBindingWithoutMutation) {
  box();
  std::string error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("mate-instance","box",{0,0,0,0,0,90},&error)) << error;
  const auto revision=kreoda::DocumentStore::instance().snapshotRevision();
  const auto registry=kreoda::DocumentStore::instance().snapshotRegistry();
  const int undos=kreoda::OcafLive::instance().AvailableUndos();
  kreoda::ShapeRecord before;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("mate-instance",&before));

  const auto response=query("findFaces",{{"featureId","mate-instance"}});

  ASSERT_EQ(response["status"],"ok") << response;
  EXPECT_EQ(response["revision"],revision);
  ASSERT_FALSE(response["result"]["faces"].empty()) << response;
  bool foundSourceFace=false;
  for(const auto& face:response["result"]["faces"]) {
    EXPECT_EQ(face["captureRevision"],revision);
    ASSERT_TRUE(face.contains("sourceBinding")) << face;
    const auto& binding=face["sourceBinding"];
    EXPECT_EQ(binding["type"],"face");
    EXPECT_EQ(binding["featureId"],"box");
    EXPECT_TRUE(binding.contains("persistentFaceId"));
    EXPECT_TRUE(binding.contains("geometryKind"));
    if(binding.value("persistentFaceId",std::string())=="box.+Z") foundSourceFace=true;
  }
  EXPECT_TRUE(foundSourceFace);

  kreoda::ShapeRecord after;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("mate-instance",&after));
  EXPECT_TRUE(before.shape.IsSame(after.shape));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(),revision);
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRegistry(),registry);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(),undos);
}

TEST(SessionGeometry, MinimumThicknessMeasuresBoxAndNeverMutatesGeometryOrRevision) {
  box();
  kreoda::ShapeRecord before;ASSERT_TRUE(kreoda::ShapeStore::instance().get("box",&before));
  const auto revision=kreoda::DocumentStore::instance().snapshotRevision();
  const auto registry=kreoda::DocumentStore::instance().snapshotRegistry();
  const auto measured=query("measureMinimumThickness",{{"bodyId","body-box"},{"maxSamples",128}});
  ASSERT_EQ(measured["status"],"ok")<<measured;
  const auto& result=measured["result"];
  EXPECT_EQ(result["basis"],"occt-sampled-normal-rays");
  EXPECT_EQ(result["isGlobalMinimum"],false);
  EXPECT_NEAR(result["minimumThicknessMm"].get<double>(),10,1e-6);
  EXPECT_EQ(result["totalFaces"],6);EXPECT_EQ(result["sampledFaces"],6);
  EXPECT_LE(result["attemptedSamples"].get<int>(),128);
  EXPECT_GT(result["validSamples"].get<int>(),0);
  double squared=0;
  for(int axis=0;axis<3;++axis) {
    const auto d=result["witness"]["pointAMm"][axis].get<double>()-result["witness"]["pointBMm"][axis].get<double>();
    squared+=d*d;
  }
  EXPECT_NEAR(std::sqrt(squared),10,1e-6);
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(),revision);
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRegistry(),registry);
  kreoda::ShapeRecord after;ASSERT_TRUE(kreoda::ShapeStore::instance().get("box",&after));
  EXPECT_TRUE(after.shape.IsSame(before.shape));
  EXPECT_EQ(after.paramsMm,before.paramsMm);
}

TEST(SessionGeometry, MinimumThicknessStopsAtCavityInsteadOfCrossingAirOrOppositeOuterWall) {
  box();kreoda::ShapeRecord rec;ASSERT_TRUE(kreoda::ShapeStore::instance().get("box",&rec));
  const std::vector<std::pair<TopoDS_Shape,double>> fixtures={
    {BRepAlgoAPI_Cut(BRepPrimAPI_MakeCylinder(10,30).Shape(),BRepPrimAPI_MakeCylinder(8,30).Shape()).Shape(),2},
    {BRepAlgoAPI_Cut(BRepPrimAPI_MakeSphere(10).Shape(),BRepPrimAPI_MakeSphere(7).Shape()).Shape(),3}
  };
  for(const auto& fixture:fixtures) {
    rec.shape=fixture.first;kreoda::ShapeStore::instance().put(rec);
    const auto measured=query("measureMinimumThickness",{{"featureId","box"},{"maxSamples",128}});
    ASSERT_EQ(measured["status"],"ok")<<measured;
    EXPECT_NEAR(measured["result"]["minimumThicknessMm"].get<double>(),fixture.second,1e-5)<<measured;
    EXPECT_GT(measured["result"]["validSamples"].get<int>(),0);
  }
}

TEST(SessionGeometry, MinimumThicknessWitnessUsesTransformedWorldCoordinates) {
  box();kreoda::ShapeRecord rec;ASSERT_TRUE(kreoda::ShapeStore::instance().get("box",&rec));
  gp_Trsf rotate;rotate.SetRotation(gp_Ax1(gp_Pnt(0,0,0),gp_Dir(1,1,1)),.7);
  gp_Trsf move;move.SetTranslation(gp_Vec(100,200,300));
  rec.shape=BRepBuilderAPI_Transform(rec.shape,move*rotate,false).Shape();
  kreoda::ShapeStore::instance().put(rec);
  const auto measured=query("measureMinimumThickness",{{"featureId","box"},{"maxSamples",64}});
  ASSERT_EQ(measured["status"],"ok")<<measured;
  EXPECT_NEAR(measured["result"]["minimumThicknessMm"].get<double>(),10,1e-6);
  EXPECT_GT(measured["result"]["witness"]["pointAMm"][0].get<double>(),80);
  EXPECT_GT(measured["result"]["witness"]["pointAMm"][2].get<double>(),280);
}

TEST(SessionGeometry, MinimumThicknessDoesNotTreatGapBetweenDisconnectedSolidsAsMaterial) {
  box();kreoda::ShapeRecord rec;ASSERT_TRUE(kreoda::ShapeStore::instance().get("box",&rec));
  TopoDS_Compound compound;BRep_Builder builder;builder.MakeCompound(compound);
  builder.Add(compound,BRepPrimAPI_MakeBox(20,30,2).Shape());
  builder.Add(compound,BRepPrimAPI_MakeBox(gp_Pnt(0,0,2.1),20,30,4).Shape());
  rec.shape=compound;kreoda::ShapeStore::instance().put(rec);
  const auto measured=query("measureMinimumThickness",{{"featureId","box"},{"maxSamples",128}});
  ASSERT_EQ(measured["status"],"ok")<<measured;
  EXPECT_NEAR(measured["result"]["minimumThicknessMm"].get<double>(),2,1e-6);
  EXPECT_EQ(measured["result"]["solidCount"],2);
}

TEST(SessionGeometry, MinimumThicknessSupportsGenericImportedEllipsoidWithAnalyticChordWitness) {
  box();kreoda::ShapeRecord rec;ASSERT_TRUE(kreoda::ShapeStore::instance().get("box",&rec));
  gp_GTrsf scale;scale.SetValue(1,1,1);scale.SetValue(2,2,2);scale.SetValue(3,3,.4);
  rec.type="StepImport";rec.shape=BRepBuilderAPI_GTransform(BRepPrimAPI_MakeSphere(10).Shape(),scale,true).Shape();
  kreoda::ShapeStore::instance().put(rec);
  const auto measured=query("measureMinimumThickness",{{"featureId","box"},{"maxSamples",128}});
  ASSERT_EQ(measured["status"],"ok")<<measured;
  const auto& result=measured["result"];const auto& a=result["witness"]["pointAMm"];const auto& b=result["witness"]["pointBMm"];
  const double q[]={.01,.0025,.0625};double equationA=0,equationB=0,squaredNormal=0;
  double normal[3];
  for(int i=0;i<3;++i) {
    const double av=a[i].get<double>(),bv=b[i].get<double>();
    equationA+=q[i]*av*av;equationB+=q[i]*bv*bv;normal[i]=q[i]*av;squaredNormal+=normal[i]*normal[i];
  }
  EXPECT_NEAR(equationA,1,1e-7);EXPECT_NEAR(equationB,1,1e-7);
  double quadratic=0;
  for(int i=0;i<3;++i) {normal[i]/=std::sqrt(squaredNormal);quadratic+=q[i]*normal[i]*normal[i];}
  const double analyticChord=2*std::sqrt(squaredNormal)/quadratic;
  EXPECT_NEAR(result["minimumThicknessMm"].get<double>(),analyticChord,1e-6);
  for(int i=0;i<3;++i)EXPECT_NEAR(b[i].get<double>()-a[i].get<double>(),-normal[i]*analyticChord,1e-6);
}

TEST(SessionGeometry, MinimumThicknessRejectsOpenGeometryAndInvalidSamplingBudgets) {
  box();
  for(const auto& budget:std::vector<kreoda::Json>{0,31,4097,32.5,"64",nullptr})
    EXPECT_EQ(query("measureMinimumThickness",{{"featureId","box"},{"maxSamples",budget}})["errorCode"],"BAD_PARAMS")<<budget;
  EXPECT_EQ(query("measureMinimumThickness",{{"featureId","box"},{"bodyId","body-box"}})["errorCode"],"BAD_PARAMS");
  kreoda::ShapeRecord rec;ASSERT_TRUE(kreoda::ShapeStore::instance().get("box",&rec));
  rec.shape=BRepBuilderAPI_MakeFace(gp_Pln(gp_Pnt(0,0,0),gp_Dir(0,0,1)),-10,10,-10,10).Shape();
  kreoda::ShapeStore::instance().put(rec);
  const auto measured=query("measureMinimumThickness",{{"featureId","box"}});
  EXPECT_EQ(measured["status"],"error");EXPECT_EQ(measured["errorCode"],"QUERY_FAILED");
}

TEST(SessionGeometry, DraftAnglesExactPlanarFacesAndPersistence) {
  box();
  const auto result=query("measureDraftAngles",{{"featureId","box"},
      {"pullDirection",kreoda::Json::array({0,0,5})}});
  ASSERT_EQ(result["status"],"ok")<<result;
  const auto& faces=result["result"]["faces"];
  ASSERT_EQ(faces.size(),6u);
  int positive=0,negative=0,neutral=0;
  for(const auto& face:faces) {
    const auto a=face["draftAngleDeg"].get<double>();
    if(face["classification"]=="positive") {++positive;EXPECT_NEAR(a,90,1e-6);}
    else if(face["classification"]=="negative") {++negative;EXPECT_NEAR(a,-90,1e-6);}
    else {++neutral;EXPECT_NEAR(a,0,1e-6);}
  }
  EXPECT_EQ(positive,1);EXPECT_EQ(negative,1);EXPECT_EQ(neutral,4);
  const auto malformed=query("measureDraftAngles",{{"featureId","box"},
      {"pullDirection",kreoda::Json::array({0,0,0})}});
  EXPECT_EQ(malformed["errorCode"],"BAD_PARAMS");
  const auto missing=query("measureDraftAngles",{{"featureId","box"}});
  EXPECT_EQ(missing["errorCode"],"BAD_PARAMS");
  auto rpc=[](int type,const std::string& request,const std::string& path="") {
    kreoda::Json p={{"protocolVersion",1},{"requestId",request},
      {"documentId","geometry-doc"},{"type",type}};
    if(!path.empty())p["path"]=path;
    const auto bytes=kreoda::handle_command(p.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  ASSERT_EQ(rpc(8,"draft-undo")["status"],"ok");
  EXPECT_EQ(query("measureDraftAngles",{{"featureId","box"},
      {"pullDirection",kreoda::Json::array({0,0,1})}})["status"],"error");
  ASSERT_EQ(rpc(9,"draft-redo")["status"],"ok");
  EXPECT_EQ(query("measureDraftAngles",{{"featureId","box"},
      {"pullDirection",kreoda::Json::array({0,0,1})}})["result"]["faces"].size(),6u);
  const auto path=(std::filesystem::temp_directory_path()/"kreoda-draft-angle.icad").string();
  ASSERT_EQ(rpc(10,"draft-save",path)["status"],"ok");
  ASSERT_EQ(rpc(2,"draft-new")["status"],"ok");
  ASSERT_EQ(rpc(11,"draft-open",path)["status"],"ok");
  EXPECT_EQ(query("measureDraftAngles",{{"featureId","box"},
      {"pullDirection",kreoda::Json::array({0,0,1})}})["result"]["faces"].size(),6u);
  std::filesystem::remove(path);
}

TEST(SessionGeometry, InterferenceUsesCommonVolumeAndDoesNotMutateDocument) {
  kreoda::DocumentStore::instance().create("geometry-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("source",10,10,10,&error))<<error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("overlap","source",{5,0,0,0,0,0},&error))<<error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("touch","source",{10,0,0,0,0,0},&error))<<error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("far","source",{30,0,0,0,0,0},&error))<<error;
  const auto before=kreoda::DocumentStore::instance().revision();
  const auto overlap=query("measureInterferences",{{"featureIds",kreoda::Json::array({"source","overlap"})}});
  ASSERT_EQ(overlap["status"],"ok")<<overlap;
  const auto& result=overlap["result"];
  EXPECT_EQ(result["componentCount"],2);
  ASSERT_EQ(result["interferences"].size(),1u);
  EXPECT_NEAR(result["interferences"][0]["volumeMm3"].get<double>(),500,1e-7);
  EXPECT_NEAR(result["interferences"][0]["centroidMm"][0].get<double>(),7.5,1e-7);
  EXPECT_EQ(result["interferences"][0]["featureA"],"source");
  EXPECT_EQ(result["interferences"][0]["featureB"],"overlap");
  for(const auto& other:{"touch","far"}) {
    const auto clear=query("measureInterferences",{{"featureIds",kreoda::Json::array({"source",other})}});
    ASSERT_EQ(clear["status"],"ok")<<clear;
    EXPECT_TRUE(clear["result"]["interferences"].empty());
  }
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),before);
  EXPECT_NEAR(query("measureVolume",{{"featureId","source"}})["result"]["volumeMm3"].get<double>(),1000,1e-7);
  const auto bytes=kreoda::handle_command(kreoda::Json{{"protocolVersion",1},{"requestId","interference-undo"},
      {"documentId","geometry-doc"},{"type",8}}.dump());
  EXPECT_EQ(kreoda::Json::parse(bytes.begin(),bytes.end())["status"],"ok");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("far"));
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("overlap"));
}

TEST(SessionGeometry, InterferenceRejectsBoundsOnlyOverlapAndRespectsVisibility) {
  kreoda::DocumentStore::instance().create("geometry-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateCylinderFeature("round",10,10,&error))<<error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("diagonal","round",{18,18,0,0,0,0},&error))<<error;
  auto measured=query("measureInterferences");
  ASSERT_EQ(measured["status"],"ok")<<measured;
  EXPECT_EQ(measured["result"]["candidatePairCount"],1);
  EXPECT_TRUE(measured["result"]["interferences"].empty());
  ASSERT_TRUE(kreoda::CreateInstanceFeature("same","round",{0,0,0,0,0,0},&error))<<error;
  ASSERT_TRUE(kreoda::SetBodyVisibility("body-round",false,&error))<<error;
  measured=query("measureInterferences");
  ASSERT_EQ(measured["status"],"ok")<<measured;
  EXPECT_EQ(measured["result"]["componentCount"],2);
  EXPECT_TRUE(measured["result"]["interferences"].empty());
  measured=query("measureInterferences",{{"includeHidden",true}});
  ASSERT_EQ(measured["status"],"ok")<<measured;
  ASSERT_EQ(measured["result"]["interferences"].size(),1u);
  EXPECT_NEAR(measured["result"]["interferences"][0]["volumeMm3"].get<double>(),1000*std::acos(-1.0),1e-6);
}

TEST(SessionGeometry, InterferenceUsesCurrentTipsAndValidatesInputsBeforeWork) {
  box();std::string error;
  ASSERT_TRUE(kreoda::CreateHoleFeature("hole","box","box.+Z",10,15,2,"throughAll",0,&error))<<error;
  auto measured=query("measureInterferences");
  ASSERT_EQ(measured["status"],"ok")<<measured;
  EXPECT_EQ(measured["result"]["componentCount"],1);
  EXPECT_TRUE(measured["result"]["interferences"].empty());
  for(const auto& params:std::vector<kreoda::Json>{
      {{"volumeToleranceMm3",-1}},{{"volumeToleranceMm3","bad"}},{{"includeHidden","yes"}},
      {{"featureId","hole"}},{{"featureIds",kreoda::Json::array({"hole"})}},
      {{"featureIds",kreoda::Json::array({"hole","body-box"})}},
      {{"featureIds",kreoda::Json::array({"box:box.+Z","hole"})}}})
    EXPECT_EQ(query("measureInterferences",params)["errorCode"],"BAD_PARAMS")<<params;
  EXPECT_EQ(query("measureInterferences",{{"featureIds",kreoda::Json::array({"hole","missing"})}})["errorCode"],"NOT_FOUND");
  measured=query("measureInterferences",{{"featureIds",kreoda::Json::array({"box","hole"})},{"volumeToleranceMm3",6000}});
  ASSERT_EQ(measured["status"],"ok")<<measured;
  EXPECT_TRUE(measured["result"]["interferences"].empty());
}

TEST(SessionGeometry, InterferenceBudgetFailsBeforeBooleanWork) {
  kreoda::DocumentStore::instance().create("geometry-doc");std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("source",10,10,10,&error))<<error;
  for(int i=0;i<24;++i)
    ASSERT_TRUE(kreoda::CreateInstanceFeature("part-"+std::to_string(i),"source",{0,0,0,0,0,0},&error))<<error;
  const auto before=kreoda::DocumentStore::instance().revision();
  EXPECT_EQ(query("measureInterferences")["errorCode"],"LIMIT_EXCEEDED");
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),before);
}

TEST(SessionGeometry, InterferenceReportsNonSolidComponentsInsteadOfPretendingTheyHaveVolume) {
  box();
  kreoda::ShapeRecord sheet;
  sheet.featureId="sheet";sheet.type="SurfaceLoft";
  sheet.shape=BRepBuilderAPI_MakeFace(gp_Pln(gp_Pnt(0,0,0),gp_Dir(0,0,1)),-10,10,-10,10).Face();
  kreoda::ShapeStore::instance().put(sheet);
  const auto measured=query("measureInterferences",{{"featureIds",kreoda::Json::array({"box","sheet"})}});
  ASSERT_EQ(measured["status"],"ok")<<measured;
  EXPECT_EQ(measured["result"]["componentCount"],1);
  EXPECT_EQ(measured["result"]["skippedNonSolidFeatureIds"],kreoda::Json::array({"sheet"}));
  EXPECT_TRUE(measured["result"]["interferences"].empty());
}

TEST(SessionGeometry, GlobalGeometryIgnoresHiddenBodyTipsAndKeepsScopedInspection) {
  kreoda::DocumentStore::instance().create("geometry-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("base",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("cutter",20,20,20,&error)) << error;
  const auto before=query("measureVolume");
  ASSERT_EQ(before["status"],"ok") << before;
  EXPECT_NEAR(before["result"]["volumeMm3"].get<double>(),9000,1e-6);
  const auto hide=kreoda::Json{{"protocolVersion",1},{"requestId","hide-cutter"},
    {"documentId","geometry-doc"},{"type",44},{"bodyId","body-cutter"},{"visible",false}};
  const auto bytes=kreoda::handle_command(hide.dump());
  ASSERT_EQ(kreoda::Json::parse(bytes.begin(),bytes.end())["status"],"ok");
  const auto global=query("measureVolume");
  ASSERT_EQ(global["status"],"ok") << global;
  EXPECT_NEAR(global["result"]["volumeMm3"].get<double>(),1000,1e-6);
  EXPECT_NEAR(query("measureVolume",{{"includeHidden",true}})["result"]["volumeMm3"].get<double>(),9000,1e-6);
  EXPECT_NEAR(query("measureVolume",{{"featureId","cutter"}})["result"]["volumeMm3"].get<double>(),8000,1e-6);
  const auto bounds=query("getBoundingBox");
  ASSERT_EQ(bounds["status"],"ok") << bounds;
  EXPECT_EQ(bounds["result"]["solidCount"],1);
  EXPECT_EQ(query("getBoundingBox",{{"includeHidden",true}})["result"]["solidCount"],2);
  EXPECT_EQ(query("getBoundingBox",{{"includeHidden","yes"}})["errorCode"],"BAD_PARAMS");
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("cutter"));
}

TEST(SessionGeometry, VisibilityJoinsTransactionAsSingleRevisionAndUndo) {
  kreoda::DocumentStore::instance().create("geometry-doc");
  auto rpc=[](kreoda::Json command) {
    command["protocolVersion"]=1;
    command["documentId"]="geometry-doc";
    const auto bytes=kreoda::handle_command(command.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  const auto baseline=kreoda::DocumentStore::instance().revision();
  ASSERT_EQ(rpc({{"type",27},{"requestId","begin"},{"transactionId","group"}})["status"],"ok");
  ASSERT_EQ(rpc({{"type",3},{"requestId","create"},{"transactionId","group"},
      {"featureId","tool"},{"widthMm",10},{"heightMm",10},{"depthMm",10}})["status"],"ok");
  ASSERT_EQ(rpc({{"type",44},{"requestId","hide"},{"transactionId","group"},
      {"bodyId","body-tool"},{"visible",false}})["status"],"ok");
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),baseline);
  ASSERT_EQ(rpc({{"type",28},{"requestId","commit"},{"transactionId","group"}})["status"],"ok");
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),baseline+1);
  kreoda::BodyRecord body;
  ASSERT_TRUE(kreoda::BodyStore::instance().get("body-tool",&body));
  EXPECT_FALSE(body.visible);
  ASSERT_EQ(rpc({{"type",8},{"requestId","undo"}})["status"],"ok");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("tool"));
  ASSERT_EQ(rpc({{"type",9},{"requestId","redo"}})["status"],"ok");
  ASSERT_TRUE(kreoda::BodyStore::instance().get("body-tool",&body));
  EXPECT_FALSE(body.visible);
}

TEST(SessionGeometry, MassPropertiesReadOnlyDispatcherAndDensityValidation) {
  box();
  const auto before=kreoda::DocumentStore::instance().revision();
  const auto measured=query("measureMassProperties",{{"featureId","box"},{"densityKgPerM3",7850}});
  ASSERT_EQ(measured["status"],"ok") << measured;
  const auto& props=measured["result"];
  EXPECT_NEAR(props["volumeMm3"].get<double>(),6000,1e-7);
  EXPECT_NEAR(props["areaMm2"].get<double>(),2200,1e-7);
  EXPECT_NEAR(props["massKg"].get<double>(),0.0471,1e-9);
  EXPECT_NEAR(props["centroidMm"][0].get<double>(),10,1e-7);
  EXPECT_NEAR(props["centroidMm"][1].get<double>(),15,1e-7);
  EXPECT_NEAR(props["centroidMm"][2].get<double>(),5,1e-7);
  EXPECT_EQ(query("measureMassProperties",{{"featureId","box"}})["result"]["massKg"],0);
  EXPECT_EQ(query("measureMassProperties",{{"featureId","box"},{"densityKgPerM3",-1}})["errorCode"],"BAD_PARAMS");
  EXPECT_EQ(query("measureMassProperties",{{"featureId","box"},{"densityKgPerM3","steel"}})["errorCode"],"BAD_PARAMS");
  EXPECT_EQ(query("measureMassProperties",{{"featureId","missing"}})["errorCode"],"NOT_FOUND");
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),before);
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
  const auto complete=query("getBoundingBox");
  ASSERT_EQ(complete["status"],"ok") << complete;
  EXPECT_EQ(complete["result"]["solidCount"],2);
  EXPECT_EQ(query("getBoundingBox",{{"featureId","box"}})["result"]["solidCount"],1);
  const auto bound=query("getBoundingBox",{{"featureId","instance"}});
  ASSERT_EQ(bound["status"],"ok") << bound;
  EXPECT_EQ(bound["result"]["solidCount"],1);
  EXPECT_NEAR(bound["result"]["bboxMm"][0].get<double>(),20,1e-6);
  EXPECT_NEAR(bound["result"]["bboxMm"][3].get<double>(),50,1e-6);
  const auto validation=query("validateDocument");
  ASSERT_EQ(validation["status"],"ok") << validation;
  EXPECT_EQ(validation["result"]["valid"],true) << validation;
}

TEST(SessionGeometry, OneBodyTipCountsDisconnectedBrepSolids) {
  box();
  TopoDS_Compound compound; BRep_Builder builder; builder.MakeCompound(compound);
  builder.Add(compound,BRepPrimAPI_MakeBox(gp_Pnt(0,0,0),10,10,10).Shape());
  builder.Add(compound,BRepPrimAPI_MakeBox(gp_Pnt(20,0,0),10,10,10).Shape());
  kreoda::ShapeRecord tip;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("box",&tip));
  tip.shape=compound;
  kreoda::ShapeStore::instance().put(tip);

  const auto bound=query("getBoundingBox",{{"bodyId","body-box"}});
  ASSERT_EQ(bound["status"],"ok") << bound;
  EXPECT_EQ(bound["result"]["solidCount"],2);
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

TEST(SessionGeometry, SequentialBlindHolesKeepUniqueOuterTopAndIndexedFloors) {
  kreoda::DocumentStore::instance().create("geometry-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("root-box", 100, 50, 10, &error)) << error;
  const auto validateStage = [&] {
    const auto validation = query("validateDocument");
    EXPECT_EQ(validation["status"], "ok") << validation;
    EXPECT_EQ(validation["result"]["valid"], true) << validation;
  };
  validateStage();

  ASSERT_TRUE(kreoda::CreateHoleFeature("blind-hole-1", "root-box", "box.+Z",
                                        20, 15, 8, "blind", 5, &error)) << error;
  validateStage();
  const auto firstRefs = query("validateReferences", {{"ids", {
      "blind-hole-1:box.+Z", "blind-hole-1:edge.cir.box.+Z~wall.0"}}});
  ASSERT_EQ(firstRefs["status"], "ok") << firstRefs;
  EXPECT_EQ(firstRefs["result"]["valid"], true) << firstRefs;
  ASSERT_TRUE(kreoda::CreateHoleFeature("blind-hole-2", "blind-hole-1", "box.+Z",
                                        70, 15, 8, "blind", 5, &error)) << error;
  validateStage();
  ASSERT_TRUE(kreoda::CreateHoleFeature("blind-hole-3", "blind-hole-2", "box.+Z",
                                        45, 35, 8, "blind", 5, &error)) << error;
  validateStage();

  kreoda::ShapeRecord tip;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("blind-hole-3", &tip));
  EXPECT_NEAR(tip.volumeMm3, 50000 - 240 * std::acos(-1.0), .01);
  const auto roles = kreoda::ClassifyFaceRoles(tip.shape, tip.type, tip.featureId);
  EXPECT_EQ(std::count(roles.begin(), roles.end(), "blind-hole-3:box.+Z"), 1);
  TopoDS_Face outerTop;
  ASSERT_TRUE(kreoda::FindFaceByRole(tip.shape, tip.featureId, tip.type,
                                     "box.+Z", &outerTop));

  std::vector<TopoDS_Face> faces;
  for (TopExp_Explorer ex(tip.shape, TopAbs_FACE); ex.More(); ex.Next())
    faces.push_back(TopoDS::Face(ex.Current()));
  ASSERT_EQ(faces.size(), roles.size());
  double outerSupport = -std::numeric_limits<double>::infinity();
  std::vector<double> supports(faces.size(),
                               std::numeric_limits<double>::quiet_NaN());
  for (size_t i = 0; i < faces.size(); ++i) {
    BRepAdaptor_Surface adapt(faces[i]);
    if (adapt.GetType() != GeomAbs_Plane) continue;
    const gp_Pln plane = adapt.Plane();
    gp_Dir normal = plane.Axis().Direction();
    if (faces[i].Orientation() == TopAbs_REVERSED) normal.Reverse();
    if (normal.Z() < 1.0 - 1e-6) continue;
    supports[i] = plane.Location().Z();
    outerSupport = std::max(outerSupport, supports[i]);
  }
  size_t outerFaces = 0;
  size_t interiorFloors = 0;
  for (size_t i = 0; i < supports.size(); ++i) {
    if (!std::isfinite(supports[i])) continue;
    if (std::abs(supports[i] - outerSupport) <= Precision::Confusion()) {
      ++outerFaces;
      EXPECT_EQ(roles[i], "blind-hole-3:box.+Z");
    } else {
      ++interiorFloors;
      EXPECT_NE(roles[i].find(":face."), std::string::npos) << roles[i];
      EXPECT_TRUE(kreoda::HasIndexedTopologyRole(roles[i])) << roles[i];
    }
  }
  EXPECT_EQ(outerFaces, 1u);
  EXPECT_EQ(interiorFloors, 3u);
  const auto refs = query("validateReferences", {{"ids", {"blind-hole-3:box.+Z"}}});
  ASSERT_EQ(refs["status"], "ok") << refs;
  EXPECT_EQ(refs["result"]["valid"], true) << refs;

  ASSERT_TRUE(kreoda::RebuildFeature("blind-hole-3", "diameterMm", 10, &error)) << error;
  validateStage();
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("blind-hole-3", &tip));
  EXPECT_NEAR(tip.volumeMm3, 50000 - 285 * std::acos(-1.0), .01);
  ASSERT_TRUE(kreoda::OcafLive::instance().Undo(&error)) << error;
  ASSERT_TRUE(kreoda::OcafLive::instance().ResyncStore(&error)) << error;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("blind-hole-3", &tip));
  EXPECT_NEAR(tip.volumeMm3, 50000 - 240 * std::acos(-1.0), .01);
  validateStage();
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
  EXPECT_EQ(found["result"]["faces"][0]["captureRevision"],
            kreoda::DocumentStore::instance().snapshotRevision());
  EXPECT_EQ(found["result"]["faces"][0]["sourceFace"],
            (kreoda::Json{{"type","face"},{"featureId","box"},
                          {"persistentFaceId","box:box.+Z"}}));
  EXPECT_FALSE(found["result"]["faces"][0]["sourceFace"].contains("selectionEntry"));
  const auto face=query("getBoundingBox",{{"referenceId","box:box.+Z"}});
  ASSERT_EQ(face["status"],"ok") << face;
  EXPECT_EQ(face["result"]["solidCount"],0);
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

TEST(SessionGeometry, InstanceDeclaresPositionAndPlanarBasisInCadCoordinates) {
  kreoda::DocumentStore::instance().create("geometry-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("basis-box", 100, 50, 20, &error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("basis-inst", "basis-box", {10, 20, 30, 0, 0, 90}, &error)) << error;
  const auto result = query("getManipulators", {{"featureId", "basis-inst"}});
  ASSERT_EQ(result["status"], "ok") << result;
  bool planar = false, position = false;
  for (const auto& manip : result["result"]["manipulators"]) {
    if (manip["type"] == "planar") {
      planar = true;
      EXPECT_EQ(manip["parameters"], kreoda::Json::array({"txMm", "tyMm"}));
      EXPECT_EQ(manip["xAxis"], kreoda::Json::array({1, 0, 0}));
      EXPECT_EQ(manip["yAxis"], kreoda::Json::array({0, 1, 0}));
      EXPECT_EQ(manip["normal"], kreoda::Json::array({0, 0, 1}));
      EXPECT_EQ(manip["origin"], kreoda::Json::array({10, 20, 30}));
    }
    if (manip["type"] == "position") {
      position = true;
      ASSERT_TRUE(manip.contains("basis"));
      EXPECT_EQ(manip["basis"], kreoda::Json::array({{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}));
    }
  }
  EXPECT_TRUE(planar);EXPECT_TRUE(position);
}

TEST(SessionGeometry, ManipulatorValuesUseCanonicalParameterNamesWithoutClientSlots) {
  box();
  const auto result=query("getManipulators",{{"featureId","box"}});
  ASSERT_EQ(result["status"],"ok") << result;
  for(const auto& manip:result["result"]["manipulators"]) {
    ASSERT_TRUE(manip.contains("currentValues")) << manip;
    const auto name=manip["parameter"].get<std::string>();
    const auto expected=name=="widthMm"?20:name=="heightMm"?30:10;
    EXPECT_EQ(manip["currentValues"][name],expected);
  }
  std::string error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("values-inst","box",{-10,20,30,15,25,35},&error)) << error;
  const auto instance=query("getManipulators",{{"featureId","values-inst"}});
  ASSERT_EQ(instance["status"],"ok") << instance;
  for(const auto& manip:instance["result"]["manipulators"]) {
    ASSERT_TRUE(manip.contains("currentValues")) << manip;
    for(const auto& name:manip["parameters"]) EXPECT_TRUE(manip["currentValues"].contains(name.get<std::string>()));
    if(manip["id"]=="position") EXPECT_EQ(manip["currentValues"]["txMm"],-10);
    if(manip["id"]=="rotation") EXPECT_EQ(manip["currentValues"]["ryDeg"],25);
  }
}

TEST(SessionGeometry, ValidReferenceCarriesActualOwnerAndRoleForContextBinding) {
  box();
  const auto result=query("validateReferences",{{"ids",{"box:box.+Z"}}});
  ASSERT_EQ(result["status"],"ok") << result;
  const auto& check=result["result"]["checks"][0];
  EXPECT_EQ(check["kind"],"face");EXPECT_EQ(check["owner"],"box");EXPECT_EQ(check["role"],"box.+Z");
  ASSERT_TRUE(check.contains("ownerBody"));EXPECT_FALSE(check["ownerBody"].get<std::string>().empty());
}

TEST(SessionGeometry, WholeShapeReferencesUseCanonicalBodyKindAndKeepFreshnessChecks) {
  box();
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("stale-sketch", "XY", rectangleSketch(), &error)) << error;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("stale-feature", "stale-sketch", 5, &error)) << error;

  auto current = query("validateReferences", {{"ids", {"box", "body-box",
                                                          "stale-feature", "body-stale-feature"}}});
  ASSERT_EQ(current["status"], "ok") << current;
  ASSERT_EQ(current["result"]["valid"], true) << current;
  ASSERT_EQ(current["result"]["checks"].size(), 4u);
  const std::vector<std::pair<std::string, std::string>> expected = {
      {"box", "box"}, {"body-box", "box"},
      {"stale-feature", "stale-feature"}, {"body-stale-feature", "stale-feature"}};
  for (size_t i = 0; i < expected.size(); ++i) {
    const auto& check = current["result"]["checks"][i];
    EXPECT_EQ(check["kind"], "body") << check;
    EXPECT_EQ(check["owner"], expected[i].second) << check;
    EXPECT_FALSE(check["ownerBody"].get<std::string>().empty()) << check;
  }

  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();
  ASSERT_TRUE(kreoda::SketchStore::instance().remove("stale-sketch"));
  const auto stale = query("validateReferences", {{"ids", {"stale-feature", "body-stale-feature"}}});
  ASSERT_EQ(stale["status"], "ok") << stale;
  ASSERT_EQ(stale["result"]["valid"], false) << stale;
  ASSERT_EQ(stale["result"]["checks"].size(), 2u);
  for (const auto& check : stale["result"]["checks"]) {
    EXPECT_EQ(check["ok"], false) << check;
    EXPECT_EQ(check["errorCode"], "GEOMETRY_UNAVAILABLE") << check;
  }
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
}

TEST(SessionGeometry, DatumUuidReferencesPreserveKindAndNeverInventBodyOwnership) {
  kreoda::DocumentStore::instance().create("geometry-doc");
  std::string error;
  const std::string planeId = "11111111-1111-4111-8111-111111111111";
  const std::string axisId = "22222222-2222-4222-8222-222222222222";
  const std::string pointId = "33333333-3333-4333-8333-333333333333";
  ASSERT_TRUE(kreoda::CreateDatumFeature(planeId, kreoda::DatumKind::Plane,
      R"({"type":"principal","planeKind":"XY"})", &error)) << error;
  ASSERT_TRUE(kreoda::CreateDatumFeature(axisId, kreoda::DatumKind::Axis,
      R"({"type":"twoPoint","first":{"type":"coordinates","positionMm":[0,0,0]},"second":{"type":"coordinates","positionMm":[0,0,10]}})", &error)) << error;
  ASSERT_TRUE(kreoda::CreateDatumFeature(pointId, kreoda::DatumKind::Point,
      R"({"type":"coordinates","positionMm":[1,2,3]})", &error)) << error;

  const auto revision = kreoda::DocumentStore::instance().snapshotRevision();
  const auto undos = kreoda::OcafLive::instance().AvailableUndos();
  const auto refs = query("validateReferences", {{"ids", {planeId, axisId, pointId}}});
  ASSERT_EQ(refs["status"], "ok") << refs;
  ASSERT_EQ(refs["result"]["valid"], true) << refs;
  ASSERT_EQ(refs["result"]["checks"].size(), 3u);
  const std::vector<std::pair<std::string, std::string>> expected = {
      {planeId, "datumPlane"}, {axisId, "datumAxis"}, {pointId, "datumPoint"}};
  for (size_t i = 0; i < expected.size(); ++i) {
    const auto& check = refs["result"]["checks"][i];
    EXPECT_EQ(check["kind"], expected[i].second) << check;
    EXPECT_EQ(check["owner"], expected[i].first) << check;
    EXPECT_FALSE(check.contains("ownerBody")) << check;
    EXPECT_FALSE(check.contains("body")) << check;
    EXPECT_FALSE(check.contains("face")) << check;
  }
  EXPECT_EQ(refs["revision"], revision);
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(), revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), undos);
}

TEST(SessionGeometry, DatumAndSupportedSketchValidationIsCompleteAndReadOnly) {
  datumSketchAndSolid();
  const auto revision=kreoda::DocumentStore::instance().snapshotRevision();
  const auto undos=kreoda::OcafLive::instance().AvailableUndos();

  const auto document=query("validateDocument");
  ASSERT_EQ(document["status"],"ok") << document;
  EXPECT_EQ(document["result"]["valid"],true) << document;
  const auto datum=query("validateFeature",{{"featureId","plane"}});
  ASSERT_EQ(datum["status"],"ok") << datum;
  EXPECT_EQ(datum["result"]["valid"],true) << datum;
  const auto sketch=query("validateFeature",{{"featureId","sketch"}});
  ASSERT_EQ(sketch["status"],"ok") << sketch;
  EXPECT_EQ(sketch["result"]["valid"],true) << sketch;
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(),revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(),undos);
}

TEST(SessionGeometry, DatumSketchSupportRejectsWrongKindMissingAndCorruptDatums) {
  datumSketchAndSolid();
  std::string error;
  ASSERT_TRUE(kreoda::CreateDatumFeature("axis",kreoda::DatumKind::Axis,
      R"({"type":"twoPoint","first":{"type":"coordinates","positionMm":[0,0,0]},"second":{"type":"coordinates","positionMm":[0,0,10]}})",&error)) << error;
  const auto revision=kreoda::DocumentStore::instance().snapshotRevision();
  const auto undos=kreoda::OcafLive::instance().AvailableUndos();
  kreoda::SketchFeature sketch;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("sketch",&sketch));

  sketch.supportRef="axis";
  kreoda::SketchStore::instance().put(sketch);
  auto result=query("validateFeature",{{"featureId","sketch"}});
  ASSERT_EQ(result["status"],"ok") << result;
  EXPECT_EQ(result["result"]["valid"],false) << result;

  sketch.supportRef="missing-datum";
  kreoda::SketchStore::instance().put(sketch);
  result=query("validateDocument");
  ASSERT_EQ(result["status"],"ok") << result;
  EXPECT_EQ(result["result"]["valid"],false) << result;

  sketch.supportRef="plane";
  kreoda::SketchStore::instance().put(sketch);
  kreoda::DatumRecord plane;
  ASSERT_TRUE(kreoda::DatumStore::instance().get("plane",&plane));
  plane.status="broken";
  plane.error="test corruption";
  kreoda::DatumStore::instance().put(plane);
  result=query("validateFeature",{{"featureId","plane"}});
  ASSERT_EQ(result["status"],"ok") << result;
  EXPECT_EQ(result["result"]["valid"],false) << result;

  plane.status="ok";
  plane.error.clear();
  plane.plane.origin[2]+=1;
  kreoda::DatumStore::instance().put(plane);
  result=query("validateDocument");
  ASSERT_EQ(result["status"],"ok") << result;
  EXPECT_EQ(result["result"]["valid"],false) << result;
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(),revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(),undos);
}

TEST(SessionGeometry, DatumReferenceValidationUsesOnlyItsDependencyClosure) {
  kreoda::DocumentStore::instance().create("geometry-doc");
  std::string error;
  const std::string planeJson=R"({"type":"offset","base":{"type":"principal","planeKind":"XY"},"offsetMm":24})";
  const std::string pointJson=R"({"type":"coordinates","positionMm":[1,2,3]})";
  ASSERT_TRUE(kreoda::CreateDatumFeature("healthy-plane",kreoda::DatumKind::Plane,planeJson,&error)) << error;
  ASSERT_TRUE(kreoda::CreateDatumFeature("other-plane",kreoda::DatumKind::Plane,
      R"({"type":"offset","base":{"type":"principal","planeKind":"YZ"},"offsetMm":12})",&error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchOnDatumFeature("other-supported-sketch","other-plane",rectangleSketch(),&error)) << error;
  ASSERT_TRUE(kreoda::CreateDatumFeature("unrelated-point",kreoda::DatumKind::Point,pointJson,&error)) << error;
  kreoda::DatumRecord unrelated;
  ASSERT_TRUE(kreoda::DatumStore::instance().get("unrelated-point",&unrelated));
  unrelated.status="broken";
  unrelated.error="test corruption";
  kreoda::DatumStore::instance().put(unrelated);

  auto references=query("validateReferences",{{"ids",{"healthy-plane"}}});
  ASSERT_EQ(references["status"],"ok") << references;
  EXPECT_EQ(references["result"]["valid"],true) << references;
  references=query("validateReferences",{{"ids",{"unrelated-point"}}});
  ASSERT_EQ(references["status"],"ok") << references;
  EXPECT_EQ(references["result"]["valid"],false) << references;
  auto feature=query("validateFeature",{{"featureId","healthy-plane"}});
  ASSERT_EQ(feature["status"],"ok") << feature;
  EXPECT_EQ(feature["result"]["valid"],true) << feature;
  auto document=query("validateDocument");
  ASSERT_EQ(document["status"],"ok") << document;
  EXPECT_EQ(document["result"]["valid"],false) << document;

  kreoda::DocumentStore::instance().create("geometry-doc");
  ASSERT_TRUE(kreoda::CreateDatumFeature("source",kreoda::DatumKind::Point,pointJson,&error)) << error;
  ASSERT_TRUE(kreoda::CreateDatumFeature("child",kreoda::DatumKind::Point,
      R"({"type":"midpoint","first":{"type":"datum","featureId":"source"},"second":{"type":"coordinates","positionMm":[5,6,7]}})",&error)) << error;
  const auto revision=kreoda::DocumentStore::instance().snapshotRevision();
  const auto undos=kreoda::OcafLive::instance().AvailableUndos();
  kreoda::DatumRecord source;
  ASSERT_TRUE(kreoda::DatumStore::instance().get("source",&source));
  source.status="broken";
  source.error="broken ancestor";
  kreoda::DatumStore::instance().put(source);
  references=query("validateReferences",{{"ids",{"child"}}});
  ASSERT_EQ(references["status"],"ok") << references;
  EXPECT_EQ(references["result"]["valid"],false) << references;
  feature=query("validateFeature",{{"featureId","child"}});
  ASSERT_EQ(feature["status"],"ok") << feature;
  EXPECT_EQ(feature["result"]["valid"],false) << feature;

  source.status="ok";
  source.error.clear();
  kreoda::DatumStore::instance().put(source);
  ASSERT_TRUE(kreoda::DatumStore::instance().remove("source"));
  references=query("validateReferences",{{"ids",{"child"}}});
  ASSERT_EQ(references["status"],"ok") << references;
  EXPECT_EQ(references["result"]["valid"],false) << references;
  feature=query("validateFeature",{{"featureId","child"}});
  ASSERT_EQ(feature["status"],"ok") << feature;
  EXPECT_EQ(feature["result"]["valid"],false) << feature;
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRevision(),revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(),undos);
}

TEST(SessionGeometry, SurfaceTrimDatumToolDependencyValidatesAndRejectsBrokenReferences) {
  kreoda::DocumentStore::instance().create("geometry-doc");
  std::string error;
  kreoda::SketchModel model;
  model.points = {{"a", 0, 0, true}, {"b", 10, 0, true}};
  model.lines = {{"line", "a", "b"}};
  ASSERT_TRUE(kreoda::CreateSketchFeature("trim-target-sketch", "XY", model, &error)) << error;
  ASSERT_TRUE(kreoda::CreateSurfaceExtrudeFeature("trim-target", "trim-target-sketch", 10, &error)) << error;
  ASSERT_TRUE(kreoda::CreateDatumFeature("trim-p0", kreoda::DatumKind::Point,
      R"({"type":"coordinates","positionMm":[5,0,0]})", &error)) << error;
  ASSERT_TRUE(kreoda::CreateDatumFeature("trim-p1", kreoda::DatumKind::Point,
      R"({"type":"coordinates","positionMm":[5,1,0]})", &error)) << error;
  ASSERT_TRUE(kreoda::CreateDatumFeature("trim-p2", kreoda::DatumKind::Point,
      R"({"type":"coordinates","positionMm":[5,0,1]})", &error)) << error;
  ASSERT_TRUE(kreoda::CreateDatumFeature("trim-datum", kreoda::DatumKind::Plane,
      R"({"type":"threePoint","first":{"type":"datum","featureId":"trim-p0"},"second":{"type":"datum","featureId":"trim-p1"},"third":{"type":"datum","featureId":"trim-p2"}})", &error)) << error;
  const auto keep = query("resolveSurfacePoint", {{"targetId", "trim-target"}, {"pointMm", {2, 0, 5}}});
  ASSERT_EQ(keep["status"], "ok") << keep;
  const auto created = rpc({{"type", kreoda::kCreateSurfaceTrim}, {"featureId", "datum-trim"},
      {"targetId", "trim-target"}, {"toolId", "trim-datum"},
      {"keepFace", keep["result"]["keepFace"]}, {"keepUv", keep["result"]["keepUv"]}});
  ASSERT_EQ(created["status"], "ok") << created;
  kreoda::BodyRecord body;
  ASSERT_TRUE(kreoda::BodyStore::instance().bodyForFeature("datum-trim", &body));
  const auto expectValidationFailure = [](const kreoda::Json& result) {
    const auto status = result.value("status", std::string{});
    EXPECT_TRUE(status != "ok" || !result.at("result").at("valid").get<bool>()) << result;
  };

  auto document = query("validateDocument");
  ASSERT_EQ(document["status"], "ok") << document;
  EXPECT_TRUE(document["result"]["valid"]) << document;
  auto feature = query("validateFeature", {{"featureId", "datum-trim"}});
  ASSERT_EQ(feature["status"], "ok") << feature;
  EXPECT_TRUE(feature["result"]["valid"]) << feature;
  auto bodyResult = query("validateBody", {{"bodyId", body.bodyId}});
  ASSERT_EQ(bodyResult["status"], "ok") << bodyResult;
  EXPECT_TRUE(bodyResult["result"]["valid"]) << bodyResult;

  kreoda::DatumRecord datum;
  ASSERT_TRUE(kreoda::DatumStore::instance().get("trim-datum", &datum));
  datum.status = "broken";
  datum.error = "test corruption";
  kreoda::DatumStore::instance().put(datum);
  auto datumFeature = query("validateFeature", {{"featureId", "trim-datum"}});
  ASSERT_EQ(datumFeature["status"], "ok") << datumFeature;
  EXPECT_FALSE(datumFeature["result"]["valid"]) << datumFeature;
  document = query("validateDocument");
  ASSERT_EQ(document["status"], "ok") << document;
  EXPECT_FALSE(document["result"]["valid"]) << document;
  feature = query("validateFeature", {{"featureId", "datum-trim"}});
  expectValidationFailure(feature);
  bodyResult = query("validateBody", {{"bodyId", body.bodyId}});
  expectValidationFailure(bodyResult);

  datum.status = "ok";
  datum.error.clear();
  kreoda::DatumStore::instance().put(datum);
  kreoda::DatumRecord ancestor;
  ASSERT_TRUE(kreoda::DatumStore::instance().get("trim-p0", &ancestor));
  ancestor.status = "broken";
  ancestor.error = "broken datum ancestor";
  kreoda::DatumStore::instance().put(ancestor);
  datumFeature = query("validateFeature", {{"featureId", "trim-datum"}});
  ASSERT_EQ(datumFeature["status"], "ok") << datumFeature;
  EXPECT_FALSE(datumFeature["result"]["valid"]) << datumFeature;
  document = query("validateDocument");
  ASSERT_EQ(document["status"], "ok") << document;
  EXPECT_FALSE(document["result"]["valid"]) << document;
  feature = query("validateFeature", {{"featureId", "datum-trim"}});
  expectValidationFailure(feature);
  bodyResult = query("validateBody", {{"bodyId", body.bodyId}});
  expectValidationFailure(bodyResult);

  ancestor.status = "ok";
  ancestor.error.clear();
  kreoda::DatumStore::instance().put(ancestor);
  kreoda::ShapeRecord trim;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("datum-trim", &trim));
  trim.dependsOn.push_back("missing-datum-tool");
  kreoda::ShapeStore::instance().put(trim);
  document = query("validateDocument");
  ASSERT_EQ(document["status"], "ok") << document;
  EXPECT_FALSE(document["result"]["valid"]) << document;
  feature = query("validateFeature", {{"featureId", "datum-trim"}});
  expectValidationFailure(feature);
  bodyResult = query("validateBody", {{"bodyId", body.bodyId}});
  expectValidationFailure(bodyResult);
}
