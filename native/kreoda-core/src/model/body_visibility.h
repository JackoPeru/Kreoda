#pragma once

#include "body.h"
#include "persistence/ocaf_live.h"
#include <nlohmann/json.hpp>

namespace kreoda {

// Display suppression only: the B-Rep, history and dependency graph remain
// intact so booleans continue to recompute from hidden cutter bodies.
inline bool SetBodyVisibility(const std::string& bodyId,bool visible,
                              std::string* error) {
  BodyRecord body;
  if (!BodyStore::instance().get(bodyId,&body)) {
    if (error) *error="unknown body"; return false;
  }
  if (body.visible==visible) return true;
  auto& ocaf=OcafLive::instance();
  if (!ocaf.BeginCommand(error)) return false;
  std::string stored;
  if (!ocaf.ReadBodyVisibility(&stored,error)) { ocaf.AbortCommand(); return false; }
  nlohmann::json state=nlohmann::json::object();
  try { if (!stored.empty()) state=nlohmann::json::parse(stored); }
  catch (...) { ocaf.AbortCommand(); if (error) *error="invalid stored visibility"; return false; }
  if (!state.is_object()) { ocaf.AbortCommand(); if (error) *error="invalid stored visibility"; return false; }
  state[bodyId]=visible;
  if (!ocaf.WriteBodyVisibility(state.dump(),error)) { ocaf.AbortCommand(); return false; }
  bool delta=false;
  if (!ocaf.CommitCommand(&delta,error)) { ocaf.AbortCommand(); return false; }
  BodyStore::instance().setVisible(bodyId,visible);
  return true;
}

} // namespace kreoda
