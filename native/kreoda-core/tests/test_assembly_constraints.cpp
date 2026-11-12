#include <gtest/gtest.h>
#include <filesystem>
#include <cmath>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRep_Builder.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Compound.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#include <TopoDS.hxx>
#include "features/assembly/assembly_constraints.h"
#include "features/instance/instance.h"
#include "features/primitives/primitives.h"
#include "features/hole/hole.h"
#include "model/commit.h"
#include "features/extrusion/extrude.h"
#include "features/sketch/sketch_commands.h"
#include "features/sketch/sketch_store.h"
#include "document/document_store.h"
#include "protocol/dispatcher.h"
#include "protocol/json_fields.h"
#include "protocol/session_geometry.h"
#include "topology/face_roles.h"

TEST(AssemblyConstraints, GroundAndAxisDistancePersistUndoRedo) {
  kreoda::DocumentStore::instance().create("assembly-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("assembly-source",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("assembly-fixed","assembly-source",{4,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("assembly-moving","assembly-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("assembly-ground","ground","assembly-fixed","",0,0,&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("assembly-distance","distance","assembly-moving","assembly-fixed",0,12,&error)) << error;
  kreoda::ShapeRecord moving;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("assembly-moving",&moving));
  EXPECT_EQ(moving.paramsMm[0],16);
  EXPECT_EQ(moving.featureId,"assembly-moving");
  auto rpc=[](int type,const std::string& requestId,const std::string& path="") {
    kreoda::Json packet={{"protocolVersion",1},{"requestId",requestId},
      {"documentId","assembly-doc"},{"type",type}};
    if (!path.empty()) packet["path"]=path;
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  ASSERT_EQ(rpc(8,"assembly-undo")["status"],"ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("assembly-moving",&moving));
  EXPECT_EQ(moving.paramsMm[0],0);
  nlohmann::json doc;
  ASSERT_TRUE(kreoda::ReadAssemblyDocument(&doc,&error));
  EXPECT_FALSE(doc["constraints"].contains("assembly-distance"));
  ASSERT_EQ(rpc(9,"assembly-redo")["status"],"ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("assembly-moving",&moving));
  EXPECT_EQ(moving.paramsMm[0],16);
  ASSERT_TRUE(kreoda::ReadAssemblyDocument(&doc,&error));
  EXPECT_EQ(doc["constraints"].size(),2);
  const auto path=(std::filesystem::temp_directory_path()/"kreoda-assembly-constraints.icad").generic_string();
  ASSERT_EQ(rpc(10,"assembly-save",path)["status"],"ok");
  ASSERT_EQ(rpc(2,"assembly-reset")["status"],"ok");
  ASSERT_EQ(rpc(11,"assembly-open",path)["status"],"ok");
  ASSERT_TRUE(kreoda::ReadAssemblyDocument(&doc,&error));
  EXPECT_EQ(doc["constraints"].size(),2);
  ASSERT_TRUE(kreoda::ReapplyAssemblyConstraints(&error)) << error;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("assembly-moving",&moving));
  EXPECT_EQ(moving.paramsMm[0],16);
  EXPECT_FALSE(kreoda::RebuildFeature("assembly-moving","txMm",100,"",&error));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("assembly-moving",&moving));
  EXPECT_EQ(moving.paramsMm[0],16);
  EXPECT_FALSE(kreoda::DefineAssemblyConstraint("bad","distance","assembly-fixed","assembly-moving",0,5,&error));
  std::filesystem::remove(path);
}

TEST(AssemblyConstraints, CoincidentOriginsAreOneUndoablePersistedMate) {
  kreoda::DocumentStore::instance().create("coincident-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("coincident-source",10,10,10,&error))<<error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("coincident-fixed","coincident-source",{4,8,12,0,0,0},&error))<<error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("coincident-moving","coincident-source",{1,2,3,15,25,35},&error))<<error;
  EXPECT_FALSE(kreoda::DefineAssemblyConstraint("unanchored","coincident","coincident-moving","coincident-fixed",0,0,&error));
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("ground-fixed","ground","coincident-fixed","",0,0,&error))<<error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("mate-origins","coincident","coincident-moving","coincident-fixed",0,0,&error))<<error;
  kreoda::ShapeRecord moving;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("coincident-moving",&moving));
  EXPECT_EQ((std::vector<double>{moving.paramsMm[0],moving.paramsMm[1],moving.paramsMm[2]}),
            (std::vector<double>{4,8,12}));
  EXPECT_EQ((std::vector<double>{moving.paramsMm[3],moving.paramsMm[4],moving.paramsMm[5]}),
            (std::vector<double>{15,25,35}));
  const auto coincidentShape=moving.shape;
  const int mateUndos=kreoda::OcafLive::instance().AvailableUndos();
  EXPECT_FALSE(kreoda::DefineAssemblyConstraint("conflicting-distance","distance","coincident-moving","coincident-fixed",0,5,&error));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("coincident-moving",&moving));
  EXPECT_TRUE(moving.shape.IsSame(coincidentShape));
  EXPECT_EQ(moving.paramsMm[0],4);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(),mateUndos);
  nlohmann::json constraintsAfterConflict;
  ASSERT_TRUE(kreoda::ReadAssemblyDocument(&constraintsAfterConflict,&error));
  EXPECT_EQ(constraintsAfterConflict["constraints"].size(),2);
  nlohmann::json doc;
  ASSERT_TRUE(kreoda::ReadAssemblyDocument(&doc,&error));
  EXPECT_EQ(doc["constraints"]["mate-origins"]["kind"],"coincident");
  auto rpc=[](int type,const std::string& id,const std::string& path="") {
    kreoda::Json request={{"protocolVersion",1},{"requestId",id},
      {"documentId","coincident-doc"},{"type",type}};
    if(!path.empty())request["path"]=path;
    const auto bytes=kreoda::handle_command(request.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  ASSERT_EQ(rpc(8,"mate-undo")["status"],"ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("coincident-moving",&moving));
  EXPECT_EQ((std::vector<double>{moving.paramsMm[0],moving.paramsMm[1],moving.paramsMm[2]}),
            (std::vector<double>{1,2,3}));
  EXPECT_EQ((std::vector<double>{moving.paramsMm[3],moving.paramsMm[4],moving.paramsMm[5]}),
            (std::vector<double>{15,25,35}));
  ASSERT_TRUE(kreoda::ReadAssemblyDocument(&doc,&error));
  EXPECT_FALSE(doc["constraints"].contains("mate-origins"));
  ASSERT_EQ(rpc(9,"mate-redo")["status"],"ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("coincident-moving",&moving));
  EXPECT_EQ((std::vector<double>{moving.paramsMm[0],moving.paramsMm[1],moving.paramsMm[2]}),
            (std::vector<double>{4,8,12}));
  EXPECT_EQ((std::vector<double>{moving.paramsMm[3],moving.paramsMm[4],moving.paramsMm[5]}),
            (std::vector<double>{15,25,35}));
  const auto path=(std::filesystem::temp_directory_path()/"kreoda-coincident-mate.icad").string();
  ASSERT_EQ(rpc(10,"mate-save",path)["status"],"ok");
  ASSERT_EQ(rpc(2,"mate-new")["status"],"ok");
  ASSERT_EQ(rpc(11,"mate-open",path)["status"],"ok");
  ASSERT_TRUE(kreoda::ReadAssemblyDocument(&doc,&error));
  EXPECT_EQ(doc["constraints"]["mate-origins"]["kind"],"coincident");
  ASSERT_TRUE(kreoda::ReapplyAssemblyConstraints(&error))<<error;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("coincident-moving",&moving));
  EXPECT_EQ((std::vector<double>{moving.paramsMm[0],moving.paramsMm[1],moving.paramsMm[2]}),
            (std::vector<double>{4,8,12}));
  std::filesystem::remove(path);
}

TEST(AssemblyConstraints, CanonicalWireGroundCoincidentDistanceRejectAndUndo) {
  kreoda::DocumentStore::instance().create("assembly-wire-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("wire-source",10,10,10,&error))<<error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("wire-anchor","wire-source",{7,8,9,0,0,0},&error))<<error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("wire-moving","wire-source",{1,2,3,0,0,0},&error))<<error;
  auto rpc=[](kreoda::Json packet) {
    packet["protocolVersion"]=1;
    packet["documentId"]="assembly-wire-doc";
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  const kreoda::Json base={{"type",47},{"requestId","wire"},
    {"constraintId","wire-mate"},{"kind","coincident"},
    {"movingId","wire-moving"},{"fixedId","wire-anchor"}};
  auto malformed=base;
  malformed["extraField"]=true;
  EXPECT_EQ(rpc(malformed)["errorCode"],"BAD_PARAMS");
  malformed=base;
  malformed["kind"]="distance";
  EXPECT_EQ(rpc(malformed)["errorCode"],"BAD_PARAMS");
  malformed=base;
  malformed["kind"]="ground";
  EXPECT_EQ(rpc(malformed)["errorCode"],"BAD_PARAMS");
  EXPECT_EQ(rpc(base)["status"],"error"); // fixed must be grounded
  ASSERT_EQ(rpc({{"type",47},{"requestId","ground-wire"},
    {"constraintId","wire-ground"},{"kind","ground"},{"movingId","wire-anchor"}})["status"],"ok");
  ASSERT_EQ(rpc(base)["status"],"ok");
  kreoda::ShapeRecord moving;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("wire-moving",&moving));
  EXPECT_EQ((std::vector<double>{moving.paramsMm[0],moving.paramsMm[1],moving.paramsMm[2]}),
            (std::vector<double>{7,8,9}));
  ASSERT_EQ(rpc({{"type",8},{"requestId","wire-undo"}})["status"],"ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("wire-moving",&moving));
  EXPECT_EQ((std::vector<double>{moving.paramsMm[0],moving.paramsMm[1],moving.paramsMm[2]}),
            (std::vector<double>{1,2,3}));
  ASSERT_EQ(rpc({{"type",47},{"requestId","distance-wire"},
    {"constraintId","wire-distance"},{"kind","distance"},
    {"movingId","wire-moving"},{"fixedId","wire-anchor"},
    {"axis",0},{"distanceMm",5}})["status"],"ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("wire-moving",&moving));
  EXPECT_NEAR(moving.paramsMm[0],12,1e-8);
  EXPECT_NEAR(moving.paramsMm[1],2,1e-8);
}

TEST(AssemblyConstraints, ConflictingDistancesRejectWithoutChangingModelOrHistory) {
  kreoda::DocumentStore::instance().create("assembly-conflict-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("conflict-source",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("conflict-fixed","conflict-source",{4,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("conflict-moving","conflict-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("conflict-ground","ground","conflict-fixed","",0,0,&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("z-first-distance","distance","conflict-moving","conflict-fixed",0,12,&error)) << error;
  kreoda::ShapeRecord before;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("conflict-moving",&before));
  const int undos=kreoda::OcafLive::instance().AvailableUndos();

  EXPECT_FALSE(kreoda::DefineAssemblyConstraint("a-conflicting-distance","distance","conflict-moving","conflict-fixed",0,30,&error));

  kreoda::ShapeRecord after;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("conflict-moving",&after));
  EXPECT_DOUBLE_EQ(after.paramsMm[0],16);
  EXPECT_TRUE(after.shape.IsSame(before.shape));
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(),undos);
  nlohmann::json doc;
  ASSERT_TRUE(kreoda::ReadAssemblyDocument(&doc,&error)) << error;
  EXPECT_EQ(doc["constraints"].size(),2);
}

TEST(AssemblyConstraints, OrdinaryAndFormulaEditsCannotBreakGroundOrMate) {
  kreoda::DocumentStore::instance().create("assembly-edit-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("edit-source",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("edit-fixed","edit-source",{4,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("edit-moving","edit-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("edit-ground","ground","edit-fixed","",0,0,&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("edit-distance","distance","edit-moving","edit-fixed",0,12,&error)) << error;
  auto rpc=[](int type,const std::string& id,kreoda::Json extra=kreoda::Json::object()) {
    kreoda::Json packet={{"protocolVersion",1},{"requestId",id},{"documentId","assembly-edit-doc"},{"type",type}};
    for(auto it=extra.begin();it!=extra.end();++it)packet[it.key()]=it.value();
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  kreoda::ShapeRecord before;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("edit-moving",&before));
  const auto rejectedRevision=kreoda::DocumentStore::instance().revision();
  const auto rejectedUndos=kreoda::OcafLive::instance().AvailableUndos();
  const auto rejectedRegistry=kreoda::DocumentStore::instance().snapshotRegistry();
  const auto rejectedGraphSize=kreoda::TheFeatureGraph().size();
  EXPECT_EQ(rpc(6,"break-distance",{{"featureId","edit-moving"},{"paramName","txMm"},{"valueMm",100}})["status"],"error");
  EXPECT_EQ(rpc(6,"formula-break-distance",{{"featureId","edit-moving"},{"paramName","txMm"},{"expression","100"}})["status"],"error");
  EXPECT_EQ(rpc(6,"break-ground-rotation",{{"featureId","edit-fixed"},{"paramName","rxDeg"},{"valueMm",45}})["status"],"error");
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),rejectedRevision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(),rejectedUndos);
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRegistry(),rejectedRegistry);
  EXPECT_EQ(kreoda::TheFeatureGraph().size(),rejectedGraphSize);
  EXPECT_FALSE(kreoda::TheFeatureGraph().isGeometryDirty("edit-moving"));
  kreoda::ShapeRecord after;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("edit-moving",&after));
  EXPECT_DOUBLE_EQ(after.paramsMm[0],16);
  EXPECT_TRUE(after.shape.IsSame(before.shape));

  EXPECT_EQ(rpc(6,"free-axis",{{"featureId","edit-moving"},{"paramName","tyMm"},{"valueMm",123}})["status"],"ok");
  EXPECT_EQ(rpc(6,"compatible-compound",{{"featureId","edit-moving"},{"paramName","txMm"},{"valueMm",16},{"parameterValues",{{"tyMm",124}}}})["status"],"ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("edit-moving",&after));
  const kreoda::ShapeRecord compoundBefore=after;
  const auto compoundRevision=kreoda::DocumentStore::instance().revision();
  const int compoundUndos=kreoda::OcafLive::instance().AvailableUndos();
  EXPECT_EQ(rpc(6,"conflicting-compound",{{"featureId","edit-moving"},{"paramName","txMm"},{"valueMm",100},{"parameterValues",{{"tyMm",200}}}})["status"],"error");
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),compoundRevision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(),compoundUndos);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("edit-moving",&after));
  EXPECT_DOUBLE_EQ(after.paramsMm[0],16);
  EXPECT_DOUBLE_EQ(after.paramsMm[1],124);
  EXPECT_TRUE(after.shape.IsSame(compoundBefore.shape));
  ASSERT_TRUE(kreoda::RebuildFeature("edit-source","widthMm",20,"",&error)) << error;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("edit-moving",&after));
  EXPECT_DOUBLE_EQ(after.paramsMm[0],16);
  EXPECT_DOUBLE_EQ(after.paramsMm[1],124);
}

TEST(AssemblyConstraints, WireTransactionJoinsCreateGroundAndMateAsOneUndoStep) {
  kreoda::DocumentStore::instance().create("assembly-joined-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("joined-source",10,10,10,&error)) << error;
  auto rpc=[](int type,const std::string& id,kreoda::Json extra=kreoda::Json::object()) {
    kreoda::Json packet={{"protocolVersion",1},{"requestId",id},{"documentId","assembly-joined-doc"},{"type",type}};
    for(auto it=extra.begin();it!=extra.end();++it)packet[it.key()]=it.value();
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  const int undos=kreoda::OcafLive::instance().AvailableUndos();
  const auto revision=kreoda::DocumentStore::instance().revision();
  ASSERT_EQ(rpc(27,"joined-begin",{{"transactionId","joined-owner"}})["status"],"ok");
  ASSERT_EQ(rpc(24,"joined-fixed",{{"transactionId","joined-owner"},{"featureId","joined-fixed"},{"targetId","joined-source"},{"txMm",4}})["status"],"ok");
  ASSERT_EQ(rpc(24,"joined-moving",{{"transactionId","joined-owner"},{"featureId","joined-moving"},{"targetId","joined-source"}})["status"],"ok");
  ASSERT_EQ(rpc(47,"joined-ground",{{"transactionId","joined-owner"},{"constraintId","joined-ground"},{"kind","ground"},{"movingId","joined-fixed"}})["status"],"ok");
  ASSERT_EQ(rpc(47,"joined-distance",{{"transactionId","joined-owner"},{"constraintId","joined-distance"},{"kind","distance"},{"movingId","joined-moving"},{"fixedId","joined-fixed"},{"axis",0},{"distanceMm",8}})["status"],"ok");
  ASSERT_EQ(rpc(28,"joined-commit",{{"transactionId","joined-owner"}})["status"],"ok");
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(),undos+1);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),revision+1);
  kreoda::ShapeRecord moving;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("joined-moving",&moving));
  EXPECT_DOUBLE_EQ(moving.paramsMm[0],12);
  ASSERT_EQ(rpc(8,"joined-undo")["status"],"ok");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("joined-fixed"));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRegistry().size(),1u);
  nlohmann::json doc;
  ASSERT_TRUE(kreoda::ReadAssemblyDocument(&doc,&error)) << error;
  EXPECT_TRUE(doc["constraints"].empty());
  ASSERT_EQ(rpc(9,"joined-redo")["status"],"ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("joined-moving",&moving));
  EXPECT_DOUBLE_EQ(moving.paramsMm[0],12);
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRegistry().size(),3u);
  ASSERT_TRUE(kreoda::ReadAssemblyDocument(&doc,&error)) << error;
  EXPECT_EQ(doc["constraints"].size(),2);
}

TEST(AssemblyConstraints, ValidateDocumentReportsMalformedConstraintIdentity) {
  kreoda::DocumentStore::instance().create("assembly-validation-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("validation-source",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("validation-fixed","validation-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("validation-moving","validation-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::OcafLive::instance().BeginCommand(&error)) << error;
  const std::string invalid=R"({"constraints":{"bad-axis":{"kind":"distance","movingId":"validation-moving","fixedId":"validation-fixed","axis":9,"distanceMm":2}}})";
  ASSERT_TRUE(kreoda::OcafLive::instance().WriteAssemblyConstraints(invalid,&error)) << error;
  ASSERT_TRUE(kreoda::OcafLive::instance().CommitCommand(nullptr,&error)) << error;

  const auto result=kreoda::RunSessionGeometryQuery("validateDocument",kreoda::Json::object());
  EXPECT_FALSE(result["valid"].get<bool>());
  bool found=false;
  for(const auto& check:result["checks"])
    if(check.value("code","")=="assembly-constraint-valid" &&
       check.value("detail",std::string()).find("bad-axis")!=std::string::npos) found=true;
  EXPECT_TRUE(found);
}

TEST(AssemblyConstraints, ReapplyPreflightsAndRestoresAllMovedInstancesTogether) {
  kreoda::DocumentStore::instance().create("assembly-reapply-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("reapply-source",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("reapply-fixed","reapply-source",{4,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("reapply-a","reapply-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("reapply-b","reapply-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("reapply-ground","ground","reapply-fixed","",0,0,&error)) << error;
  ASSERT_TRUE(kreoda::RebuildFeature("reapply-a","txMm",100,"",&error)) << error;
  ASSERT_TRUE(kreoda::RebuildFeature("reapply-b","txMm",200,"",&error)) << error;
  nlohmann::json doc;
  ASSERT_TRUE(kreoda::ReadAssemblyDocument(&doc,&error)) << error;
  doc["constraints"]["reapply-distance-a"]={{"kind","distance"},{"movingId","reapply-a"},
    {"fixedId","reapply-fixed"},{"axis",0},{"distanceMm",11}};
  doc["constraints"]["reapply-distance-b"]={{"kind","distance"},{"movingId","reapply-b"},
    {"fixedId","reapply-fixed"},{"axis",0},{"distanceMm",22}};
  ASSERT_TRUE(kreoda::OcafLive::instance().BeginCommand(&error)) << error;
  ASSERT_TRUE(kreoda::OcafLive::instance().WriteAssemblyConstraints(doc.dump(),&error)) << error;
  ASSERT_TRUE(kreoda::OcafLive::instance().CommitCommand(nullptr,&error)) << error;
  ASSERT_TRUE(kreoda::ReapplyAssemblyConstraints(&error)) << error;
  kreoda::ShapeRecord a,b;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("reapply-a",&a));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("reapply-b",&b));
  EXPECT_DOUBLE_EQ(a.paramsMm[0],15);
  EXPECT_DOUBLE_EQ(b.paramsMm[0],26);
}

TEST(AssemblyConstraints, ReapplyConflictHasNoPartialMutationOrHistory) {
  kreoda::DocumentStore::instance().create("assembly-reapply-conflict-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("reapply-conflict-source",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("reapply-conflict-fixed","reapply-conflict-source",{4,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("reapply-conflict-moving","reapply-conflict-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("reapply-conflict-ground","ground","reapply-conflict-fixed","",0,0,&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("reapply-conflict-first","distance","reapply-conflict-moving","reapply-conflict-fixed",0,12,&error)) << error;
  nlohmann::json doc;
  ASSERT_TRUE(kreoda::ReadAssemblyDocument(&doc,&error)) << error;
  doc["constraints"]["reapply-conflict-second"]={{"kind","distance"},{"movingId","reapply-conflict-moving"},
    {"fixedId","reapply-conflict-fixed"},{"axis",0},{"distanceMm",30}};
  ASSERT_TRUE(kreoda::OcafLive::instance().BeginCommand(&error)) << error;
  ASSERT_TRUE(kreoda::OcafLive::instance().WriteAssemblyConstraints(doc.dump(),&error)) << error;
  ASSERT_TRUE(kreoda::OcafLive::instance().CommitCommand(nullptr,&error)) << error;
  kreoda::ShapeRecord before;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("reapply-conflict-moving",&before));
  const int undos=kreoda::OcafLive::instance().AvailableUndos();

  EXPECT_FALSE(kreoda::ReapplyAssemblyConstraints(&error));

  kreoda::ShapeRecord after;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("reapply-conflict-moving",&after));
  EXPECT_DOUBLE_EQ(after.paramsMm[0],16);
  EXPECT_TRUE(after.shape.IsSame(before.shape));
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(),undos);
}

TEST(AssemblyConstraints, FailedJoinedConstraintTaintsOwnerAndRollsBackOnCommit) {
  kreoda::DocumentStore::instance().create("assembly-taint-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("taint-source",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("taint-fixed","taint-source",{4,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("taint-moving","taint-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("taint-ground","ground","taint-fixed","",0,0,&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("taint-first-distance","distance","taint-moving","taint-fixed",0,12,&error)) << error;
  auto rpc=[](int type,const std::string& id,kreoda::Json extra=kreoda::Json::object()) {
    kreoda::Json packet={{"protocolVersion",1},{"requestId",id},{"documentId","assembly-taint-doc"},{"type",type}};
    for(auto it=extra.begin();it!=extra.end();++it)packet[it.key()]=it.value();
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  const int undos=kreoda::OcafLive::instance().AvailableUndos();
  const auto registry=kreoda::DocumentStore::instance().snapshotRegistry();
  const auto graphSize=kreoda::TheFeatureGraph().size();
  ASSERT_EQ(rpc(27,"taint-begin",{{"transactionId","taint-owner"}})["status"],"ok");
  ASSERT_EQ(rpc(24,"taint-extra-instance",{{"transactionId","taint-owner"},{"featureId","taint-extra"},{"targetId","taint-source"}})["status"],"ok");
  EXPECT_EQ(rpc(47,"taint-conflict",{{"transactionId","taint-owner"},{"constraintId","taint-second-distance"},
    {"kind","distance"},{"movingId","taint-moving"},{"fixedId","taint-fixed"},{"axis",0},{"distanceMm",30}})["status"],"error");
  EXPECT_EQ(rpc(28,"taint-commit",{{"transactionId","taint-owner"}})["errorCode"],"TRANSACTION_TAINTED");
  EXPECT_FALSE(kreoda::OcafLive::instance().InTransaction());
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(),undos);
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("taint-extra"));
  EXPECT_EQ(kreoda::DocumentStore::instance().snapshotRegistry(),registry);
  EXPECT_EQ(kreoda::TheFeatureGraph().size(),graphSize);
  EXPECT_FALSE(kreoda::TheFeatureGraph().hasFeature("taint-extra"));
  kreoda::ShapeRecord moving;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("taint-moving",&moving));
  EXPECT_DOUBLE_EQ(moving.paramsMm[0],16);
  nlohmann::json doc;
  ASSERT_TRUE(kreoda::ReadAssemblyDocument(&doc,&error)) << error;
  EXPECT_EQ(doc["constraints"].size(),2);
}

TEST(AssemblyConstraints, CoordinateToleranceUsesFiniteUlpsAndPhysicalMillimeters) {
  const double maximum=std::numeric_limits<double>::max();
  EXPECT_FALSE(kreoda::AssemblyCoordinatesAgree(maximum,maximum/2));
  EXPECT_FALSE(kreoda::AssemblyCoordinatesAgree(1e12,1e12+1.0));
  EXPECT_TRUE(kreoda::AssemblyCoordinatesAgree(1e12,std::nextafter(1e12,std::numeric_limits<double>::infinity())));
}

TEST(AssemblyConstraints, EqualAndIndependentCoordinateRequirementsCoexist) {
  kreoda::DocumentStore::instance().create("assembly-equal-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("equal-source",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("equal-fixed","equal-source",{4,5,6,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("equal-moving","equal-source",{0,0,0,10,20,30},&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("equal-ground","ground","equal-fixed","",0,0,&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("z-equal-x","distance","equal-moving","equal-fixed",0,12,&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("a-equal-x","distance","equal-moving","equal-fixed",0,12,&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("independent-y","distance","equal-moving","equal-fixed",1,7,&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("equal-moving-ground","ground","equal-moving","",0,0,&error)) << error;
  EXPECT_FALSE(kreoda::DefineAssemblyConstraint("conflicting-grounded-mate","distance","equal-moving","equal-fixed",0,13,&error));
  kreoda::ShapeRecord moving;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("equal-moving",&moving));
  EXPECT_DOUBLE_EQ(moving.paramsMm[0],16);
  EXPECT_DOUBLE_EQ(moving.paramsMm[1],12);
  EXPECT_DOUBLE_EQ(moving.paramsMm[2],0);
  EXPECT_DOUBLE_EQ(moving.paramsMm[3],10);
  EXPECT_DOUBLE_EQ(moving.paramsMm[4],20);
  EXPECT_DOUBLE_EQ(moving.paramsMm[5],30);
}

TEST(AssemblyConstraints, ValidateDocumentReportsUnsatisfiedMateIdentityAndReason) {
  kreoda::DocumentStore::instance().create("assembly-unsatisfied-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("unsatisfied-source",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("unsatisfied-fixed","unsatisfied-source",{4,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("unsatisfied-moving","unsatisfied-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("unsatisfied-ground","ground","unsatisfied-fixed","",0,0,&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("unsatisfied-distance","distance","unsatisfied-moving","unsatisfied-fixed",0,12,&error)) << error;
  kreoda::ShapeRecord displaced;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("unsatisfied-moving",&displaced));
  displaced.paramsMm[0]=100;
  kreoda::ShapeStore::instance().put(displaced);

  const auto result=kreoda::RunSessionGeometryQuery("validateDocument",kreoda::Json::object());
  EXPECT_FALSE(result["valid"].get<bool>());
  bool found=false;
  for(const auto& check:result["checks"]) {
    const std::string detail=check.value("detail",std::string());
    if(check.value("code","")=="assembly-constraint-valid" &&
       detail.find("unsatisfied-distance")!=std::string::npos &&
       detail.find("unsatisfied txMm")!=std::string::npos) found=true;
  }
  EXPECT_TRUE(found);
}

TEST(AssemblyConstraints, ReferencedInstanceMustHaveCurrentLiveGeometry) {
  kreoda::DocumentStore::instance().create("assembly-stale-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("stale-source",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("stale-fixed","stale-source",{4,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("stale-moving","stale-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("stale-free","stale-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("stale-ground","ground","stale-fixed","",0,0,&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("stale-distance","distance","stale-moving","stale-fixed",0,12,&error)) << error;
  kreoda::ShapeRecord moving;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("stale-moving",&moving));
  EXPECT_FALSE(moving.shape.IsNull());
  kreoda::TheFeatureGraph().markDirty("stale-moving");
  std::vector<kreoda::AssemblyConstraintIssue> issues;
  EXPECT_FALSE(kreoda::ReadAssemblyConstraintIssues(&issues,&error));
  EXPECT_NE(kreoda::AssemblyConstraintIssueText(issues).find("stale-moving"),std::string::npos);
  EXPECT_NE(kreoda::AssemblyConstraintIssueText(issues).find("geometry is dirty"),std::string::npos);
  const auto result=kreoda::RunSessionGeometryQuery("validateDocument",kreoda::Json::object());
  EXPECT_FALSE(result["valid"].get<bool>());
  EXPECT_NE(result.dump().find("stale-moving"),std::string::npos);
  kreoda::TheFeatureGraph().clearDirty("stale-moving");
  kreoda::TheFeatureGraph().markDirty("stale-free");
  EXPECT_TRUE(kreoda::ReadAssemblyConstraintIssues(&issues,&error)) << error;
}

TEST(AssemblyConstraints, GeometricMateWireAcceptsCapturedSourceBindings) {
  kreoda::DocumentStore::instance().create("assembly-geometric-wire-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("mate-source",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("mate-fixed","mate-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("mate-moving","mate-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("mate-ground","ground","mate-fixed","",0,0,&error)) << error;
  const auto revision=kreoda::DocumentStore::instance().snapshotRevision();
  const kreoda::Json faceBinding={{"type","face"},{"featureId","mate-source"},
      {"persistentFaceId","box.+Z"},{"geometryKind","plane"}};
  const kreoda::Json request={{"protocolVersion",1},{"requestId","parallel-mate"},
      {"documentId","assembly-geometric-wire-doc"},{"type",47},
      {"constraintId","parallel-mate"},{"kind","parallel"},
      {"movingId","mate-moving"},{"fixedId","mate-fixed"},
      {"captureRevision",revision},{"movingPickId","mate-moving:box.+Z"},
      {"fixedPickId","mate-fixed:box.+Z"},{"movingSourceBinding",faceBinding},
      {"fixedSourceBinding",faceBinding}};

  const auto bytes=kreoda::handle_command(request.dump());
  const auto response=kreoda::Json::parse(bytes.begin(),bytes.end());

  ASSERT_EQ(response["status"],"ok") << response;
}

TEST(AssemblyConstraints, AnglePlanRotatesSelectedPlaneAndValidatesTransformedBrep) {
  kreoda::DocumentStore::instance().create("assembly-angle-plan-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("angle-source",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("angle-fixed","angle-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("angle-moving","angle-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("angle-ground","ground","angle-fixed","",0,0,&error)) << error;

  kreoda::Json document;
  ASSERT_TRUE(kreoda::ReadAssemblyDocument(&document,&error)) << error;
  const kreoda::Json binding={{"type","face"},{"featureId","angle-source"},
      {"persistentFaceId","box.+Z"},{"geometryKind","plane"}};
  document["constraints"]["angle-30"]={{"kind","angle"},{"movingId","angle-moving"},
      {"fixedId","angle-fixed"},{"movingSourceBinding",binding},
      {"fixedSourceBinding",binding},{"angleDeg",30}};
  kreoda::AssemblyGeometryCapturePair pair;
  pair.moving.type="face";pair.moving.featureId="angle-source";
  pair.moving.persistentId="box.+Z";pair.moving.geometryKind="plane";
  pair.moving.point={{0,0,10}};pair.moving.direction={{0,0,1}};
  pair.fixed=pair.moving;
  kreoda::AssemblyGeometryCaptures captures{{"angle-30",pair}};

  kreoda::AssemblyConstraintPlan plan;
  ASSERT_TRUE(kreoda::BuildAssemblyConstraintPlan(document,&plan,false,&captures))
      << kreoda::AssemblyConstraintIssueText(plan.issues);

  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("angle-source",&source));
  TopoDS_Face sourceFace;
  ASSERT_TRUE(kreoda::FindFaceByRole(source.shape,"angle-source","Box","box.+Z",&sourceFace));
  gp_Trsf transform;
  const auto& pose=plan.placements.at("angle-moving");
  ASSERT_TRUE(kreoda::BuildInstanceTransform(
      {pose[0],pose[1],pose[2],pose[3],pose[4],pose[5]},&transform,&error)) << error;
  BRepBuilderAPI_Transform moved(source.shape,transform,true);
  moved.Build();
  ASSERT_TRUE(moved.IsDone());
  const TopoDS_Shape mapped=moved.ModifiedShape(sourceFace);
  ASSERT_FALSE(mapped.IsNull());
  auto movingDirection=BRepAdaptor_Surface(TopoDS::Face(mapped)).Plane().Axis().Direction();
  if(TopoDS::Face(mapped).Orientation()==TopAbs_REVERSED)movingDirection.Reverse();
  const double residual=std::atan2(
      gp_Vec(0,0,1).Crossed(gp_Vec(movingDirection)).Magnitude(),
      gp_Vec(0,0,1).Dot(gp_Vec(movingDirection)));
  EXPECT_NEAR(residual,30.0*std::acos(-1.0)/180.0,1e-8);
}

TEST(AssemblyConstraints, CapturedAngleCommandPersistsAndRebuildsSolvedBrep) {
  kreoda::DocumentStore::instance().create("assembly-angle-command-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("command-angle-source",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("command-angle-fixed","command-angle-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("command-angle-moving","command-angle-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("command-angle-ground","ground","command-angle-fixed","",0,0,&error)) << error;
  auto query=[&](const std::string& method,const kreoda::Json& params) {
    const auto packet=kreoda::Json{{"protocolVersion",1},{"requestId","angle-query"},
        {"documentId","assembly-angle-command-doc"},{"type",30},{"method",method},{"params",params}};
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  auto pick=[&](const std::string& instanceId) {
    const auto response=query("findFaces",{{"featureId",instanceId}});
    EXPECT_EQ(response["status"],"ok") << response;
    for(const auto& face:response["result"]["faces"])
      if(face.value("sourceBinding",kreoda::Json::object()).value("persistentFaceId",std::string())=="box.+Z")return face;
    return kreoda::Json::object();
  };
  const auto fixed=pick("command-angle-fixed");
  const auto moving=pick("command-angle-moving");
  ASSERT_FALSE(fixed.empty());ASSERT_FALSE(moving.empty());
  const auto revision=kreoda::DocumentStore::instance().revision();
  const int undos=kreoda::OcafLive::instance().AvailableUndos();
  const kreoda::Json request={{"protocolVersion",1},{"requestId","angle-command"},
      {"documentId","assembly-angle-command-doc"},{"type",47},
      {"constraintId","command-angle-30"},{"kind","angle"},
      {"movingId","command-angle-moving"},{"fixedId","command-angle-fixed"},
      {"captureRevision",revision},{"movingPickId",moving["persistentId"]},
      {"fixedPickId",fixed["persistentId"]},{"movingSourceBinding",moving["sourceBinding"]},
      {"fixedSourceBinding",fixed["sourceBinding"]},{"angleDeg",30}};
  const auto bytes=kreoda::handle_command(request.dump());
  const auto response=kreoda::Json::parse(bytes.begin(),bytes.end());
  ASSERT_EQ(response["status"],"ok") << response;
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(),undos+1);

  const auto moved=pick("command-angle-moving");
  const auto measured=query("measureAngle",{{"a",moved["persistentId"]},{"b",fixed["persistentId"]}});
  ASSERT_EQ(measured["status"],"ok") << measured;
  EXPECT_NEAR(measured["result"]["angleDeg"].get<double>(),30,1e-7);
  kreoda::Json document;
  ASSERT_TRUE(kreoda::ReadAssemblyDocument(&document,&error)) << error;
  const auto& saved=document["constraints"]["command-angle-30"];
  EXPECT_FALSE(saved.contains("captureRevision"));
  EXPECT_FALSE(saved.contains("movingPickId"));
  EXPECT_TRUE(saved["movingSourceBinding"].contains("selectionEntry"));
  EXPECT_TRUE(saved["fixedSourceBinding"].contains("selectionEntry"));
  EXPECT_TRUE(kreoda::RunSessionGeometryQuery("validateDocument",kreoda::Json::object())["valid"].get<bool>());
}

TEST(AssemblyConstraints, AmbiguousCurrentRoleFailsClosedBeforeSourceCapture) {
  const std::string documentId="assembly-ambiguous-binding-doc";
  kreoda::DocumentStore::instance().create(documentId);
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("ambiguous-binding-source",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("ambiguous-binding-fixed","ambiguous-binding-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("ambiguous-binding-moving","ambiguous-binding-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("ambiguous-binding-ground","ground","ambiguous-binding-fixed","",0,0,&error)) << error;
  auto query=[&](const std::string& method,const kreoda::Json& params) {
    const auto packet=kreoda::Json{{"protocolVersion",1},{"requestId","ambiguous-binding-query"},
        {"documentId",documentId},{"type",30},{"method",method},{"params",params}};
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  auto pick=[&](const std::string& instanceId,const std::string& role) {
    const auto response=query("findFaces",{{"featureId",instanceId}});
    EXPECT_EQ(response["status"],"ok") << response;
    for(const auto& face:response["result"]["faces"])
      if(face.value("sourceBinding",kreoda::Json::object()).value("persistentFaceId",std::string())==role)return face;
    ADD_FAILURE() << "source face missing: " << instanceId << ":" << role << " " << response;
    return kreoda::Json::object();
  };
  const auto moving=pick("ambiguous-binding-moving","box.+X");
  const auto fixed=pick("ambiguous-binding-fixed","box.+Z");
  ASSERT_FALSE(moving.empty());ASSERT_FALSE(fixed.empty());
  const kreoda::Json request={{"protocolVersion",1},{"requestId","ambiguous-binding-angle"},
      {"documentId",documentId},{"type",47},{"constraintId","ambiguous-binding-angle"},
      {"kind","angle"},{"angleDeg",0},{"movingId","ambiguous-binding-moving"},
      {"fixedId","ambiguous-binding-fixed"},{"captureRevision",kreoda::DocumentStore::instance().revision()},
      {"movingPickId",moving["persistentId"]},{"fixedPickId",fixed["persistentId"]},
      {"movingSourceBinding",moving["sourceBinding"]},{"fixedSourceBinding",fixed["sourceBinding"]}};
  const auto bytes=kreoda::handle_command(request.dump());
  const auto response=kreoda::Json::parse(bytes.begin(),bytes.end());
  ASSERT_EQ(response["status"],"ok") << response;

  kreoda::ShapeRecord source;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("ambiguous-binding-source",&source));
  gp_Trsf translation;translation.SetTranslation(gp_Vec(0,0,20));
  BRepBuilderAPI_Transform duplicate(source.shape,translation,true);
  duplicate.Build();ASSERT_TRUE(duplicate.IsDone());
  TopoDS_Compound ambiguous;
  BRep_Builder builder;builder.MakeCompound(ambiguous);
  builder.Add(ambiguous,source.shape);builder.Add(ambiguous,duplicate.Shape());
  const auto roles=kreoda::ClassifyFaceRoles(ambiguous,"Box","ambiguous-binding-source");
  std::size_t plusXCount=0;for(const auto& role:roles)if(role=="ambiguous-binding-source:box.+X")++plusXCount;
  ASSERT_EQ(plusXCount,2u) << roles.size();
  auto changed=source;changed.shape=ambiguous;
  kreoda::ShapeStore::instance().put(changed);
  kreoda::ShapeRecord movingInstance;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("ambiguous-binding-moving",&movingInstance));
  kreoda::AssemblyGeometrySelection capture;
  EXPECT_FALSE(kreoda::CaptureAssemblyGeometrySelection(movingInstance,moving["persistentId"],
      moving["sourceBinding"],&capture,&error));
  EXPECT_NE(error.find("ambiguous"),std::string::npos) << error;
  kreoda::ShapeStore::instance().put(source);
  const auto currentMoving=pick("ambiguous-binding-moving","box.+X");
  ASSERT_FALSE(currentMoving.empty());
  ASSERT_TRUE(kreoda::CaptureAssemblyGeometrySelection(movingInstance,currentMoving["persistentId"],
      currentMoving["sourceBinding"],&capture,&error)) << error;
  EXPECT_EQ(capture.type,"face");
}

TEST(AssemblyConstraints, ConflictingGeometricSetRejectsAtomicallyRegardlessOfIdOrder) {
  kreoda::DocumentStore::instance().create("assembly-conflict-geometry-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("conflict-geometry-source",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("conflict-geometry-fixed","conflict-geometry-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("conflict-geometry-moving","conflict-geometry-source",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("conflict-geometry-ground","ground","conflict-geometry-fixed","",0,0,&error)) << error;
  auto query=[&](const std::string& method,const kreoda::Json& params) {
    const auto packet=kreoda::Json{{"protocolVersion",1},{"requestId","conflict-geometry-query"},
        {"documentId","assembly-conflict-geometry-doc"},{"type",30},{"method",method},{"params",params}};
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  auto pick=[&](const std::string& instanceId) {
    const auto response=query("findFaces",{{"featureId",instanceId}});
    for(const auto& face:response["result"]["faces"])
      if(face.value("sourceBinding",kreoda::Json::object()).value("persistentFaceId",std::string())=="box.+Z")return face;
    return kreoda::Json::object();
  };
  auto send=[&](const std::string& id,const std::string& kind) {
    const auto fixed=pick("conflict-geometry-fixed");
    const auto moving=pick("conflict-geometry-moving");
    kreoda::Json request={{"protocolVersion",1},{"requestId",id},
        {"documentId","assembly-conflict-geometry-doc"},{"type",47},
        {"constraintId",id},{"kind",kind},{"movingId","conflict-geometry-moving"},
        {"fixedId","conflict-geometry-fixed"},{"captureRevision",kreoda::DocumentStore::instance().revision()},
        {"movingPickId",moving["persistentId"]},{"fixedPickId",fixed["persistentId"]},
        {"movingSourceBinding",moving["sourceBinding"]},{"fixedSourceBinding",fixed["sourceBinding"]}};
    const auto bytes=kreoda::handle_command(request.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  ASSERT_EQ(send("z-parallel","parallel")["status"],"ok");
  kreoda::ShapeRecord before;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("conflict-geometry-moving",&before));
  const auto revision=kreoda::DocumentStore::instance().revision();
  const int undos=kreoda::OcafLive::instance().AvailableUndos();

  const auto rejected=send("a-perpendicular","perpendicular");

  EXPECT_EQ(rejected["status"],"error") << rejected;
  EXPECT_NE(rejected.value("errorMessage",std::string()).find("conflicting"),std::string::npos) << rejected;
  kreoda::ShapeRecord after;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("conflict-geometry-moving",&after));
  EXPECT_TRUE(before.shape.IsSame(after.shape));
  EXPECT_EQ(before.paramsMm,after.paramsMm);
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(),undos);
  kreoda::Json document;
  ASSERT_TRUE(kreoda::ReadAssemblyDocument(&document,&error)) << error;
  EXPECT_EQ(document["constraints"].size(),2u);
  EXPECT_FALSE(document["constraints"].contains("a-perpendicular"));
  EXPECT_TRUE(kreoda::RunSessionGeometryQuery("validateDocument",kreoda::Json::object())["valid"].get<bool>());
}

TEST(AssemblyConstraints, ConcentricAxesAlignActualOffOriginBrepsAndKeepFreeSlide) {
  kreoda::DocumentStore::instance().create("assembly-concentric-doc");
  std::string error;
  auto createOffsetCylinder=[&](const std::string& id,const gp_Vec& offset) {
    if(!kreoda::CreateCylinderFeature(id,4,20,&error))return false;
    kreoda::ShapeRecord source;
    if(!kreoda::ShapeStore::instance().get(id,&source))return false;
    gp_Trsf translation;translation.SetTranslation(offset);
    BRepBuilderAPI_Transform moved(source.shape,translation,true);moved.Build();
    if(!moved.IsDone())return false;
    source.shape=moved.Shape();kreoda::ShapeStore::instance().put(source);return true;
  };
  ASSERT_TRUE(createOffsetCylinder("concentric-fixed-source",gp_Vec(2,-1,4))) << error;
  ASSERT_TRUE(createOffsetCylinder("concentric-moving-source",gp_Vec(-3,5,2))) << error;
  const std::vector<double> fixedPose={10,20,30,20,10,5};
  const std::vector<double> movingPose={2,-4,8,60,-20,30};
  ASSERT_TRUE(kreoda::CreateInstanceFeature("concentric-fixed","concentric-fixed-source",fixedPose,&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("concentric-moving","concentric-moving-source",movingPose,&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("concentric-ground","ground","concentric-fixed","",0,0,&error)) << error;
  auto query=[&](const std::string& method,const kreoda::Json& params) {
    const auto packet=kreoda::Json{{"protocolVersion",1},{"requestId","concentric-query"},
        {"documentId","assembly-concentric-doc"},{"type",30},{"method",method},{"params",params}};
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  auto pick=[&](const std::string& instanceId) {
    const auto response=query("findFaces",{{"featureId",instanceId}});
    EXPECT_EQ(response["status"],"ok") << response;
    for(const auto& face:response["result"]["faces"])
      if(face.value("surfaceType",std::string())=="cylinder"&&
         face.value("sourceBinding",kreoda::Json::object()).value("geometryKind",std::string())=="cylinder")return face;
    return kreoda::Json::object();
  };
  const auto fixedPick=pick("concentric-fixed");
  const auto movingPick=pick("concentric-moving");
  ASSERT_FALSE(fixedPick.empty());ASSERT_FALSE(movingPick.empty());
  kreoda::Json request={{"protocolVersion",1},{"requestId","concentric-create"},
      {"documentId","assembly-concentric-doc"},{"type",47},
      {"constraintId","concentric-axis-mate"},{"kind","concentric"},
      {"movingId","concentric-moving"},{"fixedId","concentric-fixed"},
      {"captureRevision",kreoda::DocumentStore::instance().revision()},
      {"movingPickId",movingPick["persistentId"]},{"fixedPickId",fixedPick["persistentId"]},
      {"movingSourceBinding",movingPick["sourceBinding"]},{"fixedSourceBinding",fixedPick["sourceBinding"]}};
  const auto bytes=kreoda::handle_command(request.dump());
  const auto response=kreoda::Json::parse(bytes.begin(),bytes.end());
  ASSERT_EQ(response["status"],"ok") << response;

  kreoda::ShapeRecord fixed,moving;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("concentric-fixed",&fixed));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("concentric-moving",&moving));
  auto axis=[](const TopoDS_Shape& shape,gp_Pnt* point,gp_Dir* direction) {
    for(TopExp_Explorer ex(shape,TopAbs_FACE);ex.More();ex.Next()) {
      const auto face=TopoDS::Face(ex.Current());
      const BRepAdaptor_Surface surface(face);
      if(surface.GetType()==GeomAbs_Cylinder) {
        *point=surface.Cylinder().Axis().Location();*direction=surface.Cylinder().Axis().Direction();return true;
      }
    }
    return false;
  };
  gp_Pnt fixedPoint,movingPoint;gp_Dir fixedDirection,movingDirection;
  ASSERT_TRUE(axis(fixed.shape,&fixedPoint,&fixedDirection));
  ASSERT_TRUE(axis(moving.shape,&movingPoint,&movingDirection));
  const gp_Vec directionCross=gp_Vec(fixedDirection).Crossed(gp_Vec(movingDirection));
  const double angle=std::atan2(directionCross.Magnitude(),std::abs(fixedDirection.Dot(movingDirection)));
  EXPECT_NEAR(angle,0,1e-8);
  const double lineDistance=gp_Vec(fixedPoint,movingPoint).Crossed(gp_Vec(fixedDirection)).Magnitude();
  EXPECT_NEAR(lineDistance,0,1e-8);
  const gp_Vec originalTranslation(movingPose[0],movingPose[1],movingPose[2]);
  const gp_Vec solvedTranslation(moving.paramsMm[0],moving.paramsMm[1],moving.paramsMm[2]);
  EXPECT_NEAR(originalTranslation.Dot(gp_Vec(fixedDirection)),solvedTranslation.Dot(gp_Vec(fixedDirection)),1e-8);

  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("concentric-world-z-distance","distance",
      "concentric-moving","concentric-fixed",2,25,&error)) << error;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("concentric-fixed",&fixed));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("concentric-moving",&moving));
  ASSERT_TRUE(axis(fixed.shape,&fixedPoint,&fixedDirection));
  ASSERT_TRUE(axis(moving.shape,&movingPoint,&movingDirection));
  EXPECT_NEAR(std::atan2(gp_Vec(fixedDirection).Crossed(gp_Vec(movingDirection)).Magnitude(),
      std::abs(fixedDirection.Dot(movingDirection))),0,1e-8);
  EXPECT_NEAR(gp_Vec(fixedPoint,movingPoint).Crossed(gp_Vec(fixedDirection)).Magnitude(),0,1e-8);
  EXPECT_NEAR(moving.paramsMm[2],fixed.paramsMm[2]+25,1e-9);
  EXPECT_TRUE(kreoda::RunSessionGeometryQuery("validateDocument",kreoda::Json::object())["valid"].get<bool>());
}

TEST(AssemblyConstraints, SketchRadiusEditKeepsConcentricMateButAxisShiftRollsBack) {
  kreoda::DocumentStore::instance().create("assembly-sketch-source-doc");
  std::string error;
  auto circleSketch=[](double centerX,double radius) {
    kreoda::SketchModel model;
    model.points={{"center",centerX,0,true}};
    model.circles={{"circle","center",radius}};
    model.constraints={{"radius",kreoda::SketchConstraintKind::Radius,{"circle"},radius}};
    return model;
  };
  ASSERT_TRUE(kreoda::CreateSketchFeature("fixed-axis-sketch","XY",circleSketch(0,5),&error)) << error;
  ASSERT_TRUE(kreoda::CreateSketchFeature("moving-axis-sketch","XY",circleSketch(0,5),&error)) << error;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("fixed-axis-solid","fixed-axis-sketch",20,&error)) << error;
  ASSERT_TRUE(kreoda::CreateExtrudeFeature("moving-axis-solid","moving-axis-sketch",20,&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("fixed-axis-instance","fixed-axis-solid",{0,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("moving-axis-instance","moving-axis-solid",{20,0,0,0,0,0},&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("fixed-axis-ground","ground","fixed-axis-instance","",0,0,&error)) << error;
  auto query=[&](const std::string& method,const kreoda::Json& params) {
    const auto packet=kreoda::Json{{"protocolVersion",1},{"requestId","sketch-axis-query"},
        {"documentId","assembly-sketch-source-doc"},{"type",30},{"method",method},{"params",params}};
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  auto pick=[&](const std::string& instanceId) {
    const auto response=query("findFaces",{{"featureId",instanceId}});
    for(const auto& face:response["result"]["faces"])
      if(face.value("surfaceType",std::string())=="cylinder")return face;
    return kreoda::Json::object();
  };
  const auto fixedPick=pick("fixed-axis-instance"),movingPick=pick("moving-axis-instance");
  ASSERT_FALSE(fixedPick.empty());ASSERT_FALSE(movingPick.empty());
  const kreoda::Json request={{"protocolVersion",1},{"requestId","sketch-axis-mate"},
      {"documentId","assembly-sketch-source-doc"},{"type",47},
      {"constraintId","sketch-axis-concentric"},{"kind","concentric"},
      {"movingId","moving-axis-instance"},{"fixedId","fixed-axis-instance"},
      {"captureRevision",kreoda::DocumentStore::instance().revision()},
      {"movingPickId",movingPick["persistentId"]},{"fixedPickId",fixedPick["persistentId"]},
      {"movingSourceBinding",movingPick["sourceBinding"]},{"fixedSourceBinding",fixedPick["sourceBinding"]}};
  const auto bytes=kreoda::handle_command(request.dump());
  const auto response=kreoda::Json::parse(bytes.begin(),bytes.end());
  ASSERT_EQ(response["status"],"ok") << response;

  auto resized=circleSketch(0,7);
  ASSERT_TRUE(kreoda::UpdateSketchFeature("moving-axis-sketch",resized,&error)) << error;
  kreoda::SketchFeature storedSketch;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("moving-axis-sketch",&storedSketch));
  EXPECT_DOUBLE_EQ(storedSketch.model.circles[0].r,7);
  EXPECT_TRUE(kreoda::RunSessionGeometryQuery("validateDocument",kreoda::Json::object())["valid"].get<bool>());

  kreoda::ShapeRecord solidBefore,instanceBefore;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("moving-axis-solid",&solidBefore));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("moving-axis-instance",&instanceBefore));
  const auto revision=kreoda::DocumentStore::instance().revision();
  const int undos=kreoda::OcafLive::instance().AvailableUndos();
  resized.points[0].x=1;
  EXPECT_FALSE(kreoda::UpdateSketchFeature("moving-axis-sketch",resized,&error));
  EXPECT_NE(error.find("sketch-axis-concentric"),std::string::npos) << error;
  ASSERT_TRUE(kreoda::SketchStore::instance().get("moving-axis-sketch",&storedSketch));
  EXPECT_DOUBLE_EQ(storedSketch.model.points[0].x,0);
  EXPECT_DOUBLE_EQ(storedSketch.model.circles[0].r,7);
  kreoda::ShapeRecord solidAfter,instanceAfter;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("moving-axis-solid",&solidAfter));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("moving-axis-instance",&instanceAfter));
  EXPECT_TRUE(solidBefore.shape.IsSame(solidAfter.shape));
  EXPECT_TRUE(instanceBefore.shape.IsSame(instanceAfter.shape));
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),revision);
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(),undos);
}

TEST(AssemblyConstraints, GimbalAndWrappedEulerPlacementsRoundTripThroughRealBrep) {
  for(const double fixedRy:{90.0,-90.0}) {
    const auto suffix=fixedRy>0?std::string("positive"):std::string("negative");
    const auto documentId="assembly-gimbal-"+suffix;
    kreoda::DocumentStore::instance().create(documentId);
    std::string error;
    ASSERT_TRUE(kreoda::CreateBoxFeature("gimbal-source-"+suffix,10,10,10,&error)) << error;
    ASSERT_TRUE(kreoda::CreateInstanceFeature("gimbal-fixed-"+suffix,"gimbal-source-"+suffix,
        {0,0,0,0,fixedRy,0},&error)) << error;
    ASSERT_TRUE(kreoda::CreateInstanceFeature("gimbal-moving-"+suffix,"gimbal-source-"+suffix,
        {0,0,0,0,0,370},&error)) << error;
    ASSERT_TRUE(kreoda::DefineAssemblyConstraint("gimbal-ground-"+suffix,"ground",
        "gimbal-fixed-"+suffix,"",0,0,&error)) << error;
    auto query=[&](const std::string& method,const kreoda::Json& params) {
      const auto packet=kreoda::Json{{"protocolVersion",1},{"requestId","gimbal-query"},
          {"documentId",documentId},{"type",30},{"method",method},{"params",params}};
      const auto bytes=kreoda::handle_command(packet.dump());
      return kreoda::Json::parse(bytes.begin(),bytes.end());
    };
    auto pick=[&](const std::string& id) {
      const auto response=query("findFaces",{{"featureId",id}});
      for(const auto& face:response["result"]["faces"])
        if(face.value("sourceBinding",kreoda::Json::object()).value("persistentFaceId",std::string())=="box.+Z")return face;
      return kreoda::Json::object();
    };
    const auto fixed=pick("gimbal-fixed-"+suffix),moving=pick("gimbal-moving-"+suffix);
    ASSERT_FALSE(fixed.empty());ASSERT_FALSE(moving.empty());
    const kreoda::Json request={{"protocolVersion",1},{"requestId","gimbal-mate"},
        {"documentId",documentId},{"type",47},{"constraintId","gimbal-parallel-"+suffix},
        {"kind","parallel"},{"movingId","gimbal-moving-"+suffix},{"fixedId","gimbal-fixed-"+suffix},
        {"captureRevision",kreoda::DocumentStore::instance().revision()},
        {"movingPickId",moving["persistentId"]},{"fixedPickId",fixed["persistentId"]},
        {"movingSourceBinding",moving["sourceBinding"]},{"fixedSourceBinding",fixed["sourceBinding"]}};
    const auto bytes=kreoda::handle_command(request.dump());
    const auto response=kreoda::Json::parse(bytes.begin(),bytes.end());
    ASSERT_EQ(response["status"],"ok") << response;
    kreoda::ShapeRecord solved;
    ASSERT_TRUE(kreoda::ShapeStore::instance().get("gimbal-moving-"+suffix,&solved));
    EXPECT_DOUBLE_EQ(solved.paramsMm[0],0);
    EXPECT_DOUBLE_EQ(solved.paramsMm[1],0);
    EXPECT_DOUBLE_EQ(solved.paramsMm[2],0);
    const auto actual=pick("gimbal-moving-"+suffix);
    const auto measured=query("measureAngle",{{"a",actual["persistentId"]},{"b",fixed["persistentId"]}});
    ASSERT_EQ(measured["status"],"ok") << measured;
    const double angle=measured["result"]["angleDeg"].get<double>();
    EXPECT_TRUE(std::abs(angle)<1e-7||std::abs(angle-180.0)<1e-7) << angle;
  }
}

TEST(AssemblyConstraints, DirectedTwoNormalAnglesConstrainGimbalAndNearPolePlacements) {
  const std::vector<double> fixedAngles={90.0,-90.0,89.999999,-89.999999};
  for(std::size_t caseIndex=0;caseIndex<fixedAngles.size();++caseIndex) {
    const auto suffix=std::to_string(caseIndex);
    const auto documentId="assembly-directed-gimbal-"+suffix;
    const auto sourceId="directed-gimbal-source-"+suffix;
    const auto fixedId="directed-gimbal-fixed-"+suffix;
    const auto movingId="directed-gimbal-moving-"+suffix;
    kreoda::DocumentStore::instance().create(documentId);
    std::string error;
    ASSERT_TRUE(kreoda::CreateBoxFeature(sourceId,10,10,10,&error)) << error;
    ASSERT_TRUE(kreoda::CreateInstanceFeature(fixedId,sourceId,{0,0,0,0,fixedAngles[caseIndex],0},&error)) << error;
    ASSERT_TRUE(kreoda::CreateInstanceFeature(movingId,sourceId,{0,0,0,0,0,370},&error)) << error;
    ASSERT_TRUE(kreoda::DefineAssemblyConstraint("directed-gimbal-ground-"+suffix,"ground",fixedId,"",0,0,&error)) << error;
    auto query=[&](const std::string& method,const kreoda::Json& params) {
      const auto packet=kreoda::Json{{"protocolVersion",1},{"requestId","directed-gimbal-query"},
          {"documentId",documentId},{"type",30},{"method",method},{"params",params}};
      const auto bytes=kreoda::handle_command(packet.dump());
      return kreoda::Json::parse(bytes.begin(),bytes.end());
    };
    auto pick=[&](const std::string& instanceId,const std::string& sourceRole) {
      const auto response=query("findFaces",{{"featureId",instanceId}});
      EXPECT_EQ(response["status"],"ok") << response;
      for(const auto& face:response["result"]["faces"])
        if(face.value("sourceBinding",kreoda::Json::object()).value("persistentFaceId",std::string())==sourceRole)return face;
      return kreoda::Json::object();
    };
    auto sendAngle=[&](const std::string& constraintId,const std::string& role) {
      // Picks are acquired per command. The second pair is fresh after the first commit.
      const auto fixed=pick(fixedId,role),moving=pick(movingId,role);
      if(fixed.empty()||moving.empty())return kreoda::Json{{"status","error"},{"errorMessage","selected source face is missing"}};
      const kreoda::Json request={{"protocolVersion",1},{"requestId",constraintId},
          {"documentId",documentId},{"type",47},{"constraintId",constraintId},{"kind","angle"},
          {"movingId",movingId},{"fixedId",fixedId},
          {"captureRevision",kreoda::DocumentStore::instance().revision()},
          {"movingPickId",moving["persistentId"]},{"fixedPickId",fixed["persistentId"]},
          {"movingSourceBinding",moving["sourceBinding"]},{"fixedSourceBinding",fixed["sourceBinding"]},
          {"angleDeg",0}};
      const auto bytes=kreoda::handle_command(request.dump());
      return kreoda::Json::parse(bytes.begin(),bytes.end());
    };

    const auto zMate=sendAngle("directed-gimbal-z-"+suffix,"box.+Z");
    ASSERT_EQ(zMate["status"],"ok") << zMate;
    const auto xMate=sendAngle("directed-gimbal-x-"+suffix,"box.+X");
    ASSERT_EQ(xMate["status"],"ok") << xMate;

    for(const auto& role:{std::string("box.+Z"),std::string("box.+X")}) {
      const auto fixed=pick(fixedId,role),moving=pick(movingId,role);
      ASSERT_FALSE(fixed.empty());ASSERT_FALSE(moving.empty());
      const auto measured=query("measureAngle",{{"a",moving["persistentId"]},{"b",fixed["persistentId"]}});
      ASSERT_EQ(measured["status"],"ok") << measured;
      EXPECT_NEAR(measured["result"]["angleDeg"].get<double>(),0,1e-7) << "source role " << role;
    }
    kreoda::ShapeRecord solved;
    ASSERT_TRUE(kreoda::ShapeStore::instance().get(movingId,&solved));
    EXPECT_DOUBLE_EQ(solved.paramsMm[0],0);
    EXPECT_DOUBLE_EQ(solved.paramsMm[1],0);
    EXPECT_DOUBLE_EQ(solved.paramsMm[2],0);
    EXPECT_TRUE(kreoda::RunSessionGeometryQuery("validateDocument",kreoda::Json::object())["valid"].get<bool>());
  }
}

TEST(AssemblyConstraints, IndexedCavityFaceAndCircularEdgeBindingSurviveSaveOpenAndFailClosed) {
  const std::string documentId="assembly-indexed-cavity-doc";
  kreoda::DocumentStore::instance().create(documentId);
  std::string error;
  auto createImportedCavity=[&](const std::string& id) {
    const auto block=BRepPrimAPI_MakeBox(20,30,10).Shape();
    const auto drill=BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(10,15,-1),gp_Dir(0,0,1)),3,12).Shape();
    BRepAlgoAPI_Cut cavity(block,drill);
    cavity.Build();
    return cavity.IsDone()&&kreoda::CommitSingleFeature(id,"Imported",{},{},"",cavity.Shape(),&error);
  };
  ASSERT_TRUE(createImportedCavity("indexed-fixed-cavity")) << error;
  ASSERT_TRUE(createImportedCavity("indexed-moving-cavity")) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("indexed-fixed","indexed-fixed-cavity",{5,8,3,15,-20,25},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("indexed-moving","indexed-moving-cavity",{30,-12,42,-35,40,70},&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("indexed-ground","ground","indexed-fixed","",0,0,&error)) << error;
  auto query=[&](const std::string& method,const kreoda::Json& params) {
    const auto packet=kreoda::Json{{"protocolVersion",1},{"requestId","indexed-cavity-query"},
        {"documentId",documentId},{"type",30},{"method",method},{"params",params}};
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  auto pickWall=[&](const std::string& instanceId) {
    const auto response=query("findFaces",{{"featureId",instanceId}});
    EXPECT_EQ(response["status"],"ok") << response;
    for(const auto& face:response["result"]["faces"])
      if(face.value("sourceBinding",kreoda::Json::object()).value("persistentFaceId",std::string())=="wall.0")return face;
    ADD_FAILURE() << "indexed cavity wall.0 missing from instance query: " << response;
    return kreoda::Json::object();
  };
  auto pickWallCircle=[&](const std::string& instanceId) {
    const auto response=query("findEdges",{{"featureId",instanceId}});
    EXPECT_EQ(response["status"],"ok") << response;
    for(const auto& edge:response["result"]["edges"]) {
      const auto binding=edge.value("sourceBinding",kreoda::Json::object());
      if(binding.value("type",std::string())=="edge"&&binding.value("geometryKind",std::string())=="circle"&&
         binding.value("persistentEdgeId",std::string()).find("wall.0")!=std::string::npos)return edge;
    }
    ADD_FAILURE() << "indexed cavity circular edge for wall.0 missing from instance query: " << response;
    return kreoda::Json::object();
  };
  const auto moving=pickWall("indexed-moving");
  const auto fixed=pickWallCircle("indexed-fixed");
  ASSERT_FALSE(moving.empty());ASSERT_FALSE(fixed.empty());
  ASSERT_EQ(moving["sourceBinding"]["type"],"face");
  ASSERT_EQ(fixed["sourceBinding"]["type"],"edge");
  ASSERT_EQ(moving["sourceBinding"]["persistentFaceId"],"wall.0");
  ASSERT_NE(fixed["sourceBinding"]["persistentEdgeId"].get<std::string>().find("wall.0"),std::string::npos);
  const kreoda::Json mate={{"protocolVersion",1},{"requestId","indexed-cavity-concentric"},
      {"documentId",documentId},{"type",47},{"constraintId","indexed-cavity-concentric"},
      {"kind","concentric"},{"movingId","indexed-moving"},{"fixedId","indexed-fixed"},
      {"captureRevision",kreoda::DocumentStore::instance().revision()},
      {"movingPickId",moving["persistentId"]},{"fixedPickId",fixed["persistentId"]},
      {"movingSourceBinding",moving["sourceBinding"]},{"fixedSourceBinding",fixed["sourceBinding"]}};
  auto bytes=kreoda::handle_command(mate.dump());
  const auto response=kreoda::Json::parse(bytes.begin(),bytes.end());
  ASSERT_EQ(response["status"],"ok") << response;
  kreoda::Json stored;
  ASSERT_TRUE(kreoda::ReadAssemblyDocument(&stored,&error)) << error;
  const auto originalDocument=stored;
  EXPECT_TRUE(stored["constraints"]["indexed-cavity-concentric"]["movingSourceBinding"].contains("selectionEntry"));
  EXPECT_TRUE(stored["constraints"]["indexed-cavity-concentric"]["fixedSourceBinding"].contains("selectionEntry"));
  EXPECT_FALSE(stored["constraints"]["indexed-cavity-concentric"].contains("captureRevision"));
  EXPECT_FALSE(stored["constraints"]["indexed-cavity-concentric"].contains("movingPickId"));

  kreoda::ShapeRecord movingInstance,fixedInstance;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("indexed-moving",&movingInstance));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("indexed-fixed",&fixedInstance));
  TopoDS_Face movingWall,fixedWall;
  ASSERT_TRUE(kreoda::FindFaceByRole(movingInstance.shape,"indexed-moving","Instance","wall.0",&movingWall));
  ASSERT_TRUE(kreoda::FindFaceByRole(fixedInstance.shape,"indexed-fixed","Instance","wall.0",&fixedWall));
  const auto movingAxis=BRepAdaptor_Surface(movingWall).Cylinder().Axis();
  const auto fixedAxis=BRepAdaptor_Surface(fixedWall).Cylinder().Axis();
  gp_Vec movingDirection(movingAxis.Direction()),fixedDirection(fixedAxis.Direction());
  const double axisAngle=std::atan2(movingDirection.Crossed(fixedDirection).Magnitude(),
                                    std::abs(movingDirection.Dot(fixedDirection)));
  const double axisDistance=gp_Vec(movingAxis.Location(),fixedAxis.Location()).Crossed(fixedDirection).Magnitude();
  EXPECT_NEAR(axisAngle,0,1e-8);
  EXPECT_NEAR(axisDistance,0,1e-7);

  auto rpc=[&](int type,const std::string& requestId,const std::string& path="") {
    kreoda::Json packet={{"protocolVersion",1},{"requestId",requestId},{"documentId",documentId},{"type",type}};
    if(!path.empty())packet["path"]=path;
    const auto commandBytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(commandBytes.begin(),commandBytes.end());
  };
  const auto savePath=(std::filesystem::temp_directory_path()/"kreoda-assembly-indexed-cavity-mate.icad").string();
  ASSERT_EQ(rpc(10,"indexed-cavity-save",savePath)["status"],"ok");
  ASSERT_EQ(rpc(2,"indexed-cavity-reset")["status"],"ok");
  ASSERT_EQ(rpc(11,"indexed-cavity-open",savePath)["status"],"ok");
  ASSERT_TRUE(kreoda::ReapplyAssemblyConstraints(&error)) << error;
  std::vector<kreoda::AssemblyConstraintIssue> issues;
  ASSERT_TRUE(kreoda::ReadAssemblyConstraintIssues(&issues,&error)) << error;

  // The resolver must reject an entry borrowed from the other source owner.
  auto forged=originalDocument;
  forged["constraints"]["indexed-cavity-concentric"]["movingSourceBinding"]["selectionEntry"]=
      forged["constraints"]["indexed-cavity-concentric"]["fixedSourceBinding"]["selectionEntry"];
  ASSERT_TRUE(kreoda::OcafLive::instance().WriteAssemblyConstraints(forged.dump(),&error)) << error;
  EXPECT_FALSE(kreoda::ReadAssemblyConstraintIssues(&issues,&error));
  EXPECT_NE(error.find("moving source binding"),std::string::npos) << error;
  ASSERT_TRUE(kreoda::OcafLive::instance().WriteAssemblyConstraints(originalDocument.dump(),&error)) << error;
  ASSERT_TRUE(kreoda::ReadAssemblyConstraintIssues(&issues,&error)) << error;

  // A missing selector on an indexed role is a repair error, not a role re-pick.
  auto dropped=originalDocument;
  dropped["constraints"]["indexed-cavity-concentric"]["movingSourceBinding"].erase("selectionEntry");
  ASSERT_TRUE(kreoda::OcafLive::instance().WriteAssemblyConstraints(dropped.dump(),&error)) << error;
  EXPECT_FALSE(kreoda::ReadAssemblyConstraintIssues(&issues,&error));
  EXPECT_NE(error.find("selectionEntry"),std::string::npos) << error;
  ASSERT_TRUE(kreoda::OcafLive::instance().WriteAssemblyConstraints(originalDocument.dump(),&error)) << error;
  ASSERT_TRUE(kreoda::ReadAssemblyConstraintIssues(&issues,&error)) << error;

  // Simulate source topology loss: the saved TNaming face still resolves, but is
  // no longer a member of the current source B-Rep. Indexed ordinal fallback fails.
  kreoda::ShapeRecord movingSource;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("indexed-moving-cavity",&movingSource));
  TopoDS_Shape replacement;
  ASSERT_TRUE(kreoda::BuildBoxShape(20,30,10,&replacement,&error)) << error;
  auto missingWall=movingSource;
  missingWall.shape=replacement;
  kreoda::ShapeStore::instance().put(missingWall);
  EXPECT_FALSE(kreoda::ReadAssemblyConstraintIssues(&issues,&error));
  EXPECT_NE(error.find("indexed source binding needs repair"),std::string::npos) << error;
  kreoda::ShapeStore::instance().put(movingSource);
  ASSERT_TRUE(kreoda::ReadAssemblyConstraintIssues(&issues,&error)) << error;
  EXPECT_TRUE(kreoda::RunSessionGeometryQuery("validateDocument",kreoda::Json::object())["valid"].get<bool>());
  std::error_code cleanupError;
  std::filesystem::remove(savePath,cleanupError);
}

TEST(AssemblyConstraints, HoleIndexedAndSemanticFaceBindingsSurviveSaveOpen) {
  const std::string documentId="assembly-indexed-hole-doc";
  kreoda::DocumentStore::instance().create(documentId);
  std::string error;
  auto createHoledBody=[&](const std::string& bodyId,const std::string& holeId) {
    return kreoda::CreateBoxFeature(bodyId,20,30,10,&error)&&
        kreoda::CreateHoleFeature(holeId,bodyId,"box.+Z",10,15,6,"throughAll",0,&error);
  };
  ASSERT_TRUE(createHoledBody("hole-fixed-block","hole-fixed-source")) << error;
  ASSERT_TRUE(createHoledBody("hole-moving-block","hole-moving-source")) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("hole-fixed","hole-fixed-source",{5,8,3,15,-20,25},&error)) << error;
  ASSERT_TRUE(kreoda::CreateInstanceFeature("hole-moving","hole-moving-source",{30,-12,42,-35,40,70},&error)) << error;
  ASSERT_TRUE(kreoda::DefineAssemblyConstraint("hole-ground","ground","hole-fixed","",0,0,&error)) << error;

  auto query=[&](const std::string& method,const kreoda::Json& params) {
    const auto packet=kreoda::Json{{"protocolVersion",1},{"requestId","indexed-hole-query"},
        {"documentId",documentId},{"type",30},{"method",method},{"params",params}};
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  auto pickFace=[&](const std::string& instanceId,const std::string& role) {
    const auto response=query("findFaces",{{"featureId",instanceId}});
    EXPECT_EQ(response["status"],"ok") << response;
    for(const auto& face:response["result"]["faces"])
      if(face.value("sourceBinding",kreoda::Json::object()).value("persistentFaceId",std::string())==role)return face;
    ADD_FAILURE() << "Hole source face role missing from instance query: " << role << " " << response;
    return kreoda::Json::object();
  };
  const auto movingWall=pickFace("hole-moving","wall.0");
  const auto fixedWall=pickFace("hole-fixed","wall.0");
  const auto movingTop=pickFace("hole-moving","box.+Z");
  const auto fixedTop=pickFace("hole-fixed","box.+Z");
  ASSERT_FALSE(movingWall.empty());ASSERT_FALSE(fixedWall.empty());
  ASSERT_FALSE(movingTop.empty());ASSERT_FALSE(fixedTop.empty());
  ASSERT_EQ(movingWall["sourceBinding"]["geometryKind"],"cylinder");
  ASSERT_EQ(movingTop["sourceBinding"]["geometryKind"],"plane");

  auto constrainParallel=[&](const std::string& id,const kreoda::Json& moving,const kreoda::Json& fixed) {
    const kreoda::Json request={{"protocolVersion",1},{"requestId",id},{"documentId",documentId},
        {"type",47},{"constraintId",id},{"kind","parallel"},{"movingId","hole-moving"},{"fixedId","hole-fixed"},
        {"captureRevision",kreoda::DocumentStore::instance().revision()},
        {"movingPickId",moving["persistentId"]},{"fixedPickId",fixed["persistentId"]},
        {"movingSourceBinding",moving["sourceBinding"]},{"fixedSourceBinding",fixed["sourceBinding"]}};
    const auto bytes=kreoda::handle_command(request.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  ASSERT_EQ(constrainParallel("hole-wall-parallel",movingWall,fixedWall)["status"],"ok");
  ASSERT_EQ(constrainParallel("hole-semantic-parallel",movingTop,fixedTop)["status"],"ok");
  kreoda::Json originalDocument;
  ASSERT_TRUE(kreoda::ReadAssemblyDocument(&originalDocument,&error)) << error;
  for(const auto* id:{"hole-wall-parallel","hole-semantic-parallel"}) {
    EXPECT_TRUE(originalDocument["constraints"][id]["movingSourceBinding"].contains("selectionEntry"));
    EXPECT_TRUE(originalDocument["constraints"][id]["fixedSourceBinding"].contains("selectionEntry"));
  }

  auto rpc=[&](int type,const std::string& requestId,const std::string& path="") {
    kreoda::Json packet={{"protocolVersion",1},{"requestId",requestId},{"documentId",documentId},{"type",type}};
    if(!path.empty())packet["path"]=path;
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  const auto savePath=(std::filesystem::temp_directory_path()/"kreoda-assembly-indexed-hole-mates.icad").string();
  ASSERT_EQ(rpc(10,"indexed-hole-save",savePath)["status"],"ok");
  ASSERT_EQ(rpc(2,"indexed-hole-reset")["status"],"ok");
  ASSERT_EQ(rpc(11,"indexed-hole-open",savePath)["status"],"ok");
  ASSERT_TRUE(kreoda::ReapplyAssemblyConstraints(&error)) << error;
  std::vector<kreoda::AssemblyConstraintIssue> issues;
  ASSERT_TRUE(kreoda::ReadAssemblyConstraintIssues(&issues,&error)) << error;
  std::error_code cleanupError;
  std::filesystem::remove(savePath,cleanupError);
}
