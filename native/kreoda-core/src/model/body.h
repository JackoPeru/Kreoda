#pragma once

#include <string>
#include <vector>

#include "shapes.h"

namespace kreoda {

// Slice 2: Body/Feature data model. A Body is an ordered history of solid
// feature UUIDs plus a tip pointer (the visible result). Historical
// ShapeRecords stay in ShapeStore (needed for recompute/history); the tip is
// what distinguishes the visible result. Feature UUID stability is untouched
// (existing ids are never renamed). Body ids live in their own conceptual
// namespace but obey the same [A-Za-z0-9_-] charset rule (§10).

// Central feature→body semantics table (ONE place — no UI conditionals):
enum class BodySemantics {
  // Opens a fresh body (history = {feature}, tip = feature).
  NewBody,
  // Joins the deps[0] target's body (history append, tip = new feature).
  AdvancesBody,
  // Never a member of any body.
  NonBody,
};

// NewBody: Box, Cylinder, Sphere (deps-free roots) + Extrude, Revolve (the dep
// is a Sketch — NonBody, so there is no target body to advance; the prism/
// revolved solid is a fresh root, same as a primitive) + StepImport,
// MeshImport (each imported solid is its own root) + unknown solid types
// (defensive: an unrecognized type still belongs in exactly one body).
// AdvancesBody: Hole, Fillet, Chamfer (deps[0] = target solid) + HolePattern
// members (each committed as a "Hole" record) + Union, Subtract, Intersect
// (boolean result advances the deps[0] TARGET body and becomes its tip; the
// tool body is left untouched with its old tip — least churn vs merging
// histories, and same-body deps collapse naturally).
// NonBody: Sketch (lives in SketchStore, never ShapeStore) + Instance
// (assembly occurrence reference per Phase 9d, not a body edit).
BodySemantics FeatureBodySemantics(const std::string& type);

struct BodyRecord {
  std::string bodyId;
  std::vector<std::string> history;  // ordered feature ids, creation order
  std::string tipFeatureId;          // visible result (normally history.back())
};

class BodyStore {
 public:
  static BodyStore& instance();

  void clear();
  std::vector<BodyRecord> bodies() const;  // creation order
  size_t size() const;
  bool get(const std::string& bodyId, BodyRecord* out) const;
  bool bodyForFeature(const std::string& featureId, BodyRecord* out) const;

  // Incremental commit hook (called by CommitShape AFTER the OCAF mirror
  // succeeds, so store/OCAF/body never diverge; rebuilds with isNew=false
  // re-anchor the tip (Slice 3 tip-follow — normally a no-op since history
  // order never changes; failures never reach here, so the tip always names
  // the last successfully recomputed history feature).
  void noteCommitted(const std::string& featureId, const std::string& type,
                     const std::vector<std::string>& dependsOn, bool isNew);
  // Slice 3 tip-follow: after a successful recompute, repair any tip drift
  // back to history.back(). No-op when already anchored or unknown id.
  void noteRecomputed(const std::string& featureId);
  // Rollback helper (hole-pattern / multi-import abort paths): drops the
  // feature from its body; an emptied body vanishes; a removed tip falls
  // back to the new history.back().
  bool removeFeature(const std::string& featureId);
  // Migration rule (legacy .icad without body info + every ResyncStore):
  // root features (no target dep) open bodies; downstream features join
  // their target's body in creation order. Deterministic: body ids derive
  // from the root feature id, so rebuild == incremental state.
  void rebuildFromRecords(const std::vector<ShapeRecord>& recordsInOrder);
  // Trusted replace (snapshot restore, validated manifest adopt).
  void replaceAll(const std::vector<BodyRecord>& bodies);

  static bool ValidBodyId(const std::string& id);
  static std::string BodyIdForRoot(const std::string& rootFeatureId);

 private:
  BodyStore() = default;
  void attach(const std::string& featureId, const std::string& type,
              const std::vector<std::string>& dependsOn);
  std::vector<BodyRecord> bodies_;
};

// .icad manifest persistence (§30): bodies ride in manifest.json
// ("bodies":[{"id","history":[...],"tip"}]) next to the XBF blob.
std::string SerializeBodiesJson();
// False when the manifest has no (or a corrupt) bodies section → caller
// falls back to rebuildFromRecords (legacy migration). Never fails an open.
bool ParseBodiesJson(const std::string& manifest,
                     std::vector<BodyRecord>* out);
// Manifest-adopt gate: every history id must exist in the loaded records,
// tip == history.back(), no id in two bodies.
bool BodiesMatchRecords(const std::vector<BodyRecord>& bodies,
                        const std::vector<ShapeRecord>& records);

}  // namespace kreoda
