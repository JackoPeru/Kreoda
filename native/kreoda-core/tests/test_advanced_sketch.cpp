#include <gtest/gtest.h>
#include <BRepGProp.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <algorithm>
#include <chrono>
#include <filesystem>
#include <GProp_GProps.hxx>
#include <limits>
#include "constraints/solver.h"
#include "features/sketch/sketch_face.h"
#include "features/sketch/sketch_json.h"
#include "features/sketch/sketch_commands.h"
#include "features/sketch/sketch_transform.h"
#include "features/datum/datum_commands.h"
#include "features/extrusion/extrude.h"
#include "document/document_store.h"
#include "model/shapes.h"
#include "model/body_visibility.h"
#include "features/primitives/primitives.h"
#include "protocol/dispatcher.h"
#include "protocol/json_fields.h"

TEST(AdvancedSketch, EllipseAnalyticProfileAndNativeExtrude) {
  kreoda::DocumentStore::instance().create("advanced-sketch");
  kreoda::SketchModel model;
  model.points.push_back({"origin",0,0,true});
  model.ellipses.push_back({"ellipse","origin",20,10,0,false,0,6.283185307179586});
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("advanced-ellipse","XY",model,&error)) << error;
  kreoda::SketchFeature sketch;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("advanced-ellipse",&sketch));
  TopoDS_Shape profile;
  ASSERT_TRUE(kreoda::BuildProfileFromSketch(sketch,&profile,&error)) << error;
  GProp_GProps area;
  BRepGProp::SurfaceProperties(profile,area);
  EXPECT_NEAR(area.Mass(),200*3.141592653589793,1e-4);
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("advanced-ellipse-solid","advanced-ellipse",7,&error)) << error;
  kreoda::ShapeRecord solid;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("advanced-ellipse-solid",&solid));
  EXPECT_NEAR(solid.volumeMm3,1400*3.141592653589793,1e-3);
  auto rpc=[](int type,const std::string& id,const std::string& path="") {
    kreoda::Json request={{"protocolVersion",1},{"requestId",id},
      {"documentId","advanced-sketch"},{"type",type}};
    if (!path.empty()) request["path"]=path;
    const auto reply=kreoda::handle_command(request.dump());
    return kreoda::Json::parse(reply.begin(),reply.end());
  };
  ASSERT_EQ(rpc(8,"advanced-undo")["status"],"ok");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("advanced-ellipse-solid"));
  ASSERT_EQ(rpc(9,"advanced-redo")["status"],"ok");
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("advanced-ellipse-solid"));
  const auto path=(std::filesystem::temp_directory_path()/"kreoda-advanced-ellipse.icad").string();
  ASSERT_EQ(rpc(10,"advanced-save",path)["status"],"ok");
  ASSERT_EQ(rpc(2,"advanced-new")["status"],"ok");
  ASSERT_EQ(rpc(11,"advanced-open",path)["status"],"ok");
  ASSERT_TRUE(kreoda::SketchStore::instance().get("advanced-ellipse",&sketch));
  ASSERT_EQ(sketch.model.ellipses.size(),1u);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("advanced-ellipse-solid",&solid));
  EXPECT_NEAR(solid.volumeMm3,1400*3.141592653589793,1e-3);
  std::filesystem::remove(path);
  const auto serialized=kreoda::SerializeSketchModel(model);
  kreoda::SketchModel parsed;
  ASSERT_TRUE(kreoda::ParseSketchModel(serialized,&parsed,&error)) << error;
  ASSERT_EQ(parsed.ellipses.size(),1u);
  EXPECT_EQ(parsed.ellipses[0].majorRadius,20);
  model.ellipses[0].minorRadius=-1;
  EXPECT_FALSE(kreoda::CreateSketchFeature("invalid-ellipse","XY",model,&error));
}

TEST(AdvancedSketch, SplinePolesAndInterpolationProduceExactBSplineEdges) {
  kreoda::SketchFeature sketch;
  sketch.id="spline-sketch";
  sketch.model.points={{"a",0,0,true},{"b",5,8,true},{"c",10,8,true},{"d",15,0,true}};
  std::string error;
  for (bool poles:{true,false}) {
    sketch.model.splines={{"curve",{"a","b","c","d"},poles,false}};
    std::vector<TopoDS_Edge> edges;
    ASSERT_TRUE(kreoda::BuildSketchEntityEdges(sketch,{"curve"},&edges,&error)) << error;
    ASSERT_EQ(edges.size(),1u);
    BRepAdaptor_Curve curve(edges[0]);
    EXPECT_EQ(curve.GetType(),GeomAbs_BSplineCurve);
  }
  sketch.model.splines[0].pointIds={"a","missing","c"};
  std::vector<TopoDS_Edge> edges;
  EXPECT_FALSE(kreoda::BuildSketchEntityEdges(sketch,{"curve"},&edges,&error));
}

TEST(AdvancedSketch, ConstructionCircleExcludedFromAnalyticProfile) {
  kreoda::SketchFeature sketch;
  sketch.id="construction-sketch";
  sketch.model.points={{"o",0,0,true}};
  sketch.model.circles={{"outer","o",20},{"helper","o",5}};
  sketch.model.constructionIds={"helper"};
  std::string error;
  TopoDS_Shape profile;
  ASSERT_TRUE(kreoda::BuildProfileFromSketch(sketch,&profile,&error)) << error;
  GProp_GProps area;
  BRepGProp::SurfaceProperties(profile,area);
  EXPECT_NEAR(area.Mass(),400*3.141592653589793,1e-4);
  const auto json=kreoda::SerializeSketchModel(sketch.model);
  kreoda::SketchModel parsed;
  ASSERT_TRUE(kreoda::ParseSketchModel(json,&parsed,&error)) << error;
  ASSERT_EQ(parsed.constructionIds.size(),1u);
  EXPECT_EQ(parsed.constructionIds[0],"helper");
}

TEST(AdvancedSketch, BoundedMirrorAndLinearPatternUseCanonicalSketchUpdate) {
  kreoda::DocumentStore::instance().create("sketch-transform-doc");
  kreoda::SketchModel model;
  model.points={{"a",1,2,true},{"b",3,2,true}};
  model.lines={{"source","a","b"}};
  model.constructionIds={"source"};
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("transform-sketch","XY",model,&error)) << error;
  ASSERT_TRUE(kreoda::TransformSketchLines("transform-sketch",{"source"},"mirror",true,0,1,0,0,1,&error)) << error;
  ASSERT_TRUE(kreoda::TransformSketchLines("transform-sketch",{"source"},"array",false,1,0,5,0,2,&error)) << error;
  kreoda::SketchFeature result;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("transform-sketch",&result));
  EXPECT_EQ(result.model.lines.size(),4u);
  EXPECT_EQ(result.model.constructionIds.size(),4u);
  EXPECT_NEAR(result.model.points[2].x,-1,1e-9);
  EXPECT_NEAR(result.model.points[6].x,11,1e-9);
  EXPECT_FALSE(kreoda::TransformSketchLines("transform-sketch",{"source"},"bad",true,0,0,0,0,1,&error));
  ASSERT_TRUE(kreoda::SketchStore::instance().get("transform-sketch",&result));
  EXPECT_EQ(result.model.lines.size(),4u);
}

TEST(AdvancedSketch, PatternCopiesConnectedContourAndAllInternalConstraintsInOneUndoStep) {
  kreoda::DocumentStore::instance().create("sketch-copy-constraints-doc");
  kreoda::SketchModel model;
  model.points={{"p0",0,0,true},{"p1",10,0,false},{"p2",10,5,false},{"p3",0,5,false}};
  model.lines={{"l0","p0","p1"},{"l1","p1","p2"},
               {"l2","p2","p3"},{"l3","p3","p0"}};
  model.constructionIds={"l0","l2"};
  model.constraints={{"anchor",kreoda::SketchConstraintKind::Fixed,{"p0"},0},
                     {"h0",kreoda::SketchConstraintKind::Horizontal,{"l0"},0},
                     {"v1",kreoda::SketchConstraintKind::Vertical,{"l1"},0},
                     {"h2",kreoda::SketchConstraintKind::Horizontal,{"l2"},0},
                     {"v3",kreoda::SketchConstraintKind::Vertical,{"l3"},0},
                     {"width",kreoda::SketchConstraintKind::Distance,{"p0","p1"},10},
                     {"height",kreoda::SketchConstraintKind::Distance,{"p1","p2"},5}};
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("copy-constraints-sketch","XY",model,&error)) << error;
  kreoda::SketchFeature before;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("copy-constraints-sketch",&before));
  const auto beforeJson=kreoda::SerializeSketchModel(before.model);
  const auto beforeRevision=kreoda::DocumentStore::instance().revision();

  ASSERT_TRUE(kreoda::PatternSketchLines("copy-constraints-sketch",
      {"l0","l1","l2","l3"},"array",20,30,1,&error)) << error;

  kreoda::SketchFeature after;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("copy-constraints-sketch",&after));
  ASSERT_EQ(after.model.lines.size(),8u);
  ASSERT_EQ(after.model.points.size(),8u);
  ASSERT_EQ(after.model.constraints.size(),14u);
  ASSERT_EQ(after.model.constructionIds.size(),4u);
  const auto line=[&](const std::string& id)->const kreoda::SketchLine* {
    for(const auto& item:after.model.lines) if(item.id==id) return &item;
    return nullptr;
  };
  const auto point=[&](const std::string& id)->const kreoda::SketchPoint* {
    for(const auto& item:after.model.points) if(item.id==id) return &item;
    return nullptr;
  };
  const auto *copyBottom=line("array-1-l0"),*copyRight=line("array-1-l1"),
             *copyTop=line("array-1-l2"),*copyLeft=line("array-1-l3");
  ASSERT_NE(copyBottom,nullptr); ASSERT_NE(copyRight,nullptr);
  ASSERT_NE(copyTop,nullptr); ASSERT_NE(copyLeft,nullptr);
  EXPECT_EQ(copyBottom->p2,copyRight->p1);
  EXPECT_EQ(copyRight->p2,copyTop->p1);
  EXPECT_EQ(copyTop->p2,copyLeft->p1);
  EXPECT_EQ(copyLeft->p2,copyBottom->p1);
  ASSERT_NE(point(copyBottom->p1),nullptr);
  ASSERT_NE(point(copyBottom->p2),nullptr);
  EXPECT_TRUE(point(copyBottom->p1)->fixed);
  EXPECT_FALSE(point(copyBottom->p2)->fixed);
  EXPECT_NEAR(point(copyBottom->p1)->x,20,1e-8);
  EXPECT_NEAR(point(copyBottom->p1)->y,30,1e-8);
  EXPECT_TRUE(std::find(after.model.constructionIds.begin(),after.model.constructionIds.end(),"array-1-l0")!=after.model.constructionIds.end());
  EXPECT_TRUE(std::find(after.model.constructionIds.begin(),after.model.constructionIds.end(),"array-1-l2")!=after.model.constructionIds.end());
  const auto copiedWidth=std::find_if(after.model.constraints.begin(),after.model.constraints.end(),
      [](const auto& c){return c.id=="array-1-width";});
  ASSERT_NE(copiedWidth,after.model.constraints.end());
  EXPECT_EQ(copiedWidth->value,10);
  EXPECT_EQ(copiedWidth->refs.size(),2u);
  EXPECT_NE(copiedWidth->refs[0],"p0");
  EXPECT_NE(copiedWidth->refs[1],"p1");
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),beforeRevision+1);
  const auto afterJson=kreoda::SerializeSketchModel(after.model);

  auto rpc=[](int type,const std::string& id,const std::string& path="") {
    kreoda::Json request={{"protocolVersion",1},{"requestId",id},
      {"documentId","sketch-copy-constraints-doc"},{"type",type}};
    if(!path.empty()) request["path"]=path;
    const auto reply=kreoda::handle_command(request.dump());
    return kreoda::Json::parse(reply.begin(),reply.end());
  };
  ASSERT_EQ(rpc(8,"copy-constraints-undo")["status"],"ok");
  ASSERT_TRUE(kreoda::SketchStore::instance().get("copy-constraints-sketch",&after));
  EXPECT_EQ(kreoda::SerializeSketchModel(after.model),beforeJson);
  ASSERT_EQ(rpc(9,"copy-constraints-redo")["status"],"ok");
  ASSERT_TRUE(kreoda::SketchStore::instance().get("copy-constraints-sketch",&after));
  EXPECT_EQ(kreoda::SerializeSketchModel(after.model),afterJson);

  // Construction metadata was copied faithfully above. Disable it for this
  // downstream solid check so both closed rectangle profiles are material.
  auto extrusionModel=after.model;
  extrusionModel.constructionIds.clear();
  ASSERT_TRUE(kreoda::UpdateSketchFeature("copy-constraints-sketch",extrusionModel,&error)) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("copy-constraints-sketch",&after));
  const auto extrusionJson=kreoda::SerializeSketchModel(after.model);
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("copy-contour-solid","copy-constraints-sketch",2,&error)) << error;
  kreoda::ShapeRecord solid;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("copy-contour-solid",&solid));
  EXPECT_NEAR(solid.volumeMm3,200,1e-5);
  const auto path=std::filesystem::temp_directory_path() /
      ("kreoda-copy-contour-"+std::to_string(std::chrono::steady_clock::now().time_since_epoch().count())+".icad");
  ASSERT_EQ(rpc(10,"copy-contour-save",path.string())["status"],"ok");
  ASSERT_EQ(rpc(2,"copy-contour-new")["status"],"ok");
  ASSERT_EQ(rpc(11,"copy-contour-open",path.string())["status"],"ok");
  ASSERT_TRUE(kreoda::SketchStore::instance().get("copy-constraints-sketch",&after));
  EXPECT_EQ(kreoda::SerializeSketchModel(after.model),extrusionJson);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("copy-contour-solid",&solid));
  EXPECT_NEAR(solid.volumeMm3,200,1e-5);
  std::filesystem::remove(path);
}

TEST(AdvancedSketch, RejectsCrossingConstraintsAndCrossKindGeneratedIdCollisionsAtomically) {
  kreoda::DocumentStore::instance().create("sketch-copy-reject-doc");
  kreoda::SketchModel model;
  model.points={{"a",0,0,true},{"b",10,0,true},{"c",20,0,true},{"d",30,0,true},
                {"collision-1-source",40,40,true}};
  model.lines={{"source","a","b"},{"outside","c","d"}};
  model.constraints={{"crossing",kreoda::SketchConstraintKind::Parallel,{"source","outside"},0}};
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("copy-reject-sketch","XY",model,&error)) << error;
  kreoda::SketchFeature before,after;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("copy-reject-sketch",&before));
  const auto beforeJson=kreoda::SerializeSketchModel(before.model);
  const auto beforeRevision=kreoda::DocumentStore::instance().revision();
  EXPECT_FALSE(kreoda::TransformSketchLines("copy-reject-sketch",{"source"},"cross",false,1,0,0,0,1,&error));
  EXPECT_NE(error.find("constraint"),std::string::npos);
  ASSERT_TRUE(kreoda::SketchStore::instance().get("copy-reject-sketch",&after));
  EXPECT_EQ(kreoda::SerializeSketchModel(after.model),beforeJson);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),beforeRevision);

  model.constraints.clear();
  kreoda::DocumentStore::instance().create("sketch-copy-collision-doc");
  ASSERT_TRUE(kreoda::CreateSketchFeature("copy-collision-sketch","XY",model,&error)) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("copy-collision-sketch",&before));
  const auto collisionJson=kreoda::SerializeSketchModel(before.model);
  const auto collisionRevision=kreoda::DocumentStore::instance().revision();
  EXPECT_FALSE(kreoda::TransformSketchLines("copy-collision-sketch",{"source"},"collision",false,1,0,0,0,1,&error));
  EXPECT_NE(error.find("collision"),std::string::npos);
  ASSERT_TRUE(kreoda::SketchStore::instance().get("copy-collision-sketch",&after));
  EXPECT_EQ(kreoda::SerializeSketchModel(after.model),collisionJson);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),collisionRevision);
}

TEST(AdvancedSketch, ObliqueMirrorRemapsAxisConstraintsAndSignedAngles) {
  kreoda::DocumentStore::instance().create("sketch-oblique-copy-doc");
  kreoda::SketchModel model;
  model.points={{"a",0,0,true},{"b",4,0,true},{"c",0,0,true},{"d",0,4,true}};
  model.lines={{"horizontal","a","b"},{"vertical","c","d"}};
  model.constraints={{"h",kreoda::SketchConstraintKind::Horizontal,{"horizontal"},0},
                     {"v",kreoda::SketchConstraintKind::Vertical,{"vertical"},0},
                     {"angle",kreoda::SketchConstraintKind::Angle,{"horizontal","vertical"},1.5707963267948966}};
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("oblique-copy-sketch","XY",model,&error)) << error;
  ASSERT_TRUE(kreoda::TransformSketchLinesAboutAxis("oblique-copy-sketch",{"horizontal","vertical"},
      "mirror",1,1,0,1,&error)) << error;
  kreoda::SketchFeature copied;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("oblique-copy-sketch",&copied));
  const auto constraint=[&](const std::string& id)->const kreoda::SketchConstraint* {
    for(const auto& item:copied.model.constraints) if(item.id==id) return &item;
    return nullptr;
  };
  ASSERT_NE(constraint("mirror-1-h"),nullptr);
  ASSERT_NE(constraint("mirror-1-v"),nullptr);
  ASSERT_NE(constraint("mirror-1-angle"),nullptr);
  EXPECT_EQ(constraint("mirror-1-h")->kind,kreoda::SketchConstraintKind::Vertical);
  EXPECT_EQ(constraint("mirror-1-v")->kind,kreoda::SketchConstraintKind::Horizontal);
  EXPECT_NEAR(constraint("mirror-1-angle")->value,-1.5707963267948966,1e-9);
}

TEST(AdvancedSketch, TrimExtendRejectsFixedEndpointAndSolverDriftAtomically) {
  kreoda::DocumentStore::instance().create("trim-intent-doc");
  kreoda::SketchModel fixed;
  fixed.points={{"a",0,0,true},{"b",10,0,true},{"c",4,-5,true},{"d",4,5,true}};
  fixed.lines={{"target","a","b"},{"boundary","c","d"}};
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("trim-intent-sketch","XY",fixed,&error)) << error;
  kreoda::SketchFeature before,after;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("trim-intent-sketch",&before));
  const auto fixedJson=kreoda::SerializeSketchModel(before.model);
  const auto fixedRevision=kreoda::DocumentStore::instance().revision();
  EXPECT_FALSE(kreoda::TrimExtendSketchLine("trim-intent-sketch","target","boundary",true,false,&error));
  ASSERT_TRUE(kreoda::SketchStore::instance().get("trim-intent-sketch",&after));
  EXPECT_EQ(kreoda::SerializeSketchModel(after.model),fixedJson);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),fixedRevision);

  kreoda::DocumentStore::instance().create("trim-drift-doc");
  kreoda::SketchModel dimensioned;
  dimensioned.points={{"a",0,0,false},{"b",10,0,true},{"c",4,-5,true},{"d",4,5,true}};
  dimensioned.lines={{"target","a","b"},{"boundary","c","d"}};
  dimensioned.constraints={{"length",kreoda::SketchConstraintKind::Distance,{"a","b"},10}};
  ASSERT_TRUE(kreoda::CreateSketchFeature("trim-drift-sketch","XY",dimensioned,&error)) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("trim-drift-sketch",&before));
  const auto driftJson=kreoda::SerializeSketchModel(before.model);
  const auto driftRevision=kreoda::DocumentStore::instance().revision();
  EXPECT_FALSE(kreoda::TrimExtendSketchLine("trim-drift-sketch","target","boundary",true,false,&error));
  ASSERT_TRUE(kreoda::SketchStore::instance().get("trim-drift-sketch",&after));
  EXPECT_EQ(kreoda::SerializeSketchModel(after.model),driftJson);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),driftRevision);

  kreoda::DocumentStore::instance().create("trim-large-coordinate-doc");
  kreoda::SketchModel large;
  large.points={{"a",99980,0,false},{"b",99990,0,true},
                {"c",99980.0005,-5,true},{"d",99980.0005,5,true}};
  large.lines={{"target","a","b"},{"boundary","c","d"}};
  large.constraints={{"length",kreoda::SketchConstraintKind::Distance,{"a","b"},10}};
  ASSERT_TRUE(kreoda::CreateSketchFeature("trim-large-sketch","XY",large,&error)) << error;
  EXPECT_FALSE(kreoda::sketch_transform_detail::Near(1000000.0,1000000.005));
  ASSERT_TRUE(kreoda::SketchStore::instance().get("trim-large-sketch",&before));
  const auto largeJson=kreoda::SerializeSketchModel(before.model);
  const auto largeRevision=kreoda::DocumentStore::instance().revision();
  EXPECT_FALSE(kreoda::TrimExtendSketchLine("trim-large-sketch","target","boundary",true,false,&error));
  EXPECT_NE(error.find("intersection"),std::string::npos);
  ASSERT_TRUE(kreoda::SketchStore::instance().get("trim-large-sketch",&after));
  EXPECT_EQ(kreoda::SerializeSketchModel(after.model),largeJson);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),largeRevision);
}

TEST(AdvancedSketch, TrimExtendLinePreservesCanonicalSketchAndUndo) {
  kreoda::DocumentStore::instance().create("trim-extend-doc");
  kreoda::SketchModel model;
  model.points={{"a",0,0,false},{"b",10,0,false},
                {"c",4,-5,true},{"d",4,5,true},
                {"e",15,-5,true},{"f",15,5,true}};
  model.lines={{"target","a","b"},{"trim-boundary","c","d"},
               {"extend-boundary","e","f"}};
  model.constructionIds={"target","trim-boundary","extend-boundary"};
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("trim-sketch","XY",model,&error)) << error;
  ASSERT_TRUE(kreoda::TrimExtendSketchLine("trim-sketch","target","trim-boundary",true,false,&error)) << error;
  kreoda::SketchFeature result;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("trim-sketch",&result));
  EXPECT_NEAR(result.model.points[0].x,4,1e-7);
  ASSERT_TRUE(kreoda::TrimExtendSketchLine("trim-sketch","target","extend-boundary",false,true,&error)) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("trim-sketch",&result));
  EXPECT_NEAR(result.model.points[1].x,15,1e-7);
  EXPECT_FALSE(kreoda::TrimExtendSketchLine("trim-sketch","target","target",false,true,&error));
  ASSERT_TRUE(kreoda::SketchStore::instance().get("trim-sketch",&result));
  EXPECT_NEAR(result.model.points[1].x,15,1e-7);
  auto rpc=[](int type,const std::string& id,const std::string& path="") {
    kreoda::Json request={{"protocolVersion",1},{"requestId",id},
      {"documentId","trim-extend-doc"},{"type",type}};
    if (!path.empty()) request["path"]=path;
    const auto reply=kreoda::handle_command(request.dump());
    return kreoda::Json::parse(reply.begin(),reply.end());
  };
  ASSERT_EQ(rpc(8,"trim-undo")["status"],"ok");
  ASSERT_TRUE(kreoda::SketchStore::instance().get("trim-sketch",&result));
  EXPECT_NEAR(result.model.points[1].x,10,1e-7);
  ASSERT_EQ(rpc(9,"trim-redo")["status"],"ok");
  ASSERT_TRUE(kreoda::SketchStore::instance().get("trim-sketch",&result));
  EXPECT_NEAR(result.model.points[1].x,15,1e-7);
  const auto path=(std::filesystem::temp_directory_path()/"kreoda-trim-extend.icad").string();
  ASSERT_EQ(rpc(10,"trim-save",path)["status"],"ok");
  ASSERT_EQ(rpc(2,"trim-new")["status"],"ok");
  ASSERT_EQ(rpc(11,"trim-open",path)["status"],"ok");
  ASSERT_TRUE(kreoda::SketchStore::instance().get("trim-sketch",&result));
  EXPECT_NEAR(result.model.points[0].x,4,1e-7);
  EXPECT_NEAR(result.model.points[1].x,15,1e-7);
  std::filesystem::remove(path);
}

TEST(AdvancedSketch, ClosedInterpolatedSplineProducesNativePlanarFace) {
  kreoda::SketchFeature sketch;
  sketch.id="closed-spline";
  sketch.model.points={{"p0",10,0,true},{"p1",0,10,true},
                       {"p2",-10,0,true},{"p3",0,-10,true}};
  sketch.model.splines={{"outline",{"p0","p1","p2","p3"},false,true}};
  std::string error;
  TopoDS_Shape profile;
  ASSERT_TRUE(kreoda::BuildProfileFromSketch(sketch,&profile,&error)) << error;
  GProp_GProps props;
  BRepGProp::SurfaceProperties(profile,props);
  EXPECT_GT(props.Mass(),150);
  EXPECT_LT(props.Mass(),500);
  sketch.model.splines[0].pointIds={"p0","p1","p2"};
  EXPECT_FALSE(kreoda::BuildProfileFromSketch(sketch,&profile,&error));
}

TEST(AdvancedSketch, EllipseDimensionsDriveGeometryPreviewAndPersistence) {
  kreoda::DocumentStore::instance().create("ellipse-dim-doc");
  kreoda::SketchModel model;
  model.points={{"origin",0,0,true}};
  model.ellipses={{"oval","origin",12,6,0,false,0,6.283185307179586}};
  model.constraints={{"major",kreoda::SketchConstraintKind::EllipseMajorRadius,{"oval"},12}};
  std::string error;
  auto createDriven=model;
  createDriven.constraints[0].value=13;
  ASSERT_TRUE(kreoda::CreateSketchFeature("ellipse-create-driven","XY",createDriven,&error)) << error;
  kreoda::SketchFeature created;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("ellipse-create-driven",&created));
  EXPECT_DOUBLE_EQ(created.model.ellipses[0].majorRadius,13);
  ASSERT_TRUE(kreoda::CreateSketchFeature("ellipse-dim","XY",model,&error)) << error;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("ellipse-dim-solid","ellipse-dim",7,&error)) << error;

  constexpr double kPi=3.14159265358979323846;
  auto expectGeometry=[&](double major,double minor) {
    kreoda::SketchFeature current;
    ASSERT_TRUE(kreoda::SketchStore::instance().get("ellipse-dim",&current));
    ASSERT_EQ(current.model.ellipses.size(),1u);
    EXPECT_DOUBLE_EQ(current.model.ellipses[0].majorRadius,major);
    EXPECT_DOUBLE_EQ(current.model.ellipses[0].minorRadius,minor);
    TopoDS_Shape profile;
    std::string profileError;
    ASSERT_TRUE(kreoda::BuildProfileFromSketch(current,&profile,&profileError)) << profileError;
    GProp_GProps area;
    BRepGProp::SurfaceProperties(profile,area);
    EXPECT_NEAR(area.Mass(),kPi*major*minor,1e-4);
    kreoda::ShapeRecord solid;
    ASSERT_TRUE(kreoda::ShapeStore::instance().get("ellipse-dim-solid",&solid));
    EXPECT_NEAR(solid.volumeMm3,kPi*major*minor*7,1e-3);
  };
  auto sketchRequest=[&](int type,const std::string& requestId,
                         const kreoda::SketchModel& proposed,bool preview) {
    kreoda::Json request={{"protocolVersion",1},{"requestId",requestId},
      {"documentId","ellipse-dim-doc"},{"type",type},{"featureId","ellipse-dim"},
      {"model",kreoda::Json::parse(kreoda::SerializeSketchModel(proposed))}};
    if(type==kreoda::kUpdateSketch) request["isPreview"]=preview;
    return kreoda::Json::parse(kreoda::handle_command(request.dump()));
  };
  auto rpc=[&](int type,const std::string& requestId,const std::string& path="") {
    kreoda::Json request={{"protocolVersion",1},{"requestId",requestId},
      {"documentId","ellipse-dim-doc"},{"type",type}};
    if(!path.empty()) request["path"]=path;
    return kreoda::Json::parse(kreoda::handle_command(request.dump()));
  };

  expectGeometry(12,6);
  kreoda::SketchModel proposed=model;
  proposed.constraints[0].value=13;
  auto committed=sketchRequest(kreoda::kUpdateSketch,"ellipse-major-13",proposed,false);
  ASSERT_EQ(committed["status"],"ok") << committed.dump();
  expectGeometry(13,6);  // unconstrained minor radius stays canonical

  kreoda::SketchFeature stored;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("ellipse-dim",&stored));
  proposed=stored.model;
  proposed.constraints[0].value=14;
  const auto beforePreview=kreoda::SerializeSketchFeature(stored);
  const auto revisionBeforePreview=kreoda::DocumentStore::instance().revision();
  auto updatePreview=sketchRequest(kreoda::kUpdateSketch,"ellipse-preview-update",proposed,true);
  ASSERT_EQ(updatePreview["status"],"ok") << updatePreview.dump();
  EXPECT_TRUE(updatePreview["preview"].get<bool>());
  EXPECT_DOUBLE_EQ(updatePreview["sketch"]["model"]["ellipses"][0]["majorRadius"].get<double>(),14);
  auto aliasPreview=sketchRequest(kreoda::kPreviewSketch,"ellipse-preview-alias",proposed,false);
  ASSERT_EQ(aliasPreview["status"],"ok") << aliasPreview.dump();
  EXPECT_DOUBLE_EQ(aliasPreview["sketch"]["model"]["ellipses"][0]["majorRadius"].get<double>(),14);
  ASSERT_TRUE(kreoda::SketchStore::instance().get("ellipse-dim",&stored));
  EXPECT_EQ(kreoda::SerializeSketchFeature(stored),beforePreview);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),revisionBeforePreview);

  proposed=stored.model;
  proposed.constraints.push_back({"minor",kreoda::SketchConstraintKind::EllipseMinorRadius,{"oval"},5});
  committed=sketchRequest(kreoda::kUpdateSketch,"ellipse-minor-5",proposed,false);
  ASSERT_EQ(committed["status"],"ok") << committed.dump();
  expectGeometry(13,5);
  ASSERT_EQ(rpc(kreoda::kUndo,"ellipse-dim-undo")["status"],"ok");
  expectGeometry(13,6);
  ASSERT_EQ(rpc(kreoda::kRedo,"ellipse-dim-redo")["status"],"ok");
  expectGeometry(13,5);

  const auto path=(std::filesystem::temp_directory_path()/"kreoda-driving-ellipse.icad").string();
  ASSERT_EQ(rpc(kreoda::kSaveDocument,"ellipse-dim-save",path)["status"],"ok");
  ASSERT_EQ(rpc(kreoda::kCreateDocument,"ellipse-dim-new")["status"],"ok");
  ASSERT_EQ(rpc(kreoda::kOpenDocument,"ellipse-dim-open",path)["status"],"ok");
  expectGeometry(13,5);
  ASSERT_TRUE(kreoda::SketchStore::instance().get("ellipse-dim",&stored));
  proposed=stored.model;
  proposed.constraints[0].value=14;
  committed=sketchRequest(kreoda::kUpdateSketch,"ellipse-major-after-open",proposed,false);
  ASSERT_EQ(committed["status"],"ok") << committed.dump();
  expectGeometry(14,5);
  std::filesystem::remove(path);
}

TEST(AdvancedSketch, EllipseDrivingDimensionFailuresAreAtomicAndDiagnosed) {
  kreoda::DocumentStore::instance().create("ellipse-invalid-doc");
  kreoda::SketchModel model;
  model.points={{"origin",0,0,true}};
  model.ellipses={{"oval","origin",12,6,0,false,0,6.283185307179586}};
  model.constraints={{"major",kreoda::SketchConstraintKind::EllipseMajorRadius,{"oval"},12}};
  std::string error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("ellipse-invalid","XY",model,&error)) << error;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("ellipse-invalid-solid","ellipse-invalid",7,&error)) << error;
  kreoda::SketchFeature before;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("ellipse-invalid",&before));
  kreoda::ShapeRecord beforeSolid;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("ellipse-invalid-solid",&beforeSolid));
  const auto beforeJson=kreoda::SerializeSketchFeature(before);
  const auto beforeRevision=kreoda::DocumentStore::instance().revision();
  auto expectRejectedAtomically=[&](const kreoda::SketchModel& proposed) {
    std::string rejected;
    EXPECT_FALSE(kreoda::UpdateSketchFeature("ellipse-invalid",proposed,&rejected));
    EXPECT_FALSE(rejected.empty());
    kreoda::SketchFeature after;
    EXPECT_TRUE(kreoda::SketchStore::instance().get("ellipse-invalid",&after));
    EXPECT_EQ(kreoda::SerializeSketchFeature(after),beforeJson);
    EXPECT_EQ(kreoda::DocumentStore::instance().revision(),beforeRevision);
    kreoda::ShapeRecord afterSolid;
    EXPECT_TRUE(kreoda::ShapeStore::instance().get("ellipse-invalid-solid",&afterSolid));
    EXPECT_DOUBLE_EQ(afterSolid.volumeMm3,beforeSolid.volumeMm3);
#if KREODA_WITH_OCCT
    EXPECT_TRUE(afterSolid.shape.IsSame(beforeSolid.shape));
#endif
  };

  auto solver=kreoda::CreateSketchSolver();
  auto duplicate=model;
  duplicate.constraints.push_back({"major-redundant",kreoda::SketchConstraintKind::EllipseMajorRadius,{"oval"},12});
  const auto redundant=solver->solve(duplicate,{});
  ASSERT_TRUE(redundant.ok) << redundant.error;
  EXPECT_FALSE(redundant.redundant.empty());

  auto conflict=model;
  conflict.constraints.push_back({"major-conflict",kreoda::SketchConstraintKind::EllipseMajorRadius,{"oval"},13});
  const auto conflicting=solver->solve(conflict,{});
  EXPECT_FALSE(conflicting.ok);
  EXPECT_TRUE(std::find(conflicting.conflicting.begin(),conflicting.conflicting.end(),"major")!=conflicting.conflicting.end() ||
              std::find(conflicting.conflicting.begin(),conflicting.conflicting.end(),"major-conflict")!=conflicting.conflicting.end());
  expectRejectedAtomically(conflict);

  auto crossed=model;
  crossed.constraints[0].value=5;
  expectRejectedAtomically(crossed);
  auto equalAxes=model;
  equalAxes.constraints[0].value=6;
  expectRejectedAtomically(equalAxes);
  auto unknown=model;
  unknown.constraints[0].refs={"missing"};
  expectRejectedAtomically(unknown);
  auto nonFinite=model;
  nonFinite.constraints[0].value=std::numeric_limits<double>::quiet_NaN();
  expectRejectedAtomically(nonFinite);
  auto nonPositive=model;
  nonPositive.constraints[0].value=0;
  expectRejectedAtomically(nonPositive);

  auto previewRequest=[&](int type,const std::string& requestId,const kreoda::SketchModel& proposed) {
    kreoda::Json request={{"protocolVersion",1},{"requestId",requestId},
      {"documentId","ellipse-invalid-doc"},{"type",type},{"featureId","ellipse-invalid"},
      {"model",kreoda::Json::parse(kreoda::SerializeSketchModel(proposed))}};
    if(type==kreoda::kUpdateSketch) request["isPreview"]=true;
    return kreoda::Json::parse(kreoda::handle_command(request.dump()));
  };
  auto crossedPreview=previewRequest(kreoda::kUpdateSketch,"ellipse-cross-preview",crossed);
  EXPECT_EQ(crossedPreview["status"],"error");
  auto equalPreview=previewRequest(kreoda::kPreviewSketch,"ellipse-equal-preview",equalAxes);
  EXPECT_EQ(equalPreview["status"],"error");
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),beforeRevision);
  kreoda::SketchFeature afterPreview;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("ellipse-invalid",&afterPreview));
  EXPECT_EQ(kreoda::SerializeSketchFeature(afterPreview),beforeJson);
  kreoda::ShapeRecord afterPreviewSolid;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("ellipse-invalid-solid",&afterPreviewSolid));
  EXPECT_DOUBLE_EQ(afterPreviewSolid.volumeMm3,beforeSolid.volumeMm3);
#if KREODA_WITH_OCCT
  EXPECT_TRUE(afterPreviewSolid.shape.IsSame(beforeSolid.shape));
#endif
}

TEST(AdvancedSketch, NativeCurveDisplayUsesExactEdgesForSketchAndBothPreviews) {
  kreoda::DocumentStore::instance().create("native-curve-display-doc");
  std::string error;
  const kreoda::Json rotatedPlane={{"type","angle"},
      {"base",{{"type","principal"},{"planeKind","XY"}}},
      {"axis",{{"type","principal"},{"axis","X"}}},
      {"angleDeg",35}};
  ASSERT_TRUE(kreoda::CreateDatumFeature("curve-display-plane",
      kreoda::DatumKind::Plane,rotatedPlane.dump(),&error)) << error;

  constexpr double kPi=3.14159265358979323846;
  kreoda::SketchModel model;
  model.points={{"origin",2,3,true},
      {"p0",0,0,true},{"p1",5,8,true},{"p2",10,8,true},{"p3",15,0,true},
      {"i0",0,20,true},{"i1",5,31,true},{"i2",10,15,true},{"i3",15,22,true},
      {"c0",30,0,true},{"c1",35,5,true},{"c2",40,0,true},{"c3",35,-5,true}};
  model.ellipses={{"ellipse","origin",12,6,0.35,false,0,2*kPi},
      {"arc","origin",8,4,0.2,true,0.25,1.6}};
  model.splines={{"poles",{"p0","p1","p2","p3"},true,false},
      {"interpolated",{"i0","i1","i2","i3"},false,false},
      {"periodic",{"c0","c1","c2","c3"},true,true},
      {"periodic-interpolated",{"c0","c1","c2","c3"},false,true}};
  model.constructionIds={"periodic","periodic-interpolated"};
  model.constraints={{"ellipse-major",kreoda::SketchConstraintKind::EllipseMajorRadius,
                      {"ellipse"},12}};
  ASSERT_TRUE(kreoda::CreateSketchOnDatumFeature("curve-display-sketch",
      "curve-display-plane",model,&error)) << error;

  kreoda::SketchFeature stored;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("curve-display-sketch",&stored));
  const auto before=kreoda::SerializeSketchFeature(stored);
  const auto revision=kreoda::DocumentStore::instance().revision();
  auto request=[&](int type,const std::string& requestId,
                   const kreoda::SketchModel* candidate=nullptr,
                   const std::string& featureId="curve-display-sketch") {
    kreoda::Json value={{"protocolVersion",1},{"requestId",requestId},
        {"documentId","native-curve-display-doc"},{"type",type},
        {"featureId",featureId}};
    if(candidate) value["model"]=kreoda::Json::parse(kreoda::SerializeSketchModel(*candidate));
    if(type==kreoda::kUpdateSketch) value["isPreview"]=true;
    return kreoda::Json::parse(kreoda::handle_command(value.dump()));
  };
  auto findCurve=[](const kreoda::Json& response,const std::string& id) {
    if(!response.contains("curveDisplay") || !response["curveDisplay"].contains("curves"))
      return kreoda::Json();
    for(const auto& curve:response["curveDisplay"]["curves"])
      if(curve.value("entityId","")==id) return curve;
    return kreoda::Json();
  };
  auto assertCurve=[&](const kreoda::Json& response,const std::string& id,
                       const std::string& kind,bool closed) {
    const auto curve=findCurve(response,id);
    ASSERT_FALSE(curve.is_null()) << id << " absent from " << response.dump();
    EXPECT_EQ(curve["kind"],kind);
    EXPECT_EQ(curve["closed"],closed);
    ASSERT_EQ(curve["pointsMm"].size(),129u);
    for(const auto& point:curve["pointsMm"]) {
      ASSERT_EQ(point.size(),2u);
      EXPECT_TRUE(std::isfinite(point[0].get<double>()));
      EXPECT_TRUE(std::isfinite(point[1].get<double>()));
    }
  };
  auto assertNativeSamples=[&](const kreoda::Json& response,
                               const kreoda::SketchFeature& feature,
                               const std::string& id) {
    const auto display=findCurve(response,id);
    ASSERT_FALSE(display.is_null()) << id;
    std::vector<TopoDS_Edge> edges;
    std::string edgeError;
    ASSERT_TRUE(kreoda::BuildSketchEntityEdges(feature,{id},&edges,&edgeError)) << edgeError;
    ASSERT_EQ(edges.size(),1u);
    BRepAdaptor_Curve curve(edges.front());
    const double first=curve.FirstParameter();
    const double span=curve.LastParameter()-first;
    for(const size_t sample:{0u,32u,64u,96u,128u}) {
      const gp_Pnt point=curve.Value(first+span*static_cast<double>(sample)/128.0);
      const double dx=point.X()-feature.plane.origin[0];
      const double dy=point.Y()-feature.plane.origin[1];
      const double dz=point.Z()-feature.plane.origin[2];
      const double x=dx*feature.plane.xAxis[0]+dy*feature.plane.xAxis[1]+dz*feature.plane.xAxis[2];
      const double y=dx*feature.plane.yAxis[0]+dy*feature.plane.yAxis[1]+dz*feature.plane.yAxis[2];
      EXPECT_NEAR(display["pointsMm"][sample][0].get<double>(),x,1e-8) << id << " sample " << sample;
      EXPECT_NEAR(display["pointsMm"][sample][1].get<double>(),y,1e-8) << id << " sample " << sample;
    }
  };

  const auto fetched=request(kreoda::kRequestSketch,"curve-display-request");
  ASSERT_EQ(fetched["status"],"ok") << fetched.dump();
  ASSERT_TRUE(fetched.contains("curveDisplay")) << fetched.dump();
  ASSERT_EQ(fetched["curveDisplay"]["space"],"sketch-local");
  ASSERT_TRUE(fetched["curveDisplay"]["errors"].empty());
  assertCurve(fetched,"ellipse","ellipse",true);
  assertCurve(fetched,"arc","ellipticalArc",false);
  assertCurve(fetched,"poles","spline",false);
  assertCurve(fetched,"interpolated","spline",false);
  assertCurve(fetched,"periodic","spline",true);
  assertCurve(fetched,"periodic-interpolated","spline",true);
  for(const std::string id:{"ellipse","arc","poles","interpolated","periodic","periodic-interpolated"})
    assertNativeSamples(fetched,stored,id);

  std::vector<TopoDS_Edge> nativeEdges;
  ASSERT_TRUE(kreoda::BuildSketchEntityEdges(stored,{"ellipse"},&nativeEdges,&error)) << error;
  ASSERT_EQ(nativeEdges.size(),1u);
  BRepAdaptor_Curve nativeCurve(nativeEdges.front());
  const gp_Pnt nativeMid=nativeCurve.Value((nativeCurve.FirstParameter()+nativeCurve.LastParameter())/2);
  const double dx=nativeMid.X()-stored.plane.origin[0];
  const double dy=nativeMid.Y()-stored.plane.origin[1];
  const double dz=nativeMid.Z()-stored.plane.origin[2];
  const auto displayMid=findCurve(fetched,"ellipse")["pointsMm"][64];
  EXPECT_NEAR(displayMid[0].get<double>(),dx*stored.plane.xAxis[0]+dy*stored.plane.xAxis[1]+dz*stored.plane.xAxis[2],1e-8);
  EXPECT_NEAR(displayMid[1].get<double>(),dx*stored.plane.yAxis[0]+dy*stored.plane.yAxis[1]+dz*stored.plane.yAxis[2],1e-8);

  auto proposed=stored.model;
  proposed.constraints[0].value=13;
  const auto updatePreview=request(kreoda::kUpdateSketch,"curve-display-update-preview",&proposed);
  const auto aliasPreview=request(kreoda::kPreviewSketch,"curve-display-alias-preview",&proposed);
  for(const auto* preview:{&updatePreview,&aliasPreview}) {
    ASSERT_EQ((*preview)["status"],"ok") << preview->dump();
    EXPECT_TRUE((*preview)["preview"].get<bool>());
    ASSERT_EQ((*preview)["sketch"]["model"]["ellipses"][0]["majorRadius"],13);
    assertCurve(*preview,"ellipse","ellipse",true);
    kreoda::SketchFeature previewFeature=stored;
    ASSERT_TRUE(kreoda::ParseSketchModel((*preview)["sketch"]["model"].dump(),
        &previewFeature.model,&error)) << error;
    assertNativeSamples(*preview,previewFeature,"ellipse");
    const auto previewDisplay=findCurve(*preview,"ellipse")["pointsMm"][64];
    EXPECT_NE(previewDisplay,displayMid);
  }
  kreoda::SketchFeature after;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("curve-display-sketch",&after));
  EXPECT_EQ(kreoda::SerializeSketchFeature(after),before);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),revision);

  // The construction spline remains in display output but contributes no material area.
  kreoda::SketchFeature profile=stored;
  profile.model.ellipses.resize(1);
  profile.model.splines={{"periodic",{"c0","c1","c2","c3"},true,true},
      {"periodic-interpolated",{"c0","c1","c2","c3"},false,true}};
  profile.model.constructionIds={"periodic","periodic-interpolated"};
  TopoDS_Shape shape;
  ASSERT_TRUE(kreoda::BuildProfileFromSketch(profile,&shape,&error)) << error;
  GProp_GProps area;
  BRepGProp::SurfaceProperties(shape,area);
  EXPECT_NEAR(area.Mass(),72*kPi,1e-4);

  kreoda::SketchModel invalidInterpolation;
  invalidInterpolation.points={{"a",0,0,true},{"b",0,0,true},
      {"c",5,0,true},{"d",10,2,true}};
  invalidInterpolation.splines={{"invalid-interpolation",{"a","b","c","d"},false,false}};
  ASSERT_TRUE(kreoda::CreateSketchFeature("curve-display-error","XY",
      invalidInterpolation,&error)) << error;
  kreoda::SketchFeature beforeError;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("curve-display-error",&beforeError));
  const auto errorModel=kreoda::SerializeSketchFeature(beforeError);
  const auto errorRevision=kreoda::DocumentStore::instance().revision();
  const auto erroredDisplay=request(kreoda::kRequestSketch,"curve-display-error-request",
      nullptr,"curve-display-error");
  ASSERT_EQ(erroredDisplay["status"],"ok") << erroredDisplay.dump();
  ASSERT_EQ(erroredDisplay["curveDisplay"]["curves"].size(),0u);
  ASSERT_EQ(erroredDisplay["curveDisplay"]["errors"].size(),1u);
  EXPECT_EQ(erroredDisplay["curveDisplay"]["errors"][0]["entityId"],"invalid-interpolation");
  kreoda::SketchFeature afterError;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("curve-display-error",&afterError));
  EXPECT_EQ(kreoda::SerializeSketchFeature(afterError),errorModel);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),errorRevision);
}

TEST(AdvancedSketch, BodySuppressionPersistsThroughUndoRedoAndSaveOpen) {
  kreoda::DocumentStore::instance().create("suppression-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("tool-cutter",10,10,10,&error)) << error;
  const auto bodyId=kreoda::BodyStore::BodyIdForRoot("tool-cutter");
  kreoda::BodyRecord body;
  ASSERT_TRUE(kreoda::BodyStore::instance().get(bodyId,&body));
  ASSERT_TRUE(body.visible);
  ASSERT_TRUE(kreoda::SetBodyVisibility(bodyId,false,&error)) << error;
  ASSERT_TRUE(kreoda::BodyStore::instance().get(bodyId,&body));
  EXPECT_FALSE(body.visible);
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("tool-cutter"));
  auto rpc=[](int type,const std::string& id,const std::string& path="") {
    kreoda::Json request={{"protocolVersion",1},{"requestId",id},
      {"documentId","suppression-doc"},{"type",type}};
    if (!path.empty()) request["path"]=path;
    const auto reply=kreoda::handle_command(request.dump());
    return kreoda::Json::parse(reply.begin(),reply.end());
  };
  {
    kreoda::Json command={{"protocolVersion",1},{"requestId","visibility-command"},
      {"documentId","suppression-doc"},{"type",44},
      {"bodyId",bodyId},{"visible",true}};
    const auto bytes=kreoda::handle_command(command.dump());
    ASSERT_EQ(kreoda::Json::parse(bytes.begin(),bytes.end())["status"],"ok");
    command["requestId"]="visibility-command-hide";
    command["visible"]=false;
    const auto bytes2=kreoda::handle_command(command.dump());
    ASSERT_EQ(kreoda::Json::parse(bytes2.begin(),bytes2.end())["status"],"ok");
  }
  ASSERT_EQ(rpc(8,"visibility-undo")["status"],"ok");
  ASSERT_TRUE(kreoda::BodyStore::instance().get(bodyId,&body));
  EXPECT_TRUE(body.visible);
  ASSERT_EQ(rpc(9,"visibility-redo")["status"],"ok");
  ASSERT_TRUE(kreoda::BodyStore::instance().get(bodyId,&body));
  EXPECT_FALSE(body.visible);
  const auto path=(std::filesystem::temp_directory_path()/"kreoda-hidden-body.icad").string();
  ASSERT_EQ(rpc(10,"visibility-save",path)["status"],"ok");
  ASSERT_EQ(rpc(2,"visibility-new")["status"],"ok");
  ASSERT_EQ(rpc(11,"visibility-open",path)["status"],"ok");
  ASSERT_TRUE(kreoda::BodyStore::instance().get(bodyId,&body));
  EXPECT_FALSE(body.visible);
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("tool-cutter"));
  std::filesystem::remove(path);
}
