#pragma once

#include <cmath>
#include <map>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>
#include "document/document_store.h"
#include "features/primitives/primitives.h"
#include "model/shapes.h"
#include "persistence/ocaf_live.h"

namespace kreoda {

// Stable feature UUID -> canonical parameter name -> finite mm value.
using ConfigurationOverrides = std::map<std::string,std::map<std::string,double>>;

inline bool ReadConfigurationDocument(nlohmann::json* doc,std::string* error) {
  std::string raw;
  if (!OcafLive::instance().ReadConfigurations(&raw,error)) return false;
  try {
    *doc=raw.empty() ? nlohmann::json{{"active",""},{"named",nlohmann::json::object()}}
                     : nlohmann::json::parse(raw);
    if (!doc->is_object() || !doc->contains("active") || !doc->at("active").is_string() ||
        !doc->contains("named") || !doc->at("named").is_object())
      throw std::runtime_error("invalid configuration metadata");
    return true;
  } catch (const std::exception& ex) {
    if (error) *error=ex.what(); return false;
  }
}

inline bool DefineConfiguration(const std::string& name,
                                const ConfigurationOverrides& overrides,
                                std::string* error) {
  if (name.empty() || name.size()>64 || overrides.empty()) {
    if (error) *error="configuration name and overrides required"; return false;
  }
  nlohmann::json doc;
  if (!ReadConfigurationDocument(&doc,error)) return false;
  nlohmann::json entries=nlohmann::json::object();
  for (const auto& [id,params]:overrides) {
    ShapeRecord record;
    if (!ShapeStore::instance().get(id,&record) || params.empty()) {
      if (error) *error="unknown or empty configuration feature "+id; return false;
    }
    for (const auto& [param,value]:params) {
      std::vector<double> candidate;
      if (!std::isfinite(value) || !ResolveParamsForEdit(record,param,value,&candidate,error)) return false;
      record.paramsMm=std::move(candidate);
    }
    // Parameter schema validation alone does not enforce kernel geometry
    // bounds (e.g. negative box dimensions); preflight detached geometry.
    auto first=params.begin();
    std::map<std::string,double> other(params);
    other.erase(first->first);
    CoreMesh preview;
    if (!BuildPreviewBodyMesh(id,first->first,first->second,id,&preview,error,"",other))
      return false;
    entries[id]=params;
  }
  doc["named"][name]=std::move(entries);
  if (!OcafLive::instance().BeginCommand(error)) return false;
  if (!OcafLive::instance().WriteConfigurations(doc.dump(),error)) {
    OcafLive::instance().AbortCommand(); return false;
  }
  bool delta=false;
  if (!OcafLive::instance().CommitCommand(&delta,error)) return false;
  if (delta) DocumentStore::instance().commit();
  return true;
}

inline bool ActivateConfiguration(const std::string& name,std::string* error) {
  nlohmann::json doc;
  if (!ReadConfigurationDocument(&doc,error)) return false;
  if (!doc["named"].contains(name)) {
    if (error) *error="unknown configuration "+name; return false;
  }
  if (doc["active"]==name) return true;
  // Validate every requested value before beginning any mutation.
  const auto& entries=doc["named"][name];
  if (!entries.is_object()) { if (error) *error="invalid configuration entries"; return false; }
  try {
    for (auto it=entries.begin();it!=entries.end();++it) {
      ShapeRecord record;
      if (!ShapeStore::instance().get(it.key(),&record) || !it.value().is_object()) {
        if (error) *error="missing configuration feature "+it.key(); return false;
      }
      for (auto param=it.value().begin();param!=it.value().end();++param) {
        if (!param.value().is_number()) { if (error) *error="non-numeric override"; return false; }
        const double value=param.value().get<double>();
        std::vector<double> candidate;
        if (!std::isfinite(value) || !ResolveParamsForEdit(record,param.key(),value,&candidate,error)) return false;
        record.paramsMm=std::move(candidate);
      }
    }
  } catch (const std::exception& ex) { if (error) *error=ex.what(); return false; }
  const std::string transactionId="configuration-"+name;
  if (!OcafLive::instance().BeginTransaction(transactionId,error)) return false;
  bool ok=true;
  for (auto it=entries.begin();it!=entries.end() && ok;++it) {
    const auto params=it.value().get<std::map<std::string,double>>();
    auto first=params.begin();
    if (first==params.end()) continue;
    std::map<std::string,double> other(params);
    other.erase(first->first);
    ok=RebuildFeature(it.key(),first->first,first->second,"",error,other);
  }
  if (ok) {
    doc["active"]=name;
    ok=OcafLive::instance().WriteConfigurations(doc.dump(),error);
  }
  if (!ok) {
    std::string rollback;
    OcafLive::instance().RollbackTransaction(transactionId,&rollback);
    return false;
  }
  bool delta=false;
  if (!OcafLive::instance().CommitTransaction(transactionId,&delta,error)) return false;
  if (delta) DocumentStore::instance().commit();
  return true;
}
} // namespace kreoda
