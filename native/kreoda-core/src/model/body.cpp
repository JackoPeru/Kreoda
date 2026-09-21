#include "body.h"

#include <map>
#include <set>

namespace kreoda {

BodySemantics FeatureBodySemantics(const std::string& type) {
  if (type == "Hole" || type == "HolePattern" || type == "Fillet" ||
      type == "Chamfer" || type == "Union" || type == "Subtract" ||
      type == "Intersect") {
    return BodySemantics::AdvancesBody;
  }
  if (type == "Sketch" || type == "Instance") {
    return BodySemantics::NonBody;
  }
  return BodySemantics::NewBody;
}

BodyStore& BodyStore::instance() {
  static BodyStore store;
  return store;
}

void BodyStore::clear() { bodies_.clear(); }

std::vector<BodyRecord> BodyStore::bodies() const { return bodies_; }

size_t BodyStore::size() const { return bodies_.size(); }

bool BodyStore::get(const std::string& bodyId, BodyRecord* out) const {
  for (const auto& b : bodies_) {
    if (b.bodyId == bodyId) {
      if (out) *out = b;
      return true;
    }
  }
  return false;
}

bool BodyStore::bodyForFeature(const std::string& featureId,
                               BodyRecord* out) const {
  for (const auto& b : bodies_) {
    for (const auto& id : b.history) {
      if (id == featureId) {
        if (out) *out = b;
        return true;
      }
    }
  }
  return false;
}

bool BodyStore::ValidBodyId(const std::string& id) {
  return ShapeStore::ValidFeatureId(id);  // same [A-Za-z0-9_-] rule (§10)
}

std::string BodyStore::BodyIdForRoot(const std::string& rootFeatureId) {
  return "body-" + rootFeatureId;
}

void BodyStore::attach(const std::string& featureId, const std::string& type,
                       const std::vector<std::string>& dependsOn) {
  if (FeatureBodySemantics(type) == BodySemantics::NonBody) return;
  if (bodyForFeature(featureId, nullptr)) return;  // idempotent (rebuilds)
  if (FeatureBodySemantics(type) == BodySemantics::NewBody) {
    BodyRecord b;
    b.bodyId = BodyIdForRoot(featureId);
    b.history.push_back(featureId);
    b.tipFeatureId = featureId;
    bodies_.push_back(std::move(b));
    return;
  }
  // AdvancesBody: join the deps[0] target's body. Fallback (target missing,
  // a sketch, or an Instance — none of which own a body): root a fresh body
  // so every solid feature still belongs to exactly one body.
  const std::string target = dependsOn.empty() ? "" : dependsOn[0];
  for (auto& b : bodies_) {
    for (const auto& id : b.history) {
      if (id == target) {
        b.history.push_back(featureId);
        b.tipFeatureId = featureId;
        return;
      }
    }
  }
  BodyRecord b;
  b.bodyId = BodyIdForRoot(featureId);
  b.history.push_back(featureId);
  b.tipFeatureId = featureId;
  bodies_.push_back(std::move(b));
}

void BodyStore::noteCommitted(const std::string& featureId,
                               const std::string& type,
                               const std::vector<std::string>& dependsOn,
                               bool isNew) {
  if (!isNew) {
    noteRecomputed(featureId);  // Slice 3: tip follows the recompute result
    return;
  }
  attach(featureId, type, dependsOn);
}

void BodyStore::noteRecomputed(const std::string& featureId) {
  for (auto& b : bodies_) {
    for (const auto& id : b.history) {
      if (id == featureId) {
        if (!b.history.empty() && b.tipFeatureId != b.history.back()) {
          b.tipFeatureId = b.history.back();
        }
        return;
      }
    }
  }
}

bool BodyStore::removeFeature(const std::string& featureId) {
  for (auto it = bodies_.begin(); it != bodies_.end(); ++it) {
    for (auto h = it->history.begin(); h != it->history.end(); ++h) {
      if (*h == featureId) {
        it->history.erase(h);
        if (it->history.empty()) {
          bodies_.erase(it);
        } else if (it->tipFeatureId == featureId) {
          it->tipFeatureId = it->history.back();
        }
        return true;
      }
    }
  }
  return false;
}

void BodyStore::rebuildFromRecords(
    const std::vector<ShapeRecord>& recordsInOrder) {
  bodies_.clear();
  for (const auto& rec : recordsInOrder) {
    attach(rec.featureId, rec.type, rec.dependsOn);
  }
}

void BodyStore::replaceAll(const std::vector<BodyRecord>& bodies) {
  bodies_ = bodies;
}

std::string SerializeBodiesJson() {
  // Feature/body ids obey [A-Za-z0-9_-] — no JSON escaping needed.
  std::string s = "[";
  bool first = true;
  for (const auto& b : BodyStore::instance().bodies()) {
    if (!first) s += ",";
    first = false;
    s += "{\"id\":\"" + b.bodyId + "\",\"history\":[";
    for (size_t i = 0; i < b.history.size(); ++i) {
      if (i) s += ",";
      s += "\"" + b.history[i] + "\"";
    }
    s += "],\"tip\":\"" + b.tipFeatureId + "\"}";
  }
  return s + "]";
}

namespace {

// Minimal tolerant scanners (manifest.json is machine-written; anything
// unexpected → false → migration rebuild, never a failed open).
bool ExtractQuoted(const std::string& s, size_t* pos, std::string* out) {
  const size_t q = s.find('"', *pos);
  if (q == std::string::npos) return false;
  const size_t e = s.find('"', q + 1);
  if (e == std::string::npos) return false;
  *out = s.substr(q + 1, e - q - 1);
  *pos = e + 1;
  return true;
}

bool ExtractStringField(const std::string& obj, const std::string& key,
                        std::string* out) {
  const size_t k = obj.find("\"" + key + "\"");
  if (k == std::string::npos) return false;
  const size_t c = obj.find(':', k);
  if (c == std::string::npos) return false;
  size_t pos = c + 1;
  return ExtractQuoted(obj, &pos, out);
}

}  // namespace

bool ParseBodiesJson(const std::string& manifest,
                     std::vector<BodyRecord>* out) {
  if (!out) return false;
  const size_t k = manifest.find("\"bodies\"");
  if (k == std::string::npos) return false;  // legacy file → migrate
  const size_t open = manifest.find('[', k);
  if (open == std::string::npos) return false;
  std::vector<BodyRecord> bodies;
  size_t pos = open + 1;
  while (true) {
    const size_t ob = manifest.find('{', pos);
    const size_t ce = manifest.find(']', pos);
    if (ob == std::string::npos || (ce != std::string::npos && ce < ob)) break;
    const size_t oe = manifest.find('}', ob);
    if (oe == std::string::npos) return false;
    const std::string obj = manifest.substr(ob, oe - ob + 1);
    BodyRecord b;
    if (!ExtractStringField(obj, "id", &b.bodyId)) return false;
    if (!ExtractStringField(obj, "tip", &b.tipFeatureId)) return false;
    // history array: collect every quoted string inside it.
    const size_t hk = obj.find("\"history\"");
    if (hk == std::string::npos) return false;
    const size_t ha = obj.find('[', hk);
    const size_t he = obj.find(']', hk);
    if (ha == std::string::npos || he == std::string::npos || he < ha) {
      return false;
    }
    size_t hp = ha + 1;
    while (true) {
      const size_t q = obj.find('"', hp);
      if (q == std::string::npos || q > he) break;
      std::string id;
      if (!ExtractQuoted(obj, &hp, &id)) return false;
      b.history.push_back(id);
    }
    bodies.push_back(std::move(b));
    pos = oe + 1;
  }
  *out = std::move(bodies);
  return true;
}

bool BodiesMatchRecords(const std::vector<BodyRecord>& bodies,
                        const std::vector<ShapeRecord>& records) {
  std::map<std::string, bool> known;
  for (const auto& r : records) known[r.featureId] = true;
  std::set<std::string> seen;
  for (const auto& b : bodies) {
    if (!BodyStore::ValidBodyId(b.bodyId)) return false;
    if (b.history.empty() || b.tipFeatureId != b.history.back()) return false;
    for (const auto& id : b.history) {
      if (known.find(id) == known.end()) return false;
      if (!seen.insert(id).second) return false;  // id in two bodies
    }
  }
  // Every solid feature must belong to exactly one body (adopt must never
  // silently drop coverage — otherwise fall back to the migration rebuild).
  for (const auto& r : records) {
    if (FeatureBodySemantics(r.type) == BodySemantics::NonBody) continue;
    if (seen.find(r.featureId) == seen.end()) return false;
  }
  return true;
}

}  // namespace kreoda
