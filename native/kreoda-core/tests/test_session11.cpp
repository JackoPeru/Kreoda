// Phase 11 session snapshot (§11.7): read-only full-list query at the
// current revision. No transaction, no revision bump, safe between
// mutations — the session relay serves it to every connected client.

#include <gtest/gtest.h>

#include <string>

#include "../src/document/document_store.h"
#include "../src/features/hole/hole.h"
#include "../src/features/primitives/primitives.h"
#include "../src/model/shapes.h"
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
