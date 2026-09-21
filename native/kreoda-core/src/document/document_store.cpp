#include "document_store.h"

#include "model/feature_graph.h"
#include "model/shapes.h"
#include "expressions/expressions.h"
#include "features/sketch/sketch_store.h"
#include "persistence/ocaf_live.h"

namespace kreoda {

DocumentStore& DocumentStore::instance() {
  static DocumentStore store;
  return store;
}

void DocumentStore::create(const std::string& documentId) {
  std::lock_guard<std::mutex> lock(mutex_);
  documentId_ = documentId.empty() ? "doc-bootstrap" : documentId;
  ShapeStore::instance().clear();  // new document owns an empty model (§9)
  SketchStore::instance().clear();  // sketches are part of the model (§21)
  ExpressionStore::instance().clear();  // formulas are part of the model (§22)
#if KREODA_WITH_OCCT
  OcafLive::instance().Reset();  // live OCAF mirrors the empty model (§3)
#endif
  TheFeatureGraph().clear();  // no nodes, no dirty state (§53)
  revision_ = 0;
  features_.clear();
}

void DocumentStore::commit() {
  std::lock_guard<std::mutex> lock(mutex_);
  ++revision_;  // one committed transaction = one Undo step (§12)
}

void DocumentStore::registerFeature(const std::string& featureId,
                                    const std::string& type) {
  std::lock_guard<std::mutex> lock(mutex_);
  features_[featureId] = type;
  ++revision_;
}

void DocumentStore::noteFeature(const std::string& featureId,
                                const std::string& type) {
  std::lock_guard<std::mutex> lock(mutex_);
  features_[featureId] = type;
}

void DocumentStore::replaceAll(
    const std::map<std::string, std::string>& entries) {
  std::lock_guard<std::mutex> lock(mutex_);
  features_ = entries;
}

std::map<std::string, std::string> DocumentStore::snapshotRegistry() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return features_;
}

int64_t DocumentStore::snapshotRevision() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return revision_;
}

std::string DocumentStore::snapshotDocumentId() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return documentId_;
}

void DocumentStore::restoreSnapshot(
    const std::string& documentId, int64_t revision,
    const std::map<std::string, std::string>& entries) {
  std::lock_guard<std::mutex> lock(mutex_);
  documentId_ = documentId;
  revision_ = revision;
  features_ = entries;
}

}  // namespace kreoda
