#include "document_store.h"

#include "model/feature_graph.h"
#include "model/shapes.h"
#include "features/sketch/sketch_store.h"
#include "persistence/ocaf_live.h"

namespace intentcad {

DocumentStore& DocumentStore::instance() {
  static DocumentStore store;
  return store;
}

void DocumentStore::create(const std::string& documentId) {
  std::lock_guard<std::mutex> lock(mutex_);
  documentId_ = documentId.empty() ? "doc-bootstrap" : documentId;
  ShapeStore::instance().clear();  // new document owns an empty model (§9)
  SketchStore::instance().clear();  // sketches are part of the model (§21)
#if INTENTCAD_WITH_OCCT
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

bool DocumentStore::hasFeature(const std::string& featureId) const {
  std::lock_guard<std::mutex> lock(mutex_);
  return features_.count(featureId) > 0;
}

}  // namespace intentcad
