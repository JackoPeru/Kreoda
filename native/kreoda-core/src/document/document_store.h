#pragma once

#include <cstdint>
#include <map>
#include <mutex>
#include <string>

namespace kreoda {

// Serialized per-document mutation queue owner (§40). OCAF document +
// transactions back this in Phase 3; Phase 0 keeps revision + registry so the
// IPC contract and Undo mapping (§12) are already exercised.
class DocumentStore {
 public:
  static DocumentStore& instance();

  void create(const std::string& documentId);
  int64_t revision() const { return revision_; }
  void commit();

  void registerFeature(const std::string& featureId, const std::string& type);
  // Records the entry without a revision step (resync paths bump once).
  void noteFeature(const std::string& featureId, const std::string& type);
  // Replaces the whole registry (resync after Undo/Redo/Open, §12).
  void replaceAll(const std::map<std::string, std::string>& entries);
  bool hasFeature(const std::string& featureId) const;
  // C5 snapshot/restore: a failed Open/Import must leave the current
  // document untouched (create-before-load destroyed work).
  std::map<std::string, std::string> snapshotRegistry() const;
  int64_t snapshotRevision() const;
  std::string snapshotDocumentId() const;
  void restoreSnapshot(const std::string& documentId, int64_t revision,
                       const std::map<std::string, std::string>& entries);

 private:
  DocumentStore() = default;
  mutable std::mutex mutex_;
  std::string documentId_ = "doc-bootstrap";
  int64_t revision_ = 0;
  std::map<std::string, std::string> features_;
};

}  // namespace kreoda
