#include <gtest/gtest.h>
#include "features/configurations/configurations.h"
#include "document/document_store.h"
#include "features/primitives/primitives.h"
#include "protocol/dispatcher.h"
#include "protocol/json_fields.h"
#include "rpc_text.h"
#include <filesystem>

TEST(Configurations, NamedOverridesPersistAndSwitchAsOneUndo) {
  kreoda::DocumentStore::instance().create("configuration-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("configured-box",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("configured-second",5,5,5,&error)) << error;
  auto wire=[](int type,const kreoda::Json& fields,const std::string& id) {
    kreoda::Json packet={{"protocolVersion",1},{"requestId",id},
      {"documentId","configuration-doc"},{"type",type}};
    packet.update(fields);
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  const auto beforeDefine=wire(42,kreoda::Json::object(),"config-query-before-define")["revision"].get<int64_t>();
  const auto definedSmall=wire(40,{{"name","Small"},{"overrides",{{"configured-box",{{"widthMm",10},{"heightMm",10}}}}}},"config-define-wire");
  ASSERT_EQ(definedSmall["status"],"ok") << definedSmall;
  EXPECT_EQ(definedSmall["revision"],beforeDefine+1);
  ASSERT_TRUE(kreoda::DefineConfiguration("Medium",{{"configured-box",{{"widthMm",20},{"heightMm",20}}},
    {"configured-second",{{"widthMm",8}}}},&error)) << error;
  ASSERT_TRUE(kreoda::DefineConfiguration("Large",{{"configured-box",{{"widthMm",30},{"heightMm",30}}}},&error)) << error;
  const auto initial=wire(42,kreoda::Json::object(),"config-query-before");
  ASSERT_EQ(initial["status"],"ok") << initial;
  EXPECT_EQ(initial["named"].size(),3);
  const auto beforeRevision=initial["revision"];
  const auto invalid=wire(40,{{"name","Invalid"},{"overrides",{{"configured-box",{{"widthMm",-1}}}}}},"config-invalid-wire");
  EXPECT_EQ(invalid["status"],"error");
  const auto afterInvalid=wire(42,kreoda::Json::object(),"config-query-after");
  EXPECT_EQ(afterInvalid["revision"],beforeRevision);
  EXPECT_EQ(afterInvalid["named"],initial["named"]);
  EXPECT_EQ(wire(42,kreoda::Json::object(),"config-query-repeat")["revision"],beforeRevision);
#if KREODA_WITH_FLATBUFFERS
  const char* meshRequest=R"({"protocolVersion":1,"requestId":"config-mesh","documentId":"configuration-doc","type":12,"featureId":"configured-box","lod":1})";
  const auto cached=kreoda::handle_command(meshRequest);
  const auto* beforeMesh=kreoda_test::meshRoot(cached);
  ASSERT_NE(beforeMesh,nullptr);
  EXPECT_NEAR(beforeMesh->volume_mm3(),1000,1e-5);
#endif
  const auto activated=wire(41,{{"name","Medium"}},"config-activate-wire");
  ASSERT_EQ(activated["status"],"ok") << activated;
  EXPECT_EQ(activated["active"],"Medium");
  const auto activeRevision=beforeRevision.get<int64_t>()+1;
  EXPECT_EQ(activated["revision"],activeRevision);
  const auto unchanged=wire(41,{{"name","Medium"}},"config-activate-noop");
  ASSERT_EQ(unchanged["status"],"ok") << unchanged;
  EXPECT_EQ(unchanged["revision"],activeRevision);
#if KREODA_WITH_FLATBUFFERS
  const auto refreshed=kreoda::handle_command(meshRequest);
  const auto* afterMesh=kreoda_test::meshRoot(refreshed);
  ASSERT_NE(afterMesh,nullptr);
  EXPECT_EQ(afterMesh->revision(),activeRevision);
  EXPECT_NEAR(afterMesh->volume_mm3(),4000,1e-5);
#endif
  kreoda::ShapeRecord rec;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("configured-box",&rec));
  EXPECT_NEAR(rec.volumeMm3,4000,1e-5);
  EXPECT_EQ(rec.featureId,"configured-box");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("configured-second",&rec));
  EXPECT_NEAR(rec.volumeMm3,200,1e-5);
  auto rpc=[](int type,const std::string& requestId,const std::string& path="") {
    kreoda::Json packet={{"protocolVersion",1},{"requestId",requestId},
                         {"documentId","configuration-doc"},{"type",type}};
    if (!path.empty()) packet["path"]=path;
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  ASSERT_EQ(rpc(8,"config-undo")["status"],"ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("configured-box",&rec));
  EXPECT_NEAR(rec.volumeMm3,1000,1e-5);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("configured-second",&rec));
  EXPECT_NEAR(rec.volumeMm3,125,1e-5);
  ASSERT_EQ(rpc(9,"config-redo")["status"],"ok");
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("configured-box",&rec));
  EXPECT_NEAR(rec.volumeMm3,4000,1e-5);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("configured-second",&rec));
  EXPECT_NEAR(rec.volumeMm3,200,1e-5);
  const auto path=(std::filesystem::temp_directory_path()/"kreoda-config-test.icad").generic_string();
  ASSERT_EQ(rpc(10,"config-save",path)["status"],"ok");
  ASSERT_EQ(rpc(2,"config-new")["status"],"ok");
  ASSERT_EQ(rpc(11,"config-open",path)["status"],"ok");
  nlohmann::json doc;
  ASSERT_TRUE(kreoda::ReadConfigurationDocument(&doc,&error)) << error;
  EXPECT_EQ(doc["active"],"Medium");
  EXPECT_EQ(doc["named"].size(),3);
  ASSERT_TRUE(kreoda::ActivateConfiguration("Large",&error)) << error;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("configured-box",&rec));
  EXPECT_NEAR(rec.volumeMm3,9000,1e-5);
  EXPECT_FALSE(kreoda::DefineConfiguration("Broken",{{"configured-box",{{"widthMm",-5}}}},&error));
  EXPECT_FALSE(kreoda::ActivateConfiguration("Missing",&error));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("configured-box",&rec));
  EXPECT_NEAR(rec.volumeMm3,9000,1e-5);
  ASSERT_TRUE(kreoda::ReadConfigurationDocument(&doc,&error));
  EXPECT_EQ(doc["active"],"Large");
  EXPECT_FALSE(doc["named"].contains("Broken"));
  std::filesystem::remove(path);
}
