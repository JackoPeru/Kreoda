#include <gtest/gtest.h>
#include <filesystem>
#include "features/direct/offset_face.h"
#include "features/primitives/primitives.h"
#include "document/document_store.h"
#include "exchange/step_exchange.h"
#include "protocol/dispatcher.h"
#include "protocol/json_fields.h"

TEST(DirectFace, ImportedStepPlanarFacePushHistoryUndoSaveOpenRebuild) {
  namespace fs=std::filesystem;
  kreoda::DocumentStore::instance().create("direct-face-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("direct-export-box",20,10,5,&error)) << error;
  const auto step=(fs::temp_directory_path()/"kreoda-direct-face.step").string();
  ASSERT_TRUE(kreoda::ExportStep(step,&error)) << error;
  kreoda::DocumentStore::instance().create("direct-face-doc");
  std::vector<std::string> ids;
  ASSERT_TRUE(kreoda::ImportStep(step,&ids,&error)) << error;
  ASSERT_EQ(ids.size(),1u);
  kreoda::ShapeRecord imported;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(ids[0],&imported));
  ASSERT_EQ(imported.type,"StepImport");
  const auto roles=kreoda::ClassifyFaceRoles(imported.shape,imported.type,imported.featureId);
  ASSERT_FALSE(roles.empty());
  std::string chosen;
  for (const auto& role:roles) {
    if (kreoda::HasIndexedTopologyRole(role)) continue;
    TopoDS_Shape preview;
    std::string local;
    if (kreoda::BuildOutwardFacePush(imported,role,3,&preview,&local)) {
      chosen=role;
      break;
    }
  }
  ASSERT_FALSE(chosen.empty());
  EXPECT_FALSE(kreoda::CreateOutwardFacePushFeature("direct-bad",ids[0],chosen,-3,&error));
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("direct-bad"));
  auto createWire=[&](const kreoda::Json& fields,const std::string& requestId) {
    kreoda::Json packet={{"protocolVersion",1},{"requestId",requestId},
      {"documentId","direct-face-doc"},{"type",43}};
    packet.update(fields);
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  const kreoda::Json args={{"featureId","direct-face-push"},
    {"sourceFeatureId",ids[0]},{"faceRole",chosen},{"distanceMm",3}};
  const auto badOwner=createWire({{"featureId","wrong-owner"},{"sourceFeatureId",ids[0]},
    {"faceRole","another-feature:box.+Z"},{"distanceMm",3}},"direct-wrong-owner");
  EXPECT_EQ(badOwner["status"],"error");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("wrong-owner"));
  const auto created=createWire(args,"direct-face-create-wire");
  ASSERT_EQ(created["status"],"ok") << created;
  kreoda::ShapeRecord pushed;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("direct-face-push",&pushed));
  EXPECT_GT(pushed.volumeMm3,imported.volumeMm3);
  EXPECT_EQ(pushed.dependsOn,(std::vector<std::string>{ids[0]}));
  EXPECT_EQ(pushed.refExtra,chosen.substr(chosen.find(':')+1));
  auto rpc=[](int type,const std::string& requestId,const std::string& path="") {
    kreoda::Json packet={{"protocolVersion",1},{"requestId",requestId},
      {"documentId","direct-face-doc"},{"type",type}};
    if (!path.empty()) packet["path"]=path;
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  ASSERT_EQ(rpc(8,"direct-face-undo")["status"],"ok");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("direct-face-push"));
  ASSERT_EQ(rpc(9,"direct-face-redo")["status"],"ok");
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("direct-face-push"));
  const auto path=(fs::temp_directory_path()/"kreoda-direct-face.icad").string();
  ASSERT_EQ(rpc(10,"direct-face-save",path)["status"],"ok");
  ASSERT_EQ(rpc(2,"direct-face-new")["status"],"ok");
  ASSERT_EQ(rpc(11,"direct-face-open",path)["status"],"ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("direct-face-push",&pushed));
  const auto before=pushed.volumeMm3;
  ASSERT_TRUE(kreoda::RebuildOutwardFacePushFromStore("direct-face-push",&error)) << error;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("direct-face-push",&pushed));
  EXPECT_NEAR(pushed.volumeMm3,before,1e-5);
  fs::remove(path); fs::remove(step);
}

TEST(DirectFace, ImportedStepInwardFacePocketPublicHistoryUndoSaveOpenRebuild) {
  namespace fs=std::filesystem;
  kreoda::DocumentStore::instance().create("inward-face-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("inward-source",20,10,5,&error))<<error;
  const auto step=(fs::temp_directory_path()/"kreoda-inward-face.step").string();
  ASSERT_TRUE(kreoda::ExportStep(step,&error))<<error;
  kreoda::DocumentStore::instance().create("inward-face-doc");
  std::vector<std::string> ids;
  ASSERT_TRUE(kreoda::ImportStep(step,&ids,&error))<<error;
  ASSERT_EQ(ids.size(),1u);
  kreoda::ShapeRecord imported;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get(ids[0],&imported));
  std::string role;
  for(const auto& candidate:kreoda::ClassifyFaceRoles(imported.shape,imported.type,imported.featureId)) {
    if(kreoda::HasIndexedTopologyRole(candidate))continue;
    TopoDS_Shape preview;
    if(kreoda::BuildInwardFacePocket(imported,candidate,2,&preview,&error)) {
      role=candidate;break;
    }
  }
  ASSERT_FALSE(role.empty())<<error;
  auto rpc=[](kreoda::Json packet) {
    packet["protocolVersion"]=1;
    packet["documentId"]="inward-face-doc";
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  const auto malformed=rpc({{"type",45},{"requestId","bad-depth"},
      {"featureId","bad-inward"},{"sourceFeatureId",ids[0]},
      {"faceRole",role},{"distanceMm",-2}});
  EXPECT_EQ(malformed["status"],"error");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("bad-inward"));
  const auto wrong=rpc({{"type",45},{"requestId","bad-owner"},
      {"featureId","bad-owner"},{"sourceFeatureId",ids[0]},
      {"faceRole","another-feature:box.+Z"},{"distanceMm",2}});
  EXPECT_EQ(wrong["status"],"error");
  const auto created=rpc({{"type",45},{"requestId","inward-create"},
      {"featureId","inward-pocket"},{"sourceFeatureId",ids[0]},
      {"faceRole",role},{"distanceMm",2}});
  ASSERT_EQ(created["status"],"ok")<<created;
  kreoda::ShapeRecord pocket;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("inward-pocket",&pocket));
  EXPECT_LT(pocket.volumeMm3,imported.volumeMm3);
  EXPECT_GT(pocket.volumeMm3,0);
  EXPECT_EQ(pocket.dependsOn,(std::vector<std::string>{ids[0]}));
  EXPECT_EQ(pocket.type,"InwardFacePocket");
  ASSERT_EQ(rpc({{"type",8},{"requestId","inward-undo"}})["status"],"ok");
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("inward-pocket"));
  ASSERT_EQ(rpc({{"type",9},{"requestId","inward-redo"}})["status"],"ok");
  const auto path=(fs::temp_directory_path()/"kreoda-inward-face.icad").string();
  ASSERT_EQ(rpc({{"type",10},{"requestId","inward-save"},{"path",path}})["status"],"ok");
  ASSERT_EQ(rpc({{"type",2},{"requestId","inward-new"}})["status"],"ok");
  ASSERT_EQ(rpc({{"type",11},{"requestId","inward-open"},{"path",path}})["status"],"ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("inward-pocket",&pocket));
  const auto volume=pocket.volumeMm3;
  ASSERT_TRUE(kreoda::RebuildInwardFacePocketFromStore("inward-pocket",&error))<<error;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("inward-pocket",&pocket));
  EXPECT_NEAR(pocket.volumeMm3,volume,1e-5);
  fs::remove(path);fs::remove(step);
}
