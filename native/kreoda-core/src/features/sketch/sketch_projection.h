#pragma once

#include <string>
#include <vector>

#include "../datum/datum_store.h"
#include "../../model/shapes.h"
#include "../../persistence/ocaf_live.h"
#include "sketch_store.h"

namespace kreoda {

bool ParseSketchProjectionGroups(const std::string& json,
                                std::vector<SketchProjectionGroup>* groups,
                                std::string* error);
std::string SerializeSketchProjectionGroups(
    const std::vector<SketchProjectionGroup>& groups);
std::string SerializeSketchProjectionGroupsForInspection(
    const std::vector<SketchProjectionGroup>& groups);
bool SerializeSketchProjectionQuery(const SketchFeature& sketch,
                                    const std::string& groupId,
                                    std::string* result,
                                    std::string* error);
bool ValidateSketchProjectionDefinition(const std::string& groupId,
                                       const std::string& definitionJson,
                                       std::string* canonicalJson,
                                       std::vector<std::string>* sourceIds,
                                       std::string* error);
std::vector<std::string> SketchDependencies(const SketchFeature& sketch);

#if KREODA_WITH_OCCT
bool ResolveSketchProjectionGroups(
    SketchFeature* sketch, const std::vector<ShapeRecord>& shapeSources,
    const std::vector<SketchFeature>& sketchSources,
    const std::vector<DatumRecord>& datumSources,
    const ProjectionSelectionResolver& selectionResolver,
    const std::string& bindGroupId, bool allowBroken, bool incoming,
    std::vector<ProjectionSelection>* newBindings, std::string* error);
#endif

bool SetSketchProjectionGroup(const std::string& sketchId,
                              const std::string& groupId,
                              const std::string& definitionJson,
                              std::string* error);
bool RemoveSketchProjectionGroup(const std::string& sketchId,
                                 const std::string& groupId,
                                 std::string* error);

}  // namespace kreoda
