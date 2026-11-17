#pragma once

#include <map>
#include <string>
#include <vector>

#include "document/document_store.h"
#include "model/shapes.h"

namespace kreoda {

// Phase12 native change-only service. Call CaptureGeometryRevision at both
// revision boundaries. This is not a revision journal or a wire stream.
struct GeometryRevision {
  std::string documentId;
  int64_t revision = 0;
  std::map<std::string, ShapeRecord> features;
};

struct GeometryDelta {
  std::string documentId;
  int64_t baseRevision = 0;
  int64_t revision = 0;
  std::vector<std::string> added;
  std::vector<std::string> updated;
  std::vector<std::string> removed;
  // Only changed/added features require a new full MeshUpdate payload.
  // Removals are explicit IDs, never empty fake meshes.
  std::vector<std::string> changedMeshes;
};

inline GeometryRevision CaptureGeometryRevision() {
  GeometryRevision snapshot;
  snapshot.documentId = DocumentStore::instance().snapshotDocumentId();
  snapshot.revision = DocumentStore::instance().snapshotRevision();
  for (const auto& record : ShapeStore::instance().listInOrder())
    snapshot.features.emplace(record.featureId, record);
  return snapshot;
}

inline bool DiffGeometryRevisions(const GeometryRevision& before,
                                  const GeometryRevision& after,
                                  GeometryDelta* out,
                                  std::string* error = nullptr) {
  if (!out || before.documentId.empty() ||
      before.documentId != after.documentId ||
      before.revision > after.revision) {
    if (error) *error = "incompatible geometry revision snapshots";
    return false;
  }
  GeometryDelta delta;
  delta.documentId = after.documentId;
  delta.baseRevision = before.revision;
  delta.revision = after.revision;
  for (const auto& [id, current] : after.features) {
    const auto old = before.features.find(id);
    if (old == before.features.end()) {
      delta.added.push_back(id);
      delta.changedMeshes.push_back(id);
      continue;
    }
    const auto& previous = old->second;
    bool changed = previous.type != current.type ||
                   previous.paramsMm != current.paramsMm ||
                   previous.dependsOn != current.dependsOn ||
                   previous.refExtra != current.refExtra ||
                   previous.volumeMm3 != current.volumeMm3;
    for (int i = 0; i < 6; ++i)
      changed |= previous.bboxMm[i] != current.bboxMm[i];
#if KREODA_WITH_OCCT
    changed |= !previous.shape.IsSame(current.shape);
#endif
    if (changed) {
      delta.updated.push_back(id);
      delta.changedMeshes.push_back(id);
    }
  }
  for (const auto& [id, old] : before.features)
    if (!after.features.count(id)) delta.removed.push_back(id);
  // A revision without mutations is a legitimate empty delta; a changed
  // model at the SAME revision is not, e.g. a provisional transaction.
  if (before.revision == after.revision &&
      (!delta.added.empty() || !delta.updated.empty() || !delta.removed.empty())) {
    if (error) *error = "uncommitted geometry change: no revision advance";
    return false;
  }
  *out = std::move(delta);
  return true;
}

}  // namespace kreoda
