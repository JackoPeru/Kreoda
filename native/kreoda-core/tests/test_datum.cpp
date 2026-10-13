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
