#include "shapes.h"

#include <algorithm>

namespace kreoda {

ShapeStore& ShapeStore::instance() {
  static ShapeStore store;
  return store;
}

void ShapeStore::clear() {
  std::lock_guard<std::mutex> lock(mutex_);
  shapes_.clear();
  order_.clear();
}

void ShapeStore::put(ShapeRecord record) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (shapes_.find(record.featureId) == shapes_.end()) {
    order_.push_back(record.featureId);
  }
  shapes_[record.featureId] = std::move(record);
}

bool ShapeStore::get(const std::string& featureId, ShapeRecord* out) const {
  std::lock_guard<std::mutex> lock(mutex_);
  const auto it = shapes_.find(featureId);
  if (it == shapes_.end()) return false;
  if (out) *out = it->second;
  return true;
}

bool ShapeStore::contains(const std::string& featureId) const {
  std::lock_guard<std::mutex> lock(mutex_);
  return shapes_.find(featureId) != shapes_.end();
}

bool ShapeStore::remove(const std::string& featureId) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (shapes_.erase(featureId) == 0) return false;
  order_.erase(std::remove(order_.begin(), order_.end(), featureId),
               order_.end());
  return true;
}

std::vector<ShapeRecord> ShapeStore::listInOrder() const {
  std::lock_guard<std::mutex> lock(mutex_);
  std::vector<ShapeRecord> out;
  out.reserve(order_.size());
  for (const auto& id : order_) {
    const auto it = shapes_.find(id);
    if (it != shapes_.end()) out.push_back(it->second);
  }
  return out;
}

bool ShapeStore::ValidFeatureId(const std::string& id) {
  if (id.empty() || id.size() > 128) return false;
  for (char c : id) {
    const bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                    (c >= '0' && c <= '9') || c == '-' || c == '_';
    if (!ok) return false;
  }
  return true;
}

}  // namespace kreoda
