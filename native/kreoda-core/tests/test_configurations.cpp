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
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("configured-second",&rec));
  EXPECT_NEAR(rec.volumeMm3,125,1e-5); // Medium's width override must not leak.
  EXPECT_FALSE(kreoda::DefineConfiguration("Broken",{{"configured-box",{{"widthMm",-5}}}},&error));
  EXPECT_FALSE(kreoda::ActivateConfiguration("Missing",&error));
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("configured-box",&rec));
  EXPECT_NEAR(rec.volumeMm3,9000,1e-5);
  ASSERT_TRUE(kreoda::ReadConfigurationDocument(&doc,&error));
  EXPECT_EQ(doc["active"],"Large");
  EXPECT_FALSE(doc["named"].contains("Broken"));
  std::filesystem::remove(path);
}

TEST(Configurations, SparseSwitchRestoresBaselineThroughUndoRedoSaveAndRedefinition) {
  kreoda::DocumentStore::instance().create("configuration-sparse-doc");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("sparse-box",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("sparse-second",5,5,5,&error)) << error;

  ASSERT_TRUE(kreoda::DefineConfiguration("A",{
    {"sparse-box",{{"widthMm",20}}},
    {"sparse-second",{{"widthMm",8}}}},&error)) << error;
  ASSERT_TRUE(kreoda::DefineConfiguration("B",{
    {"sparse-box",{{"heightMm",30}}}},&error)) << error;

  auto check=[](const char* id,double width,double height,double depth) {
    kreoda::ShapeRecord rec;
    ASSERT_TRUE(kreoda::ShapeStore::instance().get(id,&rec));
    ASSERT_EQ(rec.paramsMm.size(),3u);
    EXPECT_DOUBLE_EQ(rec.paramsMm[0],width);
    EXPECT_DOUBLE_EQ(rec.paramsMm[1],height);
    EXPECT_DOUBLE_EQ(rec.paramsMm[2],depth);
    EXPECT_NEAR(rec.volumeMm3,width*height*depth,1e-5);
  };
  auto wire=[](int type,const std::string& id,const std::string& path="") {
    kreoda::Json packet={{"protocolVersion",1},{"requestId",id},
                         {"documentId","configuration-sparse-doc"},{"type",type}};
    if (!path.empty()) packet["path"]=path;
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  const auto before=wire(42,"sparse-query-before")["revision"].get<int64_t>();
  ASSERT_TRUE(kreoda::ActivateConfiguration("A",&error)) << error;
  check("sparse-box",20,10,10);
  check("sparse-second",8,5,5);
  EXPECT_EQ(wire(42,"sparse-query-A")["revision"],before+1);

  ASSERT_TRUE(kreoda::ActivateConfiguration("B",&error)) << error;
  check("sparse-box",10,30,10);
  check("sparse-second",5,5,5);
  const auto activeB=wire(42,"sparse-query-B");
  EXPECT_EQ(activeB["active"],"B");
  EXPECT_EQ(activeB["revision"],before+2);
  ASSERT_EQ(wire(8,"sparse-undo")["status"],"ok");
  check("sparse-box",20,10,10);
  check("sparse-second",8,5,5);
  EXPECT_EQ(wire(42,"sparse-undo-query")["active"],"A");
  ASSERT_EQ(wire(9,"sparse-redo")["status"],"ok");
  check("sparse-box",10,30,10);
  check("sparse-second",5,5,5);

  ASSERT_TRUE(kreoda::ActivateConfiguration("",&error)) << error;
  check("sparse-box",10,10,10);
  check("sparse-second",5,5,5);
  EXPECT_EQ(wire(42,"sparse-base-query")["active"],"");
  ASSERT_EQ(wire(8,"sparse-base-undo")["status"],"ok");
  check("sparse-box",10,30,10);
  EXPECT_EQ(wire(42,"sparse-base-undone")["active"],"B");
  ASSERT_EQ(wire(9,"sparse-base-redo")["status"],"ok");
  check("sparse-box",10,10,10);
  EXPECT_EQ(wire(42,"sparse-base-redone")["active"],"");
  ASSERT_TRUE(kreoda::ActivateConfiguration("B",&error)) << error;
  check("sparse-box",10,30,10);

  const auto path=(std::filesystem::temp_directory_path()/"kreoda-config-sparse-switch.icad").generic_string();
  ASSERT_EQ(wire(10,"sparse-save",path)["status"],"ok");
  ASSERT_EQ(wire(2,"sparse-new")["status"],"ok");
  ASSERT_EQ(wire(11,"sparse-open",path)["status"],"ok");
  nlohmann::json doc;
  ASSERT_TRUE(kreoda::ReadConfigurationDocument(&doc,&error)) << error;
  ASSERT_EQ(doc["active"],"B");
  ASSERT_TRUE(doc.contains("base"));
  EXPECT_EQ(doc["base"]["sparse-box"]["widthMm"],10);
  EXPECT_EQ(doc["base"]["sparse-box"]["heightMm"],10);
  EXPECT_EQ(doc["base"]["sparse-second"]["widthMm"],5);
  check("sparse-box",10,30,10);
  check("sparse-second",5,5,5);
  ASSERT_TRUE(kreoda::ActivateConfiguration("",&error)) << error;
  check("sparse-box",10,10,10);
  ASSERT_TRUE(kreoda::ActivateConfiguration("A",&error)) << error;
  check("sparse-box",20,10,10);
  check("sparse-second",8,5,5);
  ASSERT_TRUE(kreoda::ActivateConfiguration("B",&error)) << error;
  check("sparse-box",10,30,10);
  check("sparse-second",5,5,5);

  // Redefining the already active configuration must apply its new sparse set.
  const auto beforeRedefine=wire(42,"sparse-before-redefine")["revision"].get<int64_t>();
  ASSERT_TRUE(kreoda::DefineConfiguration("B",{
    {"sparse-box",{{"widthMm",40}}}},&error)) << error;
  check("sparse-box",40,10,10);
  check("sparse-second",5,5,5);
  EXPECT_EQ(wire(42,"sparse-redefined")["revision"],beforeRedefine+1);
  ASSERT_EQ(wire(8,"sparse-redefine-undo")["status"],"ok");
  check("sparse-box",10,30,10);
  EXPECT_EQ(wire(42,"sparse-redefine-undone")["named"]["B"]["sparse-box"]["heightMm"],30);
  ASSERT_EQ(wire(9,"sparse-redefine-redo")["status"],"ok");
  check("sparse-box",40,10,10);
  EXPECT_EQ(wire(42,"sparse-redefine-redone")["active"],"B");
  std::filesystem::remove(path);
}

TEST(Configurations, LegacyActiveWithoutBaselineRejectsSwitchWithoutMutation) {
  kreoda::DocumentStore::instance().create("configuration-legacy-active");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("legacy-active-box",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::DefineConfiguration("A",{{"legacy-active-box",{{"widthMm",20}}}},&error)) << error;
  ASSERT_TRUE(kreoda::DefineConfiguration("B",{{"legacy-active-box",{{"heightMm",30}}}},&error)) << error;
  ASSERT_TRUE(kreoda::ActivateConfiguration("A",&error)) << error;
  kreoda::ShapeRecord rec;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("legacy-active-box",&rec));
  EXPECT_DOUBLE_EQ(rec.paramsMm[0],20);

  const auto beforeInvalid=kreoda::DocumentStore::instance().revision();
  EXPECT_FALSE(kreoda::DefineConfiguration("A",{{"legacy-active-box",{{"widthMm",-4}}}},&error));
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),beforeInvalid);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("legacy-active-box",&rec));
  EXPECT_NEAR(rec.volumeMm3,2000,1e-5);

  nlohmann::json doc;
  ASSERT_TRUE(kreoda::ReadConfigurationDocument(&doc,&error)) << error;
  EXPECT_EQ(doc["named"]["A"]["legacy-active-box"]["widthMm"],20);
  doc.erase("base"); // Simulate a persisted document from before baselines existed.
  auto& ocaf=kreoda::OcafLive::instance();
  ASSERT_TRUE(ocaf.BeginCommand(&error)) << error;
  ASSERT_TRUE(ocaf.WriteConfigurations(doc.dump(),&error)) << error;
  bool delta=false;
  ASSERT_TRUE(ocaf.CommitCommand(&delta,&error)) << error;
  if (delta) kreoda::DocumentStore::instance().commit();
  const auto revision=kreoda::DocumentStore::instance().revision();

  EXPECT_FALSE(kreoda::ActivateConfiguration("B",&error));
  EXPECT_NE(error.find("missing persisted baseline"),std::string::npos) << error;
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),revision);
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("legacy-active-box",&rec));
  EXPECT_DOUBLE_EQ(rec.paramsMm[0],20);
  EXPECT_DOUBLE_EQ(rec.paramsMm[1],10);
  ASSERT_TRUE(kreoda::ReadConfigurationDocument(&doc,&error));
  EXPECT_EQ(doc["active"],"A");
  EXPECT_TRUE(doc["base"].empty());
}

TEST(Configurations, LegacyInactiveCapturesBaselineOnFirstActivation) {
  kreoda::DocumentStore::instance().create("configuration-legacy-inactive");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("legacy-inactive-box",10,10,10,&error)) << error;
  const nlohmann::json legacy={{"active",""},{"named",{
    {"A",{{"legacy-inactive-box",{{"widthMm",20}}}}}}}};
  auto& ocaf=kreoda::OcafLive::instance();
  ASSERT_TRUE(ocaf.BeginCommand(&error)) << error;
  ASSERT_TRUE(ocaf.WriteConfigurations(legacy.dump(),&error)) << error;
  bool delta=false;
  ASSERT_TRUE(ocaf.CommitCommand(&delta,&error)) << error;
  if (delta) kreoda::DocumentStore::instance().commit();

  ASSERT_TRUE(kreoda::ActivateConfiguration("A",&error)) << error;
  kreoda::ShapeRecord rec;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("legacy-inactive-box",&rec));
  EXPECT_DOUBLE_EQ(rec.paramsMm[0],20);
  nlohmann::json doc;
  ASSERT_TRUE(kreoda::ReadConfigurationDocument(&doc,&error));
  EXPECT_EQ(doc["base"]["legacy-inactive-box"]["widthMm"],10);
  ASSERT_TRUE(kreoda::ActivateConfiguration("",&error)) << error;
  ASSERT_TRUE(kreoda::ShapeStore::instance().get("legacy-inactive-box",&rec));
  EXPECT_DOUBLE_EQ(rec.paramsMm[0],10);
  EXPECT_EQ(doc["base"]["legacy-inactive-box"]["heightMm"],10);
}

TEST(Configurations, ManualBaseEditsRefreshAllTrackedBaselinesAtomically) {
  kreoda::DocumentStore::instance().create("configuration-edited-base");
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("edited-base-box",10,10,10,&error)) << error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("edited-base-second",5,5,5,&error)) << error;
  ASSERT_TRUE(kreoda::DefineConfiguration("Medium",
    {{"edited-base-box",{{"widthMm",20}}}},&error)) << error;
  ASSERT_TRUE(kreoda::DefineConfiguration("Other",
    {{"edited-base-second",{{"widthMm",8}}}},&error)) << error;

  auto wire=[](int type,const std::string& id,const kreoda::Json& fields=kreoda::Json::object()) {
    kreoda::Json packet={{"protocolVersion",1},{"requestId",id},
      {"documentId","configuration-edited-base"},{"type",type}};
    packet.update(fields);
    const auto bytes=kreoda::handle_command(packet.dump());
    return kreoda::Json::parse(bytes.begin(),bytes.end());
  };
  auto check=[](const char* id,double width,double height,double depth) {
    kreoda::ShapeRecord record;
    ASSERT_TRUE(kreoda::ShapeStore::instance().get(id,&record));
    ASSERT_EQ(record.paramsMm.size(),3u);
    EXPECT_DOUBLE_EQ(record.paramsMm[0],width);
    EXPECT_DOUBLE_EQ(record.paramsMm[1],height);
    EXPECT_DOUBLE_EQ(record.paramsMm[2],depth);
    EXPECT_NEAR(record.volumeMm3,width*height*depth,1e-5);
  };
  auto baseline=[&](double first,double second,const char* active) {
    nlohmann::json doc;
    ASSERT_TRUE(kreoda::ReadConfigurationDocument(&doc,&error)) << error;
    EXPECT_EQ(doc["active"],active);
    EXPECT_EQ(doc["base"]["edited-base-box"]["widthMm"],first);
    EXPECT_EQ(doc["base"]["edited-base-second"]["widthMm"],second);
  };

  // Establish the persisted 10/5 baselines, then return to editable Base.
  ASSERT_EQ(wire(41,"edited-base-initial-medium",{{"name","Medium"}})["status"],"ok");
  ASSERT_EQ(wire(41,"edited-base-initial-base",{{"name",""}})["status"],"ok");
  baseline(10,5,"");

  // Canonical SetDimension / SetFeatureParameter on Base does not itself
  // update configuration metadata. Departure from Base must snapshot it.
  ASSERT_EQ(wire(6,"edited-base-manual-first",{{"featureId","edited-base-box"},
    {"paramName","widthMm"},{"valueMm",15}})["status"],"ok");
  ASSERT_EQ(wire(6,"edited-base-manual-second",{{"featureId","edited-base-second"},
    {"paramName","widthMm"},{"valueMm",7}})["status"],"ok");
  check("edited-base-box",15,10,10);
  check("edited-base-second",7,5,5);
  baseline(10,5,"");

  const auto before=kreoda::DocumentStore::instance().revision();
  ASSERT_EQ(wire(41,"edited-base-enter-medium",{{"name","Medium"}})["status"],"ok");
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(),before+1);
  check("edited-base-box",20,10,10);
  check("edited-base-second",7,5,5); // Dormant Other override must not hide Base edit.
  baseline(15,7,"Medium");

  // An activation and its baseline refresh are one OCAF Undo/Redo step.
  ASSERT_EQ(wire(8,"edited-base-undo-medium")["status"],"ok");
  check("edited-base-box",15,10,10);
  check("edited-base-second",7,5,5);
  baseline(10,5,""); // Undo restores the old persisted baseline pre-image.
  ASSERT_EQ(wire(9,"edited-base-redo-medium")["status"],"ok");
  check("edited-base-box",20,10,10);
  baseline(15,7,"Medium");

  ASSERT_EQ(wire(41,"edited-base-return-base",{{"name",""}})["status"],"ok");
  check("edited-base-box",15,10,10);
  check("edited-base-second",7,5,5);
  baseline(15,7,"");
  ASSERT_EQ(wire(41,"edited-base-enter-other",{{"name","Other"}})["status"],"ok");
  check("edited-base-box",15,10,10);
  check("edited-base-second",8,5,5);
  ASSERT_EQ(wire(41,"edited-base-return-from-other",{{"name",""}})["status"],"ok");
  check("edited-base-box",15,10,10);
  check("edited-base-second",7,5,5);

  ASSERT_EQ(wire(41,"edited-base-save-in-medium",{{"name","Medium"}})["status"],"ok");
  const auto path=(std::filesystem::temp_directory_path()/"kreoda-config-edited-base.icad").generic_string();
  ASSERT_EQ(wire(10,"edited-base-save",{{"path",path}})["status"],"ok");
  ASSERT_EQ(wire(2,"edited-base-new")["status"],"ok");
  ASSERT_EQ(wire(11,"edited-base-open",{{"path",path}})["status"],"ok");
  baseline(15,7,"Medium");
  check("edited-base-box",20,10,10);
  check("edited-base-second",7,5,5);
  ASSERT_EQ(wire(41,"edited-base-after-open",{{"name",""}})["status"],"ok");
  check("edited-base-box",15,10,10);
  check("edited-base-second",7,5,5);
  std::filesystem::remove(path);
}
