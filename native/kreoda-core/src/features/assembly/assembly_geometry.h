#pragma once

#include <array>
#include <map>
#include <string>
#include <nlohmann/json.hpp>
#include "model/shapes.h"

namespace kreoda {

struct AssemblyConstraintPlan;

struct AssemblyGeometrySelection {
  std::string type;
  std::string featureId;
  std::string persistentId;
  std::string geometryKind;
  std::string selectionEntry;
  std::array<double,3> point{{0,0,0}};
  std::array<double,3> direction{{0,0,1}};
  bool hasAxisLine=false;
};

struct AssemblyGeometryCapturePair {
  AssemblyGeometrySelection moving;
  AssemblyGeometrySelection fixed;
};
using AssemblyGeometryCaptures=std::map<std::string,AssemblyGeometryCapturePair>;
using AssemblySourceBindingMap=std::map<std::string,nlohmann::json>;
using AssemblySourceBindingErrors=std::map<std::string,std::string>;

bool BuildAssemblyInstanceSourceBindings(const ShapeRecord& instance,
                                         AssemblySourceBindingMap* bindings,
                                         AssemblySourceBindingErrors* errors,
                                         std::string* error);
bool CaptureAssemblyGeometrySelection(const ShapeRecord& instance,
                                      const std::string& worldPickId,
                                      const nlohmann::json& claimedBinding,
                                      AssemblyGeometrySelection* selection,
                                      std::string* error);
bool BindAssemblyConstraintSources(const std::string& constraintId,
                                   nlohmann::json* constraint,
                                   std::string* error);
bool PlanAssemblyGeometricConstraints(
    const nlohmann::json& document, AssemblyConstraintPlan* plan,
    bool requireCurrent, const AssemblyGeometryCaptures* captures,
    std::string* error);

}  // namespace kreoda
