#pragma once
#include "body.h"
#include "feature_graph.h"
#include "shapes.h"
#include "../document/document_store.h"
#include "../expressions/expressions.h"
#include "../features/datum/datum_store.h"
#include "../features/sketch/sketch_store.h"

namespace kreoda {
// In-memory pre-images; callers separately abort/resync their OCAF command.
// Preserve order and shared native shape identity, including healthy branches.
struct ModelSnapshot {
  std::vector<ShapeRecord> shapes=ShapeStore::instance().listInOrder();
  std::vector<SketchFeature> sketches=SketchStore::instance().listInOrder();
  std::vector<DatumRecord> datums=DatumStore::instance().listInOrder();
  std::vector<BodyRecord> bodies=BodyStore::instance().bodies();
  std::vector<ExpressionEntry> expressions=ExpressionStore::instance().listInOrder();
  FeatureGraph graph=TheFeatureGraph();
  std::map<std::string,std::string> registry=DocumentStore::instance().snapshotRegistry();
  std::string documentId=DocumentStore::instance().snapshotDocumentId();
  int64_t revision=DocumentStore::instance().snapshotRevision();
  void restore() const {
    ShapeStore::instance().clear();for(const auto& record:shapes)ShapeStore::instance().put(record);
    SketchStore::instance().clear();for(const auto& record:sketches)SketchStore::instance().put(record);
    DatumStore::instance().clear();for(const auto& record:datums)DatumStore::instance().put(record);
    BodyStore::instance().replaceAll(bodies);
    ExpressionStore::instance().clear();for(const auto& entry:expressions)ExpressionStore::instance().set(entry.featureId,entry.paramName,entry.expression);
    TheFeatureGraph()=graph;
    DocumentStore::instance().restoreSnapshot(documentId,revision,registry);
  }
};
}
