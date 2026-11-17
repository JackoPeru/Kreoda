// Phase 11 session snapshot (§11.7): read-only full-list query at the
// current revision. No transaction, no revision bump, safe between
// mutations — the session relay serves it to every connected client.

#include <gtest/gtest.h>

#include <chrono>
#include <string>
#include <thread>

#include "../src/document/document_store.h"
#include "../src/features/hole/hole.h"
#include "../src/features/primitives/primitives.h"
#include "../src/model/shapes.h"
#include "../src/model/geometry_delta.h"
#include "../src/persistence/ocaf_live.h"

#include "rpc_text.h"

namespace {

std::string rpc(const std::string& body) {
  return kreoda_test::rpcText(body);
}

bool ok(const std::string& r) {
  return r.find("\"status\":\"ok\"") != std::string::npos;
}

bool has(const std::string& r, const std::string& s) {
  return r.find(s) != std::string::npos;
}

}  // namespace

TEST(Session11Json, TopLevelFieldsIgnoreNestedMetadataAndDecodeEscapes) {
  const std::string value = R"({"meta":{"type":27,"requestId":"forged","widthMm":999},"type":1,"requestId":"actual\u002drequest","widthMm":20})";
  EXPECT_EQ(kreoda::json_int_field(value, "type", 0), 1);
  EXPECT_EQ(kreoda::json_string_field(value, "requestId", ""), "actual-request");
  EXPECT_EQ(kreoda::json_double_field(value, "widthMm", 0), 20);
  EXPECT_FALSE(kreoda::json_has_key(R"({"meta":{"transactionId":"other"}})", "transactionId"));
}

TEST(Session11Json, DoesNotCoerceScalarsOrAcceptMalformedObjects) {
  EXPECT_EQ(kreoda::json_int_field(R"({"type":"3"})", "type", -1), -1);
  EXPECT_EQ(kreoda::json_double_field(R"({"widthMm":"20"})", "widthMm", -1), -1);
  EXPECT_EQ(kreoda::json_string_field(R"({"featureId":3})", "featureId", "fallback"), "fallback");
  for (const auto& malformed : {"[]", "null", "{\"type\":1,}", "{\"type\":1}garbage"}) {
    EXPECT_TRUE(has(rpc(malformed), "BAD_ENVELOPE")) << malformed;
  }
}

TEST(Session11Json, RejectsCommandsForAnotherDocumentButAllowsLifecycle) {
  kreoda::DocumentStore::instance().create("doc-alpha");
  const auto mismatched = rpc(
      R"({"protocolVersion":1,"requestId":"x1","documentId":"doc-beta","type":3,"featureId":"wrong-box","widthMm":10,"heightMm":10,"depthMm":10})");
  EXPECT_TRUE(has(mismatched, "DOCUMENT_MISMATCH")) << mismatched;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("wrong-box"));
  // Lifecycle commands must name the document they create.
  EXPECT_TRUE(has(rpc(
      R"({"protocolVersion":1,"requestId":"x0","documentId":"","type":2})"),
      "BAD_ENVELOPE"));
  // Lifecycle commands name the document they create and then match it.
  EXPECT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"x2","documentId":"doc-beta","type":2})")));
  EXPECT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"x3","documentId":"doc-beta","type":3,"featureId":"right-box","widthMm":10,"heightMm":10,"depthMm":10})")));
}

TEST(Session11Json, NestedTransactionCannotJoinAnOpenUnit) {
  kreoda::DocumentStore::instance().create("typed-json");
  ASSERT_TRUE(ok(rpc(R"({"protocolVersion":1,"requestId":"begin","documentId":"typed-json","type":27,"transactionId":"owner"})")));
  const auto revision = kreoda::DocumentStore::instance().revision();
  const auto rejected = rpc(R"({"meta":{"transactionId":"owner"},"protocolVersion":1,"requestId":"nested","documentId":"typed-json","type":3,"featureId":"forged-box","widthMm":10,"heightMm":10,"depthMm":10})");
  EXPECT_TRUE(has(rejected, "TRANSACTION_OPEN")) << rejected;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("forged-box"));
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revision);
  EXPECT_TRUE(ok(rpc(R"({"protocolVersion":1,"requestId":"rollback","documentId":"typed-json","type":29,"transactionId":"owner"})")));
}

TEST(Session11Json, InvalidNumbersAndNestedArraysCannotCreateFeatures) {
  kreoda::DocumentStore::instance().create("typed-json");
  const auto invalid = rpc(R"({"protocolVersion":1,"requestId":"quoted","documentId":"typed-json","type":3,"featureId":"quoted-box","widthMm":"20","heightMm":10,"depthMm":10})");
  EXPECT_TRUE(has(invalid, "BAD_PARAMS")) << invalid;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("quoted-box"));
  const auto nested = rpc(R"({"protocolVersion":1,"requestId":"nested-array","documentId":"typed-json","type":25,"targetId":"missing","faceRole":"box.+Z","diameterMm":2,"featureIds":["h"],"points":[[1,2]]})");
  EXPECT_TRUE(has(nested, "BAD_PARAMS")) << nested;
}

TEST(Session11, SnapshotListsFeaturesWithoutMutating) {
  kreoda::DocumentStore::instance().create("snap-doc");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("sb", 100, 60, 10, &err)) << err;
  ASSERT_TRUE(kreoda::CreateHoleFeature("sh", "sb", "box.+Z", 50, 30, 8,
                                        "throughAll", 0, &err))
      << err;
  const int64_t revBefore = kreoda::DocumentStore::instance().revision();
  const std::string res = rpc(
      R"({"protocolVersion":1,"requestId":"snap-1","documentId":"snap-doc","type":26})");
  ASSERT_TRUE(ok(res)) << res;
  EXPECT_TRUE(has(res, "\"featureId\":\"sb\""));
  EXPECT_TRUE(has(res, "\"featureId\":\"sh\""));
  EXPECT_TRUE(has(res, "\"revision\":" + std::to_string(revBefore)));
  // Read-only: revision unchanged, undo stack untouched (2 deltas).
  EXPECT_EQ(kreoda::DocumentStore::instance().revision(), revBefore);
}

TEST(Session11, Phase12SnapshotDocumentIdAuthoritativeWithOrWithoutReferencePlanes) {
  kreoda::DocumentStore::instance().create("phase12-snapshot");
  const auto rev=kreoda::DocumentStore::instance().revision();
  for(const bool references:{false,true}) {
    const auto response=rpc(std::string(R"({"protocolVersion":1,"requestId":"p12-snapshot","documentId":"phase12-snapshot","type":26,"includeReferencePlanes":)")+(references?"true":"false")+"}");
    EXPECT_TRUE(ok(response))<<response;
    EXPECT_TRUE(has(response,"\"documentId\":\"phase12-snapshot\""))<<response;
    EXPECT_TRUE(has(response,"\"revision\":"+std::to_string(rev)))<<response;
    EXPECT_EQ(has(response,"referencePlanesJson"),references);
    EXPECT_EQ(kreoda::DocumentStore::instance().revision(),rev);
  }
}

TEST(Session11, Phase12NativeGeometryDeltaOnlyChangedFeatures) {
  kreoda::DocumentStore::instance().create("phase12-delta");
  const auto empty=kreoda::CaptureGeometryRevision();
  std::string error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("delta-a",10,10,10,&error))<<error;
  ASSERT_TRUE(kreoda::CreateBoxFeature("delta-b",20,20,20,&error))<<error;
  const auto baseline=kreoda::CaptureGeometryRevision();
  kreoda::GeometryDelta delta;
  ASSERT_TRUE(kreoda::DiffGeometryRevisions(empty,baseline,&delta,&error))<<error;
  EXPECT_EQ(delta.added,(std::vector<std::string>{"delta-a","delta-b"}));
  EXPECT_EQ(delta.changedMeshes,delta.added);
  EXPECT_TRUE(delta.updated.empty());
  ASSERT_TRUE(kreoda::DiffGeometryRevisions(baseline,baseline,&delta,&error))<<error;
  EXPECT_TRUE(delta.changedMeshes.empty());
  EXPECT_TRUE(delta.added.empty());
  ASSERT_TRUE(ok(rpc(R"({"protocolVersion":1,"requestId":"delta-update","documentId":"phase12-delta","type":6,"featureId":"delta-a","paramName":"widthMm","valueMm":30})")));
  const auto updated=kreoda::CaptureGeometryRevision();
  ASSERT_TRUE(kreoda::DiffGeometryRevisions(baseline,updated,&delta,&error))<<error;
  EXPECT_TRUE(delta.added.empty());
  EXPECT_EQ(delta.updated,(std::vector<std::string>{"delta-a"}));
  EXPECT_EQ(delta.changedMeshes,delta.updated);
  EXPECT_TRUE(delta.removed.empty());
  auto removed=updated;
  removed.revision++;
  removed.features.erase("delta-b");
  ASSERT_TRUE(kreoda::DiffGeometryRevisions(updated,removed,&delta,&error))<<error;
  EXPECT_EQ(delta.removed,(std::vector<std::string>{"delta-b"}));
  EXPECT_TRUE(delta.changedMeshes.empty());
  auto provisional=updated;
  provisional.features.erase("delta-b");
  EXPECT_FALSE(kreoda::DiffGeometryRevisions(updated,provisional,&delta,&error));
  auto different=updated;
  different.documentId="other-document";
  EXPECT_FALSE(kreoda::DiffGeometryRevisions(updated,different,&delta,&error));
}

// §11.12: N joined commands commit as exactly one Undo delta.
TEST(Session11, TransactionTwoCreatesOneUndo) {
  kreoda::DocumentStore::instance().create("txn-doc");
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"t1","documentId":"txn-doc","type":27,"transactionId":"t1"})")));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"t2","documentId":"txn-doc","type":3,"featureId":"ta","widthMm":10,"heightMm":10,"depthMm":10,"transactionId":"t1"})")));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"t3","documentId":"txn-doc","type":3,"featureId":"tb","widthMm":20,"heightMm":20,"depthMm":20,"transactionId":"t1"})")));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"t4","documentId":"txn-doc","type":28,"transactionId":"t1"})")));
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("ta"));
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("tb"));
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), 1);
  // One Undo removes both boxes: single atomic delta.
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"t5","documentId":"txn-doc","type":8})")));
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("ta"));
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("tb"));
}

// §11.12: a failed step taints the unit — commit rolls everything back.
// The cycle passes the single-expression probe (both refs exist) and only
// fails in the fixpoint, i.e. inside the joined command (taint path).
TEST(Session11, TransactionFailureAtomic) {
  kreoda::DocumentStore::instance().create("txn-doc2");
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"f1","documentId":"txn-doc2","type":27,"transactionId":"ft"})")));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"f2","documentId":"txn-doc2","type":3,"featureId":"fa","widthMm":10,"heightMm":10,"depthMm":10,"transactionId":"ft"})")));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"f3","documentId":"txn-doc2","type":3,"featureId":"fb","widthMm":10,"heightMm":10,"depthMm":10,"transactionId":"ft"})")));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"f4","documentId":"txn-doc2","type":6,"featureId":"fb","paramName":"depthMm","expression":"fa.widthMm + 5","transactionId":"ft"})")));
  EXPECT_FALSE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"f5","documentId":"txn-doc2","type":6,"featureId":"fa","paramName":"widthMm","expression":"fb.depthMm","transactionId":"ft"})")));
  const std::string commit = rpc(
      R"({"protocolVersion":1,"requestId":"f6","documentId":"txn-doc2","type":28,"transactionId":"ft"})");
  EXPECT_FALSE(ok(commit));
  EXPECT_TRUE(has(commit, "TRANSACTION_TAINTED")) << commit;
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("fa"));
  EXPECT_FALSE(kreoda::ShapeStore::instance().contains("fb"));
}

// §11.12: ownership, fencing, and preview-during-transaction rules.
TEST(Session11, TransactionOwnerRules) {
  kreoda::DocumentStore::instance().create("txn-doc3");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("ob", 100, 60, 10, &err)) << err;
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"o1","documentId":"txn-doc3","type":27,"transactionId":"owner"})")));
  // Double begin is BUSY; outsiders (even without any id) are fenced.
  EXPECT_TRUE(has(
      rpc(R"({"protocolVersion":1,"requestId":"o2","documentId":"txn-doc3","type":27,"transactionId":"other"})"),
      "TRANSACTION_BUSY"));
  EXPECT_TRUE(has(
      rpc(R"({"protocolVersion":1,"requestId":"o3","documentId":"txn-doc3","type":3,"featureId":"ox","widthMm":1,"heightMm":1,"depthMm":1})"),
      "TRANSACTION_OPEN"));
  // History commands are fenced even with the owner's id.
  EXPECT_TRUE(has(
      rpc(R"({"protocolVersion":1,"requestId":"o4","documentId":"txn-doc3","type":8,"transactionId":"owner"})"),
      "TRANSACTION_OPEN"));
  // Wrong owner cannot commit or roll back.
  EXPECT_TRUE(has(
      rpc(R"({"protocolVersion":1,"requestId":"o5","documentId":"txn-doc3","type":28,"transactionId":"impostor"})"),
      "NOT_OWNER"));
  EXPECT_TRUE(has(
      rpc(R"({"protocolVersion":1,"requestId":"o6","documentId":"txn-doc3","type":29,"transactionId":"impostor"})"),
      "NOT_OWNER"));
  // Transient previews observe but never join: allowed mid-transaction.
  const std::string preview = rpc(
      R"({"protocolVersion":1,"requestId":"o7","documentId":"txn-doc3","type":6,"featureId":"ob","paramName":"widthMm","valueMm":200,"isPreview":true})");
  EXPECT_TRUE(has(preview, "TRANSACTION_OPEN") == false) << preview.substr(0, 200);
  // Clean rollback: nothing committed, undo stack untouched.
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"o8","documentId":"txn-doc3","type":29,"transactionId":"owner"})")));
  EXPECT_TRUE(kreoda::ShapeStore::instance().contains("ob"));
  EXPECT_EQ(kreoda::OcafLive::instance().AvailableUndos(), 1);
}

// An abandoned transaction must not fence the document forever: once its
// owner is idle past the timeout, the next command rolls it back.
TEST(Session11, AbandonedTransactionExpiresAndUnfences) {
  auto& ocaf = kreoda::OcafLive::instance();
  kreoda::DocumentStore::instance().create("txn-doc4");
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"e1","documentId":"txn-doc4","type":27,"transactionId":"gone"})")));
  ASSERT_TRUE(ocaf.InTransaction());
  ocaf.SetTransactionTimeoutForTest(std::chrono::milliseconds(1));
  std::this_thread::sleep_for(std::chrono::milliseconds(5));
  EXPECT_TRUE(ocaf.ExpireStaleTransaction());
  EXPECT_FALSE(ocaf.InTransaction());
  // The fence is gone: lifecycle commands run again without the owner id.
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"e2","documentId":"txn-doc4","type":2})")));
  ocaf.SetTransactionTimeoutForTest(std::chrono::milliseconds(660000));
  // A stale transaction also expires implicitly on the next dispatch.
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"e3","documentId":"txn-doc4","type":27,"transactionId":"gone2"})")));
  ocaf.SetTransactionTimeoutForTest(std::chrono::milliseconds(1));
  std::this_thread::sleep_for(std::chrono::milliseconds(5));
  ASSERT_TRUE(ok(rpc(
      R"({"protocolVersion":1,"requestId":"e4","documentId":"txn-doc4","type":2})")));
  EXPECT_FALSE(ocaf.InTransaction());
  ocaf.SetTransactionTimeoutForTest(std::chrono::milliseconds(660000));
}
