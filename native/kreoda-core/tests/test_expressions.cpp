// Parametric expressions, Phase 9a (§22): formulas validate, evaluate in
// dependency order, cycle honestly, and persist through save/open + undo.

#include <gtest/gtest.h>

#include <filesystem>
#include <string>
#include <vector>

#include "../src/document/document_store.h"
#include "../src/expressions/expressions.h"
#include "../src/features/primitives/primitives.h"
#include "../src/model/shapes.h"
#include "../src/persistence/ocaf_live.h"

#include "rpc_text.h"

namespace fs = std::filesystem;

namespace {

bool setExpr(const std::string& fid, const std::string& param,
             const std::string& expr, std::string* err) {
  // Expression-only edit: valueMm ignored when a formula is present.
  return kreoda::RebuildFeature(fid, param, 0, expr, err);
}

double paramOf(const std::string& fid, const std::string& param) {
  kreoda::ShapeRecord rec;
  if (!kreoda::ShapeStore::instance().get(fid, &rec)) return -1.0;
  const int idx = kreoda::ParamIndexOf(rec.type, param, rec.paramsMm.size());
  if (idx < 0) return -1.0;
  return rec.paramsMm[static_cast<size_t>(idx)];
}

}  // namespace

TEST(Expressions, ParserAcceptsAndRejects) {
  std::vector<std::pair<std::string, std::string>> deps;
  std::string err;
  EXPECT_TRUE(kreoda::ParseExpression("heightMm * 2 + 5", &deps, &err)) << err;
  EXPECT_EQ(deps.size(), 1u);
  EXPECT_EQ(deps[0].first, "");
  EXPECT_EQ(deps[0].second, "heightMm");
  deps.clear();
  EXPECT_TRUE(kreoda::ParseExpression("box-1.widthMm / 2", &deps, &err)) << err;
  EXPECT_EQ(deps[0].first, "box-1");
  EXPECT_FALSE(kreoda::ParseExpression("heightMm *", &deps, &err));
  EXPECT_FALSE(kreoda::ParseExpression("rm -rf /", &deps, &err));
  EXPECT_FALSE(kreoda::ParseExpression("widthMm; evil()", &deps, &err));
  EXPECT_FALSE(kreoda::ParseExpression("(2 + 3", &deps, &err));
  // Parsing "1 / 0" is fine (grammar-level); evaluation refuses it.
  EXPECT_TRUE(kreoda::ParseExpression("10 / 2", &deps, &err)) << err;
  {
    double out = 0;
    auto never = [](const std::string&, const std::string&, double*,
                    void*) { return false; };
    EXPECT_FALSE(kreoda::EvaluateExpression("10 / 0", "x", never, nullptr,
                                            &out, &err));
    EXPECT_FALSE(err.empty());
  }
}

TEST(Expressions, SetEvaluatesAndChains) {
  kreoda::DocumentStore::instance().create("expr-doc");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("ex-a", 100, 60, 10, &err)) << err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("ex-b", 10, 10, 10, &err)) << err;
  // width = height * 2 → 120.
  ASSERT_TRUE(setExpr("ex-a", "widthMm", "heightMm * 2", &err)) << err;
  EXPECT_DOUBLE_EQ(paramOf("ex-a", "widthMm"), 120.0);
  // Chain across features: b.depth = a.width + 5 → 125.
  ASSERT_TRUE(setExpr("ex-b", "depthMm", "ex-a.widthMm + 5", &err)) << err;
  EXPECT_DOUBLE_EQ(paramOf("ex-b", "depthMm"), 125.0);
  // Editing the source re-flows dependents: height 100 → width 200,
  // b.depth 205.
  ASSERT_TRUE(kreoda::RebuildFeature("ex-a", "heightMm", 100, &err)) << err;
  EXPECT_DOUBLE_EQ(paramOf("ex-a", "widthMm"), 200.0);
  EXPECT_DOUBLE_EQ(paramOf("ex-b", "depthMm"), 205.0);
  // Expression survives as stored formula (not just the value).
  std::string stored;
  EXPECT_TRUE(
      kreoda::ExpressionStore::instance().get("ex-a", "widthMm", &stored));
  EXPECT_EQ(stored, "heightMm * 2");
}

TEST(Expressions, RejectCyclesTyposAndBadValues) {
  kreoda::DocumentStore::instance().create("expr-doc2");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("ex-c", 100, 60, 10, &err)) << err;
  // Self-cycle.
  EXPECT_FALSE(setExpr("ex-c", "widthMm", "widthMm * 2", &err));
  EXPECT_FALSE(err.empty());
  // Unknown reference.
  EXPECT_FALSE(setExpr("ex-c", "widthMm", "nope.widthMm + 1", &err));
  EXPECT_FALSE(setExpr("ex-c", "widthMm", "bogusParam + 1", &err));
  // Non-positive / oversize results.
  EXPECT_FALSE(setExpr("ex-c", "widthMm", "heightMm - 1000", &err));
  // Failed sets leave previous values untouched.
  EXPECT_DOUBLE_EQ(paramOf("ex-c", "widthMm"), 100.0);
  // Clearing with an empty expression restores bare values.
  ASSERT_TRUE(kreoda::RebuildFeature("ex-c", "widthMm", 150, &err)) << err;
  EXPECT_DOUBLE_EQ(paramOf("ex-c", "widthMm"), 150.0);
}

TEST(Expressions, PersistAndUndo) {
  kreoda::DocumentStore::instance().create("expr-doc3");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("ex-d", 100, 60, 10, &err)) << err;
  ASSERT_TRUE(setExpr("ex-d", "depthMm", "widthMm / 4", &err)) << err;
  EXPECT_DOUBLE_EQ(paramOf("ex-d", "depthMm"), 25.0);
  // Save → fresh doc → open: formula and value both come back.
  const fs::path icad =
      fs::temp_directory_path() / "kreoda-expr-roundtrip.icad";
  std::error_code ec;
  fs::remove(icad, ec);
  const std::string save =
      std::string(
          R"({"protocolVersion":1,"requestId":"e1","documentId":"expr-doc3","type":10,"path":")") +
      icad.string() + "\"}";
  ASSERT_NE(kreoda_test::rpcText(save).find("\"status\":\"ok\""),
            std::string::npos);
  kreoda::DocumentStore::instance().create("expr-doc3b");
  const std::string open =
      std::string(
          R"({"protocolVersion":1,"requestId":"e2","documentId":"expr-doc3b","type":11,"path":")") +
      icad.string() + "\"}";
  const std::string opened = kreoda_test::rpcText(open);
  ASSERT_NE(opened.find("\"status\":\"ok\""), std::string::npos) << opened;
  std::string stored;
  EXPECT_TRUE(
      kreoda::ExpressionStore::instance().get("ex-d", "depthMm", &stored));
  EXPECT_EQ(stored, "widthMm / 4");
  EXPECT_DOUBLE_EQ(paramOf("ex-d", "depthMm"), 25.0);
  fs::remove(icad, ec);
}

TEST(Expressions, UndoRestoresFormula) {
  kreoda::DocumentStore::instance().create("expr-doc4");
  std::string err;
  ASSERT_TRUE(kreoda::CreateBoxFeature("ex-e", 100, 60, 10, &err)) << err;
  ASSERT_TRUE(setExpr("ex-e", "widthMm", "heightMm + 10", &err)) << err;
  EXPECT_DOUBLE_EQ(paramOf("ex-e", "widthMm"), 70.0);
  ASSERT_TRUE(kreoda::OcafLive::instance().Undo(&err)) << err;
  // Formula gone with its command; bare value restored.
  std::string stored;
  EXPECT_FALSE(
      kreoda::ExpressionStore::instance().get("ex-e", "widthMm", &stored));
  EXPECT_DOUBLE_EQ(paramOf("ex-e", "widthMm"), 100.0);
  ASSERT_TRUE(kreoda::OcafLive::instance().Redo(&err)) << err;
  EXPECT_TRUE(
      kreoda::ExpressionStore::instance().get("ex-e", "widthMm", &stored));
  EXPECT_DOUBLE_EQ(paramOf("ex-e", "widthMm"), 70.0);
}
