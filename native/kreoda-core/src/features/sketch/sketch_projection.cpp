#include "sketch_projection.h"

#include <algorithm>
#include <regex>
#include <set>
#include <stdexcept>

#include "../../model/shapes.h"
#include "../../model/geometry_availability.h"
#include "../../model/feature_graph.h"
#include "../../model/model_snapshot.h"
#include "../../document/document_store.h"
#include "../../protocol/json_fields.h"
#include "sketch_json.h"
#include "projected_geometry.h"
#include "sketch_face.h"

#if KREODA_WITH_OCCT
#include "../../topology/face_roles.h"
#include <BRepCheck_Analyzer.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopoDS.hxx>
#include <TopExp_Explorer.hxx>
#endif

#if KREODA_WITH_OCCT
#include "../../features/evaluate.h"
#include "../../persistence/ocaf_live.h"
#endif

namespace kreoda {
namespace {

[[noreturn]] void ProjectionFail(const std::string& message) {
  throw std::runtime_error(message);
}

void RequireKeys(const Json& value, std::initializer_list<const char*> allowed,
                 const char* label) {
  if (!value.is_object()) ProjectionFail(std::string(label) + " must be an object");
  for (const auto& field : value.items()) {
    if (std::none_of(allowed.begin(), allowed.end(), [&](const char* key) {
          return field.key() == key;
        })) {
      ProjectionFail(std::string("unsupported projection ") + label + " field: " +
                     field.key());
    }
  }
}

std::string RequiredText(const Json& value, const char* key) {
  if (!value.is_object() || !value.contains(key) || !value.at(key).is_string()) {
    ProjectionFail(std::string("projection requires string ") + key);
  }
  const auto text = value.at(key).get<std::string>();
  if (text.empty()) ProjectionFail(std::string("projection ") + key + " must not be empty");
  return text;
}

std::string SourceIdentity(const Json& source) {
  const auto type = source.at("type").get<std::string>();
  const auto owner = source.at("featureId").get<std::string>();
  Json identity{{"type", type}, {"featureId", owner}};
  if (type == "edge") identity["persistentEdgeId"] = source.at("persistentEdgeId");
  if (type == "sketchEntities") identity["entityIds"] = source.at("entityIds");
  return identity.dump();
}

Json ParseBindings(const Json& value, const std::set<std::string>& edgeSources) {
  RequireKeys(value, {"version", "entries"}, "bindings");
  if (!value.contains("version") || !value.at("version").is_number_integer() ||
      value.at("version").get<int>() != 1)
    ProjectionFail("unsupported projection bindings version");
  if (!value.contains("entries") || !value.at("entries").is_array() ||
      value.at("entries").size() > 128)
    ProjectionFail("projection bindings entries must be an array of at most 128");
  static const std::regex entryPattern("[0-9]+(:[0-9]+)+");
  Json result = Json::array();
  std::set<std::string> seenSources, seenEntries;
  for (const auto& item : value.at("entries")) {
    RequireKeys(item, {"sourceIdentity", "selectionEntry"}, "binding entry");
    const auto source = RequiredText(item, "sourceIdentity");
    const auto entry = RequiredText(item, "selectionEntry");
    if (!edgeSources.count(source) || !seenSources.insert(source).second ||
        entry.size() > 128 || !std::regex_match(entry, entryPattern) ||
        !seenEntries.insert(entry).second)
      ProjectionFail("invalid or duplicate projection source binding");
    result.push_back({{"sourceIdentity", source}, {"selectionEntry", entry}});
  }
  return Json{{"version", 1}, {"entries", result}};
}

Json ParseDefinition(const std::string& groupId, const std::string& text,
                     std::vector<std::string>* sourceIds) {
  if (!ShapeStore::ValidFeatureId(groupId)) ProjectionFail("invalid projection groupId");
  if (text.empty() || text.size() > 65536)
    ProjectionFail("projection definition must be between 1 and 65536 UTF-8 bytes");
  const Json definition = Json::parse(text);
  RequireKeys(definition, {"version", "operation", "sources"}, "definition");
  if (!definition.contains("version") || !definition.at("version").is_number_integer() ||
      definition.at("version").get<int>() != 1)
    ProjectionFail("unsupported projection definition version");
  if (!definition.contains("operation") || !definition.at("operation").is_string())
    ProjectionFail("projection operation is required");
  const auto operation = definition.at("operation").get<std::string>();
  if (operation != "projectEdges" && operation != "silhouette" &&
      operation != "section")
    ProjectionFail("unsupported projection operation " + operation);
  if (!definition.contains("sources") || !definition.at("sources").is_array() ||
      definition.at("sources").empty() || definition.at("sources").size() > 128)
    ProjectionFail("projection sources must contain 1 to 128 entries");

  Json sources = Json::array();
  std::vector<std::string> ids;
  std::set<std::string> identities;
  std::set<std::string> edgeSources;
  size_t shapeCount = 0;
  for (const auto& source : definition.at("sources")) {
    if (!source.is_object() || !source.contains("type") ||
        !source.at("type").is_string())
      ProjectionFail("projection source type is required");
    const auto type = source.at("type").get<std::string>();
    if (type == "edge") {
      RequireKeys(source, {"type", "featureId", "persistentEdgeId"}, "edge source");
      const auto owner = RequiredText(source, "featureId");
      const auto edgeId = RequiredText(source, "persistentEdgeId");
      if (!ShapeStore::ValidFeatureId(owner) || edgeId.size() > 512 ||
          edgeId.rfind(owner + ":", 0) != 0)
        ProjectionFail("projection edge source requires an owner-qualified persistentEdgeId");
      ids.push_back(owner);
      sources.push_back({{"type", "edge"}, {"featureId", owner},
                         {"persistentEdgeId", edgeId}});
    } else if (type == "shape") {
      RequireKeys(source, {"type", "featureId"}, "shape source");
      const auto owner = RequiredText(source, "featureId");
      if (!ShapeStore::ValidFeatureId(owner)) ProjectionFail("invalid projection source featureId");
      ++shapeCount;
      ids.push_back(owner);
      sources.push_back({{"type", "shape"}, {"featureId", owner}});
    } else if (type == "sketchEntities") {
      RequireKeys(source, {"type", "featureId", "entityIds"}, "sketchEntities source");
      const auto owner = RequiredText(source, "featureId");
      if (!ShapeStore::ValidFeatureId(owner)) ProjectionFail("invalid projection source featureId");
      if (!source.contains("entityIds") || !source.at("entityIds").is_array() ||
          source.at("entityIds").empty() || source.at("entityIds").size() > 128)
        ProjectionFail("projection entityIds must contain 1 to 128 entries");
      Json entityIds = Json::array();
      std::set<std::string> unique;
      for (const auto& id : source.at("entityIds")) {
        if (!id.is_string() || id.get<std::string>().empty() ||
            id.get<std::string>().size() > 512 || !unique.insert(id.get<std::string>()).second)
          ProjectionFail("projection entityIds must be non-empty and unique");
        entityIds.push_back(id);
      }
      ids.push_back(owner);
      sources.push_back({{"type", "sketchEntities"}, {"featureId", owner},
                         {"entityIds", entityIds}});
    } else {
      ProjectionFail("unsupported projection source type " + type);
    }
    const auto identity = SourceIdentity(sources.back());
    if (type == "edge") edgeSources.insert(identity);
    if (!identities.insert(identity).second)
      ProjectionFail("duplicate projection source");
  }
  if (operation == "projectEdges") {
    if (shapeCount) ProjectionFail("projectEdges accepts edge or sketchEntities sources");
  } else if (shapeCount != 1 || sources.size() != 1 ||
             sources.front().at("type") != "shape") {
    ProjectionFail(operation + " requires exactly one whole-shape source");
  }
  if (sourceIds) *sourceIds = std::move(ids);
  return Json{{"version", 1}, {"operation", operation}, {"sources", sources}};
}

}  // namespace

bool ValidateSketchProjectionDefinition(const std::string& groupId,
                                        const std::string& definitionJson,
                                        std::string* canonicalJson,
                                        std::vector<std::string>* sourceIds,
                                        std::string* error) {
  try {
    const Json definition = ParseDefinition(groupId, definitionJson, sourceIds);
    if (canonicalJson) *canonicalJson = definition.dump();
    if (error) error->clear();
    return true;
  } catch (const std::exception& failure) {
    if (error) *error = std::string("projection definition: ") + failure.what();
    return false;
  }
}

bool ParseSketchProjectionGroups(const std::string& text,
                                 std::vector<SketchProjectionGroup>* groups,
                                 std::string* error) {
  if (!groups) {
    if (error) *error = "projection groups output is required";
    return false;
  }
  try {
    const Json values = Json::parse(text);
    if (!values.is_array() || values.size() > 128)
      ProjectionFail("projectionGroups must be an array of at most 128 groups");
    std::vector<SketchProjectionGroup> parsed;
    std::set<std::string> groupIds;
    for (const auto& value : values) {
      RequireKeys(value, {"groupId", "definition", "bindings"}, "group");
      SketchProjectionGroup group;
      group.groupId = RequiredText(value, "groupId");
      if (!groupIds.insert(group.groupId).second)
        ProjectionFail("duplicate projection groupId " + group.groupId);
      const auto definition = ParseDefinition(
          group.groupId, value.contains("definition") ? value.at("definition").dump() : "",
          nullptr);
      group.definitionJson = definition.dump();
      std::set<std::string> edgeSources;
      for (const auto& source : definition.at("sources"))
        if (source.at("type") == "edge") edgeSources.insert(SourceIdentity(source));
      const Json bindings = value.contains("bindings") ? value.at("bindings") : Json();
      group.bindingsJson = ParseBindings(bindings, edgeSources).dump();
      group.status = "ok";
      group.error.clear();
      group.blockingSourceIds.clear();
      group.generation = 0;
      parsed.push_back(std::move(group));
    }
    *groups = std::move(parsed);
    if (error) error->clear();
    return true;
  } catch (const std::exception& failure) {
    if (error) *error = std::string("projection metadata: ") + failure.what();
    return false;
  }
}

std::string SerializeSketchProjectionGroups(
    const std::vector<SketchProjectionGroup>& groups) {
  Json values = Json::array();
  for (const auto& group : groups) {
    values.push_back({{"groupId", group.groupId},
                      {"definition", Json::parse(group.definitionJson)},
                      {"bindings", Json::parse(group.bindingsJson)}});
  }
  return values.dump();
}

std::string SerializeSketchProjectionGroupsForInspection(
    const std::vector<SketchProjectionGroup>& groups) {
  Json values = Json::array();
  for (const auto& group : groups) {
    std::vector<std::string> sourceIds;
    const auto definition = Json::parse(group.definitionJson);
    for (const auto& source : definition.at("sources")) {
      const auto id = source.at("featureId").get<std::string>();
      if (std::find(sourceIds.begin(), sourceIds.end(), id) == sourceIds.end())
        sourceIds.push_back(id);
    }
    values.push_back({{"groupId", group.groupId},
                      {"definition", definition},
                      {"sourceFeatureIds", sourceIds},
                      {"status", group.status},
                      {"error", group.error},
                      {"blockingSourceIds", group.blockingSourceIds},
                      {"generation", group.generation}});
  }
  return values.dump();
}

std::vector<std::string> SketchDependencies(const SketchFeature& sketch) {
  std::set<std::string> dependencies;
  if (!sketch.supportRef.empty()) dependencies.insert(sketch.supportRef);
  for (const auto& group : sketch.projectionGroups) {
    std::vector<std::string> sources;
    std::string error;
    std::string canonical;
    if (ValidateSketchProjectionDefinition(group.groupId, group.definitionJson,
                                           &canonical, &sources, &error))
      dependencies.insert(sources.begin(), sources.end());
  }
  return {dependencies.begin(), dependencies.end()};
}

#if KREODA_WITH_OCCT
bool ResolveSketchProjectionGroups(
    SketchFeature* sketch, const std::vector<ShapeRecord>& shapeSources,
    const std::vector<SketchFeature>& sketchSources,
    const std::vector<DatumRecord>& datumSources,
    const ProjectionSelectionResolver& selectionResolver,
    const std::string& bindGroupId, bool allowBroken, bool incoming,
    std::vector<ProjectionSelection>* newBindings, std::string* error) {
  if (!sketch) {
    if (error) *error = "projection target sketch is required";
    return false;
  }
  SketchFeature candidate = *sketch;
  std::vector<ProjectionSelection> bindings;
  size_t edgeTotal = 0;
  std::set<std::string> groupIds;
  const auto findOwner = [&](const std::string& id, const ShapeRecord** shape,
                             const SketchFeature** sourceSketch,
                             const DatumRecord** datum) {
    *shape = nullptr; *sourceSketch = nullptr; *datum = nullptr;
    int count = 0;
    for (const auto& record : shapeSources)
      if (record.featureId == id) { *shape = &record; ++count; }
    for (const auto& record : sketchSources)
      if (record.id == id) { *sourceSketch = &record; ++count; }
    for (const auto& record : datumSources)
      if (record.featureId == id) { *datum = &record; ++count; }
    return count;
  };
  std::function<bool(const std::string&, std::set<std::string>*)> incomingAvailable;
  incomingAvailable = [&](const std::string& id, std::set<std::string>* active) {
    if (!active->insert(id).second) return false;
    const ShapeRecord* shape = nullptr;
    const SketchFeature* sourceSketch = nullptr;
    const DatumRecord* datum = nullptr;
    if (findOwner(id, &shape, &sourceSketch, &datum) != 1) {
      active->erase(id);
      return false;
    }
    bool ok = true;
    if (shape) {
      ok = !shape->shape.IsNull();
      for (const auto& dependency : shape->dependsOn)
        if (!incomingAvailable(dependency, active)) ok = false;
    } else if (sourceSketch) {
      ok = true;
      for (const auto& group : sourceSketch->projectionGroups)
        if (group.status != "ok") ok = false;
      for (const auto& dependency : SketchDependencies(*sourceSketch))
        if (!incomingAvailable(dependency, active)) ok = false;
    } else if (datum) {
      ok = datum->status == "ok";
      for (const auto& dependency : datum->dependsOn)
        if (!incomingAvailable(dependency, active)) ok = false;
    }
    active->erase(id);
    return ok;
  };
  const auto ensureSourceCurrent = [&](const std::string& id, std::string* why) {
    if (!incoming) return EnsureGeometryAvailable(id, why);
    std::set<std::string> active;
    if (incomingAvailable(id, &active)) return true;
    if (why) *why = "projection source geometry is broken: " + id;
    return false;
  };

  for (auto& group : candidate.projectionGroups) {
    if (!groupIds.insert(group.groupId).second) {
      if (error) *error = "duplicate projection groupId " + group.groupId;
      return false;
    }
    const bool bindingThisGroup = group.groupId == bindGroupId;
    group.status = "ok";
    group.error.clear();
    group.blockingSourceIds.clear();
    group.evaluatedEdges.clear();
    auto markBroken = [&](const std::string& why,
                          const std::vector<std::string>& blockers) {
      group.status = "broken";
      group.error = why;
      group.blockingSourceIds = blockers;
      std::sort(group.blockingSourceIds.begin(), group.blockingSourceIds.end());
      group.blockingSourceIds.erase(
          std::unique(group.blockingSourceIds.begin(), group.blockingSourceIds.end()),
          group.blockingSourceIds.end());
    };

    try {
      std::vector<std::string> declaredSourceIds;
      std::string canonical;
      std::string parseError;
      if (!ValidateSketchProjectionDefinition(group.groupId, group.definitionJson,
                                               &canonical, &declaredSourceIds,
                                               &parseError))
        throw std::runtime_error(parseError);
      const Json definition = Json::parse(canonical);
      const Json bindingDoc = Json::parse(group.bindingsJson);
      RequireKeys(bindingDoc, {"version", "entries"}, "bindings");
      if (!bindingDoc.contains("version") || !bindingDoc.at("version").is_number_integer() ||
          bindingDoc.at("version").get<int>() != 1 ||
          !bindingDoc.contains("entries") || !bindingDoc.at("entries").is_array())
        throw std::runtime_error("invalid projection bindings");
      std::map<std::string, std::string> selectionEntries;
      for (const auto& item : bindingDoc.at("entries")) {
        if (!item.is_object() || !item.contains("sourceIdentity") ||
            !item.at("sourceIdentity").is_string() || !item.contains("selectionEntry") ||
            !item.at("selectionEntry").is_string() ||
            !selectionEntries.emplace(item.at("sourceIdentity").get<std::string>(),
                                      item.at("selectionEntry").get<std::string>()).second)
          throw std::runtime_error("invalid duplicate projection selection binding");
      }

      std::vector<TopoDS_Edge> sourceEdges;
      const auto operation = definition.at("operation").get<std::string>();
      const ShapeRecord* wholeShape = nullptr;
      for (const auto& source : definition.at("sources")) {
        const std::string type = source.at("type").get<std::string>();
        const std::string ownerId = source.at("featureId").get<std::string>();
        const ShapeRecord* shape = nullptr;
        const SketchFeature* sourceSketch = nullptr;
        const DatumRecord* datum = nullptr;
        if (findOwner(ownerId, &shape, &sourceSketch, &datum) != 1)
          throw std::runtime_error("projection source owner is missing or ambiguous: " + ownerId);
        if (type == "shape") {
          if (!shape || datum || sourceSketch || shape->shape.IsNull())
            throw std::runtime_error("projection shape source is unavailable: " + ownerId);
          if (!ensureSourceCurrent(ownerId, &parseError))
            throw std::runtime_error(parseError);
          wholeShape = shape;
        } else if (type == "sketchEntities") {
          if (!sourceSketch || shape || datum)
            throw std::runtime_error("projection sketch source is unavailable: " + ownerId);
          if (!ensureSourceCurrent(ownerId, &parseError))
            throw std::runtime_error(parseError);
          std::vector<std::string> entityIds;
          for (const auto& entity : source.at("entityIds"))
            entityIds.push_back(entity.get<std::string>());
          std::vector<TopoDS_Edge> authored;
          if (!BuildSketchEntityEdges(*sourceSketch, entityIds, &authored, &parseError))
            throw std::runtime_error(parseError);
          sourceEdges.insert(sourceEdges.end(), authored.begin(), authored.end());
        } else if (type == "edge") {
          if (!shape || datum || sourceSketch || shape->shape.IsNull())
            throw std::runtime_error("projection edge source is unavailable: " + ownerId);
          if (!ensureSourceCurrent(ownerId, &parseError))
            throw std::runtime_error(parseError);
          const std::string edgeId = source.at("persistentEdgeId").get<std::string>();
          const std::string identity = SourceIdentity(source);
          const auto found = selectionEntries.find(identity);
          TopoDS_Edge selected;
          if (bindingThisGroup && found == selectionEntries.end()) {
            TopoDS_Edge match;
            size_t matches = 0;
            for (const auto& role : ClassifyEdgeRoles(shape->shape, shape->type, ownerId))
              if (role.persistentEdgeId == edgeId) { match = role.edge; ++matches; }
            if (matches != 1)
              throw std::runtime_error("projection edge source is missing or ambiguous: " + edgeId);
            selected = match;
            bindings.push_back({identity, ownerId, edgeId, selected});
          } else {
            if (found == selectionEntries.end() || !selectionResolver)
              throw std::runtime_error("persistent projection edge binding is missing: " + edgeId);
            if (!selectionResolver(found->second, sketch->id, group.groupId,
                                   identity, ownerId, edgeId, &selected, &parseError))
              throw std::runtime_error(parseError.empty()
                  ? "persistent projection edge binding cannot be resolved: " + edgeId
                  : parseError);
            if (selected.IsNull() || selected.ShapeType() != TopAbs_EDGE)
              throw std::runtime_error("invalid native projection edge");
            bool belongs = false;
            for (TopExp_Explorer it(shape->shape, TopAbs_EDGE); it.More(); it.Next())
              if (it.Current().IsSame(selected)) { belongs = true; break; }
            if (!belongs) {
              // Whole-solid replacement does not publish per-edge evolution.
              // A semantic role may recover only by exact unique identity;
              // index-bearing roles never fall back to a new ordinal occupant.
              if (HasIndexedTopologyRole(edgeId))
                throw std::runtime_error("indexed projection edge lost its TNaming lineage: " + edgeId);
              size_t matches = 0;
              for (const auto& role : ClassifyEdgeRoles(shape->shape, shape->type, ownerId))
                if (role.persistentEdgeId == edgeId) { selected = role.edge; ++matches; }
              if (matches != 1)
                throw std::runtime_error("persistent projection edge no longer belongs to source: " + edgeId);
            }
          }
          sourceEdges.push_back(selected);
        } else {
          throw std::runtime_error("unsupported projection source type " + type);
        }
      }

      std::vector<TopoDS_Edge> evaluated;
      bool ok = false;
      if (operation == "projectEdges") {
        ok = ProjectNativeEdgesToPlane(sourceEdges, candidate.plane,
                                       &evaluated, &parseError);
      } else if (operation == "silhouette") {
        ok = wholeShape && ProjectNativeSilhouetteToPlane(
            wholeShape->shape, candidate.plane, &evaluated, &parseError);
      } else if (operation == "section") {
        ok = wholeShape && IntersectNativeShapeWithPlane(
            wholeShape->shape, candidate.plane, &evaluated, &parseError);
      }
      if (!ok) throw std::runtime_error(parseError.empty()
          ? "projection operation failed" : parseError);
      if (evaluated.size() > 2000 - edgeTotal)
        throw std::runtime_error("sketch projection output exceeds 2000 edges");
      edgeTotal += evaluated.size();
      group.evaluatedEdges = std::move(evaluated);
      ++group.generation;
      if (bindingThisGroup) {
        group.bindingsJson = Json{{"version", 1}, {"entries", Json::array()}}.dump();
      }
    } catch (const std::exception& failure) {
      if (!allowBroken) {
        if (error) *error = failure.what();
        return false;
      }
      std::vector<std::string> blockers;
      for (const auto& source : Json::parse(group.definitionJson).value("sources", Json::array()))
        if (source.is_object() && source.contains("featureId") && source.at("featureId").is_string())
          blockers.push_back(source.at("featureId").get<std::string>());
      markBroken(failure.what(), blockers);
    }
  }
  *sketch = std::move(candidate);
  if (newBindings) *newBindings = std::move(bindings);
  if (error) error->clear();
  return true;
}
#endif

bool SetSketchProjectionGroup(const std::string& sketchId,
                              const std::string& groupId,
                              const std::string& definitionJson,
                              std::string* error) {
#if KREODA_WITH_OCCT
  try {
    SketchFeature previous;
    if (!SketchStore::instance().get(sketchId, &previous))
      throw std::runtime_error("unknown sketch " + sketchId);
    std::string canonical;
    std::vector<std::string> sourceIds;
    if (!ValidateSketchProjectionDefinition(groupId, definitionJson, &canonical,
                                            &sourceIds, error)) return false;
    auto groups = previous.projectionGroups;
    auto existing = std::find_if(groups.begin(), groups.end(), [&](const auto& group) {
      return group.groupId == groupId;
    });
    const bool replacing = existing != groups.end();
    const uint64_t nextGeneration = existing == groups.end()
        ? 1 : existing->generation + 1;
    SketchProjectionGroup replacement;
    replacement.groupId = groupId;
    replacement.definitionJson = canonical;
    replacement.generation = nextGeneration;
    if (existing == groups.end()) {
      if (groups.size() >= 128) throw std::runtime_error("sketch has 128 projection groups already");
      groups.push_back(std::move(replacement));
    } else {
      *existing = std::move(replacement);
    }
    SketchFeature candidate = previous;
    candidate.projectionGroups = std::move(groups);
    const auto shapes = ShapeStore::instance().listInOrder();
    const auto sketches = SketchStore::instance().listInOrder();
    const auto datums = DatumStore::instance().listInOrder();
    std::vector<ProjectionSelection> newBindings;
    if (!ResolveSketchProjectionGroups(&candidate, shapes, sketches, datums,
                                       OcafLive::instance().SketchProjectionSourceResolver(),
                                       groupId, false, false, &newBindings, error))
      return false;

    FeatureGraph graph = TheFeatureGraph();
    graph.addFeature(sketchId, SketchDependencies(candidate));
    graph.markDirty(sketchId);
    std::vector<std::string> order;
    if (!graph.dirtyOrder(&order, error)) return false;

    const ModelSnapshot before;
    auto& ocaf = OcafLive::instance();
    if (!ocaf.BeginCommand(error)) return false;
    bool commandOpen = true;
    auto rollback = [&](const std::string& why) {
      if (commandOpen) ocaf.AbortCommand();
      before.restore();
      if (error) *error = why;
      return false;
    };
    if (replacing &&
        !ocaf.ReleaseSketchProjectionSources(sketchId, groupId, error))
      return rollback(error && !error->empty() ? *error : "cannot release old projection bindings");
    SketchProjectionGroup* group = nullptr;
    for (auto& item : candidate.projectionGroups)
      if (item.groupId == groupId) { group = &item; break; }
    std::string bindings;
    if (!group || !ocaf.BindSketchProjectionSources(sketchId, groupId,
                                                     newBindings, &bindings, error))
      return rollback(error && !error->empty() ? *error : "cannot bind projection sources");
    group->bindingsJson = std::move(bindings);
    if (!ResolveSketchProjectionGroups(&candidate, shapes, sketches, datums,
            ocaf.SketchProjectionSourceResolver(), "", false, false, nullptr, error))
      return rollback(error && !error->empty() ? *error : "cannot resolve bound projection sources");
    SketchStore::instance().put(candidate);
    if (!ocaf.UpsertSketch(sketchId, SerializeSketchFeature(candidate), error))
      return rollback(error && !error->empty() ? *error : "cannot save projection group");
    TheFeatureGraph().addFeature(sketchId, SketchDependencies(candidate));
    TheFeatureGraph().markDirty(sketchId);
    const auto report = TheFeatureGraph().recompute(
        [](const std::string& id, std::string* e) { return RebuildNodeFromStore(id, e); });
    if (!report.ok) return rollback(report.firstError);
    if (ocaf.InTransaction()) DocumentStore::instance().noteFeature(sketchId, "Sketch");
    else DocumentStore::instance().registerFeature(sketchId, "Sketch");
    if (!ocaf.CommitCommand(nullptr, error))
      return rollback(error && !error->empty() ? *error : "projection command commit failed");
    commandOpen = false;
    return true;
  } catch (const std::exception& failure) {
    if (error) *error = failure.what();
    return false;
  }
#else
  (void)sketchId; (void)groupId; (void)definitionJson;
  if (error) *error = "native projection lifecycle requires OCCT";
  return false;
#endif
}

bool RemoveSketchProjectionGroup(const std::string& sketchId,
                                 const std::string& groupId,
                                 std::string* error) {
#if KREODA_WITH_OCCT
  try {
    SketchFeature previous;
    if (!SketchStore::instance().get(sketchId, &previous))
      throw std::runtime_error("unknown sketch " + sketchId);
    SketchFeature candidate = previous;
    const auto existing = std::find_if(candidate.projectionGroups.begin(),
        candidate.projectionGroups.end(), [&](const auto& group) { return group.groupId == groupId; });
    if (existing == candidate.projectionGroups.end())
      throw std::runtime_error("unknown projection group " + groupId);
    candidate.projectionGroups.erase(existing);
    const auto shapes = ShapeStore::instance().listInOrder();
    const auto sketches = SketchStore::instance().listInOrder();
    const auto datums = DatumStore::instance().listInOrder();
    if (!ResolveSketchProjectionGroups(&candidate, shapes, sketches, datums,
            OcafLive::instance().SketchProjectionSourceResolver(), "", false,
            false, nullptr, error)) return false;
    FeatureGraph graph = TheFeatureGraph();
    graph.addFeature(sketchId, SketchDependencies(candidate));
    graph.markDirty(sketchId);
    std::vector<std::string> order;
    if (!graph.dirtyOrder(&order, error)) return false;

    const ModelSnapshot before;
    auto& ocaf = OcafLive::instance();
    if (!ocaf.BeginCommand(error)) return false;
    bool commandOpen = true;
    auto rollback = [&](const std::string& why) {
      if (commandOpen) ocaf.AbortCommand();
      before.restore();
      if (error) *error = why;
      return false;
    };
    if (!ocaf.ReleaseSketchProjectionSources(sketchId, groupId, error))
      return rollback(error && !error->empty() ? *error : "cannot release projection bindings");
    SketchStore::instance().put(candidate);
    if (!ocaf.UpsertSketch(sketchId, SerializeSketchFeature(candidate), error))
      return rollback(error && !error->empty() ? *error : "cannot save projection removal");
    TheFeatureGraph().addFeature(sketchId, SketchDependencies(candidate));
    TheFeatureGraph().markDirty(sketchId);
    const auto report = TheFeatureGraph().recompute(
        [](const std::string& id, std::string* e) { return RebuildNodeFromStore(id, e); });
    if (!report.ok) return rollback(report.firstError);
    if (ocaf.InTransaction()) DocumentStore::instance().noteFeature(sketchId, "Sketch");
    else DocumentStore::instance().registerFeature(sketchId, "Sketch");
    if (!ocaf.CommitCommand(nullptr, error))
      return rollback(error && !error->empty() ? *error : "projection command commit failed");
    commandOpen = false;
    return true;
  } catch (const std::exception& failure) {
    if (error) *error = failure.what();
    return false;
  }
#else
  (void)sketchId; (void)groupId;
  if (error) *error = "native projection lifecycle requires OCCT";
  return false;
#endif
}

}  // namespace kreoda
