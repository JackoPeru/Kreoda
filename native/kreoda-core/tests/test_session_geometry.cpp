#include <gtest/gtest.h>
#include <algorithm>
#include <cmath>
#include "document/document_store.h"
#include "features/primitives/primitives.h"
#include "features/hole/hole.h"
#include "features/instance/instance.h"
#include "features/datum/datum_commands.h"
#include "features/datum/datum_store.h"
#include "protocol/dispatcher.h"
#include "protocol/json_fields.h"
#include "model/shapes.h"
#include "features/extrusion/extrude.h"
#include "features/sketch/sketch_commands.h"
#include "persistence/ocaf_live.h"
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

TEST(SessionGeometry, BlindHoleRoleCollisionsFailSemanticReferenceValidation) {
  kreoda::DocumentStore::instance().create("geometry-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("root-box", 100, 50, 10, &error)) << error;
  ASSERT_TRUE(kreoda::CreateHoleFeature("blind-hole", "root-box", "box.+Z", 20, 20, 8,
                                        "blind", 5, &error)) << error;

  const auto refs = query("validateReferences", {{"ids", {
      "blind-hole:box.+Z", "blind-hole:edge.cir.box.+Z~wall.0"}}});

  ASSERT_EQ(refs["status"], "ok") << refs;
  EXPECT_EQ(refs["result"]["valid"], false) << refs;
  ASSERT_EQ(refs["result"]["checks"].size(), 2u);
  for (const auto& check : refs["result"]["checks"]) {
    EXPECT_EQ(check["ok"], false) << check;
    EXPECT_EQ(check["errorCode"], "AMBIGUOUS_REFERENCE") << check;
    EXPECT_NE(check["detail"].get<std::string>().find("multiple entities"), std::string::npos);
  }
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
