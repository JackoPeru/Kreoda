#include <gtest/gtest.h>
#include "features/datum/datum_store.h"
#include "protocol/json_fields.h"
#include <cmath>
using namespace kreoda;
namespace {
Json point(double x, double y, double z) { return {{"type","coordinates"},{"positionMm",{x,y,z}}}; }
Json xy() { return {{"type","principal"},{"planeKind","XY"}}; }
DatumRecord resolve(DatumKind kind, const Json& definition) {
  DatumRecord record; std::string error;
  EXPECT_TRUE(ResolveDatumDefinition(kind, definition.dump(), &record, &error)) << error;
  return record;
}
}
TEST(Datum, OffsetAndOpposedMidplanesRetainFirstBasis) {
  DatumStore::instance().clear();
  auto first=resolve(DatumKind::Plane,{{"type","offset"},{"base",xy()},{"offsetMm",10}});
  EXPECT_NEAR(first.plane.origin[2],10,1e-12); first.featureId="first"; DatumStore::instance().put(first);
  auto second=resolve(DatumKind::Plane,{{"type","offset"},{"base",xy()},{"offsetMm",30}});
  second.featureId="second"; second.plane.normal[2]=-1; second.plane.yAxis[1]=-1; DatumStore::instance().put(second);
  auto mid=resolve(DatumKind::Plane,{{"type","mid"},{"first",{{"type","datum"},{"featureId","first"}}},{"second",{{"type","datum"},{"featureId","second"}}}});
  EXPECT_NEAR(mid.plane.origin[2],20,1e-12); EXPECT_DOUBLE_EQ(mid.plane.normal[2],1);
  EXPECT_EQ(mid.dependsOn,(std::vector<std::string>{"first","second"}));
}
TEST(Datum, AngleUsesDirectedAxisAndDegrees) {
  auto d=resolve(DatumKind::Plane,{{"type","angle"},{"base",xy()},{"axis",{{"type","principal"},{"axis","X"}}},{"angleDeg",90}});
  EXPECT_NEAR(d.plane.normal[0],0,1e-12); EXPECT_NEAR(d.plane.normal[1],-1,1e-12); EXPECT_NEAR(d.plane.normal[2],0,1e-12);
  std::string error; EXPECT_TRUE(ValidateSketchPlane(d.plane,&error)) << error;
}
TEST(Datum, ThreePointPlaneAndAxesUseFiniteNativeFrame) {
  auto d=resolve(DatumKind::Plane,{{"type","threePoint"},{"first",point(10,20,30)},{"second",point(10,21,30)},{"third",point(10,20,31)}});
  EXPECT_DOUBLE_EQ(d.plane.origin[0],10); EXPECT_DOUBLE_EQ(d.plane.xAxis[1],1); EXPECT_DOUBLE_EQ(d.plane.normal[0],1);
  auto axis=resolve(DatumKind::Axis,{{"type","twoPoint"},{"first",point(1,2,3)},{"second",point(1,2,5)}});
  EXPECT_DOUBLE_EQ(axis.originMm[0],1); EXPECT_DOUBLE_EQ(axis.direction[2],1);
  auto normal=resolve(DatumKind::Axis,{{"type","planeNormal"},{"plane",xy()},{"through",point(5,6,7)}});
  EXPECT_DOUBLE_EQ(normal.originMm[2],7); EXPECT_DOUBLE_EQ(normal.direction[2],1);
}
TEST(Datum, IntersectionAxisSatisfiesBothOffsetPlanes) {
  auto first=resolve(DatumKind::Plane,{{"type","offset"},{"base",xy()},{"offsetMm",10}}); first.featureId="a"; DatumStore::instance().put(first);
  auto second=resolve(DatumKind::Plane,{{"type","offset"},{"base",{{"type","principal"},{"planeKind","YZ"}}},{"offsetMm",20}}); second.featureId="b"; DatumStore::instance().put(second);
  auto d=resolve(DatumKind::Axis,{{"type","planeIntersection"},{"first",{{"type","datum"},{"featureId","a"}}},{"second",{{"type","datum"},{"featureId","b"}}}});
  EXPECT_NEAR(d.originMm[0],20,1e-12); EXPECT_NEAR(d.originMm[2],10,1e-12); EXPECT_NEAR(d.direction[1],1,1e-12);
}
TEST(Datum, CoordinateAndMidpointRecordsAreReadOnlyAndKeepSources) {
  auto a=resolve(DatumKind::Point,point(-1000000,2,3)); a.featureId="p"; DatumStore::instance().put(a);
  auto b=resolve(DatumKind::Point,{{"type","midpoint"},{"first",{{"type","datum"},{"featureId","p"}}},{"second",point(1000000,4,5)}});
  EXPECT_DOUBLE_EQ(b.positionMm[0],0); EXPECT_DOUBLE_EQ(b.positionMm[1],3); EXPECT_EQ(b.dependsOn,(std::vector<std::string>{"p"}));
}
TEST(Datum, InvalidSourcesAndDegeneracyLeaveOutputUntouched) {
  DatumRecord accepted; accepted.featureId="unchanged"; accepted.positionMm[0]=123;
  std::string error;
  for (const auto& definition : std::vector<Json>{
    {{"type","threePoint"},{"first",point(0,0,0)},{"second",point(1,0,0)},{"third",point(2,0,0)}},
    {{"type","offset"},{"base",{{"type","datum"},{"featureId","missing"}}},{"offsetMm",1}},
    {{"type","offset"},{"base",xy()},{"offsetMm",1000001}},
    {{"type","angle"},{"base",xy()},{"axis",{{"type","principal"},{"axis","X"}}},{"angleDeg",361}},
    {{"type","mid"},{"first",xy()},{"second",{{"type","principal"},{"planeKind","YZ"}}}}
  }) {
    EXPECT_FALSE(ResolveDatumDefinition(DatumKind::Plane,definition.dump(),&accepted,&error));
    EXPECT_FALSE(error.empty()); EXPECT_EQ(accepted.featureId,"unchanged"); EXPECT_DOUBLE_EQ(accepted.positionMm[0],123);
  }
  EXPECT_FALSE(ResolveDatumDefinition(DatumKind::Axis,Json{{"type","twoPoint"},{"first",point(0,0,0)},{"second",point(1e-7,0,0)}}.dump(),&accepted,&error));
  EXPECT_FALSE(ResolveDatumDefinition(DatumKind::Point,point(1000001,0,0).dump(),&accepted,&error));
}

#if KREODA_WITH_OCCT
#include "document/document_store.h"
#include "features/primitives/primitives.h"
#include "model/shapes.h"
#include "topology/face_roles.h"
#include <BRep_Builder.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <TopoDS_Compound.hxx>
TEST(Datum, ActualOcctFaceAndLineReferencesKeepNativeBodiesUnchanged) {
  DocumentStore::instance().create("datum-native-source"); DatumStore::instance().clear(); std::string error;
  ASSERT_TRUE(CreateBoxFeature("datum-box",100,50,20,&error)) << error;
  ShapeRecord original; ASSERT_TRUE(ShapeStore::instance().get("datum-box",&original));
  auto plane=resolve(DatumKind::Plane,{{"type","offset"},{"base",{{"type","face"},{"featureId","datum-box"},{"persistentFaceId","datum-box:box.+Z"}}},{"offsetMm",2}});
  EXPECT_NEAR(plane.plane.origin[2],22,1e-12); EXPECT_DOUBLE_EQ(plane.plane.normal[2],1);
  EXPECT_EQ(plane.dependsOn,(std::vector<std::string>{"datum-box"}));
  auto bottom=resolve(DatumKind::Plane,{{"type","offset"},{"base",{{"type","face"},{"featureId","datum-box"},{"persistentFaceId","datum-box:box.-Z"}}},{"offsetMm",2}});
  EXPECT_DOUBLE_EQ(bottom.plane.normal[2],-1); EXPECT_TRUE(ValidateSketchPlane(bottom.plane,&error)) << error;
  const auto edges=ClassifyEdgeRoles(original.shape,original.type,original.featureId); ASSERT_FALSE(edges.empty());
  auto rotated=resolve(DatumKind::Plane,{{"type","angle"},{"base",xy()},{"axis",{{"type","edge"},{"featureId","datum-box"},{"persistentEdgeId",edges.front().persistentEdgeId}}},{"angleDeg",45}});
  EXPECT_TRUE(ValidateSketchPlane(rotated.plane,&error)) << error;
  EXPECT_EQ(rotated.dependsOn,(std::vector<std::string>{"datum-box"}));
  ShapeRecord after; ASSERT_TRUE(ShapeStore::instance().get("datum-box",&after));
  EXPECT_EQ(ShapeStore::instance().listInOrder().size(),1u); EXPECT_DOUBLE_EQ(after.volumeMm3,100000); EXPECT_TRUE(after.shape.IsSame(original.shape));
}
TEST(Datum, CurvedAndAmbiguousNativeSourcesRejectWithoutFallback) {
  DocumentStore::instance().create("datum-native-invalid"); DatumStore::instance().clear(); std::string error;
  ASSERT_TRUE(CreateCylinderFeature("datum-cylinder",5,10,&error)) << error;
  DatumRecord accepted; accepted.featureId="unchanged";
  EXPECT_FALSE(ResolveDatumDefinition(DatumKind::Plane,Json{{"type","offset"},{"base",{{"type","face"},{"featureId","datum-cylinder"},{"persistentFaceId","datum-cylinder:cyl.wall"}}},{"offsetMm",1}}.dump(),&accepted,&error));
  EXPECT_NE(error.find("planar"),std::string::npos) << error;
  ShapeRecord cylinder; ASSERT_TRUE(ShapeStore::instance().get("datum-cylinder",&cylinder));
  std::string circle; for(const auto& edge:ClassifyEdgeRoles(cylinder.shape,cylinder.type,cylinder.featureId)) if(edge.persistentEdgeId.find("edge.cir.")!=std::string::npos) { circle=edge.persistentEdgeId; break; }
  ASSERT_FALSE(circle.empty());
  EXPECT_FALSE(ResolveDatumDefinition(DatumKind::Plane,Json{{"type","angle"},{"base",xy()},{"axis",{{"type","edge"},{"featureId","datum-cylinder"},{"persistentEdgeId",circle}}},{"angleDeg",90}}.dump(),&accepted,&error));
  EXPECT_NE(error.find("straight"),std::string::npos) << error;
  BRep_Builder builder; TopoDS_Compound compound; builder.MakeCompound(compound);
  builder.Add(compound,BRepPrimAPI_MakeBox(10,10,10).Shape()); builder.Add(compound,BRepPrimAPI_MakeBox(20,20,20).Shape());
  ShapeRecord ambiguous; ambiguous.featureId="ambiguous"; ambiguous.type="Box"; ambiguous.shape=compound; ShapeStore::instance().put(ambiguous);
  EXPECT_FALSE(ResolveDatumDefinition(DatumKind::Plane,Json{{"type","offset"},{"base",{{"type","face"},{"featureId","ambiguous"},{"persistentFaceId","ambiguous:box.+Z"}}},{"offsetMm",1}}.dump(),&accepted,&error));
  EXPECT_NE(error.find("ambiguous"),std::string::npos) << error; EXPECT_EQ(accepted.featureId,"unchanged");
}
#endif
TEST(Datum, WrongKindBrokenSourcesAndInvalidJsonKeepAcceptedOutput) {
  DatumStore::instance().clear(); auto p=resolve(DatumKind::Point,point(1,2,3)); p.featureId="source"; DatumStore::instance().put(p);
  DatumRecord accepted; accepted.featureId="keep"; accepted.positionMm[0]=9; std::string error;
  const Json offset={{"type","offset"},{"base",{{"type","datum"},{"featureId","source"}}},{"offsetMm",1}};
  EXPECT_FALSE(ResolveDatumDefinition(DatumKind::Plane,offset.dump(),&accepted,&error)); EXPECT_NE(error.find("wrong kind"),std::string::npos);
  p.status="broken"; p.error="source removed"; DatumStore::instance().put(p);
  EXPECT_FALSE(ResolveDatumDefinition(DatumKind::Point,Json{{"type","midpoint"},{"first",{{"type","datum"},{"featureId","source"}}},{"second",point(0,0,0)}}.dump(),&accepted,&error));
  EXPECT_NE(error.find("broken"),std::string::npos); EXPECT_FALSE(ResolveDatumDefinition(DatumKind::Point,"{bad",&accepted,&error));
  EXPECT_FALSE(ResolveDatumDefinition(DatumKind::Point,R"({"type":"coordinates","positionMm":[0,0,1e309]})",&accepted,&error));
  EXPECT_EQ(accepted.featureId,"keep"); EXPECT_DOUBLE_EQ(accepted.positionMm[0],9);
}

TEST(Datum, ProspectiveRecordsNeverResolveAgainstTheCurrentDocument) {
  DatumStore::instance().clear(); auto live=resolve(DatumKind::Point,point(999,0,0)); live.featureId="shared"; DatumStore::instance().put(live);
  auto prospective=resolve(DatumKind::Point,point(10,0,0)); prospective.featureId="shared";
  const std::vector<DatumRecord> datums{prospective}; const std::vector<ShapeRecord> shapes;
  const Json definition={{"type","midpoint"},{"first",{{"type","datum"},{"featureId","shared"}}},{"second",point(20,0,0)}};
  DatumRecord result; std::string error;
  ASSERT_TRUE(ResolveDatumDefinition(DatumKind::Point,definition.dump(),DatumSourceRecords{datums,shapes},&result,&error)) << error;
  EXPECT_DOUBLE_EQ(result.positionMm[0],15);
  DatumRecord stillLive; ASSERT_TRUE(DatumStore::instance().get("shared",&stillLive)); EXPECT_DOUBLE_EQ(stillLive.positionMm[0],999);
  const std::vector<DatumRecord> empty;
  EXPECT_FALSE(ResolveDatumDefinition(DatumKind::Point,definition.dump(),DatumSourceRecords{empty,shapes},&result,&error));
}
#if KREODA_WITH_OCCT
TEST(Datum, ProspectiveOcctFacesUseTheIncomingGeometryOnly) {
  DocumentStore::instance().create("prospective-faces"); std::string error;
  ASSERT_TRUE(CreateBoxFeature("shared-box",100,50,20,&error)) << error;
  ShapeRecord incoming; incoming.featureId="shared-box"; incoming.type="Box";
  ASSERT_TRUE(BuildBoxShape(100,50,50,&incoming.shape,&error)) << error;
  const std::vector<ShapeRecord> shapes{incoming}; const std::vector<DatumRecord> datums;
  DatumRecord result;
  ASSERT_TRUE(ResolveDatumDefinition(DatumKind::Plane,Json{{"type","offset"},{"base",{{"type","face"},{"featureId","shared-box"},{"persistentFaceId","shared-box:box.+Z"}}},{"offsetMm",2}}.dump(),DatumSourceRecords{datums,shapes},&result,&error)) << error;
  EXPECT_NEAR(result.plane.origin[2],52,1e-12);
  ShapeRecord stillLive; ASSERT_TRUE(ShapeStore::instance().get("shared-box",&stillLive)); EXPECT_NEAR(stillLive.bboxMm[5],20,1e-6);
}
#endif

#include "features/datum/datum_json.h"
TEST(DatumPersistence, DefinitionsResolveInDependencyOrderWithoutCachedGeometry) {
  auto parent=resolve(DatumKind::Point,point(10,20,30)); parent.featureId="parent";
  DatumStore::instance().put(parent);
  auto child=resolve(DatumKind::Point,Json{{"type","midpoint"},{"first",{{"type","datum"},{"featureId","parent"}}},{"second",point(30,40,50)}}); child.featureId="child";
  parent.positionMm[0]=999; // Persistence must derive from definition, not stale geometry.
  std::vector<DatumRecord> out; std::string error;
  ASSERT_TRUE(ParseDatumDefinitions({SerializeDatumDefinition(child),SerializeDatumDefinition(parent)},{},{},&out,&error)) << error;
  ASSERT_EQ(out.size(),2u); EXPECT_EQ(out[0].featureId,"parent"); EXPECT_EQ(out[1].featureId,"child");
  EXPECT_DOUBLE_EQ(out[0].positionMm[0],10); EXPECT_DOUBLE_EQ(out[1].positionMm[0],20);
  EXPECT_EQ(out[1].dependsOn,(std::vector<std::string>{"parent"}));
}
TEST(DatumPersistence, MissingDuplicateCyclicAndMalformedDefinitionsAreAtomic) {
  std::vector<DatumRecord> accepted(1); accepted[0].featureId="keep"; std::string error;
  const auto record=[](const std::string& id,const std::string& source) {
    return Json{{"version",1},{"featureId",id},{"kind","DatumPoint"},{"definition",{{"type","midpoint"},{"first",{{"type","datum"},{"featureId",source}}},{"second",point(0,0,0)}}}}.dump();
  };
  for(const auto& records:std::vector<std::vector<std::string>>{{record("a","missing")},{record("a","b"),record("b","a")},{record("a","b"),record("a","b")},{"{bad"}}) {
    EXPECT_FALSE(ParseDatumDefinitions(records,{},{},&accepted,&error)); EXPECT_FALSE(error.empty());
    ASSERT_EQ(accepted.size(),1u); EXPECT_EQ(accepted[0].featureId,"keep");
  }
}

#if KREODA_WITH_OCCT
#include "persistence/ocaf_live.h"
#include <filesystem>
#include <chrono>
namespace {
std::filesystem::path datumFile(const char* label) {
  return std::filesystem::temp_directory_path()/(std::string("kreoda-datum-")+label+"-"+std::to_string(std::chrono::steady_clock::now().time_since_epoch().count())+".xbf");
}
}
TEST(DatumPersistence, ActualOcafRoundTripAndUndoRetainDefinitionsAndSources) {
  DocumentStore::instance().create("datum-roundtrip"); DatumStore::instance().clear();
  auto parent=resolve(DatumKind::Point,point(10,20,30)); parent.featureId="parent"; DatumStore::instance().put(parent);
  auto child=resolve(DatumKind::Point,Json{{"type","midpoint"},{"first",{{"type","datum"},{"featureId","parent"}}},{"second",point(30,40,50)}}); child.featureId="child";
  auto& ocaf=OcafLive::instance(); std::string error; ASSERT_TRUE(ocaf.BeginCommand(&error)) << error;
  ASSERT_TRUE(ocaf.UpsertDatum(parent.featureId,SerializeDatumDefinition(parent),&error)) << error;
  ASSERT_TRUE(ocaf.UpsertDatum(child.featureId,SerializeDatumDefinition(child),&error)) << error;
  bool delta=false; ASSERT_TRUE(ocaf.CommitCommand(&delta,&error)) << error; ASSERT_TRUE(delta);
  ASSERT_TRUE(ocaf.ResyncStore(&error)) << error;
  DatumRecord loaded; ASSERT_TRUE(DatumStore::instance().get("child",&loaded)); EXPECT_DOUBLE_EQ(loaded.positionMm[0],20);
  EXPECT_EQ(loaded.dependsOn,(std::vector<std::string>{"parent"})); EXPECT_TRUE(ShapeStore::instance().listInOrder().empty());
  ASSERT_TRUE(ocaf.Undo(&error)); ASSERT_TRUE(ocaf.ResyncStore(&error)) << error; EXPECT_TRUE(DatumStore::instance().listInOrder().empty());
  ASSERT_TRUE(ocaf.Redo(&error)); ASSERT_TRUE(ocaf.ResyncStore(&error)) << error; ASSERT_TRUE(DatumStore::instance().get("child",&loaded));
  const auto file=datumFile("roundtrip"); ASSERT_TRUE(ocaf.Save(file.string(),&error)) << error;
  DocumentStore::instance().create("datum-cleared"); EXPECT_TRUE(DatumStore::instance().listInOrder().empty());
  std::vector<ShapeRecord> shapes; ASSERT_TRUE(ocaf.Load(file.string(),&shapes,&error)) << error; ASSERT_TRUE(ocaf.ResyncStore(&error)) << error;
  ASSERT_TRUE(DatumStore::instance().get("child",&loaded)); EXPECT_DOUBLE_EQ(loaded.positionMm[0],20); EXPECT_DOUBLE_EQ(loaded.positionMm[1],30);
  EXPECT_EQ(DocumentStore::instance().snapshotRegistry().at("child"),"DatumPoint");
  ASSERT_TRUE(ocaf.BeginCommand(&error)); ASSERT_TRUE(ocaf.RemoveFeature("child",&error)) << error; ASSERT_TRUE(ocaf.CommitCommand(nullptr,&error)); ASSERT_TRUE(ocaf.ResyncStore(&error));
  EXPECT_FALSE(DatumStore::instance().contains("child")); EXPECT_TRUE(DatumStore::instance().contains("parent"));
  ASSERT_TRUE(ocaf.Undo(&error)); ASSERT_TRUE(ocaf.ResyncStore(&error)); EXPECT_TRUE(DatumStore::instance().contains("child"));
  std::error_code ec; std::filesystem::remove(file,ec);
}
TEST(DatumPersistence, BadIncomingSourcesRejectBeforeReplacingTheLiveDocument) {
  auto& ocaf=OcafLive::instance(); std::string error; DocumentStore::instance().create("bad-datum-file");
  const auto file=datumFile("bad"); ASSERT_TRUE(ocaf.BeginCommand(&error));
  const auto invalid=Json{{"version",1},{"featureId","broken"},{"kind","DatumPlane"},{"definition",{{"type","offset"},{"base",{{"type","datum"},{"featureId","missing"}}},{"offsetMm",1}}}}.dump();
  ASSERT_TRUE(ocaf.UpsertDatum("broken",invalid,&error)) << error; ASSERT_TRUE(ocaf.CommitCommand(nullptr,&error)); ASSERT_TRUE(ocaf.Save(file.string(),&error));
  DocumentStore::instance().create("healthy-datum"); auto pointRecord=resolve(DatumKind::Point,point(4,5,6)); pointRecord.featureId="healthy";
  ASSERT_TRUE(ocaf.BeginCommand(&error)); ASSERT_TRUE(ocaf.UpsertDatum("healthy",SerializeDatumDefinition(pointRecord),&error)); ASSERT_TRUE(ocaf.CommitCommand(nullptr,&error)); ASSERT_TRUE(ocaf.ResyncStore(&error));
  const auto undos=ocaf.AvailableUndos(); const auto registry=DocumentStore::instance().snapshotRegistry(); const auto revision=DocumentStore::instance().snapshotRevision();
  std::vector<ShapeRecord> shapes; EXPECT_FALSE(ocaf.Load(file.string(),&shapes,&error)); EXPECT_NE(error.find("missing"),std::string::npos) << error;
  DatumRecord stillHealthy; ASSERT_TRUE(DatumStore::instance().get("healthy",&stillHealthy)); EXPECT_DOUBLE_EQ(stillHealthy.positionMm[0],4);
  EXPECT_EQ(ocaf.AvailableUndos(),undos); EXPECT_EQ(DocumentStore::instance().snapshotRegistry(),registry); EXPECT_EQ(DocumentStore::instance().snapshotRevision(),revision);
  std::error_code ec; std::filesystem::remove(file,ec);
}
#endif

#if KREODA_WITH_OCCT && KREODA_WITH_MINIZIP
#include "protocol/dispatcher.h"
#include "rpc_text.h"
#include "model/feature_graph.h"
TEST(DatumPersistence, ActualIcadOpenKeepsDatumsAndReopenedLabelsRemainEditable) {
  DocumentStore::instance().create("datum-icad"); auto& ocaf=OcafLive::instance(); std::string error;
  auto record=resolve(DatumKind::Point,point(10,20,30)); record.featureId="saved-point";
  ASSERT_TRUE(ocaf.BeginCommand(&error)); ASSERT_TRUE(ocaf.UpsertDatum(record.featureId,SerializeDatumDefinition(record),&error)); ASSERT_TRUE(ocaf.CommitCommand(nullptr,&error)); ASSERT_TRUE(ocaf.ResyncStore(&error));
  auto file=datumFile("rpc"); file.replace_extension(".icad");
  auto request=[&](int type){return Json{{"protocolVersion",1},{"requestId","datum-rpc"},{"documentId","datum-icad"},{"type",type},{"path",file.generic_string()}}.dump();};
  ASSERT_NE(kreoda_test::rpcText(request(10)).find("\"status\":\"ok\""),std::string::npos);
  DocumentStore::instance().create("datum-icad");
  ASSERT_NE(kreoda_test::rpcText(request(11)).find("\"status\":\"ok\""),std::string::npos);
  DatumRecord loaded; ASSERT_TRUE(DatumStore::instance().get("saved-point",&loaded)); EXPECT_DOUBLE_EQ(loaded.positionMm[0],10);
  EXPECT_TRUE(TheFeatureGraph().hasFeature("saved-point"));
  record=resolve(DatumKind::Point,point(99,20,30)); record.featureId="saved-point";
  ASSERT_TRUE(ocaf.BeginCommand(&error)); ASSERT_TRUE(ocaf.UpsertDatum(record.featureId,SerializeDatumDefinition(record),&error)); ASSERT_TRUE(ocaf.CommitCommand(nullptr,&error)); ASSERT_TRUE(ocaf.ResyncStore(&error)) << error;
  ASSERT_TRUE(DatumStore::instance().get("saved-point",&loaded)); EXPECT_DOUBLE_EQ(loaded.positionMm[0],99);
  ASSERT_TRUE(ocaf.Undo(&error)); ASSERT_TRUE(ocaf.ResyncStore(&error)); ASSERT_TRUE(DatumStore::instance().get("saved-point",&loaded)); EXPECT_DOUBLE_EQ(loaded.positionMm[0],10);
  std::error_code ec; std::filesystem::remove(file,ec);
}
#endif

#if KREODA_WITH_OCCT
#include "features/datum/datum_commands.h"
#include "features/sketch/sketch_commands.h"
#include "features/sketch/sketch_json.h"
#include "features/extrusion/extrude.h"
#include "features/revolve/revolve.h"
#include "features/booleans/boolean.h"
#include "model/body.h"
namespace {
SketchModel datumRectangle() {
  SketchModel model;
  model.points={{"p0",0,0},{"p1",10,0},{"p2",10,5},{"p3",0,5}};
  model.lines={{"l0","p0","p1"},{"l1","p1","p2"},{"l2","p2","p3"},{"l3","p3","p0"}};
  model.constraints={{"h0",SketchConstraintKind::Horizontal,{"l0"},0},{"h2",SketchConstraintKind::Horizontal,{"l2"},0},{"v1",SketchConstraintKind::Vertical,{"l1"},0},{"v3",SketchConstraintKind::Vertical,{"l3"},0},{"w",SketchConstraintKind::Distance,{"p0","p1"},10},{"h",SketchConstraintKind::Distance,{"p1","p2"},5}};
  return model;
}
}
TEST(DatumCommands, CreateUpdateAndUndoAreSingleNonBodyMutations) {
  DocumentStore::instance().create("datum-commands"); std::string error;
  ASSERT_TRUE(CreateDatumFeature("point",DatumKind::Point,point(10,20,30).dump(),&error)) << error;
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),1); EXPECT_EQ(OcafLive::instance().AvailableUndos(),1);
  ASSERT_TRUE(UpdateDatumFeature("point",point(99,20,30).dump(),&error)) << error;
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),2); EXPECT_EQ(OcafLive::instance().AvailableUndos(),2);
  EXPECT_TRUE(BodyStore::instance().bodies().empty()); EXPECT_TRUE(ShapeStore::instance().listInOrder().empty());
  ASSERT_TRUE(OcafLive::instance().Undo(&error)); ASSERT_TRUE(OcafLive::instance().ResyncStore(&error)); DatumRecord record; ASSERT_TRUE(DatumStore::instance().get("point",&record)); EXPECT_DOUBLE_EQ(record.positionMm[0],10);
  ASSERT_TRUE(OcafLive::instance().Redo(&error)); ASSERT_TRUE(OcafLive::instance().ResyncStore(&error)); ASSERT_TRUE(DatumStore::instance().get("point",&record)); EXPECT_DOUBLE_EQ(record.positionMm[0],99);
}
TEST(DatumCommands, CyclicAndInvalidUpdatesPreserveRegistryRevisionAndUndo) {
  DocumentStore::instance().create("datum-reject"); std::string error;
  ASSERT_TRUE(CreateDatumFeature("a",DatumKind::Point,point(1,2,3).dump(),&error)) << error;
  const auto mid=[](const std::string& source){return Json{{"type","midpoint"},{"first",{{"type","datum"},{"featureId",source}}},{"second",point(0,0,0)}}.dump();};
  ASSERT_TRUE(CreateDatumFeature("b",DatumKind::Point,mid("a"),&error)) << error;
  const auto revision=DocumentStore::instance().snapshotRevision(); const auto undos=OcafLive::instance().AvailableUndos(); const auto registry=DocumentStore::instance().snapshotRegistry();
  EXPECT_FALSE(UpdateDatumFeature("a",mid("b"),&error)); EXPECT_FALSE(UpdateDatumFeature("a",point(1000001,0,0).dump(),&error));
  EXPECT_FALSE(CreateBoxFeature("a",1,1,1,&error)); EXPECT_FALSE(CreateSketchFeature("b","XY",datumRectangle(),&error));
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),revision); EXPECT_EQ(OcafLive::instance().AvailableUndos(),undos); EXPECT_EQ(DocumentStore::instance().snapshotRegistry(),registry);
  DatumRecord a; ASSERT_TRUE(DatumStore::instance().get("a",&a)); EXPECT_DOUBLE_EQ(a.positionMm[0],1);
}
TEST(DatumCommands, PointPlaneSketchExtrudeRecomputesAndRejectsDegenerateSourceAtomically) {
  DocumentStore::instance().create("datum-chain"); std::string error;
  ASSERT_TRUE(CreateBoxFeature("unrelated",100,50,20,&error)); ShapeRecord unrelated; ASSERT_TRUE(ShapeStore::instance().get("unrelated",&unrelated));
  ASSERT_TRUE(CreateDatumFeature("p0",DatumKind::Point,point(10,20,30).dump(),&error)) << error;
  ASSERT_TRUE(CreateDatumFeature("p1",DatumKind::Point,point(10,21,30).dump(),&error)); ASSERT_TRUE(CreateDatumFeature("p2",DatumKind::Point,point(10,20,31).dump(),&error));
  const auto ref=[](const char* id){return Json{{"type","datum"},{"featureId",id}};};
  ASSERT_TRUE(CreateDatumFeature("plane",DatumKind::Plane,Json{{"type","threePoint"},{"first",ref("p0")},{"second",ref("p1")},{"third",ref("p2")}}.dump(),&error)) << error;
  ASSERT_TRUE(CreateSketchOnDatumFeature("sketch","plane",datumRectangle(),&error)) << error; ASSERT_TRUE(CreateExtrudeFeature("solid","sketch",7,&error)) << error;
  ShapeRecord solid; ASSERT_TRUE(ShapeStore::instance().get("solid",&solid)); EXPECT_NEAR(solid.volumeMm3,350,1e-6); const double initial[6]={10,20,30,17,30,35}; for(int i=0;i<6;++i) EXPECT_NEAR(solid.bboxMm[i],initial[i],1e-6);
  const auto revision=DocumentStore::instance().snapshotRevision(); const auto undos=OcafLive::instance().AvailableUndos();
  ASSERT_TRUE(UpdateDatumFeature("p0",point(11,20,30).dump(),&error)) << error;
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),revision+1); EXPECT_EQ(OcafLive::instance().AvailableUndos(),undos+1);
  ASSERT_TRUE(ShapeStore::instance().get("solid",&solid)); const double a=1/std::sqrt(2.0),b=1/std::sqrt(6.0),c=1/std::sqrt(3.0); const double changed[6]={11-10*a-5*b,20-5*b,30,11+7*c,20+10*a+7*c,30+10*b+7*c}; for(int i=0;i<6;++i) EXPECT_NEAR(solid.bboxMm[i],changed[i],1e-6); EXPECT_NEAR(solid.volumeMm3,350,1e-6);
  ShapeRecord stillUnrelated; ASSERT_TRUE(ShapeStore::instance().get("unrelated",&stillUnrelated)); EXPECT_TRUE(stillUnrelated.shape.IsSame(unrelated.shape));
  const auto acceptedRevision=DocumentStore::instance().snapshotRevision(); const auto acceptedUndos=OcafLive::instance().AvailableUndos();
  EXPECT_FALSE(UpdateDatumFeature("p0",point(10,21,30).dump(),&error)); EXPECT_EQ(DocumentStore::instance().snapshotRevision(),acceptedRevision); EXPECT_EQ(OcafLive::instance().AvailableUndos(),acceptedUndos);
  ASSERT_TRUE(ShapeStore::instance().get("solid",&solid)); for(int i=0;i<6;++i) EXPECT_NEAR(solid.bboxMm[i],changed[i],1e-6);
  ASSERT_TRUE(OcafLive::instance().Undo(&error)); ASSERT_TRUE(OcafLive::instance().ResyncStore(&error)); ASSERT_TRUE(ShapeStore::instance().get("solid",&solid)); for(int i=0;i<6;++i) EXPECT_NEAR(solid.bboxMm[i],initial[i],1e-6);
#if KREODA_WITH_MINIZIP
  auto file=datumFile("full-chain");file.replace_extension(".icad");
  const auto save=Json{{"protocolVersion",1},{"requestId","save-chain"},{"documentId","datum-chain"},{"type",10},{"path",file.generic_string()}}.dump();
  ASSERT_NE(kreoda_test::rpcText(save).find("\"status\":\"ok\""),std::string::npos);
  DocumentStore::instance().create("datum-chain");
  const auto open=Json{{"protocolVersion",1},{"requestId","open-chain"},{"documentId","datum-chain"},{"type",11},{"path",file.generic_string()}}.dump();
  ASSERT_NE(kreoda_test::rpcText(open).find("\"status\":\"ok\""),std::string::npos);
  ASSERT_TRUE(ShapeStore::instance().get("solid",&solid));for(int i=0;i<6;++i)EXPECT_NEAR(solid.bboxMm[i],initial[i],1e-6);
  ASSERT_TRUE(UpdateDatumFeature("p0",point(11,20,30).dump(),&error)) << error;
  ASSERT_TRUE(ShapeStore::instance().get("solid",&solid));for(int i=0;i<6;++i)EXPECT_NEAR(solid.bboxMm[i],changed[i],1e-6);
  std::error_code ec;std::filesystem::remove(file,ec);
#endif
}
#endif

#if KREODA_WITH_OCCT
TEST(DatumCommands, NativeSourceParameterEditRebuildsDatumSketchAndSolid) {
  DocumentStore::instance().create("datum-source-body"); std::string error;
  ASSERT_TRUE(CreateBoxFeature("source-body",100,50,20,&error));
  ASSERT_TRUE(CreateDatumFeature("support",DatumKind::Plane,Json{{"type","offset"},{"base",{{"type","face"},{"featureId","source-body"},{"persistentFaceId","source-body:box.+Z"}}},{"offsetMm",2}}.dump(),&error)) << error;
  ASSERT_TRUE(CreateSketchOnDatumFeature("supported-sketch","support",datumRectangle(),&error)); ASSERT_TRUE(CreateExtrudeFeature("supported-solid","supported-sketch",7,&error));
  const auto revision=DocumentStore::instance().snapshotRevision(); const auto undos=OcafLive::instance().AvailableUndos();
  ASSERT_TRUE(RebuildFeature("source-body","depthMm",40,&error)) << error;
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),revision+1); EXPECT_EQ(OcafLive::instance().AvailableUndos(),undos+1);
  DatumRecord plane; ASSERT_TRUE(DatumStore::instance().get("support",&plane)); EXPECT_NEAR(plane.plane.origin[2],42,1e-6);
  ShapeRecord solid; ASSERT_TRUE(ShapeStore::instance().get("supported-solid",&solid)); EXPECT_NEAR(solid.bboxMm[2],42,1e-6); EXPECT_NEAR(solid.bboxMm[5],49,1e-6); EXPECT_NEAR(solid.volumeMm3,350,1e-6);
  ASSERT_TRUE(OcafLive::instance().Undo(&error)); ASSERT_TRUE(OcafLive::instance().ResyncStore(&error)); ASSERT_TRUE(DatumStore::instance().get("support",&plane)); EXPECT_NEAR(plane.plane.origin[2],22,1e-6);
}
TEST(DatumCommands, FailedUpstreamBodyEditRestoresDatumSketchSolidAndGraph) {
  DocumentStore::instance().create("datum-upstream-failure");std::string error;
  ASSERT_TRUE(CreateBoxFeature("source-body",100,50,20,&error));
  ASSERT_TRUE(CreateBoxFeature("clip",100,50,30,&error));
  ASSERT_TRUE(CreateDatumFeature("support",DatumKind::Plane,Json{{"type","offset"},{"base",{{"type","face"},{"featureId","source-body"},{"persistentFaceId","source-body:box.+Z"}}},{"offsetMm",2}}.dump(),&error));
  ASSERT_TRUE(CreateSketchOnDatumFeature("sketch","support",datumRectangle(),&error));
  ASSERT_TRUE(CreateExtrudeFeature("solid","sketch",7,&error));
  ASSERT_TRUE(CreateBooleanFeature("overlap","common","solid","clip",&error)) << error;
  const auto revision=DocumentStore::instance().snapshotRevision();const auto undos=OcafLive::instance().AvailableUndos();
  const auto registry=DocumentStore::instance().snapshotRegistry();
  DatumRecord before;ASSERT_TRUE(DatumStore::instance().get("support",&before));
  EXPECT_FALSE(RebuildFeature("source-body","depthMm",40,&error));
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),revision);EXPECT_EQ(OcafLive::instance().AvailableUndos(),undos);
  EXPECT_EQ(DocumentStore::instance().snapshotRegistry(),registry);
  DatumRecord after;ASSERT_TRUE(DatumStore::instance().get("support",&after));EXPECT_EQ(after.plane.origin[2],before.plane.origin[2]);
  SketchFeature sketch;ASSERT_TRUE(SketchStore::instance().get("sketch",&sketch));EXPECT_EQ(sketch.plane.origin[2],22);
  ShapeRecord solid;ASSERT_TRUE(ShapeStore::instance().get("solid",&solid));EXPECT_NEAR(solid.bboxMm[2],22,1e-6);EXPECT_NEAR(solid.bboxMm[5],29,1e-6);
  for(const auto* id:{"source-body","clip","support","sketch","solid","overlap"})EXPECT_FALSE(TheFeatureGraph().isGeometryDirty(id)) << id;
  ASSERT_TRUE(RebuildFeature("source-body","depthMm",21,&error)) << error;
  ASSERT_TRUE(DatumStore::instance().get("support",&after));EXPECT_EQ(after.plane.origin[2],23);
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),revision+1);EXPECT_EQ(OcafLive::instance().AvailableUndos(),undos+1);
}
TEST(DatumCommands, IdenticalBooleanGeometryRetainsDistinctFeatureLabelsAfterResyncAndReopen) {
  DocumentStore::instance().create("datum-shape-alias");std::string error;
  ASSERT_TRUE(CreateBoxFeature("clip",100,50,30,&error));
  ASSERT_TRUE(CreateDatumFeature("support",DatumKind::Plane,Json{{"type","offset"},{"base",xy()},{"offsetMm",22}}.dump(),&error));
  ASSERT_TRUE(CreateSketchOnDatumFeature("sketch","support",datumRectangle(),&error));
  ASSERT_TRUE(CreateExtrudeFeature("solid","sketch",7,&error));
  ASSERT_TRUE(CreateBooleanFeature("overlap","common","solid","clip",&error)) << error;
  ShapeRecord original;ASSERT_TRUE(ShapeStore::instance().get("solid",&original));
  ASSERT_TRUE(OcafLive::instance().ResyncStore(&error)) << error;
  ShapeRecord solid,overlap;ASSERT_TRUE(ShapeStore::instance().get("solid",&solid));ASSERT_TRUE(ShapeStore::instance().get("overlap",&overlap));
  EXPECT_NEAR(solid.volumeMm3,350,1e-6);EXPECT_NEAR(overlap.volumeMm3,350,1e-6);
  EXPECT_EQ(solid.dependsOn,(std::vector<std::string>{"sketch"}));
  auto file=datumFile("alias");ASSERT_TRUE(OcafLive::instance().Save(file.generic_string(),&error));
  std::vector<ShapeRecord> records;std::vector<std::string> sketches;
  ASSERT_TRUE(OcafLive::instance().Load(file.generic_string(),&records,&sketches,&error));
  EXPECT_EQ(std::count_if(records.begin(),records.end(),[](const auto& record){return record.featureId=="solid";}),1);
  EXPECT_EQ(std::count_if(records.begin(),records.end(),[](const auto& record){return record.featureId=="overlap";}),1);
  std::error_code ec;std::filesystem::remove(file,ec);
}
TEST(DatumCommands, FailedSourceSketchEditRestoresDependentDatumAndSketchFrames) {
  DocumentStore::instance().create("datum-sketch-failure");std::string error;
  auto sourceModel=datumRectangle();sourceModel.points[0].fixed=true;
  ASSERT_TRUE(CreateSketchFeature("source-sketch","XY",sourceModel,&error));
  ASSERT_TRUE(CreateExtrudeFeature("source-solid","source-sketch",7,&error));
  ASSERT_TRUE(CreateDatumFeature("a-support",DatumKind::Plane,Json{{"type","offset"},{"base",{{"type","face"},{"featureId","source-solid"},{"persistentFaceId","source-solid:extrude.+X"}}},{"offsetMm",0}}.dump(),&error)) << error;
  ASSERT_TRUE(CreateSketchOnDatumFeature("b-supported","a-support",datumRectangle(),&error));
  ASSERT_TRUE(CreateExtrudeFeature("c-solid","b-supported",7,&error));
  ASSERT_TRUE(CreateBoxFeature("clip",15,100,100,&error));
  ASSERT_TRUE(CreateBooleanFeature("z-overlap","common","c-solid","clip",&error)) << error;
  DatumRecord original;ASSERT_TRUE(DatumStore::instance().get("a-support",&original));EXPECT_NEAR(original.plane.origin[0],10,1e-6);
  SketchFeature originalSupported;ASSERT_TRUE(SketchStore::instance().get("b-supported",&originalSupported));
  const auto revision=DocumentStore::instance().snapshotRevision();const auto undos=OcafLive::instance().AvailableUndos();
  const auto registry=DocumentStore::instance().snapshotRegistry();
  sourceModel.points[1].x=20;sourceModel.points[2].x=20;sourceModel.constraints[4].value=20;
  EXPECT_FALSE(UpdateSketchFeature("source-sketch",sourceModel,&error)) << error;
  DatumRecord after;ASSERT_TRUE(DatumStore::instance().get("a-support",&after));EXPECT_NEAR(after.plane.origin[0],10,1e-6);
  SketchFeature supported;ASSERT_TRUE(SketchStore::instance().get("b-supported",&supported));
  EXPECT_EQ(SerializeSketchFeature(supported),SerializeSketchFeature(originalSupported));
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),revision);EXPECT_EQ(OcafLive::instance().AvailableUndos(),undos);
  EXPECT_EQ(DocumentStore::instance().snapshotRegistry(),registry);
  for(const auto* id:{"source-sketch","source-solid","a-support","b-supported","c-solid","clip","z-overlap"})EXPECT_FALSE(TheFeatureGraph().isGeometryDirty(id)) << id;
  sourceModel.points[1].x=11;sourceModel.points[2].x=11;sourceModel.constraints[4].value=11;
  ASSERT_TRUE(UpdateSketchFeature("source-sketch",sourceModel,&error)) << error;
  ASSERT_TRUE(DatumStore::instance().get("a-support",&after));EXPECT_NEAR(after.plane.origin[0],11,1e-6);
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),revision+1);EXPECT_EQ(OcafLive::instance().AvailableUndos(),undos+1);
}
TEST(DatumCommands, OrientedDatumSupportsMeasuredRevolveUndoAndRealIcadReopen) {
  DocumentStore::instance().create("datum-revolve");std::string error;
  ASSERT_TRUE(CreateDatumFeature("plane",DatumKind::Plane,Json{{"type","offset"},{"base",{{"type","principal"},{"planeKind","YZ"}}},{"offsetMm",10}}.dump(),&error));
  ASSERT_TRUE(CreateSketchOnDatumFeature("sketch","plane",datumRectangle(),&error));
  ASSERT_TRUE(CreateRevolveFeature("revolve","sketch",360,&error)) << error;
  const auto bounds=[&](double offset) {
    ShapeRecord solid;ASSERT_TRUE(ShapeStore::instance().get("revolve",&solid));
    const double expected[6]={offset-5,0,-5,offset+5,10,5};
    for(int i=0;i<6;++i)EXPECT_NEAR(solid.bboxMm[i],expected[i],1e-6);
    EXPECT_NEAR(solid.volumeMm3,250*std::acos(-1.0),1e-6);
  };
  bounds(10);const auto revision=DocumentStore::instance().snapshotRevision();const auto undos=OcafLive::instance().AvailableUndos();
  ASSERT_TRUE(SetDatumParameter("plane","offsetMm",20,&error));bounds(20);
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),revision+1);EXPECT_EQ(OcafLive::instance().AvailableUndos(),undos+1);
  ASSERT_TRUE(OcafLive::instance().Undo(&error));ASSERT_TRUE(OcafLive::instance().ResyncStore(&error));bounds(10);
#if KREODA_WITH_MINIZIP
  auto file=datumFile("revolve");file.replace_extension(".icad");
  const auto request=[&](int type){return Json{{"protocolVersion",1},{"requestId","revolve-save"},{"documentId","datum-revolve"},{"type",type},{"path",file.generic_string()}}.dump();};
  ASSERT_EQ(Json::parse(kreoda_test::rpcText(request(10)))["status"],"ok");
  DocumentStore::instance().create("datum-revolve");
  ASSERT_EQ(Json::parse(kreoda_test::rpcText(request(11)))["status"],"ok");bounds(10);
  SketchFeature sketch;ASSERT_TRUE(SketchStore::instance().get("sketch",&sketch));EXPECT_EQ(sketch.supportRef,"plane");EXPECT_EQ(sketch.planeKind,"Datum");
  ASSERT_TRUE(SetDatumParameter("plane","offsetMm",30,&error)) << error;bounds(30);
  std::error_code ec;std::filesystem::remove(file,ec);
#endif
}
#endif

#if KREODA_WITH_OCCT && KREODA_WITH_MINIZIP
namespace {
Json datumRpc(int type,const Json& fields=Json::object()) {
  Json request={{"protocolVersion",1},{"requestId","datum-public"},
                {"documentId",DocumentStore::instance().snapshotDocumentId()},{"type",type}};
  request.update(fields);
  return Json::parse(kreoda_test::rpcText(request.dump()));
}
}
TEST(DatumProtocol, PublicCommandsQueryAndNumericEditsKeepNativeIdentity) {
  DocumentStore::instance().create("datum-protocol");
  auto created=datumRpc(33,{{"featureId","public-point"},{"definition",point(10,20,30)}});
  ASSERT_EQ(created["status"],"ok") << created.dump();
  auto queried=datumRpc(35,{{"featureId","public-point"}});
  ASSERT_EQ(queried["status"],"ok") << queried.dump();
  EXPECT_EQ(queried["datum"]["kind"],"DatumPoint");
  EXPECT_EQ(queried["datum"]["resolved"]["positionMm"][0],10);
  const auto revision=DocumentStore::instance().snapshotRevision();
  ASSERT_EQ(datumRpc(6,{{"featureId","public-point"},{"paramName","xMm"},{"valueMm",99}})["status"],"ok");
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),revision+1);
  queried=datumRpc(35,{{"featureId","public-point"}});
  EXPECT_EQ(queried["datum"]["resolved"]["positionMm"][0],99);
  ASSERT_EQ(datumRpc(34,{{"featureId","public-point"},{"definition",point(123,20,30)}})["status"],"ok");
  auto query=datumRpc(30,{{"method","getDatum"},{"params",{{"featureId","public-point"}}}});
  ASSERT_EQ(query["status"],"ok") << query.dump();
  EXPECT_EQ(query["result"]["resolved"]["positionMm"][0],123);
  EXPECT_TRUE(ShapeStore::instance().listInOrder().empty());
  EXPECT_TRUE(BodyStore::instance().bodies().empty());
}
TEST(DatumProtocol, ReferencedDatumsCannotBeDeletedAndUnreferencedDeleteIsUndoable) {
  DocumentStore::instance().create("datum-delete");
  ASSERT_EQ(datumRpc(31,{{"featureId","public-plane"},{"definition",xy()}})["status"],"ok");
  ASSERT_EQ(datumRpc(32,{{"featureId","public-axis"},{"definition",{{"type","planeNormal"},{"plane",{{"type","datum"},{"featureId","public-plane"}}}}}})["status"],"ok");
  const auto revision=DocumentStore::instance().snapshotRevision();
  const auto undos=OcafLive::instance().AvailableUndos();
  auto refused=datumRpc(7,{{"featureId","public-plane"}});
  EXPECT_EQ(refused["status"],"error"); EXPECT_EQ(refused["errorCode"],"HAS_DEPENDENTS");
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),revision);
  EXPECT_EQ(OcafLive::instance().AvailableUndos(),undos);
  ASSERT_EQ(datumRpc(7,{{"featureId","public-axis"}})["status"],"ok");
  EXPECT_FALSE(DatumStore::instance().contains("public-axis"));
  ASSERT_EQ(datumRpc(8)["status"],"ok");
  EXPECT_TRUE(DatumStore::instance().contains("public-axis"));
  EXPECT_EQ(datumRpc(31,{{"featureId","public-axis"},{"definition",xy()}})["status"],"error");
}
TEST(DatumProtocol, SnapshotIncludesNativeSupportAndQueriesAreReadOnly) {
  DocumentStore::instance().create("datum-snapshot");std::string error;
  ASSERT_TRUE(CreateDatumFeature("support",DatumKind::Plane,Json{{"type","offset"},{"base",xy()},{"offsetMm",20}}.dump(),&error));
  auto created=datumRpc(13,{{"featureId","supported"},{"supportRef","support"},{"model",Json::parse(SerializeSketchModel(datumRectangle()))}});
  ASSERT_EQ(created["status"],"ok") << created.dump();
  const auto revision=DocumentStore::instance().snapshotRevision();const auto undos=OcafLive::instance().AvailableUndos();
  auto snapshot=datumRpc(26);
  ASSERT_EQ(snapshot["status"],"ok");ASSERT_EQ(snapshot["datums"].size(),1);
  EXPECT_EQ(snapshot["datums"][0]["resolved"]["originMm"][2],20);
  EXPECT_EQ(snapshot["sketches"][0]["supportRef"],"support");
  EXPECT_EQ(snapshot["sketches"][0]["plane"]["origin"][2],20);
  EXPECT_EQ(datumRpc(35,{{"featureId","missing"}})["errorCode"],"NOT_FOUND");
  EXPECT_EQ(datumRpc(7,{{"featureId","support"}})["errorCode"],"HAS_DEPENDENTS");
  EXPECT_EQ(datumRpc(6,{{"featureId","support"},{"paramName","offsetMm"},{"valueMm",30},{"isPreview",true}})["status"],"error");
  EXPECT_EQ(datumRpc(6,{{"featureId","support"},{"paramName","bogus"},{"valueMm",30}})["status"],"error");
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),revision);EXPECT_EQ(OcafLive::instance().AvailableUndos(),undos);
}
TEST(DatumProtocol, JoinedEditsCommitOnceAndRollbackRestoresDefinitions) {
  DocumentStore::instance().create("datum-transaction");
  ASSERT_EQ(datumRpc(27,{{"transactionId","txn"}})["status"],"ok");
  auto refused=datumRpc(33,{{"featureId","joined"},{"definition",point(1,2,3)}});
  EXPECT_EQ(refused["errorCode"],"TRANSACTION_OPEN");
  ASSERT_EQ(datumRpc(33,{{"featureId","joined"},{"definition",point(1,2,3)},{"transactionId","txn"}})["status"],"ok");
  ASSERT_EQ(datumRpc(6,{{"featureId","joined"},{"paramName","xMm"},{"valueMm",9},{"transactionId","txn"}})["status"],"ok");
  EXPECT_EQ(datumRpc(35,{{"featureId","joined"}})["datum"]["resolved"]["positionMm"][0],9);
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),0);EXPECT_EQ(OcafLive::instance().AvailableUndos(),0);
  ASSERT_EQ(datumRpc(28,{{"transactionId","txn"}})["status"],"ok");
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),1);EXPECT_EQ(OcafLive::instance().AvailableUndos(),1);
  ASSERT_EQ(datumRpc(27,{{"transactionId","txn2"}})["status"],"ok");
  ASSERT_EQ(datumRpc(34,{{"featureId","joined"},{"definition",point(77,2,3)},{"transactionId","txn2"}})["status"],"ok");
  ASSERT_EQ(datumRpc(29,{{"transactionId","txn2"}})["status"],"ok");
  EXPECT_EQ(datumRpc(35,{{"featureId","joined"}})["datum"]["resolved"]["positionMm"][0],9);
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),1);EXPECT_EQ(OcafLive::instance().AvailableUndos(),1);
  ASSERT_EQ(datumRpc(8)["status"],"ok");EXPECT_TRUE(DatumStore::instance().listInOrder().empty());
}
TEST(DatumProtocol, CompleteJoinedDatumSketchSolidChainHasOneRevisionAndUndo) {
  DocumentStore::instance().create("datum-chain-transaction");
  ASSERT_EQ(datumRpc(27,{{"transactionId","chain"}})["status"],"ok");
  ASSERT_EQ(datumRpc(31,{{"featureId","plane"},{"definition",{{"type","offset"},{"base",xy()},{"offsetMm",10}}},{"transactionId","chain"}})["status"],"ok");
  ASSERT_EQ(datumRpc(13,{{"featureId","sketch"},{"supportRef","plane"},{"model",Json::parse(SerializeSketchModel(datumRectangle()))},{"transactionId","chain"}})["status"],"ok");
  ASSERT_EQ(datumRpc(15,{{"featureId","solid"},{"sketchId","sketch"},{"distanceMm",7},{"transactionId","chain"}})["status"],"ok");
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),0);EXPECT_EQ(OcafLive::instance().AvailableUndos(),0);
  ASSERT_EQ(datumRpc(28,{{"transactionId","chain"}})["status"],"ok");
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),1);EXPECT_EQ(OcafLive::instance().AvailableUndos(),1);
  ShapeRecord solid;ASSERT_TRUE(ShapeStore::instance().get("solid",&solid));EXPECT_NEAR(solid.bboxMm[2],10,1e-6);EXPECT_NEAR(solid.bboxMm[5],17,1e-6);EXPECT_NEAR(solid.volumeMm3,350,1e-6);
  ASSERT_EQ(datumRpc(8)["status"],"ok");EXPECT_TRUE(DatumStore::instance().listInOrder().empty());EXPECT_TRUE(SketchStore::instance().listInOrder().empty());EXPECT_TRUE(ShapeStore::instance().listInOrder().empty());
  ASSERT_EQ(datumRpc(9)["status"],"ok");ASSERT_TRUE(ShapeStore::instance().get("solid",&solid));EXPECT_NEAR(solid.volumeMm3,350,1e-6);
  ASSERT_EQ(datumRpc(6,{{"featureId","plane"},{"paramName","offsetMm"},{"valueMm",20}})["status"],"ok");
  ASSERT_TRUE(ShapeStore::instance().get("solid",&solid));EXPECT_NEAR(solid.bboxMm[2],20,1e-6);
  const auto revision=DocumentStore::instance().snapshotRevision();const auto undos=OcafLive::instance().AvailableUndos();
  ASSERT_EQ(datumRpc(27,{{"transactionId","empty"}})["status"],"ok");ASSERT_EQ(datumRpc(28,{{"transactionId","empty"}})["status"],"ok");
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),revision);EXPECT_EQ(OcafLive::instance().AvailableUndos(),undos);
}
TEST(DatumProtocol, TaintedDependentFailureRollsBackEarlierJoinedCreationAndKeepsRevision) {
  DocumentStore::instance().create("datum-tainted");std::string error;
  ASSERT_TRUE(CreateBoxFeature("clip",100,50,30,&error));
  ASSERT_TRUE(CreateDatumFeature("plane",DatumKind::Plane,Json{{"type","offset"},{"base",xy()},{"offsetMm",22}}.dump(),&error));
  ASSERT_TRUE(CreateSketchOnDatumFeature("sketch","plane",datumRectangle(),&error));ASSERT_TRUE(CreateExtrudeFeature("solid","sketch",7,&error));
  ASSERT_TRUE(CreateBooleanFeature("overlap","common","solid","clip",&error));
  const auto revision=DocumentStore::instance().snapshotRevision();const auto undos=OcafLive::instance().AvailableUndos();const auto registry=DocumentStore::instance().snapshotRegistry();
  ASSERT_EQ(datumRpc(27,{{"transactionId","tainted"}})["status"],"ok");
  ASSERT_EQ(datumRpc(33,{{"featureId","temporary"},{"definition",point(1,2,3)},{"transactionId","tainted"}})["status"],"ok");
  EXPECT_EQ(datumRpc(6,{{"featureId","plane"},{"paramName","offsetMm"},{"valueMm",100},{"transactionId","tainted"}})["status"],"error");
  auto committed=datumRpc(28,{{"transactionId","tainted"}});EXPECT_EQ(committed["errorCode"],"TRANSACTION_TAINTED");
  EXPECT_FALSE(DatumStore::instance().contains("temporary"));EXPECT_FALSE(TheFeatureGraph().hasFeature("temporary"));
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),revision);EXPECT_EQ(OcafLive::instance().AvailableUndos(),undos);EXPECT_EQ(DocumentStore::instance().snapshotRegistry(),registry);
  DatumRecord plane;ASSERT_TRUE(DatumStore::instance().get("plane",&plane));EXPECT_EQ(plane.plane.origin[2],22);
  ShapeRecord solid;ASSERT_TRUE(ShapeStore::instance().get("solid",&solid));EXPECT_NEAR(solid.bboxMm[2],22,1e-6);EXPECT_NEAR(solid.volumeMm3,350,1e-6);
  EXPECT_FALSE(OcafLive::instance().InTransaction());
}
TEST(DatumProtocol, NumericCoordinateOffsetAndAngleEditsRejectInvalidInputsAtomically) {
  DocumentStore::instance().create("datum-numerics");
  auto decoratedPrincipal=xy();decoratedPrincipal["offsetMm"]=7;decoratedPrincipal["through"]=point(1,2,3);
  ASSERT_EQ(datumRpc(31,{{"featureId","principal"},{"definition",decoratedPrincipal}})["status"],"ok");
  EXPECT_EQ(datumRpc(6,{{"featureId","principal"},{"paramName","offsetMm"},{"valueMm",12}})["status"],"error");
  EXPECT_EQ(datumRpc(6,{{"featureId","principal"},{"paramName","throughXMm"},{"valueMm",12}})["status"],"error");
  ASSERT_EQ(datumRpc(31,{{"featureId","offset"},{"definition",{{"type","offset"},{"base",xy()},{"offsetMm",2}}}})["status"],"ok");
  ASSERT_EQ(datumRpc(31,{{"featureId","angle"},{"definition",{{"type","angle"},{"base",xy()},{"axis",{{"type","principal"},{"axis","X"}}},{"angleDeg",0}}}})["status"],"ok");
  ASSERT_EQ(datumRpc(32,{{"featureId","axis"},{"definition",{{"type","twoPoint"},{"first",point(0,0,0)},{"second",point(0,0,10)}}}})["status"],"ok");
  ASSERT_EQ(datumRpc(6,{{"featureId","offset"},{"paramName","offsetMm"},{"valueMm",15}})["status"],"ok");
  EXPECT_EQ(datumRpc(35,{{"featureId","offset"}})["datum"]["resolved"]["originMm"][2],15);
  ASSERT_EQ(datumRpc(6,{{"featureId","angle"},{"paramName","angleDeg"},{"value",90}})["status"],"ok");
  EXPECT_NEAR(datumRpc(35,{{"featureId","angle"}})["datum"]["resolved"]["normal"][1].get<double>(),-1,1e-12);
  ASSERT_EQ(datumRpc(6,{{"featureId","axis"},{"paramName","firstXMm"},{"valueMm",5}})["status"],"ok");
  EXPECT_EQ(datumRpc(35,{{"featureId","axis"}})["datum"]["resolved"]["originMm"][0],5);
  const auto revision=DocumentStore::instance().snapshotRevision();const auto undos=OcafLive::instance().AvailableUndos();
  for(const auto& fields:std::vector<Json>{
      {{"featureId","offset"},{"paramName","offsetMm"},{"valueMm",1000001}},
      {{"featureId","angle"},{"paramName","angleDeg"},{"valueMm",361}},
      {{"featureId","axis"},{"paramName","firstXMm"},{"valueMm","bad"}},
      {{"featureId","axis"},{"paramName","firstXMm"},{"expression","5+2"}},
      {{"featureId","axis"},{"paramName","firstXMm"},{"valueMm",8},{"parameterValues",{{"secondXMm",8}}}}})
    EXPECT_EQ(datumRpc(6,fields)["status"],"error");
  EXPECT_EQ(DocumentStore::instance().snapshotRevision(),revision);EXPECT_EQ(OcafLive::instance().AvailableUndos(),undos);
  EXPECT_EQ(datumRpc(35,{{"featureId","axis"}})["datum"]["resolved"]["originMm"][0],5);
}
#endif
