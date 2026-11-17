#pragma once

#include <cmath>
#include <map>
#include <set>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>
#include "document/document_store.h"
#include "expressions/expressions.h"
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
    *doc=raw.empty() ? nlohmann::json{{"active",""},{"named",nlohmann::json::object()},
                                      {"base",nlohmann::json::object()}}
                     : nlohmann::json::parse(raw);
    if (!doc->is_object() || !doc->contains("active") || !doc->at("active").is_string() ||
        !doc->contains("named") || !doc->at("named").is_object())
      throw std::runtime_error("invalid configuration metadata");
    // Older files have no baseline. Only an inactive legacy document can
    // safely take a new baseline from the current model.
    if (!doc->contains("base")) (*doc)["base"]=nlohmann::json::object();
    if (!doc->at("base").is_object())
      throw std::runtime_error("invalid configuration baseline metadata");
    return true;
  } catch (const std::exception& ex) {
    if (error) *error=ex.what(); return false;
  }
}

// The base is part of the OCAF configuration document. No process-global
// cache: undo/redo and opening a .icad file restore the correct pre-images.
inline bool EnsureConfigurationBase(nlohmann::json* doc,const std::string& id,
                                    const ShapeRecord& record,
                                    const nlohmann::json& previous,
                                    std::string* error) {
  const auto slots=DescribeParams(record.type);
  if (slots.empty() || slots.size()!=record.paramsMm.size()) {
    if (error) *error="configuration feature has no canonical parameter schema: "+id;
    return false;
  }
  auto& base=(*doc)["base"];
  if (!base.contains(id)) {
    if (previous.contains(id)) {
      if (error) *error="missing persisted baseline for active configuration feature "+id;
      return false;
    }
    nlohmann::json params=nlohmann::json::object();
    for (size_t i=0;i<slots.size();++i) {
      if (!std::isfinite(record.paramsMm[i])) {
        if (error) *error="non-finite configuration baseline for "+id;
        return false;
      }
      params[slots[i]]=record.paramsMm[i];
    }
    base[id]=std::move(params);
  }
  const auto& params=base[id];
  if (!params.is_object() || params.size()!=slots.size()) {
    if (error) *error="invalid persisted configuration baseline for "+id;
    return false;
  }
  for (const auto& slot:slots) {
    if (!params.contains(slot) || !params[slot].is_number() ||
        !std::isfinite(params[slot].get<double>())) {
      if (error) *error="invalid persisted baseline parameter "+id+"."+slot;
      return false;
    }
  }
  return true;
}

// While Base is active, canonical dimension edits change the actual Base.
// Capture those values just before leaving it; the caller persists this local
// document alongside the activation in ONE OCAF transaction. Include dormant
// named features so a later named->named switch never captures an overridden
// model value as a missing baseline. Never run this for an active named config.
inline bool RefreshConfigurationBaseOnDeparture(nlohmann::json* doc,std::string* error) {
  std::set<std::string> featureIds;
  for (auto it=doc->at("base").begin();it!=doc->at("base").end();++it)
    featureIds.insert(it.key());
  for (auto named=doc->at("named").begin();named!=doc->at("named").end();++named) {
    if (!named.value().is_object()) {
      if (error) *error="invalid configuration entries for "+named.key();
      return false;
    }
    for (auto feature=named.value().begin();feature!=named.value().end();++feature)
      featureIds.insert(feature.key());
  }
  for (const auto& id:featureIds) {
    ShapeRecord record;
    if (!ShapeStore::instance().get(id,&record)) {
      if (error) *error="missing configuration feature "+id;
      return false;
    }
    // Validate any persisted pre-image before replacing it; a corrupt Base
    // must not be silently repaired with unrelated live model values.
    if (!EnsureConfigurationBase(doc,id,record,nlohmann::json::object(),error)) return false;
    const auto slots=DescribeParams(record.type);
    for (size_t i=0;i<slots.size();++i) {
      if (!std::isfinite(record.paramsMm[i])) {
        if (error) *error="non-finite configuration baseline for "+id;
        return false;
      }
      (*doc)["base"][id][slots[i]]=record.paramsMm[i];
    }
  }
  return true;
}

inline bool ConfigurationEntries(const nlohmann::json& doc,
                                 const std::string& name,nlohmann::json* entries,
                                 std::string* error) {
  *entries=nlohmann::json::object();
  if (name.empty()) return true; // Reserved empty name selects the base.
  if (!doc["named"].contains(name) || !doc["named"][name].is_object()) {
    if (error) *error="unknown or invalid configuration "+name;
    return false;
  }
  *entries=doc["named"][name];
  return true;
}

struct ConfigurationEdit {
  std::string id;
  std::map<std::string,double> params;
};

inline bool PrepareConfigurationEdits(nlohmann::json* doc,
                                     const nlohmann::json& previous,
                                     const nlohmann::json& target,
                                     std::vector<ConfigurationEdit>* edits,
                                     std::string* error) {
  if (!previous.is_object() || !target.is_object()) {
    if (error) *error="invalid configuration entries";
    return false;
  }
  try {
    std::set<std::string> featureIds;
    for (auto it=previous.begin();it!=previous.end();++it) featureIds.insert(it.key());
    for (auto it=target.begin();it!=target.end();++it) featureIds.insert(it.key());
    for (const auto& id:featureIds) {
      ShapeRecord record;
      if (!ShapeStore::instance().get(id,&record)) {
        if (error) *error="missing configuration feature "+id;
        return false;
      }
      if (!EnsureConfigurationBase(doc,id,record,previous,error)) return false;
      ShapeRecord desired=record;
      const auto slots=DescribeParams(record.type);
      for (size_t i=0;i<slots.size();++i)
        desired.paramsMm[i]=(*doc)["base"][id][slots[i]].get<double>();

      const nlohmann::json overrides=target.contains(id) ? target[id] : nlohmann::json::object();
      if (!overrides.is_object() || overrides.empty() && target.contains(id)) {
        if (error) *error="invalid or empty configuration feature "+id;
        return false;
      }
      for (auto param=overrides.begin();param!=overrides.end();++param) {
        if (!param.value().is_number()) {
          if (error) *error="non-numeric override "+id+"."+param.key();
          return false;
        }
        const double value=param.value().get<double>();
        std::vector<double> candidate;
        if (!std::isfinite(value) ||
            !ResolveParamsForEdit(desired,param.key(),value,&candidate,error)) return false;
        desired.paramsMm=std::move(candidate);
      }
      ConfigurationEdit edit{id,{}};
      for (size_t i=0;i<slots.size();++i) {
        std::string formula;
        if (record.paramsMm[i]!=desired.paramsMm[i] ||
            (overrides.contains(slots[i]) &&
             ExpressionStore::instance().get(id,slots[i],&formula) && !formula.empty()))
          edit.params[slots[i]]=desired.paramsMm[i];
      }
      if (!edit.params.empty()) {
        // Geometry preflight uses the complete *changed* set, so a prior
        // override is reset before applying a disjoint new override.
        const auto first=edit.params.begin();
        std::map<std::string,double> other(edit.params);
        other.erase(first->first);
        CoreMesh preview;
        if (!BuildPreviewBodyMesh(id,first->first,first->second,id,&preview,error,"",other))
          return false;
        edits->push_back(std::move(edit));
      }
    }
  } catch (const std::exception& ex) { if (error) *error=ex.what(); return false; }
  return true;
}

inline bool ApplyConfigurationDocument(nlohmann::json doc,
                                      const nlohmann::json& previous,
                                      const nlohmann::json& target,
                                      const std::string& name,
                                      std::string* error) {
  std::vector<ConfigurationEdit> edits;
  if (!PrepareConfigurationEdits(&doc,previous,target,&edits,error)) return false;
  const std::string transactionId="configuration-"+(name.empty() ? "base" : name);
  if (!OcafLive::instance().BeginTransaction(transactionId,error)) return false;
  bool ok=true;
  for (const auto& edit:edits) {
    const auto first=edit.params.begin();
    std::map<std::string,double> other(edit.params);
    other.erase(first->first);
    if (!RebuildFeature(edit.id,first->first,first->second,"",error,other)) {
      ok=false;
      break;
    }
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

inline bool DefineConfiguration(const std::string& name,
                                const ConfigurationOverrides& overrides,
                                std::string* error) {
  if (name.empty() || name.size()>64 || overrides.empty()) {
    if (error) *error="configuration name and overrides required";
    return false;
  }
  nlohmann::json doc;
  if (!ReadConfigurationDocument(&doc,error)) return false;
  const std::string active=doc["active"].get<std::string>();
  nlohmann::json previous;
  if (!ConfigurationEntries(doc,active,&previous,error)) return false;
  nlohmann::json entries=nlohmann::json::object();
  for (const auto& [id,params]:overrides) {
    if (params.empty()) {
      if (error) *error="empty configuration feature "+id;
      return false;
    }
    entries[id]=params;
  }
  doc["named"][name]=entries;
  // A definition of the active name immediately updates its effective
  // geometry and metadata in one OCAF transaction, including removed fields.
  if (active==name)
    return ApplyConfigurationDocument(std::move(doc),previous,entries,name,error);

  // Inactive definitions still capture their baseline at definition time.
  std::vector<ConfigurationEdit> preview;
  if (!PrepareConfigurationEdits(&doc,previous,entries,&preview,error)) return false;
  if (!OcafLive::instance().BeginCommand(error)) return false;
  if (!OcafLive::instance().WriteConfigurations(doc.dump(),error)) {
    OcafLive::instance().AbortCommand();
    return false;
  }
  bool delta=false;
  if (!OcafLive::instance().CommitCommand(&delta,error)) return false;
  if (delta) DocumentStore::instance().commit();
  return true;
}

inline bool ActivateConfiguration(const std::string& name,std::string* error) {
  nlohmann::json doc;
  if (!ReadConfigurationDocument(&doc,error)) return false;
  nlohmann::json target;
  if (!ConfigurationEntries(doc,name,&target,error)) return false;
  if (doc["active"]==name) return true;
  if (doc["active"]=="" && !name.empty() &&
      !RefreshConfigurationBaseOnDeparture(&doc,error)) return false;
  nlohmann::json previous;
  if (!ConfigurationEntries(doc,doc["active"].get<std::string>(),&previous,error))
    return false;
  return ApplyConfigurationDocument(std::move(doc),previous,target,name,error);
}
} // namespace kreoda
