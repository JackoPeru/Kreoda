#pragma once

#include <map>
#include <string>
#include <vector>

#include "../model/shapes.h"

namespace kreoda {

// Live OCAF document (§3): one BinXCAF document for the process lifetime.
// Every feature owns a label (UUID name + params comment + XCAF shape).
// Rebuilds replace the label solid via SetShape (one whole-solid evolution);
// face selections persist as TNaming_Selector references under a dedicated
// folder, resolved via TNaming_Tool::CurrentShape first and the semantic
// role fallback second (§4, the tested contract — no reader asserts the
// naming path). Per-face Generated evolution on feature labels was removed
// in Phase 10: it made GetShape resolve to a face compound, silently
// corrupting downstream booleans after Undo/Redo/Open.
class OcafLive {
 public:
  static OcafLive& instance();

  // Fresh empty document (new document / before open).
  void Reset();

  // Transaction boundary (§12): every modeling op runs inside exactly one
  // OpenCommand/CommitCommand pair, so one user action == one Undo delta.
  // Returns false (with error) if a command is already open (no nesting).
  bool BeginCommand(std::string* error);
  // True when the command recorded a delta (i.e. an Undo step now exists).
  bool CommitCommand(bool* hadDelta, std::string* error);
  void AbortCommand();

  bool Undo(std::string* error);
  bool Redo(std::string* error);
  int AvailableUndos() const;
  int AvailableRedos() const;
  // Rebuild the in-memory store from live OCAF labels (after Undo/Redo/Open).
  bool ResyncStore(std::string* error);

  // Mirror a created (isNew) or rebuilt feature into OCAF + TNaming.
  bool UpsertFeature(const ShapeRecord& rec, bool isNew, std::string* error);

  // M4: drop in-memory label-map entries for ids that were never committed
  // (aborted transaction + failed resync). The OCAF document already rolled
  // back via AbortCommand; without this the maps point at detached labels
  // and the next Upsert takes the rebuild path on a ghost label.
  void ForgetFeatures(const std::vector<std::string>& featureIds);
  // Expression labels (§22/Phase 9a): one label per feature carrying
  // formulas, name=feature UUID + comment=JSON object {param: expression}.
  // Mirrors the sketch pattern: mutations run inside the caller's OCAF
  // command so Undo/Redo restores formulas with geometry.
  bool UpsertExpressions(const std::string& featureId,
                         const std::string& exprJson, std::string* error);

  // Sketch labels (§21): sketches live under a Sketches folder as
  // name=sketch UUID + comment=serialized SketchFeature JSON. Mutations run
  // inside the caller's OCAF command so Undo/Redo restores them.
  bool UpsertSketch(const std::string& sketchId, const std::string& sketchJson,
                    std::string* error);
  bool SketchLabelEntries(std::vector<std::pair<std::string, std::string>>* out);

  struct FaceSelection {
    std::string entry;      // TDF_Label entry — stable across save/load
    std::string featureId;  // redundant by design (entry is opaque)
    std::string role;       // semantic fallback (§4)
  };

  // Persistent face pick: TNaming_Selector reference + role fallback data.
  bool SelectFace(const std::string& featureId, const std::string& role,
                  FaceSelection* out, std::string* error);

  struct ResolveResult {
    bool valid = false;
    std::string via;   // "naming" | "role" | ""
    std::string role;  // resolved role when known
  };
  ResolveResult ResolveSelection(const FaceSelection& sel);

  bool Save(const std::string& xbfPath, std::string* error);
  // Opens into the live doc and rebuilds label/selection maps.
  // Fills records (solids) and sketchJsons (serialized SketchFeatures).
  bool Load(const std::string& xbfPath, std::vector<ShapeRecord>* records,
            std::vector<std::string>* sketchJsons, std::string* error);
  // Back-compat overload (solids only).
  bool Load(const std::string& xbfPath, std::vector<ShapeRecord>* records,
            std::string* error);

 private:
  OcafLive() = default;
  OcafLive(const OcafLive&) = delete;
  OcafLive& operator=(const OcafLive&) = delete;

#if KREODA_WITH_OCCT
  struct Ocaf;
  Ocaf* ocaf_ = nullptr;  // pimpl: OCCT handles stay out of the header
#endif
  std::string documentId_ = "doc-bootstrap";
};

}  // namespace kreoda
