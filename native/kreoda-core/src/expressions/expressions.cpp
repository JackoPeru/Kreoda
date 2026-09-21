// Parametric expressions: safe recursive-descent evaluator + registry.

#include "expressions/expressions.h"

#include <cmath>
#include <cctype>
#include <iomanip>
#include <set>
#include <sstream>

#include "model/shapes.h"
#include "persistence/ocaf_live.h"

namespace kreoda {

bool MirrorFeatureExpressions(const std::string& featureId,
                              std::string* error) {
  return OcafLive::instance().UpsertExpressions(
      featureId,
      SerializeExpressionMap(ExpressionStore::instance().forFeature(featureId)),
      error);
}

namespace {

bool IsNameChar(char c, bool first) {
  if (c >= 'A' && c <= 'Z') return true;
  if (c >= 'a' && c <= 'z') return true;
  if (c == '_') return true;
  if (!first && c >= '0' && c <= '9') return true;
  // Feature ids carry '-' (UUIDs); param names never contain '.'.
  if (!first && (c == '-' || c == '.')) return true;
  return false;
}

// Splits "featureId.paramName" at the FIRST dot (param names have none;
// feature ids may carry '-' but never '.'). Bare "paramName" → {"", name}.
bool SplitRef(const std::string& tok, std::string* fid, std::string* param,
              std::string* error) {
  const size_t dot = tok.find('.');
  std::string f, p;
  if (dot == std::string::npos) {
    f = "";
    p = tok;
  } else {
    f = tok.substr(0, dot);
    p = tok.substr(dot + 1);
  }
  if (p.empty() || !(p[0] == '_' || (p[0] >= 'A' && p[0] <= 'Z') ||
                     (p[0] >= 'a' && p[0] <= 'z'))) {
    if (error) *error = "bad parameter name in '" + tok + "'";
    return false;
  }
  for (char c : p) {
    if (!IsNameChar(c, false) || c == '.' || c == '-') {
      if (error) *error = "bad parameter name in '" + tok + "'";
      return false;
    }
  }
  if (!f.empty()) {
    if (!ShapeStore::ValidFeatureId(f)) {
      if (error) *error = "bad feature id in '" + tok + "'";
      return false;
    }
  }
  *fid = f;
  *param = p;
  return true;
}

struct Parser {
  struct EvalCtx {
    bool (*resolve)(const std::string&, const std::string&, double*, void*);
    void* user;
    bool collectOnly;
  };

  const char* p;
  const char* end;
  std::string* error;
  std::vector<std::pair<std::string, std::string>>* deps;
  std::string owner;
  int depth = 0;

  bool fail(const std::string& m) {
    if (error && error->empty()) *error = m;
    return false;
  }
  void skip() {
    while (p < end && (*p == ' ' || *p == '\t')) ++p;
  }
  bool parseExpr(double* out, EvalCtx* ctx);
  bool parseTerm(double* out, EvalCtx* ctx);
  bool parseFactor(double* out, EvalCtx* ctx);

  bool parseNumber(double* out) {
    const char* start = p;
    bool any = false;
    while (p < end && *p >= '0' && *p <= '9') {
      ++p;
      any = true;
    }
    if (p < end && *p == '.') {
      ++p;
      while (p < end && *p >= '0' && *p <= '9') {
        ++p;
        any = true;
      }
    }
    if (!any) return fail("expected a number");
    try {
      *out = std::stod(std::string(start, p));
    } catch (...) {
      return fail("bad number");
    }
    return true;
  }

  bool parseRef(std::string* fid, std::string* param) {
    const char* start = p;
    if (p >= end || !IsNameChar(*p, true)) return fail("expected a name");
    ++p;
    while (p < end && IsNameChar(*p, false)) ++p;
    return SplitRef(std::string(start, p), fid, param, error);
  }
};

bool Parser::parseExpr(double* out, EvalCtx* ctx) {
  double v = 0;
  if (!parseTerm(&v, ctx)) return false;
  while (true) {
    skip();
    if (p < end && (*p == '+' || *p == '-')) {
      const char op = *p++;
      double rhs = 0;
      if (!parseTerm(&rhs, ctx)) return false;
      v = (op == '+') ? v + rhs : v - rhs;
    } else {
      break;
    }
  }
  *out = v;
  return true;
}

bool Parser::parseTerm(double* out, EvalCtx* ctx) {
  double v = 0;
  if (!parseFactor(&v, ctx)) return false;
  while (true) {
    skip();
    if (p < end && (*p == '*' || *p == '/')) {
      const char op = *p++;
      double rhs = 0;
      if (!parseFactor(&rhs, ctx)) return false;
      if (op == '*') {
        v *= rhs;
      } else {
        if (rhs == 0.0) return fail("division by zero");
        v /= rhs;
      }
    } else {
      break;
    }
  }
  *out = v;
  return true;
}

bool Parser::parseFactor(double* out, EvalCtx* ctx) {
  skip();
  if (p >= end) return fail("unexpected end of expression");
  if (++depth > 64) return fail("expression too deeply nested (max 64)");
  bool ok = false;
  if (*p == '(') {
    ++p;
    if (!parseExpr(out, ctx)) { --depth; return false; }
    skip();
    if (p >= end || *p != ')') { --depth; return fail("expected ')'"); }
    ++p;
    --depth;
    return true;
  }
  if (*p == '-') {
    ++p;
    double v = 0;
    if (!parseFactor(&v, ctx)) { --depth; return false; }
    *out = -v;
    --depth;
    return true;
  }
  if ((*p >= '0' && *p <= '9') || *p == '.') { ok = parseNumber(out); --depth; return ok; }
  std::string fid, param;
  if (!parseRef(&fid, &param)) { --depth; return false; }
  if (ctx->collectOnly) {
    if (deps) {
      const std::string f = fid.empty() ? owner : fid;
      deps->emplace_back(f, param);
    }
    *out = 0;
    --depth;
    return true;
  }
  double v = 0;
  const std::string f = fid.empty() ? owner : fid;
  if (!ctx->resolve(f, param, &v, ctx->user)) { --depth; return false; }
  *out = v;
  --depth;
  return true;
}

bool RunParser(const std::string& text, const std::string& owner,
               std::vector<std::pair<std::string, std::string>>* deps,
               Parser::EvalCtx* ctx, double* out, std::string* error) {
  if (text.size() > 256) {
    if (error) *error = "expression too long (max 256 chars)";
    return false;
  }
  for (unsigned char c : text) {
    const bool ok = (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') ||
                    (c >= 'a' && c <= 'z') || c == '_' || c == '-' ||
                    c == '.' || c == '+' || c == '*' || c == '/' ||
                    c == '(' || c == ')' || c == ' ' || c == '\t';
    if (!ok) {
      if (error) {
        *error = "bad character in expression (numbers, names, + - * / ( ) only)";
      }
      return false;
    }
  }
  Parser ps{text.data(), text.data() + text.size(), error, deps, owner};
  double v = 0;
  if (!ps.parseExpr(&v, ctx)) return false;
  ps.skip();
  if (ps.p != ps.end) {
    if (error && error->empty()) *error = "unexpected text in expression";
    return false;
  }
  if (out) *out = v;
  return true;
}

}  // namespace

int ParamIndexOf(const std::string& type, const std::string& paramName,
                 size_t paramCount) {
  // Slots live in DescribeParams (model/shapes) — single source of truth.
  const std::vector<std::string> slots = DescribeParams(type);
  if (slots.empty() || slots.size() != paramCount) return -1;
  for (size_t i = 0; i < slots.size(); ++i) {
    if (slots[i] == paramName) return static_cast<int>(i);
  }
  return -1;
}

bool ParseExpression(const std::string& text,
                     std::vector<std::pair<std::string, std::string>>* deps,
                     std::string* error) {
  if (!deps) {
    if (error) *error = "internal error: null out-param";
    return false;
  }
  deps->clear();
  Parser::EvalCtx ctx{nullptr, nullptr, true};
  return RunParser(text, "", deps, &ctx, nullptr, error);
}

bool EvaluateExpression(const std::string& text, const std::string& ownerId,
                        bool (*resolve)(const std::string&, const std::string&,
                                        double*, void*),
                        void* ctx, double* out, std::string* error) {
  if (!resolve || !out) {
    if (error) *error = "internal error: null out-param";
    return false;
  }
  Parser::EvalCtx ectx{resolve, ctx, false};
  return RunParser(text, ownerId, nullptr, &ectx, out, error);
}

ExpressionStore& ExpressionStore::instance() {
  static ExpressionStore store;
  return store;
}

void ExpressionStore::clear() { exprs_.clear(); }

void ExpressionStore::set(const std::string& featureId,
                          const std::string& paramName,
                          const std::string& expression) {
  if (expression.empty()) {
    auto it = exprs_.find(featureId);
    if (it != exprs_.end()) {
      it->second.erase(paramName);
      if (it->second.empty()) exprs_.erase(it);
    }
    return;
  }
  exprs_[featureId][paramName] = expression;
}

bool ExpressionStore::get(const std::string& featureId,
                          const std::string& paramName,
                          std::string* out) const {
  const auto it = exprs_.find(featureId);
  if (it == exprs_.end()) return false;
  const auto jt = it->second.find(paramName);
  if (jt == it->second.end()) return false;
  if (out) *out = jt->second;
  return true;
}

std::vector<ExpressionEntry> ExpressionStore::listInOrder() const {
  std::vector<ExpressionEntry> out;
  for (const auto& [fid, params] : exprs_) {
    for (const auto& [param, expr] : params) {
      out.push_back({fid, param, expr});
    }
  }
  return out;
}

std::map<std::string, std::string> ExpressionStore::forFeature(
    const std::string& featureId) const {
  const auto it = exprs_.find(featureId);
  if (it == exprs_.end()) return {};
  return it->second;
}

void ExpressionStore::setFeatureMap(
    const std::string& featureId,
    const std::map<std::string, std::string>& entries) {
  if (entries.empty()) {
    exprs_.erase(featureId);
  } else {
    exprs_[featureId] = entries;
  }
}

namespace {

struct Resolver {  std::string* error = nullptr;
  static bool call(const std::string& fid, const std::string& param,
                   double* out, void* ctx) {
    auto* self = static_cast<Resolver*>(ctx);
    ShapeRecord rec;
    if (!ShapeStore::instance().get(fid, &rec)) {
      if (self->error && self->error->empty()) {
        *self->error = "unknown reference '" + fid + "." + param + "'";
      }
      return false;
    }
    const int idx = ParamIndexOf(rec.type, param, rec.paramsMm.size());
    if (idx < 0 ||
        static_cast<size_t>(idx) >= rec.paramsMm.size()) {
      if (self->error && self->error->empty()) {
        *self->error = "unknown reference '" + fid + "." + param + "'";
      }
      return false;
    }
    *out = rec.paramsMm[static_cast<size_t>(idx)];
    return true;
  }
};

}  // namespace

// Range by parameter family (Phase 9d): part dimensions stay (0, 100000],
// placement translations ±1000000, revolve angleDeg (0,360], other *Deg
// placement angles any finite degrees.
bool CheckValueRange(const std::string& paramName, double value,
                     std::string* error) {
  if (!std::isfinite(value)) {
    if (error) *error = "expression evaluates to a non-finite number";
    return false;
  }
  auto fmt17 = [](double v) {
    std::ostringstream os;
    os << std::setprecision(17) << v;
    return os.str();
  };
  // Revolve angle keeps its create-time gate (M2): formulas must not bypass it.
  if (paramName == "angleDeg") {
    if (!(value > 0) || value > 360) {
      if (error) {
        *error = "expression evaluates to " + fmt17(value) +
                 " (angleDeg must be in (0, 360] deg)";
      }
      return false;
    }
    return true;
  }
  const bool isAngle =
      paramName.size() >= 3 &&
      paramName.compare(paramName.size() - 3, 3, "Deg") == 0;
  if (isAngle) return true;
  const bool isPlacement =
      paramName == "txMm" || paramName == "tyMm" || paramName == "tzMm";
  if (isPlacement) {
    if (value < -1000000.0 || value > 1000000.0) {
      if (error) {
        *error = "expression evaluates to " + fmt17(value) +
                 " (placement must be within ±1000000 mm)";
      }
      return false;
    }
    return true;
  }
  if (!(value > 0) || value > 100000) {
    if (error) {
      *error = "expression evaluates to " + fmt17(value) +
               " (must be in (0, 100000] mm)";
    }
    return false;
  }
  return true;
}

bool EvaluateOneExpression(const std::string& ownerId,
                           const std::string& paramName,
                           const std::string& expression, double* out,
                           std::string* error) {  if (!out) {
    if (error) *error = "internal error: null out-param";
    return false;
  }
  ShapeRecord rec;
  if (!ShapeStore::instance().get(ownerId, &rec)) {
    if (error) *error = "unknown feature " + ownerId;
    return false;
  }
  if (ParamIndexOf(rec.type, paramName, rec.paramsMm.size()) < 0) {
    if (error) {
      *error = "unknown parameter '" + paramName + "' for " + rec.type;
    }
    return false;
  }
  std::vector<std::pair<std::string, std::string>> deps;
  if (!ParseExpression(expression, &deps, error)) return false;
  // Every reference must resolve NOW (typos fail at set-time, not later).
  for (const auto& [fid, param] : deps) {
    const std::string& target = fid.empty() ? ownerId : fid;
    ShapeRecord ref;
    if (!ShapeStore::instance().get(target, &ref) ||
        ParamIndexOf(ref.type, param, ref.paramsMm.size()) < 0) {
      if (error) {
        *error = "unknown reference '" +
                 (fid.empty() ? param : fid + "." + param) + "'";
      }
      return false;
    }
  }
  Resolver resolver{error};
  double value = 0;
  if (!EvaluateExpression(expression, ownerId, &Resolver::call, &resolver,
                          &value, error)) {
    return false;
  }
  if (!CheckValueRange(paramName, value, error)) return false;
  *out = value;
  return true;
}

bool EvaluateAllExpressions(std::vector<std::string>* changed,
                            std::string* error) {
  if (!changed) {
    if (error) *error = "internal error: null out-param";
    return false;
  }
  changed->clear();
  const std::vector<ExpressionEntry> entries =
      ExpressionStore::instance().listInOrder();
  if (entries.empty()) return true;
  // C1 two-phase: resolve everything against a scratch copy first, apply to
  // ShapeStore only after ALL entries validate. A mid-fixpoint failure
  // (div0/cycle/range) must leave the store untouched.
  std::map<std::string, ShapeRecord> scratch;
  for (const auto& r : ShapeStore::instance().listInOrder()) scratch[r.featureId] = r;
  struct ScratchCtx {
    std::map<std::string, ShapeRecord>* scratch;
    std::string* error;
  };
  auto scratchResolve = [](const std::string& fid, const std::string& param,
                           double* out, void* ctx) -> bool {
    auto* s = static_cast<ScratchCtx*>(ctx);
    auto it = s->scratch->find(fid);
    if (it == s->scratch->end()) {
      if (s->error && s->error->empty()) {
        *s->error = "unknown reference '" + fid + "." + param + "'";
      }
      return false;
    }
    const int idx = ParamIndexOf(it->second.type, param, it->second.paramsMm.size());
    if (idx < 0 || static_cast<size_t>(idx) >= it->second.paramsMm.size()) {
      if (s->error && s->error->empty()) {
        *s->error = "unknown reference '" + fid + "." + param + "'";
      }
      return false;
    }
    *out = it->second.paramsMm[static_cast<size_t>(idx)];
    return true;
  };
  std::set<std::string> changedSet;
  // Bounded fixpoint: deterministic evaluation converges exactly when the
  // dependency graph is acyclic; exhaustion means a cycle.
  for (size_t pass = 0; pass <= entries.size(); ++pass) {
    bool moved = false;
    for (const ExpressionEntry& e : entries) {
      auto it = scratch.find(e.featureId);
      if (it == scratch.end()) continue;
      ShapeRecord& rec = it->second;
      const int idx = ParamIndexOf(rec.type, e.paramName, rec.paramsMm.size());
      if (idx < 0) {
        if (error) {
          *error = "unknown parameter '" + e.paramName + "' for " + rec.type;
        }
        return false;
      }
      ScratchCtx sctx{&scratch, error};
      double value = 0;
      if (!EvaluateExpression(e.expression, e.featureId, scratchResolve,
                              &sctx, &value, error)) {
        return false;
      }
      std::string rangeErr;
      if (!CheckValueRange(e.paramName, value, &rangeErr)) {
        if (error) {
          *error = e.featureId + "." + e.paramName + " = " + e.expression +
                   ": " + rangeErr;
        }
        return false;
      }
      if (value != rec.paramsMm[static_cast<size_t>(idx)]) {
        rec.paramsMm[static_cast<size_t>(idx)] = value;
        moved = true;
        changedSet.insert(e.featureId);
      }
    }
    if (!moved) {
      // All validated: commit scratch → store in one pass.
      for (const auto& fid : changedSet) {
        auto it = scratch.find(fid);
        if (it != scratch.end()) ShapeStore::instance().put(it->second);
      }
      *changed = std::vector<std::string>(changedSet.begin(), changedSet.end());
      return true;
    }
  }
  if (error) *error = "cyclic expressions (A depends on B depends on A)";
  return false;
}

std::string SerializeExpressionMap(
    const std::map<std::string, std::string>& entries) {
  std::string out = "{";
  bool first = true;
  for (const auto& [param, expr] : entries) {
    if (!first) out += ",";
    first = false;
    out += "\"" + param + "\":\"" + expr + "\"";
  }
  out += "}";
  return out;
}

bool ParseExpressionMap(const std::string& text,
                        std::map<std::string, std::string>* out,
                        std::string* error) {
  if (!out) {
    if (error) *error = "internal error: null out-param";
    return false;
  }
  out->clear();
  size_t p = 0;
  auto fail = [&](const std::string& m) {
    if (error && error->empty()) *error = m;
    return false;
  };
  auto skip = [&]() {
    while (p < text.size() && (text[p] == ' ' || text[p] == '\t' ||
                               text[p] == '\n' || text[p] == '\r')) {
      ++p;
    }
  };
  auto quoted = [&](std::string* s) -> bool {
    if (p >= text.size() || text[p] != '"') return fail("expected string");
    ++p;
    s->clear();
    while (p < text.size() && text[p] != '"') {
      // Store charset excludes quotes/backslashes/controls by construction.
      const unsigned char c = text[p];
      if (c < 0x20 || c == '\\') return fail("bad string");
      s->push_back(text[p]);
      ++p;
    }
    if (p >= text.size()) return fail("unterminated string");
    ++p;
    return true;
  };
  skip();
  if (p >= text.size() || text[p] != '{') return fail("expected object");
  ++p;
  skip();
  if (p < text.size() && text[p] == '}') {
    ++p;
    return true;
  }
  while (true) {
    skip();
    std::string key, val;
    if (!quoted(&key)) return false;
    skip();
    if (p >= text.size() || text[p] != ':') return fail("expected ':'");
    ++p;
    skip();
    if (!quoted(&val)) return false;
    (*out)[key] = val;
    skip();
    if (p >= text.size()) return fail("unterminated object");
    if (text[p] == ',') {
      ++p;
      continue;
    }
    if (text[p] == '}') {
      ++p;
      return true;
    }
    return fail("expected ',' or '}'");
  }
}

}  // namespace kreoda
