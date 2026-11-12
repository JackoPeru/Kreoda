#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <functional>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
#include <nlohmann/json.hpp>
#include "features/primitives/primitives.h"
#include "features/assembly/assembly_geometry.h"
#include "model/shapes.h"
#include "model/geometry_availability.h"
#include "model/feature_graph.h"
#include "persistence/ocaf_live.h"

namespace kreoda {

struct AssemblyConstraintIssue {
  std::string id;
  std::string reason;
};

struct AssemblyConstraintPlan {
  std::map<std::string,std::array<double,6>> placements;
  std::map<std::string,std::array<bool,6>> constrained;
  std::map<std::string,std::array<double,6>> groundedPlacements;
  std::set<std::string> referencedInstances;
  std::vector<AssemblyConstraintIssue> issues;
};

struct AssemblyFeaturePlacement {
  std::string type;
  std::vector<double> values;
};
using AssemblyFeaturePlacements=std::map<std::string,AssemblyFeaturePlacement>;

inline bool ReadAssemblyDocument(nlohmann::json* doc,std::string* error) {
  std::string raw;
  if (!doc || !OcafLive::instance().ReadAssemblyConstraints(&raw,error)) return false;
  try {
    *doc=raw.empty()?nlohmann::json{{"constraints",nlohmann::json::object()}}:nlohmann::json::parse(raw);
    if (!doc->is_object() || !doc->contains("constraints") || !doc->at("constraints").is_object())
      throw std::runtime_error("invalid assembly constraint metadata");
    return true;
  } catch (const std::exception& ex) { if (error) *error=ex.what(); return false; }
}

inline double AssemblyCoordinateUlp(double value) {
  const double inf=std::numeric_limits<double>::infinity();
  double ulp=0;
  for (double direction:{-inf,inf}) {
    const double neighbor=std::nextafter(value,direction);
    if (std::isfinite(neighbor)) ulp=std::max(ulp,std::abs(neighbor-value));
  }
  return ulp;
}

inline double AssemblyCoordinateTolerance(double a,double b) {
  const double ulpA=AssemblyCoordinateUlp(a);
  const double ulpB=AssemblyCoordinateUlp(b);
  return 1e-9+2.0*std::max(ulpA,ulpB);
}

inline bool AssemblyCoordinatesAgree(double a,double b) {
  return std::isfinite(a) && std::isfinite(b) && std::abs(a-b)<=AssemblyCoordinateTolerance(a,b);
}

inline AssemblyFeaturePlacements SnapshotAssemblyFeaturePlacements() {
  AssemblyFeaturePlacements result;
  for (const auto& rec:ShapeStore::instance().listInOrder())
    result.emplace(rec.featureId,AssemblyFeaturePlacement{rec.type,rec.paramsMm});
  return result;
}

inline bool BuildAssemblyConstraintPlan(const nlohmann::json& doc,
                                        const AssemblyFeaturePlacements& features,
                                        AssemblyConstraintPlan* plan,
                                        bool requireCurrent=true) {
  if (!plan) return false;
  *plan=AssemblyConstraintPlan{};
  auto issue=[&](const std::string& id,const std::string& reason) {
    plan->issues.push_back({id,reason});
  };
  if (!doc.is_object() || doc.size()!=1 || !doc.contains("constraints") ||
      !doc.at("constraints").is_object()) {
    issue("metadata","invalid assembly constraint document");
    return false;
  }

  std::map<std::string,std::array<double,6>> instances;
  for (const auto& feature:features) {
    if (feature.second.type!="Instance") continue;
    if (feature.second.values.size()!=6 || !std::all_of(feature.second.values.begin(),feature.second.values.end(),
        [](double value){return std::isfinite(value);})) {
      issue(feature.first,"instance must have six finite placement values");
      continue;
    }
    auto& placement=plan->placements[feature.first];
    auto& mask=plan->constrained[feature.first];
    for (std::size_t i=0;i<6;++i) { placement[i]=feature.second.values[i]; mask[i]=false; }
    instances.emplace(feature.first,placement);
  }

  struct Constraint {
    std::string id,kind,moving,fixed;
    int axis=0;
    double distance=0;
    double angleDeg=0;
    std::array<double,6> placement{};
  };
  std::vector<Constraint> parsed;
  const auto& constraints=doc.at("constraints");
  for (const auto& item:constraints.items()) {
    const std::string id=item.key();
    const auto& value=item.value();
    bool valid=true;
    auto bad=[&](const std::string& reason){issue(id,reason);valid=false;};
    if (!ShapeStore::ValidFeatureId(id)) bad("invalid constraint ID");
    if (!value.is_object()) { bad("constraint must be an object"); continue; }
    if (!value.contains("kind") || !value.at("kind").is_string()) {
      bad("kind must be a string");
      continue;
    }
    Constraint c;c.id=id;c.kind=value.at("kind").get<std::string>();
    std::set<std::string> allowed={"kind","movingId"};
    if (c.kind=="ground") allowed.insert("placement");
    else if (c.kind=="distance") { allowed.insert("fixedId");allowed.insert("axis");allowed.insert("distanceMm"); }
    else if (c.kind=="coincident") allowed.insert("fixedId");
    else if (c.kind=="concentric"||c.kind=="parallel"||c.kind=="perpendicular"||c.kind=="angle") {
      allowed.insert("fixedId");allowed.insert("movingSourceBinding");allowed.insert("fixedSourceBinding");
      if(c.kind=="angle")allowed.insert("angleDeg");
    }
    else bad("unknown constraint kind");
    for (const auto& field:value.items()) if (!allowed.count(field.key())) bad("unexpected field "+field.key());
    if (!value.contains("movingId") || !value.at("movingId").is_string()) bad("movingId must be a string");
    else {
      c.moving=value.at("movingId").get<std::string>();
      if (!ShapeStore::ValidFeatureId(c.moving)) bad("invalid moving instance ID");
    }
    if (c.kind=="ground") {
      if (!value.contains("placement") || !value.at("placement").is_array() || value.at("placement").size()!=6)
        bad("ground placement must contain six values");
      else for (std::size_t i=0;i<6;++i) {
        const auto& coordinate=value.at("placement")[i];
        if (!coordinate.is_number()) { bad("ground placement values must be finite numbers"); break; }
        c.placement[i]=coordinate.get<double>();
        if (!std::isfinite(c.placement[i])) { bad("ground placement values must be finite numbers"); break; }
      }
    } else if (c.kind=="distance" || c.kind=="coincident" || c.kind=="concentric" ||
               c.kind=="parallel" || c.kind=="perpendicular" || c.kind=="angle") {
      if (!value.contains("fixedId") || !value.at("fixedId").is_string()) bad("fixedId must be a string");
      else {
        c.fixed=value.at("fixedId").get<std::string>();
        if (!ShapeStore::ValidFeatureId(c.fixed) || c.fixed==c.moving) bad("invalid fixed instance ID");
      }
      if (c.kind=="distance") {
        if (!value.contains("axis") || !value.at("axis").is_number_integer()) bad("axis must be integer 0, 1, or 2");
        else {
          const double axis=value.at("axis").get<double>();
          if (axis<0 || axis>2) bad("axis must be integer 0, 1, or 2");
          else c.axis=static_cast<int>(axis);
        }
        if (!value.contains("distanceMm") || !value.at("distanceMm").is_number()) bad("distanceMm must be a finite number");
        else {
          c.distance=value.at("distanceMm").get<double>();
          if (!std::isfinite(c.distance)) bad("distanceMm must be a finite number");
        }
      } else if(c.kind=="concentric"||c.kind=="parallel"||c.kind=="perpendicular"||c.kind=="angle") {
        if(!value.contains("movingSourceBinding")||!value.at("movingSourceBinding").is_object())bad("movingSourceBinding must be an object");
        if(!value.contains("fixedSourceBinding")||!value.at("fixedSourceBinding").is_object())bad("fixedSourceBinding must be an object");
        if(c.kind=="angle") {
          if(!value.contains("angleDeg")||!value.at("angleDeg").is_number())bad("angleDeg must be finite and between 0 and 180 degrees");
          else {c.angleDeg=value.at("angleDeg").get<double>();if(!std::isfinite(c.angleDeg)||c.angleDeg<0||c.angleDeg>180)bad("angleDeg must be finite and between 0 and 180 degrees");}
        }
      }
    }
    if (valid) parsed.push_back(std::move(c));
  }

  auto requireInstance=[&](const std::string& id,const std::string& owner,const char* role) {
    if (instances.count(id)) return true;
    const std::string reason=features.count(id)
        ? std::string(role)+" component must be a rigid instance with six finite placement values"
        : std::string("missing ")+role+" instance";
    issue(owner,reason);
    return false;
  };
  std::map<std::string,std::array<double,6>> groundTargets;
  std::set<std::string> grounded;
  using Requirement=std::pair<std::string,double>;
  std::map<std::string,std::array<std::vector<Requirement>,6>> requirements;
  auto add=[&](const std::string& feature,std::size_t axis,const std::string& id,double value) {
    requirements[feature][axis].push_back({id,value});
  };
  for (const auto& c:parsed) {
    if (c.kind!="ground" || !requireInstance(c.moving,c.id,"moving")) continue;
    plan->referencedInstances.insert(c.moving);
    grounded.insert(c.moving);
    if (!groundTargets.count(c.moving)) groundTargets[c.moving]=c.placement;
    for (std::size_t i=0;i<6;++i) add(c.moving,i,c.id,c.placement[i]);
  }
  for (const auto& c:parsed) {
    if (c.kind=="ground") continue;
    if (!requireInstance(c.moving,c.id,"moving") || !requireInstance(c.fixed,c.id,"fixed")) continue;
    plan->referencedInstances.insert(c.moving);
    plan->referencedInstances.insert(c.fixed);
    if (!grounded.count(c.fixed)) { issue(c.id,"fixed instance must be grounded");continue; }
    if(c.kind=="concentric"||c.kind=="parallel"||c.kind=="perpendicular"||c.kind=="angle")continue;
    const std::size_t first=c.kind=="coincident"?0u:static_cast<std::size_t>(c.axis);
    const std::size_t last=c.kind=="coincident"?2u:first;
    for (std::size_t axis=first;axis<=last;++axis) {
      const double offset=c.kind=="distance"?c.distance:0.0;
      const double desired=groundTargets.at(c.fixed)[axis]+offset;
      if (!std::isfinite(desired)) { issue(c.id,"desired placement is not finite");continue; }
      add(c.moving,axis,c.id,desired);
    }
  }

  static const char* axes[]={"txMm","tyMm","tzMm","rxDeg","ryDeg","rzDeg"};
  for (auto& feature:requirements) {
    for (std::size_t axis=0;axis<6;++axis) {
      auto& values=feature.second[axis];
      if (values.empty()) continue;
      double low=values.front().second,high=low;
      for (const auto& requirement:values) { low=std::min(low,requirement.second);high=std::max(high,requirement.second); }
      if (!AssemblyCoordinatesAgree(low,high)) {
        for (const auto& requirement:values)
          issue(requirement.first,std::string("conflicting requirements for ")+axes[axis]);
        continue;
      }
      const double desired=low;
      plan->placements[feature.first][axis]=desired;
      plan->constrained[feature.first][axis]=true;
      if (requireCurrent) {
        const double actual=instances.at(feature.first)[axis];
        for (const auto& requirement:values) if (!AssemblyCoordinatesAgree(actual,requirement.second))
          issue(requirement.first,std::string("unsatisfied ")+axes[axis]+" requirement");
      }
    }
  }
  plan->groundedPlacements=std::move(groundTargets);
  return plan->issues.empty();
}

inline bool BuildAssemblyConstraintPlan(const nlohmann::json& doc,
                                        AssemblyConstraintPlan* plan,
                                        bool requireCurrent=true,
                                        const AssemblyGeometryCaptures* captures=nullptr) {
  if (!plan) return false;
  const auto features=SnapshotAssemblyFeaturePlacements();
  const bool planned=BuildAssemblyConstraintPlan(doc,features,plan,requireCurrent);
  for (const auto& id:plan->referencedInstances) {
    ShapeRecord current;
    std::string error;
    if (!TheFeatureGraph().hasFeature(id))
      plan->issues.push_back({id,"referenced instance has no live feature graph node"});
    else if (TheFeatureGraph().isGeometryDirty(id))
      plan->issues.push_back({id,"referenced instance geometry is dirty"});
    else if (!GetCurrentShapeRecord(id,&current,&error))
      plan->issues.push_back({id,"referenced instance geometry is not current: "+error});
    else if (current.type!="Instance" || current.paramsMm.size()!=6)
      plan->issues.push_back({id,"referenced component must have current rigid instance geometry"});
#if KREODA_WITH_OCCT
    else if (current.shape.IsNull())
      plan->issues.push_back({id,"referenced instance has no live B-Rep"});
#endif
  }
  if(planned&&plan->issues.empty()) {
    std::string geometryError;
    if(!PlanAssemblyGeometricConstraints(doc,plan,requireCurrent,captures,&geometryError)&&!geometryError.empty())
      plan->issues.push_back({"assembly-geometry",geometryError});
  }
  return planned && plan->issues.empty();
}

inline std::string AssemblyConstraintIssueText(const std::vector<AssemblyConstraintIssue>& issues) {
  std::string result;
  for (const auto& item:issues) {
    if (!result.empty()) result+="; ";
    result+=item.id+": "+item.reason;
  }
  return result;
}

inline bool ReadAssemblyConstraintIssues(std::vector<AssemblyConstraintIssue>* issues,
                                         std::string* error=nullptr) {
  if (!issues) return false;
  issues->clear();
  nlohmann::json doc;
  std::string readError;
  if (!ReadAssemblyDocument(&doc,&readError)) {
    issues->push_back({"metadata",readError.empty()?"invalid assembly metadata":readError});
  } else {
    AssemblyConstraintPlan plan;
    BuildAssemblyConstraintPlan(doc,&plan,true);
    *issues=std::move(plan.issues);
  }
  if (!issues->empty() && error) *error=AssemblyConstraintIssueText(*issues);
  return issues->empty();
}

bool ApplyAssemblyConstraintPlan(const nlohmann::json& doc,
                                 const AssemblyConstraintPlan& plan,
                                 bool persistMetadata,
                                 const std::string& transactionId,
                                 std::string* error,
                                 const std::function<bool(nlohmann::json*,std::string*)>& prepareMetadata={});

bool DefineGeometricAssemblyConstraint(const nlohmann::json& request,
                                       std::string* error);

inline bool DefineAssemblyConstraint(const std::string& constraintId,
                                     const std::string& kind,
                                     const std::string& movingId,
                                     const std::string& fixedId,
                                     int axis,double distanceMm,
                                     std::string* error) {
  auto reject=[&](const std::string& reason) {
    if (OcafLive::instance().InTransaction()) OcafLive::instance().AbortCommand();
    if (error) *error=reason;
    return false;
  };
  if (!ShapeStore::ValidFeatureId(constraintId) ||
      (kind!="ground" && kind!="distance" && kind!="coincident") ||
      (kind=="distance" && (axis<0 || axis>2 || !std::isfinite(distanceMm))))
    return reject("invalid assembly constraint");
  nlohmann::json doc;
  std::string reason;
  if (!ReadAssemblyDocument(&doc,&reason)) return reject(reason);
  AssemblyConstraintPlan existingPlan;
  if (!BuildAssemblyConstraintPlan(doc,&existingPlan,true))
    return reject(AssemblyConstraintIssueText(existingPlan.issues));
  if (doc["constraints"].contains(constraintId)) return reject("constraint ID exists");
  ShapeRecord moving;
  if (!ShapeStore::instance().get(movingId,&moving) || moving.type!="Instance" ||
      moving.paramsMm.size()!=6 || !std::all_of(moving.paramsMm.begin(),moving.paramsMm.end(),
      [](double value){return std::isfinite(value);}))
    return reject("moving component must be a rigid instance with six finite placement values");
  if (kind=="ground") {
    doc["constraints"][constraintId]={{"kind",kind},{"movingId",movingId},{"placement",moving.paramsMm}};
  } else {
    doc["constraints"][constraintId]={{"kind",kind},{"movingId",movingId},{"fixedId",fixedId}};
    if (kind=="distance") {
      doc["constraints"][constraintId]["axis"]=axis;
      doc["constraints"][constraintId]["distanceMm"]=distanceMm;
    }
  }
  AssemblyConstraintPlan plan;
  if (!BuildAssemblyConstraintPlan(doc,&plan,false)) return reject(AssemblyConstraintIssueText(plan.issues));
  return ApplyAssemblyConstraintPlan(doc,plan,true,"assembly-"+constraintId,error);
}

inline bool ReapplyAssemblyConstraints(std::string* error) {
  auto reject=[&](const std::string& reason) {
    if (OcafLive::instance().InTransaction()) OcafLive::instance().AbortCommand();
    if (error) *error=reason;
    return false;
  };
  nlohmann::json doc;
  std::string reason;
  if (!ReadAssemblyDocument(&doc,&reason)) return reject(reason);
  AssemblyConstraintPlan plan;
  if (!BuildAssemblyConstraintPlan(doc,&plan,false)) return reject(AssemblyConstraintIssueText(plan.issues));
  for (const auto& ground:plan.groundedPlacements) {
    const auto current=plan.placements.find(ground.first);
    if (current==plan.placements.end()) return reject(ground.first+": missing grounded instance");
    ShapeRecord rec;
    if (!ShapeStore::instance().get(ground.first,&rec) || rec.paramsMm.size()!=6)
      return reject(ground.first+": missing grounded instance");
    for (std::size_t i=0;i<6;++i) if (!AssemblyCoordinatesAgree(rec.paramsMm[i],ground.second[i]))
      return reject(ground.first+": grounded component was moved");
  }
  return ApplyAssemblyConstraintPlan(doc,plan,false,"assembly-reapply",error);
}

} // namespace kreoda
