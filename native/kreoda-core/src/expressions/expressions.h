#pragma once

#include <map>
#include <set>
#include <string>
#include <vector>

namespace kreoda {

// Parametric expressions, Phase 9a (§22): a feature parameter may hold a
// formula (`heightMm * 2`, `box-1.widthMm + 5`) instead of a bare number.
// Formulas are core-owned state (ExpressionStore, never UI state), mirrored
// into OCAF expression labels (UpsertExpressions, like sketches), so they
// persist, undo and reopen with the model. Evaluation is a bounded fixpoint
// over stored formulas; cycles and unknown references fail honestly.
// Language: numbers, + - * / parentheses, unary minus, bare refs
// (same-feature param) and dotted refs (featureId.paramName). Millimeters.

struct ExpressionEntry {
  std::string featureId;
  std::string paramName;
  std::string expression;
};

// Canonical parameter slots per feature type (mirrors ResolveParamsForEdit
// in features/primitives — keep the two tables in sync).
// Returns the slot index, or -1 for unknown type/param.
int ParamIndexOf(const std::string& type, const std::string& paramName,
                 size_t paramCount);

// Validate + parse. On success fills deps with referenced (feature or "")
// pairs; bare refs carry "" as the feature (resolved against the owner).
bool ParseExpression(const std::string& text,
                     std::vector<std::pair<std::string, std::string>>* deps,
                     std::string* error);

// Evaluate a validated expression. resolve(fid, param, *value) reads the
// CURRENT staged value; empty fid means the owning feature.
bool EvaluateExpression(const std::string& text, const std::string& ownerId,
                        bool (*resolve)(const std::string&, const std::string&,
                                        double*, void*),
                        void* ctx, double* out, std::string* error);

// Validate + evaluate ONE formula read-only against live store values
// (preview path, set-time validation). Range-checked like staged values.
bool EvaluateOneExpression(const std::string& ownerId,
                           const std::string& paramName,
                           const std::string& expression, double* out,
                           std::string* error);

// Evaluate every stored formula to fixpoint, writing values into ShapeStore
// (caller owns the transaction + rollback). Fills `changed` with the ids
// whose params moved. Fails honestly on cycles, unknown references,
// division by zero and non-positive/out-of-range results. Deterministic:
// same inputs always converge to the same values, so exact-equality
// change detection is sound.
bool EvaluateAllExpressions(std::vector<std::string>* changed,
                            std::string* error);

// Flat JSON codec for OCAF expression labels: {"widthMm":"h*2"}.
// Keys/values are strict-charset (no quotes/backslashes possible), so the
// codec is total on anything the store accepts — garbage fails honestly.
std::string SerializeExpressionMap(
    const std::map<std::string, std::string>& entries);
bool ParseExpressionMap(const std::string& text,
                        std::map<std::string, std::string>* out,
                        std::string* error);

// Serialize one feature's formulas into its OCAF expression label.
// Must run inside the caller's open OCAF command (like UpsertSketch).
bool MirrorFeatureExpressions(const std::string& featureId,
                              std::string* error);

// Process-wide formula registry (§9: canonical state, OCAF-mirrored).
class ExpressionStore {
 public:
  static ExpressionStore& instance();

  void clear();
  // Empty expression removes that parameter's formula.
  void set(const std::string& featureId, const std::string& paramName,
           const std::string& expression);
  bool get(const std::string& featureId, const std::string& paramName,
           std::string* out) const;
  std::vector<ExpressionEntry> listInOrder() const;
  std::map<std::string, std::string> forFeature(
      const std::string& featureId) const;
  void setFeatureMap(const std::string& featureId,
                     const std::map<std::string, std::string>& entries);

 private:
  ExpressionStore() = default;
  std::map<std::string, std::map<std::string, std::string>> exprs_;
};

}  // namespace kreoda
