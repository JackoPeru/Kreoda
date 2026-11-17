#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <functional>
#include <limits>
#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "features/datum/datum_store.h"
#include "features/surface/surface_sew_offset.h"
#include "model/commit.h"
#include "model/feature_graph.h"
#include "model/model_snapshot.h"
#include "persistence/ocaf_live.h"
#include "topology/face_roles.h"

#if KREODA_WITH_OCCT
#include <BOPAlgo_PaveFiller.hxx>
#include <BOPAlgo_SectionAttribute.hxx>
#include <BRepAlgoAPI_Check.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Section.hxx>
#include <BRepAlgoAPI_Splitter.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepGProp.hxx>
#include <BRepLib.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRepClass_FaceClassifier.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <Geom2d_Curve.hxx>
#include <Geom2d_Circle.hxx>
#include <Geom2d_Line.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <Geom_Surface.hxx>
#include <Geom_BoundedSurface.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <GeomLib.hxx>
#include <NCollection_List.hxx>
#include <Precision.hxx>
#include <Standard_Failure.hxx>
#include <TopAbs.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax3.hxx>
#include <gp_Ax2d.hxx>
#include <gp_Circ2d.hxx>
#include <gp_Dir.hxx>
#include <gp_Dir2d.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Vec.hxx>
#include <gp_Vec2d.hxx>
#endif

namespace kreoda {
using SurfaceTrimExtendJson = nlohmann::json;

#if KREODA_WITH_OCCT
namespace surface_trim_extend_detail {

inline bool Fail(std::string* error, const std::string& message) {
  if (error) *error = message;
  return false;
}

inline int FaceCount(const TopoDS_Shape& shape) {
  int count = 0;
  for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next()) ++count;
  return count;
}

inline double SurfaceArea(const TopoDS_Shape& shape) {
  GProp_GProps properties;
  BRepGProp::SurfaceProperties(shape, properties);
  return properties.Mass();
}

inline bool ConnectedFaces(const std::vector<TopoDS_Face>& faces,
                           int* componentCount, std::string* error) {
  if (!componentCount || faces.empty())
    return Fail(error, "surface body has no faces");
  TopTools_IndexedDataMapOfShapeListOfShape edgeFaces;
  TopTools_IndexedMapOfShape faceMap;
  for (const auto& face : faces) faceMap.Add(face);
  TopExp::MapShapesAndAncestors(
      [&]() {
        BRep_Builder builder;
        TopoDS_Compound compound;
        builder.MakeCompound(compound);
        for (const auto& face : faces) builder.Add(compound, face);
        return TopoDS_Shape(compound);
      }(), TopAbs_EDGE, TopAbs_FACE, edgeFaces);

  std::vector<std::vector<int>> adjacency(faces.size());
  for (int edgeIndex = 1; edgeIndex <= edgeFaces.Extent(); ++edgeIndex) {
    std::vector<int> adjacent;
    const auto& ancestors = edgeFaces.FindFromIndex(edgeIndex);
    for (TopTools_ListOfShape::Iterator it(ancestors); it.More(); it.Next()) {
      const int index = faceMap.FindIndex(it.Value());
      if (index > 0 && std::find(adjacent.begin(), adjacent.end(), index - 1) == adjacent.end())
        adjacent.push_back(index - 1);
    }
    if (adjacent.size() > 2)
      return Fail(error, "surface body contains a nonmanifold edge");
    if (adjacent.size() == 2) {
      adjacency[adjacent[0]].push_back(adjacent[1]);
      adjacency[adjacent[1]].push_back(adjacent[0]);
    }
  }
  std::vector<bool> seen(faces.size(), false);
  int components = 0;
  for (size_t start = 0; start < faces.size(); ++start) {
    if (seen[start]) continue;
    ++components;
    std::vector<size_t> pending{start};
    seen[start] = true;
    while (!pending.empty()) {
      const size_t current = pending.back();
      pending.pop_back();
      for (const int next : adjacency[current]) {
        const size_t index = static_cast<size_t>(next);
        if (!seen[index]) {
          seen[index] = true;
          pending.push_back(index);
        }
      }
    }
  }
  *componentCount = components;
  return true;
}

inline bool ValidateSurfaceBody(const ShapeRecord& record,
                                const std::string& operation,
                                std::string* error) {
  if (!surface_sew_offset_detail::ValidSurface(record, operation, error)) return false;
  std::vector<TopoDS_Face> faces;
  for (TopExp_Explorer it(record.shape, TopAbs_FACE); it.More(); it.Next())
    faces.push_back(TopoDS::Face(it.Current()));
  if (faces.size() > kMaxSurfaceSewOffsetFaces)
    return Fail(error, operation + ": face budget exceeds 4096");
  int components = 0;
  if (!ConnectedFaces(faces, &components, error)) return false;
  if (components != 1)
    return Fail(error, operation + ": input must be one connected surface body");
  return surface_sew_offset_detail::NoSelfInterference(record.shape, operation, error);
}

inline bool FindRecord(const std::string& id,
                       const std::map<std::string, ShapeRecord>* records,
                       ShapeRecord* out, std::string* error) {
  if (records) {
    const auto found = records->find(id);
    if (found == records->end())
      return Fail(error, "candidate geometry is unavailable for " + id);
    *out = found->second;
    return !out->shape.IsNull() || Fail(error, "candidate shape is null for " + id);
  }
  return surface_sew_offset_detail::FindRecord(id, nullptr, out, error);
}

inline bool ResolveSelectedTopology(const ShapeRecord& owner,
                                    const std::string& consumerId,
                                    const SurfaceTrimExtendJson& reference,
                                    bool edge, bool allowUnboundSelection,
                                    TopoDS_Shape* selected,
                                    std::string* error) {
  const auto type = reference.value("type", std::string{});
  const auto ownerId = reference.value("featureId", std::string{});
  const auto key = edge ? "persistentEdgeId" : "persistentFaceId";
  const auto role = reference.value(key, std::string{});
  if (type != (edge ? "edge" : "face") || ownerId != owner.featureId || role.empty())
    return Fail(error, edge ? "boundaryEdge must reference target edge"
                            : "keepFace must reference target face");
  const std::string fullRole = role.find(':') == std::string::npos
      ? owner.featureId + ":" + role : role;
  if (reference.contains("selectionEntry")) {
    const auto resolver = OcafLive::instance().DatumSourceResolver();
    if (!resolver) return Fail(error, "topology reference requires its OCAF naming context");
    TopoDS_Shape bound;
    std::string resolveError;
    if (!resolver(reference.value("selectionEntry", std::string{}), consumerId,
                  owner.featureId, fullRole, edge, &bound, &resolveError))
      return Fail(error, resolveError.empty() ? "bound topology reference is unavailable" : resolveError);
    int matches = 0;
    for (TopExp_Explorer it(owner.shape, edge ? TopAbs_EDGE : TopAbs_FACE);
         it.More(); it.Next()) {
      if (it.Current().IsSame(bound)) {
        if (selected) *selected = it.Current();
        ++matches;
      }
    }
    if (matches == 1 || (edge && matches > 0)) return true;
    return Fail(error, "bound topology reference is absent or ambiguous in candidate target");
  }
  if (!allowUnboundSelection && HasIndexedTopologyRole(fullRole))
    return Fail(error, "indexed topology reference lost its OCAF binding; ordinal fallback is disabled");
  if (edge) {
    TopoDS_Edge found;
    if (!FindEdgeByRole(owner.shape, owner.featureId, owner.type, fullRole, &found))
      return Fail(error, "persistent edge reference was lost or is ambiguous");
    if (selected) *selected = found;
  } else {
    TopoDS_Face found;
    if (!FindFaceByRole(owner.shape, owner.featureId, owner.type, fullRole, &found))
      return Fail(error, "persistent face reference was lost or is ambiguous");
    if (selected) *selected = found;
  }
  return true;
}

inline bool RequireStoredSelectionEntry(const SurfaceTrimExtendJson& reference,
                                        bool edge, std::string* error) {
  const auto key = edge ? "persistentEdgeId" : "persistentFaceId";
  if (!reference.is_object() || !reference.contains(key) ||
      !reference.at(key).is_string())
    return Fail(error, "stored surface topology reference is invalid");
  const auto ownerId = reference.value("featureId", std::string{});
  auto role = reference.at(key).get<std::string>();
  if (ownerId.empty() || role.empty())
    return Fail(error, "stored surface topology reference is invalid");
  if (role.find(':') == std::string::npos) role = ownerId + ":" + role;
  if (HasIndexedTopologyRole(role) && !reference.contains("selectionEntry"))
    return Fail(error, "indexed topology reference lost its OCAF binding; ordinal fallback is disabled");
  return true;
}

// A single generated face has a construction identity independent of radius or
// placement. Multiple faces and imported geometry keep ordinary naming rules.
inline SurfaceTrimExtendJson SingleSurfaceGenerator(const ShapeRecord& owner) {
  using Json = SurfaceTrimExtendJson;
  TopTools_IndexedMapOfShape faces;
  TopExp::MapShapes(owner.shape, TopAbs_FACE, faces);
  if (faces.Extent() != 1) return nullptr;
  Json chain = Json::array(), inputs = Json::array();
  std::set<std::string> visited;
  ShapeRecord generator = owner;
  while (generator.type == "Instance") {
    if (!visited.insert(generator.featureId).second || generator.dependsOn.size() != 1)
      return nullptr;
    chain.push_back({generator.featureId, generator.type});
    if (!ShapeStore::instance().get(generator.dependsOn.front(), &generator)) return nullptr;
  }
  const bool oneSketch = generator.type == "SurfaceExtrude" || generator.type == "SurfaceRevolve";
  if (!oneSketch && generator.type != "SurfaceSweep" && generator.type != "SurfaceLoft") return nullptr;
  chain.push_back({generator.featureId, generator.type});
  size_t sketchCount = 0;
  for (const auto& id : generator.dependsOn) {
    SketchFeature sketch;
    if (SketchStore::instance().get(id, &sketch)) {
      Json curves = Json::array();
      const std::set<std::string> construction(sketch.model.constructionIds.begin(),
                                               sketch.model.constructionIds.end());
      const auto add = [&](const auto& entities, const char* kind) {
        for (const auto& entity : entities)
          if (!construction.count(entity.id)) curves.push_back({kind, entity.id});
      };
      add(sketch.model.lines, "line"); add(sketch.model.circles, "circle");
      add(sketch.model.arcs, "arc"); add(sketch.model.ellipses, "ellipse");
      add(sketch.model.splines, "spline");
      if (curves.size() != 1) return nullptr;
      inputs.push_back({{"sketch", id}, {"curves", curves}});
      ++sketchCount;
    } else {
      DatumRecord datum;
      if (!DatumStore::instance().get(id, &datum) || datum.status != "ok") return nullptr;
      inputs.push_back({{"datum", id}, {"kind", DatumTypeName(datum.kind)}});
    }
  }
  if ((oneSketch && sketchCount != 1) ||
      (generator.type == "SurfaceSweep" && sketchCount != 2) ||
      (generator.type == "SurfaceLoft" && sketchCount < 2)) return nullptr;
  int direction = 0;
  if (oneSketch) {
    if (generator.paramsMm.empty()) return nullptr;
    direction = generator.paramsMm.front() < 0 ? -1 : 1;
  }
  const auto face = TopoDS::Face(faces(1));
  return {{"version", 1}, {"chain", chain}, {"inputs", inputs}, {"direction", direction},
      {"surface", static_cast<int>(BRepAdaptor_Surface(face).GetType())},
      {"orientation", static_cast<int>(face.Orientation())}};
}

inline bool BindSurfaceSources(const std::string& featureId, const std::string& targetId,
                                const char* referenceKey, std::string* storedRef,
                                bool refresh, std::string* error) {
  using Json = SurfaceTrimExtendJson;
  Json data;
  try { data = Json::parse(*storedRef); }
  catch (...) { return Fail(error, "surface source metadata is invalid"); }
  ShapeRecord owner;
  if (!FindRecord(targetId, nullptr, &owner, error)) return false;
  if (!data.contains(referenceKey) || !data.at(referenceKey).is_object())
    return Fail(error, "surface source reference is missing");
  const auto& reference = data.at(referenceKey);
  const bool edge = std::string(referenceKey) == "boundaryEdge";
  const auto identity = SingleSurfaceGenerator(owner);
  if (!refresh && !identity.is_null()) {
    std::string boundary;
    if (edge) {
      TopoDS_Edge picked;
      const auto role = reference.value("persistentEdgeId", std::string{});
      if (!FindEdgeByRole(owner.shape, owner.featureId, owner.type, role, &picked))
        return Fail(error, "surface boundary is missing or ambiguous");
      TopExp_Explorer face(owner.shape, TopAbs_FACE);
      boundary = ParameterBoundaryRole(picked, TopoDS::Face(face.Current()));
    }
    if (!edge || !boundary.empty())
      data["sourceIdentity"] = {{"generator", identity}, {"boundary", boundary}};
  }
  DatumSelectionResolver verifiedRefresh;
  if (refresh && data.contains("sourceIdentity")) {
    const auto expected = data.at("sourceIdentity");
    if (!expected.is_object() || !expected.contains("generator") ||
        !expected.at("generator").is_object() || !expected.contains("boundary") ||
        !expected.at("boundary").is_string() || !reference.contains("selectionEntry"))
      return Fail(error, "stored surface generator identity requires repair");
    auto role = reference.value(edge ? "persistentEdgeId" : "persistentFaceId", std::string{});
    if (role.find(':') == std::string::npos) role = targetId + ":" + role;
    const auto entry = reference.at("selectionEntry").get<std::string>();
    verifiedRefresh = [=](const std::string& selectedEntry, const std::string& consumer,
        const std::string& sourceId, const std::string& sourceRole, bool selectedEdge,
        TopoDS_Shape* selected, std::string* failure) {
      if (selectedEntry != entry || consumer != featureId || sourceId != targetId ||
          sourceRole != role || selectedEdge != edge || identity.is_null() ||
          expected.at("generator") != identity)
        return Fail(failure, "surface generator identity changed; reference requires repair");
      TopTools_IndexedMapOfShape faces;
      TopExp::MapShapes(owner.shape, TopAbs_FACE, faces);
      if (faces.Extent() != 1) return Fail(failure, "generated surface face is no longer unique");
      if (!edge) { *selected = faces(1); return true; }
      const auto boundary = expected.at("boundary").get<std::string>();
      int count = 0;
      for (const auto& candidate : ClassifyEdgeRoles(owner.shape, owner.type, owner.featureId)) {
        if (ParameterBoundaryRole(candidate.edge, TopoDS::Face(faces(1))) == boundary) {
          *selected = candidate.edge;
          ++count;
        }
      }
      return count == 1 || Fail(failure, "generated surface boundary is missing or ambiguous");
    };
  }
  *storedRef = data.dump();
  return OcafLive::instance().BindDatumSources(featureId, storedRef, error, refresh,
                                               verifiedRefresh);
}

inline bool ResolveCandidateDatum(const std::string& id,
                                  const std::map<std::string, ShapeRecord>* records,
                                  DatumRecord* out, std::string* error) {
  const auto datums = DatumStore::instance().listInOrder();
  std::vector<ShapeRecord> shapes;
  if (records) {
    for (const auto& entry : *records) shapes.push_back(entry.second);
  } else {
    shapes = ShapeStore::instance().listInOrder();
  }
  std::vector<DatumRecord> resolved;
  std::set<std::string> active;
  std::function<bool(const std::string&)> visit = [&](const std::string& current) {
    if (std::any_of(resolved.begin(), resolved.end(), [&](const DatumRecord& datum) {
          return datum.featureId == current;
        })) return true;
    DatumRecord source;
    if (!DatumStore::instance().get(current, &source))
      return Fail(error, "missing datum dependency " + current);
    if (!active.insert(current).second)
      return Fail(error, "datum dependency cycle at " + current);
    for (const auto& dependency : source.dependsOn) {
      DatumRecord nested;
      if (DatumStore::instance().get(dependency, &nested) && !visit(dependency)) return false;
    }
    DatumRecord candidate;
    candidate.featureId = current;
    if (!ResolveDatumDefinition(source.kind, source.definitionJson,
            DatumSourceRecords{resolved, shapes, OcafLive::instance().DatumSourceResolver(), false},
            &candidate, error)) return false;
    active.erase(current);
    resolved.push_back(std::move(candidate));
    return true;
  };
  if (!visit(id)) return false;
  const auto found = std::find_if(resolved.begin(), resolved.end(), [&](const DatumRecord& datum) {
    return datum.featureId == id;
  });
  if (found == resolved.end()) return Fail(error, "datum candidate was not resolved");
  if (found->kind != DatumKind::Plane || found->status != "ok")
    return Fail(error, "tool datum must be a healthy DatumPlane");
  *out = *found;
  return true;
}

inline bool MakeDatumPlaneTool(const ShapeRecord& target, const DatumRecord& datum,
                               TopoDS_Shape* output, std::string* error) {
  if (!output || datum.kind != DatumKind::Plane || datum.status != "ok")
    return Fail(error, "tool datum must be a healthy DatumPlane");
  try {
    const gp_Pnt origin(datum.plane.origin[0], datum.plane.origin[1], datum.plane.origin[2]);
    const gp_Dir x(datum.plane.xAxis[0], datum.plane.xAxis[1], datum.plane.xAxis[2]);
    const gp_Dir normal(datum.plane.normal[0], datum.plane.normal[1], datum.plane.normal[2]);
    const gp_Pln plane(gp_Ax3(origin, normal, x));
    Bnd_Box bounds;
    BRepBndLib::AddOptimal(target.shape, bounds, false, false);
    if (bounds.IsVoid() || bounds.IsOpen()) return Fail(error, "target has no finite bounds");
    double x0, y0, z0, x1, y1, z1;
    bounds.Get(x0, y0, z0, x1, y1, z1);
    const gp_Ax3 frame = plane.Position();
    const gp_Dir ux = frame.XDirection(), vy = frame.YDirection();
    double u0 = std::numeric_limits<double>::infinity();
    double v0 = std::numeric_limits<double>::infinity();
    double u1 = -u0, v1 = -v0;
    for (const double px : {x0, x1}) for (const double py : {y0, y1}) for (const double pz : {z0, z1}) {
      const gp_Vec delta(origin, gp_Pnt(px, py, pz));
      const double u = delta.Dot(gp_Vec(ux));
      const double v = delta.Dot(gp_Vec(vy));
      u0 = std::min(u0, u); u1 = std::max(u1, u);
      v0 = std::min(v0, v); v1 = std::max(v1, v);
    }
    const double padding = std::max(1.0, gp_Pnt(x0, y0, z0).Distance(gp_Pnt(x1, y1, z1)));
    BRepBuilderAPI_MakeFace maker(plane, u0 - padding, u1 + padding,
                                  v0 - padding, v1 + padding);
    if (!maker.IsDone()) return Fail(error, "cannot create finite datum plane tool");
    *output = maker.Face();
    return true;
  } catch (const Standard_Failure& failure) {
    return Fail(error, std::string("datum plane tool failed: ") +
                        (failure.GetMessageString() ? failure.GetMessageString() : "OCCT error"));
  }
}

inline bool OutputSurface(const TopoDS_Shape& shape, const std::string& operation,
                          std::string* error) {
  ShapeRecord check;
  check.type = operation;
  if (!surface_sew_offset_detail::SetSurfaceBounds(shape, &check, operation, error)) return false;
  if (!surface_sew_offset_detail::NoSelfInterference(shape, operation, error)) return false;
  return true;
}

inline bool HasSectionPcurve(const TopoDS_Edge& edge,
                             const std::vector<TopoDS_Face>& targetFaces) {
  for (const auto& face : targetFaces) {
    Standard_Real first = 0, last = 0;
    if (!BRep_Tool::CurveOnSurface(edge, face, first, last).IsNull()) return true;
  }
  return false;
}

inline bool EndpointOnTargetBoundary(const TopoDS_Vertex& vertex,
                                     const std::vector<TopoDS_Edge>& boundary,
                                     double toleranceMm) {
  for (const auto& edge : boundary) {
    BRepExtrema_DistShapeShape distance(vertex, edge);
    distance.Perform();
    if (distance.IsDone() && distance.NbSolution() > 0 &&
        distance.Value() <= toleranceMm) return true;
  }
  return false;
}

inline bool ValidateSectionSeparates(const std::vector<TopoDS_Edge>& cuts,
                                     const TopoDS_Shape& target,
                                     double toleranceMm, std::string* error) {
  std::vector<TopoDS_Edge> targetBoundary;
  TopTools_IndexedDataMapOfShapeListOfShape edgeFaces;
  TopExp::MapShapesAndAncestors(target, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
  for (int i = 1; i <= edgeFaces.Extent(); ++i) {
    const auto& ancestors = edgeFaces.FindFromIndex(i);
    std::vector<TopoDS_Face> distinct;
    for (TopTools_ListOfShape::Iterator it(ancestors); it.More(); it.Next()) {
      const auto face = TopoDS::Face(it.Value());
      if (std::none_of(distinct.begin(), distinct.end(), [&](const TopoDS_Face& item) {
            return item.IsSame(face);
          })) distinct.push_back(face);
    }
    if (distinct.size() > 2)
      return Fail(error, "target contains a nonmanifold edge");
    if (distinct.size() == 1)
      targetBoundary.push_back(TopoDS::Edge(edgeFaces.FindKey(i)));
  }
  TopTools_IndexedDataMapOfShapeListOfShape cutVertices;
  for (const auto& edge : cuts) {
    TopoDS_Vertex first, last;
    TopExp::Vertices(edge, first, last, true);
    if (first.IsNull() || last.IsNull())
      return Fail(error, "intersection edge has missing endpoints");
    if (!cutVertices.Contains(first)) cutVertices.Add(first, TopTools_ListOfShape());
    cutVertices.ChangeFromKey(first).Append(edge);
    if (!last.IsSame(first)) {
      if (!cutVertices.Contains(last)) cutVertices.Add(last, TopTools_ListOfShape());
      cutVertices.ChangeFromKey(last).Append(edge);
    } else {
      cutVertices.ChangeFromKey(first).Append(edge);
    }
  }
  for (int i = 1; i <= cutVertices.Extent(); ++i) {
    const auto& incident = cutVertices.FindFromIndex(i);
    if (incident.Extent() > 2)
      return Fail(error, "intersection graph branches ambiguously");
    if (incident.Extent() == 1 &&
        !EndpointOnTargetBoundary(TopoDS::Vertex(cutVertices.FindKey(i)), targetBoundary,
                                  toleranceMm))
      return Fail(error, "intersection does not separate target surface");
  }
  return true;
}

inline bool SplitTarget(const TopoDS_Shape& target, const TopoDS_Shape& tool,
                        const TopoDS_Face& selectedFace, double keepU, double keepV,
                        double toleranceMm, TopoDS_Shape* output,
                        std::string* error) {
  try {
    std::vector<TopoDS_Face> targetFaces;
    for (TopExp_Explorer it(target, TopAbs_FACE); it.More(); it.Next())
      targetFaces.push_back(TopoDS::Face(it.Current()));
    if (targetFaces.empty() || targetFaces.size() > kMaxSurfaceSewOffsetFaces)
      return Fail(error, "SurfaceTrim target has no faces or exceeds 4096 faces");

    NCollection_List<TopoDS_Shape> arguments;
    arguments.Append(target);
    arguments.Append(tool);
    BOPAlgo_PaveFiller filler;
    filler.SetArguments(arguments);
    filler.SetSectionAttribute(BOPAlgo_SectionAttribute(Standard_True, Standard_True,
                                                        Standard_True));
    filler.SetNonDestructive(Standard_True);
    filler.Perform();
    if (filler.HasErrors()) return Fail(error, "SurfaceTrim intersection preparation failed");

    BRepAlgoAPI_Section section(filler);
    NCollection_List<TopoDS_Shape> sectionObjects, sectionTools;
    sectionObjects.Append(target);
    sectionTools.Append(tool);
    section.SetArguments(sectionObjects);
    section.SetTools(sectionTools);
    section.SetOperation(BOPAlgo_SECTION);
    section.SetNonDestructive(Standard_True);
    section.Build();
    if (!section.IsDone()) return Fail(error, "SurfaceTrim section construction failed");
    std::vector<TopoDS_Edge> cutEdges;
    for (TopExp_Explorer it(section.Shape(), TopAbs_EDGE); it.More(); it.Next()) {
      const auto edge = TopoDS::Edge(it.Current());
      if (!HasSectionPcurve(edge, targetFaces))
        return Fail(error, "section edge has no target pcurve");
      cutEdges.push_back(edge);
    }
    if (cutEdges.empty()) return Fail(error, "tool does not intersect target surface");
    if (!ValidateSectionSeparates(cutEdges, target, toleranceMm, error)) return false;

    NCollection_List<TopoDS_Shape> splitObjects, splitTools;
    splitObjects.Append(target);
    splitTools.Append(tool);
    BRepAlgoAPI_Splitter splitter(filler);
    splitter.SetArguments(splitObjects);
    splitter.SetTools(splitTools);
    splitter.SetNonDestructive(Standard_True);
    splitter.Build();
    if (!splitter.IsDone() || splitter.Shape().IsNull())
      return Fail(error, "SurfaceTrim splitter failed");
    if (TopExp_Explorer(splitter.Shape(), TopAbs_SOLID).More())
      return Fail(error, "SurfaceTrim unexpectedly produced solid topology");

    TopTools_IndexedMapOfShape cutMap, uniqueFaces;
    for (const auto& edge : cutEdges) cutMap.Add(edge);
    std::vector<TopoDS_Face> splitFaces;
    for (const auto& source : targetFaces) {
      bool found = false;
      const auto& modified = splitter.Modified(source);
      for (TopTools_ListOfShape::Iterator it(modified); it.More(); it.Next()) {
        if (it.Value().ShapeType() != TopAbs_FACE) continue;
        if (!uniqueFaces.Contains(it.Value())) {
          uniqueFaces.Add(it.Value());
          splitFaces.push_back(TopoDS::Face(it.Value()));
        }
        found = true;
      }
      if (!found && !splitter.IsDeleted(source) && !uniqueFaces.Contains(source)) {
        uniqueFaces.Add(source);
        splitFaces.push_back(source);
      }
    }
    if (splitFaces.size() < 2 || splitFaces.size() > kMaxSurfaceSewOffsetFaces)
      return Fail(error, "SurfaceTrim did not partition target into bounded faces");

    TopTools_IndexedDataMapOfShapeListOfShape edgeFaces;
    TopoDS_Compound compound;
    BRep_Builder builder;
    builder.MakeCompound(compound);
    for (const auto& face : splitFaces) builder.Add(compound, face);
    TopExp::MapShapesAndAncestors(compound, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
    std::vector<std::vector<int>> adjacency(splitFaces.size());
    for (int edgeIndex = 1; edgeIndex <= edgeFaces.Extent(); ++edgeIndex) {
      const TopoDS_Shape edge = edgeFaces.FindKey(edgeIndex);
      if (cutMap.Contains(edge)) continue;
      std::vector<int> adjacent;
      const auto& ancestors = edgeFaces.FindFromIndex(edgeIndex);
      for (TopTools_ListOfShape::Iterator it(ancestors); it.More(); it.Next()) {
        const int index = uniqueFaces.FindIndex(it.Value());
        if (index > 0 && std::find(adjacent.begin(), adjacent.end(), index - 1) == adjacent.end())
          adjacent.push_back(index - 1);
      }
      if (adjacent.size() > 2)
        return Fail(error, "SurfaceTrim result contains nonmanifold adjacency");
      if (adjacent.size() == 2) {
        adjacency[adjacent[0]].push_back(adjacent[1]);
        adjacency[adjacent[1]].push_back(adjacent[0]);
      }
    }
    for (const auto& edge : cutEdges)
      if (!edgeFaces.Contains(edge))
        return Fail(error, "section identity was not preserved by splitter");

    std::vector<int> component(splitFaces.size(), -1);
    int componentCount = 0;
    for (size_t start = 0; start < splitFaces.size(); ++start) {
      if (component[start] >= 0) continue;
      std::vector<size_t> pending{start};
      component[start] = componentCount;
      while (!pending.empty()) {
        const size_t current = pending.back();
        pending.pop_back();
        for (const int next : adjacency[current]) {
          const size_t index = static_cast<size_t>(next);
          if (component[index] < 0) {
            component[index] = componentCount;
            pending.push_back(index);
          }
        }
      }
      ++componentCount;
    }
    if (componentCount < 2)
      return Fail(error, "tool cut does not partition target surface");

    TopTools_IndexedMapOfShape allTargetFaces;
    for (const auto& face : targetFaces) allTargetFaces.Add(face);
    const int selectedIndex = allTargetFaces.FindIndex(selectedFace);
    if (selectedIndex <= 0) return Fail(error, "keepFace is no longer part of target");
    const auto& selectedPieces = splitter.Modified(selectedFace);
    std::vector<int> selectedRegions;
    TopLoc_Location keepLocation;
    const auto keepSurface = BRep_Tool::Surface(selectedFace, keepLocation);
    gp_Pnt keepPoint = keepSurface->Value(keepU, keepV);
    keepPoint.Transform(keepLocation.Transformation());
    const auto addPhysicalCandidate = [&](const TopoDS_Face& face, int faceIndex) {
      BRepBuilderAPI_MakeVertex vertex(keepPoint);
      BRepExtrema_DistShapeShape distance(vertex.Vertex(), face);
      distance.Perform();
      if (distance.IsDone() && distance.NbSolution() > 0 &&
          distance.Value() <= toleranceMm)
        selectedRegions.push_back(component[faceIndex - 1]);
    };
    bool hadSelectedPiece = false;
    for (TopTools_ListOfShape::Iterator it(selectedPieces); it.More(); it.Next()) {
      if (it.Value().ShapeType() != TopAbs_FACE) continue;
      const int faceIndex = uniqueFaces.FindIndex(it.Value());
      if (faceIndex <= 0) continue;
      hadSelectedPiece = true;
      const auto face = TopoDS::Face(it.Value());
      const auto state = BRepClass_FaceClassifier(face, gp_Pnt2d(keepU, keepV),
                                                  toleranceMm).State();
      if (state == TopAbs_IN) selectedRegions.push_back(component[faceIndex - 1]);
      else if (state == TopAbs_ON) addPhysicalCandidate(face, faceIndex);
    }
    if (!hadSelectedPiece && !splitter.IsDeleted(selectedFace)) {
      const int faceIndex = uniqueFaces.FindIndex(selectedFace);
      if (faceIndex > 0) {
        const auto state = BRepClass_FaceClassifier(selectedFace, gp_Pnt2d(keepU, keepV),
                                                    toleranceMm).State();
        if (state == TopAbs_IN) selectedRegions.push_back(component[faceIndex - 1]);
        else if (state == TopAbs_ON) addPhysicalCandidate(selectedFace, faceIndex);
      }
    }
    std::sort(selectedRegions.begin(), selectedRegions.end());
    selectedRegions.erase(std::unique(selectedRegions.begin(), selectedRegions.end()),
                          selectedRegions.end());
    if (selectedRegions.size() != 1)
      return Fail(error, "keepUv is outside target face or lies on an ambiguous cut");

    TopoDS_Shape result;
    size_t keptFaces = 0;
    if (componentCount == 1) return Fail(error, "tool cut does not partition target surface");
    TopoDS_Shell shell;
    builder.MakeShell(shell);
    for (size_t i = 0; i < splitFaces.size(); ++i) {
      if (component[i] != selectedRegions.front()) continue;
      builder.Add(shell, splitFaces[i]);
      ++keptFaces;
    }
    if (keptFaces == 0) return Fail(error, "keepUv did not select a target region");
    result = shell;
    if (!OutputSurface(result, "SurfaceTrim", error)) return false;
    *output = result;
    return true;
  } catch (const Standard_Failure& failure) {
    return Fail(error, std::string("SurfaceTrim kernel failure: ") +
                        (failure.GetMessageString() ? failure.GetMessageString() : "OCCT error"));
  } catch (const std::exception& failure) {
    return Fail(error, std::string("SurfaceTrim failure: ") + failure.what());
  }
}

inline bool BuildSurfaceTrimShape(const ShapeRecord& target, const TopoDS_Shape& tool,
                                  const SurfaceTrimExtendJson& refExtra,
                                  const std::vector<double>& params,
                                  const std::string& consumerId,
                                  bool allowUnboundSelection,
                                  TopoDS_Shape* output, std::string* error) {
  if (!output || params.size() != 3 || !std::isfinite(params[0]) ||
      !std::isfinite(params[1]) || !surface_sew_offset_detail::ValidTolerance(params[2]))
    return Fail(error, "SurfaceTrim expects finite keepU, keepV and toleranceMm");
  if (!refExtra.is_object() || refExtra.value("version", 0) != 1 ||
      !refExtra.contains("keepFace") || !refExtra["keepFace"].is_object())
    return Fail(error, "SurfaceTrim reference metadata is invalid");
  TopoDS_Shape selectedShape;
  if (!ResolveSelectedTopology(target, consumerId, refExtra["keepFace"], false,
                               allowUnboundSelection, &selectedShape, error)) return false;
  const TopoDS_Face selected = TopoDS::Face(selectedShape);
  BRepBuilderAPI_Copy targetCopy(target.shape, Standard_True, Standard_False);
  if (!targetCopy.IsDone() || targetCopy.Shape().IsNull())
    return Fail(error, "SurfaceTrim could not copy target B-Rep");
  TopoDS_Shape mapped = targetCopy.ModifiedShape(selected);
  if (mapped.IsNull() || mapped.ShapeType() != TopAbs_FACE)
    return Fail(error, "SurfaceTrim could not map keepFace through deep copy");
  BRepBuilderAPI_Copy toolCopy(tool, Standard_True, Standard_False);
  if (!toolCopy.IsDone() || toolCopy.Shape().IsNull())
    return Fail(error, "SurfaceTrim could not copy tool B-Rep");
  return SplitTarget(targetCopy.Shape(), toolCopy.Shape(), TopoDS::Face(mapped),
                     params[0], params[1], params[2], output, error);
}

inline bool BuildSurfaceTrimFromRecords(
    const std::string& targetId, const std::string& toolId,
    const SurfaceTrimExtendJson& refExtra, const std::vector<double>& params,
    const std::string& consumerId, bool allowUnboundSelection,
    TopoDS_Shape* output, std::string* error,
    const std::map<std::string, ShapeRecord>* records = nullptr) {
  ShapeRecord target;
  if (!FindRecord(targetId, records, &target, error)) return false;
  if (!IsSurfaceGeometry(target)) return Fail(error, "SurfaceTrim target must be a surface body");
  if (!ValidateSurfaceBody(target, "SurfaceTrim target", error)) return false;
  if (toolId == targetId) return Fail(error, "SurfaceTrim target and tool must differ");
  ShapeRecord toolRecord;
  if (ShapeStore::instance().contains(toolId) ||
      (records && records->count(toolId))) {
    if (!FindRecord(toolId, records, &toolRecord, error)) return false;
    if (!IsSurfaceGeometry(toolRecord)) return Fail(error, "SurfaceTrim tool must be a surface body or datum plane");
    if (!ValidateSurfaceBody(toolRecord, "SurfaceTrim tool", error)) return false;
    return BuildSurfaceTrimShape(target, toolRecord.shape, refExtra, params,
                                 consumerId, allowUnboundSelection, output, error);
  }
  DatumRecord datum;
  if (!ResolveCandidateDatum(toolId, records, &datum, error)) return false;
  TopoDS_Shape plane;
  if (!MakeDatumPlaneTool(target, datum, &plane, error)) return false;
  return BuildSurfaceTrimShape(target, plane, refExtra, params,
                               consumerId, allowUnboundSelection, output, error);
}

inline bool ResolveSurfacePoint(const ShapeRecord& target, const gp_Pnt& pointMm,
                                const std::string& persistentFaceId,
                                double maxDistanceMm, SurfaceTrimExtendJson* result,
                                std::string* error) {
  if (!result || !std::isfinite(pointMm.X()) || !std::isfinite(pointMm.Y()) ||
      !std::isfinite(pointMm.Z()) || !std::isfinite(maxDistanceMm) ||
      maxDistanceMm < 1e-6 || maxDistanceMm > 1.0)
    return Fail(error, "resolveSurfacePoint arguments are outside supported ranges");
  if (!IsSurfaceGeometry(target)) return Fail(error, "target is not surface geometry");
  struct Hit { std::string role; double u = 0, v = 0, distance = 0; gp_Pnt point; };
  std::vector<Hit> hits;
  const auto roles = ClassifyFaceRoles(target.shape, target.type, target.featureId);
  size_t index = 0;
  bool hintFound = persistentFaceId.empty();
  for (TopExp_Explorer it(target.shape, TopAbs_FACE); it.More(); it.Next(), ++index) {
    if (index >= roles.size()) return Fail(error, "face role count mismatch");
    const auto& role = roles[index];
    if (!persistentFaceId.empty() && role != persistentFaceId) continue;
    hintFound = true;
    const auto face = TopoDS::Face(it.Current());
    TopLoc_Location location;
    const auto surface = BRep_Tool::Surface(face, location);
    if (surface.IsNull()) continue;
    double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
    BRepTools::UVBounds(face, u0, u1, v0, v1);
    gp_Pnt local = pointMm;
    local.Transform(location.Transformation().Inverted());
    GeomAPI_ProjectPointOnSurf projection(local, surface, u0, u1, v0, v1,
                                          Precision::Confusion());
    if (!projection.IsDone()) continue;
    for (int solution = 1; solution <= projection.NbPoints(); ++solution) {
      Standard_Real u = 0, v = 0;
      projection.Parameters(solution, u, v);
      const auto state = BRepClass_FaceClassifier(face, gp_Pnt2d(u, v),
                                                   Precision::PConfusion()).State();
      if (state != TopAbs_IN && state != TopAbs_ON) continue;
      gp_Pnt projected = projection.Point(solution);
      projected.Transform(location.Transformation());
      hits.push_back({role, u, v, pointMm.Distance(projected), projected});
    }
  }
  if (!hintFound) return Fail(error, "persistentFaceId does not belong to target");
  if (hits.empty()) return Fail(error, "point does not project into material of a trimmed face");
  std::sort(hits.begin(), hits.end(), [](const Hit& a, const Hit& b) {
    if (a.distance != b.distance) return a.distance < b.distance;
    if (a.role != b.role) return a.role < b.role;
    if (a.u != b.u) return a.u < b.u;
    return a.v < b.v;
  });
  if (hits.front().distance > maxDistanceMm)
    return Fail(error, "point is farther than maxDistanceMm from target surface");
  std::vector<const Hit*> nearest;
  for (const auto& hit : hits)
    if (std::abs(hit.distance - hits.front().distance) <= Precision::Confusion())
      nearest.push_back(&hit);
  std::set<std::string> nearestFaces;
  for (const auto* hit : nearest) nearestFaces.insert(hit->role);
  if (nearestFaces.size() != 1)
    return Fail(error, "point projection is geometrically ambiguous");
  for (size_t i = 1; i < nearest.size(); ++i) {
    if (nearest.front()->point.Distance(nearest[i]->point) > Precision::Confusion())
      return Fail(error, "point has multiple equally near projections");
  }
  const auto& hit = *nearest.front();
  *result = {{"keepFace", {{"type", "face"}, {"featureId", target.featureId},
                            {"persistentFaceId", hit.role}}},
             {"keepUv", {hit.u, hit.v}},
             {"pointMm", {hit.point.X(), hit.point.Y(), hit.point.Z()}},
             {"projectionDistanceMm", hit.distance}};
  return true;
}

inline bool FindOuterBoundary(const TopoDS_Face& face, const TopoDS_Edge& selected,
                              TopoDS_Edge* boundary, std::string* error) {
  if (!boundary) return Fail(error, "SurfaceExtend requires an edge output");
  const TopoDS_Wire outer = BRepTools::OuterWire(face);
  if (outer.IsNull()) return Fail(error, "selected face has no outer boundary");
  for (BRepTools_WireExplorer it(outer, face); it.More(); it.Next()) {
    const TopoDS_Edge edge = it.Current();
    if (edge.IsSame(selected)) {
      *boundary = edge;
      return true;
    }
  }
  return Fail(error, "SurfaceExtend rejects inner-hole boundary edges");
}

inline bool OutwardPcurveDirection(const TopoDS_Face& face,
                                   const TopoDS_Edge& boundary,
                                   gp_Vec2d* direction, std::string* error) {
  Standard_Real first = 0, last = 0;
  const auto curve = BRep_Tool::CurveOnSurface(boundary, face, first, last);
  if (curve.IsNull() || !direction)
    return Fail(error, "selected boundary edge has no exact pcurve");
  gp_Pnt2d uv;
  gp_Vec2d tangent;
  curve->D1((first + last) * 0.5, uv, tangent);
  if (boundary.Orientation() == TopAbs_REVERSED) tangent.Reverse();
  if (tangent.SquareMagnitude() <= 1e-24)
    return Fail(error, "selected pcurve is degenerate");
  gp_Vec2d normal(-tangent.Y(), tangent.X());
  normal.Normalize();
  TopLoc_Location location;
  const auto surface = BRep_Tool::Surface(face, location);
  double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
  surface->Bounds(u0, u1, v0, v1);
  double span = 1.0;
  if (std::isfinite(u0) && std::isfinite(u1) && std::abs(u1 - u0) < 1e50)
    span = std::min(span, std::abs(u1 - u0));
  if (std::isfinite(v0) && std::isfinite(v1) && std::abs(v1 - v0) < 1e50)
    span = std::min(span, std::abs(v1 - v0));
  const double initial = std::max(1e-7, std::min(1e-3, span * 1e-3));
  for (int attempt = 0; attempt < 7; ++attempt) {
    const double epsilon = initial * std::pow(2.0, attempt);
    const gp_Pnt2d plus(uv.X() + normal.X() * epsilon,
                        uv.Y() + normal.Y() * epsilon);
    const gp_Pnt2d minus(uv.X() - normal.X() * epsilon,
                         uv.Y() - normal.Y() * epsilon);
    const auto plusState = BRepClass_FaceClassifier(face, plus, Precision::PConfusion()).State();
    const auto minusState = BRepClass_FaceClassifier(face, minus, Precision::PConfusion()).State();
    if (plusState == TopAbs_OUT && minusState == TopAbs_IN) {
      *direction = normal;
      return true;
    }
    if (minusState == TopAbs_OUT && plusState == TopAbs_IN) {
      *direction = gp_Vec2d(-normal.X(), -normal.Y());
      return true;
    }
  }
  return Fail(error, "cannot determine outer pcurve direction from face UV classifier");
}

inline bool PcurveWithinSupport(const Handle(Geom2d_Curve)& curve,
                                Standard_Real first, Standard_Real last,
                                const Handle(Geom_Surface)& surface,
                                const gp_Vec2d& direction, double delta) {
  double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
  surface->Bounds(u0, u1, v0, v1);
  const bool finiteU = std::isfinite(u0) && std::isfinite(u1) && std::abs(u1 - u0) < 1e50;
  const bool finiteV = std::isfinite(v0) && std::isfinite(v1) && std::abs(v1 - v0) < 1e50;
  for (int i = 0; i <= 32; ++i) {
    gp_Pnt2d uv = curve->Value(first + (last - first) * i / 32.0);
    uv.Translate(gp_Vec2d(direction.X() * delta, direction.Y() * delta));
    if (finiteU && (uv.X() < u0 - 1e-8 || uv.X() > u1 + 1e-8)) return false;
    if (finiteV && (uv.Y() < v0 - 1e-8 || uv.Y() > v1 + 1e-8)) return false;
  }
  return true;
}

inline gp_Pnt SurfacePoint(const Handle(Geom_Surface)& surface,
                           const TopLoc_Location& location,
                           const gp_Pnt2d& uv) {
  gp_Pnt point = surface->Value(uv.X(), uv.Y());
  point.Transform(location.Transformation());
  return point;
}

inline bool CalibratePcurveOnSurface(const TopoDS_Face& face,
                                     const TopoDS_Edge& boundary,
                                     const gp_Vec2d& direction,
                                     double distanceMm,
                                     const Handle(Geom_Surface)& surface,
                                     gp_Vec2d* shift, std::string* error) {
  Standard_Real first = 0, last = 0;
  const auto pcurve = BRep_Tool::CurveOnSurface(boundary, face, first, last);
  if (pcurve.IsNull() || !shift) return Fail(error, "selected boundary pcurve is missing");
  TopLoc_Location location;
  const auto sourceSurface = BRep_Tool::Surface(face, location);
  if (surface.IsNull() || sourceSurface.IsNull())
    return Fail(error, "selected face has no exact support");
  gp_Pnt2d midpoint;
  gp_Vec2d tangent;
  pcurve->D1((first + last) * 0.5, midpoint, tangent);
  const auto chord = [&](double delta) {
    gp_Pnt2d moved = midpoint;
    moved.Translate(gp_Vec2d(direction.X() * delta, direction.Y() * delta));
    return SurfacePoint(surface, location, midpoint).Distance(
        SurfacePoint(surface, location, moved));
  };
  double low = 0, high = 1e-3;
  bool bracketed = false;
  for (int i = 0; i < 40; ++i) {
    if (!PcurveWithinSupport(pcurve, first, last, surface, direction, high)) break;
    const double measured = chord(high);
    if (!std::isfinite(measured)) return Fail(error, "pcurve chord is non-finite");
    if (measured >= distanceMm) { bracketed = true; break; }
    low = high;
    high *= 2;
  }
  if (!bracketed) return Fail(error, "requested chord exceeds bounded surface continuation");
  for (int i = 0; i < 48; ++i) {
    const double middle = (low + high) * 0.5;
    if (!PcurveWithinSupport(pcurve, first, last, surface, direction, middle)) {
      high = middle;
      continue;
    }
    const double measured = chord(middle);
    if (!std::isfinite(measured)) return Fail(error, "pcurve chord is non-finite");
    if (std::abs(measured - distanceMm) <= 1e-7) {
      low = high = middle;
      break;
    }
    if (measured < distanceMm) low = middle;
    else high = middle;
  }
  const double delta = (low + high) * 0.5;
  if (!PcurveWithinSupport(pcurve, first, last, surface, direction, delta) ||
      std::abs(chord(delta) - distanceMm) > 1e-5)
    return Fail(error, "pcurve chord did not converge on the existing support");
  *shift = gp_Vec2d(direction.X() * delta, direction.Y() * delta);
  return true;
}

inline bool SupportPreserved(const TopoDS_Face& face,
                             const Handle(Geom_Surface)& original,
                             const Handle(Geom_Surface)& extended,
                             double toleranceMm, std::string* error) {
  if (original.IsNull() || extended.IsNull() ||
      std::string(original->DynamicType()->Name()) !=
          std::string(extended->DynamicType()->Name()))
    return Fail(error, "bounded support extension changed the exact surface class");
  double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
  BRepTools::UVBounds(face, u0, u1, v0, v1);
  if (!std::isfinite(u0) || !std::isfinite(u1) ||
      !std::isfinite(v0) || !std::isfinite(v1) ||
      std::abs(u1 - u0) > 1e50 || std::abs(v1 - v0) > 1e50)
    return Fail(error, "cannot verify old-domain bounded support preservation");
  constexpr double kRadiansToDegrees = 180.0 / 3.14159265358979323846;
  for (int ui = 0; ui <= 4; ++ui) {
    for (int vi = 0; vi <= 4; ++vi) {
      const double u = u0 + (u1 - u0) * ui / 4.0;
      const double v = v0 + (v1 - v0) * vi / 4.0;
      gp_Pnt beforePoint, afterPoint;
      gp_Vec beforeDu, beforeDv, afterDu, afterDv;
      original->D1(u, v, beforePoint, beforeDu, beforeDv);
      extended->D1(u, v, afterPoint, afterDu, afterDv);
      if (beforePoint.Distance(afterPoint) > toleranceMm)
        return Fail(error, "bounded support extension moved the original domain");
      for (const auto pair : {std::pair<gp_Vec, gp_Vec>{beforeDu, afterDu},
                              std::pair<gp_Vec, gp_Vec>{beforeDv, afterDv}}) {
        if (pair.first.SquareMagnitude() <= 1e-20 ||
            pair.second.SquareMagnitude() <= 1e-20) continue;
        if (pair.first.Angle(pair.second) * kRadiansToDegrees > 1e-4)
          return Fail(error, "bounded support extension changed original-domain tangents");
      }
    }
  }
  return true;
}

inline bool CalibrateExtendedPcurve(const TopoDS_Face& face,
                                    const TopoDS_Edge& boundary,
                                    const gp_Vec2d& direction,
                                    double distanceMm, double toleranceMm,
                                    Handle(Geom_Surface)* support,
                                    gp_Vec2d* shift, std::string* error) {
  if (!support || !shift) return Fail(error, "SurfaceExtend support output is missing");
  TopLoc_Location location;
  const auto original = BRep_Tool::Surface(face, location);
  if (original.IsNull()) return Fail(error, "selected face has no exact support");
  std::string firstError;
  if (CalibratePcurveOnSurface(face, boundary, direction, distanceMm,
                               original, shift, &firstError)) {
    *support = original;
    return true;
  }
  Standard_Real first = 0, last = 0;
  const auto pcurve = BRep_Tool::CurveOnSurface(boundary, face, first, last);
  if (pcurve.IsNull()) return Fail(error, "selected boundary has no exact pcurve");
  double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
  original->Bounds(u0, u1, v0, v1);
  const bool finiteU = std::isfinite(u0) && std::isfinite(u1) && std::abs(u1 - u0) < 1e50;
  const bool finiteV = std::isfinite(v0) && std::isfinite(v1) && std::abs(v1 - v0) < 1e50;
  bool outsideU = false, outsideV = false;
  for (int i = 0; i <= 32; ++i) {
    gp_Pnt2d uv = pcurve->Value(first + (last - first) * i / 32.0);
    uv.Translate(gp_Vec2d(direction.X() * 1e-3, direction.Y() * 1e-3));
    if (finiteU && (uv.X() < u0 - 1e-8 || uv.X() > u1 + 1e-8)) outsideU = true;
    if (finiteV && (uv.Y() < v0 - 1e-8 || uv.Y() > v1 + 1e-8)) outsideV = true;
  }
  if (!outsideU && !outsideV)
    return Fail(error, firstError.empty() ? "requested pcurve extension is unsupported" : firstError);
  if ((outsideU && original->IsUPeriodic()) ||
      (outsideV && original->IsVPeriodic()))
    return Fail(error, "SurfaceExtend rejects an offset that crosses a periodic support seam");
  const bool extendU = outsideU && !outsideV;
  const double primary = extendU ? direction.X() : direction.Y();
  const double secondary = extendU ? direction.Y() : direction.X();
  if (std::abs(primary) <= 1e-8 || std::abs(secondary) > 1e-8)
    return Fail(error, "bounded support continuation is limited to one natural UV direction");
  const bool finiteAxis = extendU
      ? std::isfinite(u0) && std::isfinite(u1) && std::abs(u1 - u0) < 1e50
      : std::isfinite(v0) && std::isfinite(v1) && std::abs(v1 - v0) < 1e50;
  if (!finiteAxis)
    return Fail(error, firstError.empty() ? "bounded support continuation is unavailable" : firstError);

  double extensionLength = std::max(1e-3, distanceMm * 1.25);
  std::string extensionError;
  for (int attempt = 0; attempt < 6; ++attempt) {
    try {
      Handle(Geom_Surface) copied = Handle(Geom_Surface)::DownCast(original->Copy());
      if (copied.IsNull()) return Fail(error, "bounded support copy failed");
      Handle(Geom_BoundedSurface) bounded = Handle(Geom_BoundedSurface)::DownCast(copied);
      if (bounded.IsNull()) {
        double bu0 = 0, bu1 = 0, bv0 = 0, bv1 = 0;
        original->Bounds(bu0, bu1, bv0, bv1);
        bounded = new Geom_RectangularTrimmedSurface(copied, bu0, bu1, bv0, bv1);
      }
      GeomLib::ExtendSurfByLength(bounded, extensionLength, 1, extendU, primary > 0);
      Handle(Geom_Surface) candidate = bounded;
      std::string calibrationError;
      if (CalibratePcurveOnSurface(face, boundary, direction, distanceMm,
                                   candidate, shift, &calibrationError)) {
        if (!SupportPreserved(face, original, candidate, toleranceMm, error)) return false;
        *support = candidate;
        return true;
      }
      extensionError = calibrationError;
    } catch (const Standard_Failure& failure) {
      extensionError = failure.GetMessageString() ? failure.GetMessageString()
                                                   : "bounded support extension failed";
    }
    extensionLength *= 2.0;
  }
  return Fail(error, extensionError.empty()
      ? "bounded support extension did not reach requested chord" : extensionError);
}

inline TopoDS_Edge MakePcurveConnector(const Handle(Geom_Surface)& surface,
                                       const TopoDS_Vertex& firstVertex,
                                       const TopoDS_Vertex& lastVertex,
                                       const gp_Pnt2d& firstUv,
                                       const gp_Pnt2d& lastUv,
                                       double toleranceMm) {
  gp_Vec2d delta(firstUv, lastUv);
  if (delta.Magnitude() <= 1e-12) throw std::runtime_error("zero-length pcurve connector");
  Handle(Geom2d_Curve) line = new Geom2d_Line(firstUv, gp_Dir2d(delta));
  BRepBuilderAPI_MakeEdge maker(line, surface, firstVertex, lastVertex,
                                0.0, delta.Magnitude());
  if (!maker.IsDone()) throw std::runtime_error("pcurve connector construction failed");
  TopoDS_Edge edge = maker.Edge();
  BRepLib::BuildCurve3d(edge, toleranceMm);
  return edge;
}

inline TopoDS_Face MakePcurveAnnex(const TopoDS_Face& face,
                                   const TopoDS_Edge& boundary,
                                   const gp_Vec2d& shift,
                                   const Handle(Geom_Surface)& surface,
                                   double toleranceMm) {
  Standard_Real first = 0, last = 0;
  const auto sourcePcurve = BRep_Tool::CurveOnSurface(boundary, face, first, last);
  if (sourcePcurve.IsNull()) throw std::runtime_error("selected boundary pcurve is missing");
  const auto copied = Handle(Geom2d_Curve)::DownCast(sourcePcurve->Copy());
  if (copied.IsNull()) throw std::runtime_error("selected pcurve copy failed");
  copied->Translate(shift);
  TopLoc_Location location;
  const auto sourceSurface = BRep_Tool::Surface(face, location);
  if (surface.IsNull() || sourceSurface.IsNull())
    throw std::runtime_error("selected face has no exact support");
  BRepBuilderAPI_MakeEdge innerMaker(sourcePcurve, surface, first, last);
  if (!innerMaker.IsDone()) throw std::runtime_error("annex attachment pcurve edge construction failed");
  TopoDS_Edge inner = innerMaker.Edge();
  BRepLib::BuildCurve3d(inner, toleranceMm);
  if (boundary.Orientation() == TopAbs_REVERSED) inner.Reverse();
  BRepBuilderAPI_MakeEdge outerMaker(copied, surface, first, last);
  if (!outerMaker.IsDone()) throw std::runtime_error("translated pcurve edge construction failed");
  TopoDS_Edge outer = outerMaker.Edge();
  BRepLib::BuildCurve3d(outer, toleranceMm);
  if (boundary.Orientation() == TopAbs_REVERSED) outer.Reverse();

  TopoDS_Vertex sourceStart, sourceEnd, outerStart, outerEnd;
  TopExp::Vertices(inner, sourceStart, sourceEnd, true);
  TopExp::Vertices(outer, outerStart, outerEnd, true);
  if (sourceStart.IsNull() || sourceEnd.IsNull() || outerStart.IsNull() || outerEnd.IsNull())
    throw std::runtime_error("translated pcurve endpoint vertex is missing");
  const bool forward = boundary.Orientation() != TopAbs_REVERSED;
  const gp_Pnt2d sourceUvStart = sourcePcurve->Value(forward ? first : last);
  const gp_Pnt2d sourceUvEnd = sourcePcurve->Value(forward ? last : first);
  gp_Pnt2d outerUvStart = sourceUvStart;
  gp_Pnt2d outerUvEnd = sourceUvEnd;
  outerUvStart.Translate(shift);
  outerUvEnd.Translate(shift);

  TopoDS_Edge shared = inner;
  shared.Reverse();
  const auto startConnector = MakePcurveConnector(surface, sourceStart, outerStart,
                                                   sourceUvStart, outerUvStart,
                                                   toleranceMm);
  const auto endConnector = MakePcurveConnector(surface, outerEnd, sourceEnd,
                                                 outerUvEnd, sourceUvEnd,
                                                 toleranceMm);
  BRepBuilderAPI_MakeWire wire;
  wire.Add(shared);
  wire.Add(startConnector);
  wire.Add(outer);
  wire.Add(endConnector);
  if (!wire.IsDone()) throw std::runtime_error("translated pcurve annex wire is invalid");
  BRepBuilderAPI_MakeFace maker(surface, wire.Wire(), Standard_True);
  if (!maker.IsDone()) throw std::runtime_error("translated pcurve annex face is invalid");
  TopoDS_Face annex = maker.Face();
  annex.Location(location);
  return annex;
}

inline bool CircleWithinSupport(const Handle(Geom_Surface)& surface,
                                const gp_Pnt2d& center, double radius) {
  double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
  surface->Bounds(u0, u1, v0, v1);
  const bool finiteU = !surface->IsUPeriodic() && std::isfinite(u0) &&
                       std::isfinite(u1) && std::abs(u1 - u0) < 1e50;
  const bool finiteV = !surface->IsVPeriodic() && std::isfinite(v0) &&
                       std::isfinite(v1) && std::abs(v1 - v0) < 1e50;
  for (int i = 0; i < 128; ++i) {
    const double angle = 2.0 * 3.14159265358979323846 * i / 128.0;
    const double u = center.X() + radius * std::cos(angle);
    const double v = center.Y() + radius * std::sin(angle);
    if (finiteU && (u < u0 - 1e-8 || u > u1 + 1e-8)) return false;
    if (finiteV && (v < v0 - 1e-8 || v > v1 + 1e-8)) return false;
  }
  return true;
}

inline TopoDS_Face MakeClosedCircleAnnex(const TopoDS_Face& face,
                                         const TopoDS_Edge& boundary,
                                         const Handle(Geom2d_Circle)& circle,
                                         double newRadius,
                                         const Handle(Geom_Surface)& surface,
                                         double toleranceMm) {
  if (circle.IsNull() || surface.IsNull() || newRadius <= Precision::PConfusion())
    throw std::runtime_error("closed pcurve annex has invalid circle or support");
  Standard_Real first = 0, last = 0;
  const auto sourcePcurve = BRep_Tool::CurveOnSurface(boundary, face, first, last);
  if (sourcePcurve.IsNull()) throw std::runtime_error("closed boundary pcurve is missing");
  TopLoc_Location location;
  const auto sourceSurface = BRep_Tool::Surface(face, location);
  if (sourceSurface.IsNull()) throw std::runtime_error("selected face has no exact support");

  gp_Circ2d outerGeometry = circle->Circ2d();
  outerGeometry.SetRadius(newRadius);
  Handle(Geom2d_Curve) outerPcurve = new Geom2d_Circle(outerGeometry);
  BRepBuilderAPI_MakeEdge innerMaker(sourcePcurve, surface, first, last);
  BRepBuilderAPI_MakeEdge outerMaker(outerPcurve, surface, first, last);
  if (!innerMaker.IsDone() || !outerMaker.IsDone())
    throw std::runtime_error("closed pcurve annex edges could not be built on exact support");
  TopoDS_Edge inner = innerMaker.Edge();
  TopoDS_Edge outer = outerMaker.Edge();
  BRepLib::BuildCurve3d(inner, toleranceMm);
  BRepLib::BuildCurve3d(outer, toleranceMm);
  if (boundary.Orientation() == TopAbs_REVERSED) {
    inner.Reverse();
    outer.Reverse();
  }
  TopoDS_Edge innerForAnnex = inner;
  innerForAnnex.Reverse();
  BRepBuilderAPI_MakeWire outerWire;
  outerWire.Add(outer);
  BRepBuilderAPI_MakeWire innerWire;
  innerWire.Add(innerForAnnex);
  if (!outerWire.IsDone() || !innerWire.IsDone())
    throw std::runtime_error("closed pcurve annex loops are invalid");
  BRepBuilderAPI_MakeFace maker(surface, outerWire.Wire(), Standard_True);
  maker.Add(innerWire.Wire());
  if (!maker.IsDone()) throw std::runtime_error("closed pcurve annex face construction failed");
  TopoDS_Face annex = maker.Face();
  annex.Location(location);
  annex.Orientation(face.Orientation());
  return annex;
}

inline bool BuildClosedCircleAnnex(const TopoDS_Face& face,
                                   const TopoDS_Edge& boundary,
                                   double distanceMm, double toleranceMm,
                                   TopoDS_Face* annex, std::string* error) {
  if (!annex) return Fail(error, "closed annex output is missing");
  Standard_Real first = 0, last = 0;
  const auto pcurve = BRep_Tool::CurveOnSurface(boundary, face, first, last);
  const auto circle = Handle(Geom2d_Circle)::DownCast(pcurve);
  if (circle.IsNull())
    return Fail(error, "SurfaceExtend supports a closed circular outer pcurve on this path");
  TopLoc_Location location;
  const auto surface = BRep_Tool::Surface(face, location);
  if (surface.IsNull()) return Fail(error, "selected face has no exact support");
  const auto center = circle->Circ2d().Location();
  const double radius = circle->Radius();
  if (!std::isfinite(radius) || radius <= Precision::PConfusion())
    return Fail(error, "closed circular pcurve is degenerate");
  gp_Pnt2d midpoint;
  gp_Vec2d tangent;
  pcurve->D1((first + last) * 0.5, midpoint, tangent);
  gp_Vec2d radial(center, midpoint);
  if (radial.SquareMagnitude() <= 1e-24)
    return Fail(error, "closed circular pcurve midpoint is degenerate");
  radial.Normalize();
  bool outwardPositive = false;
  bool directionFound = false;
  for (int attempt = 0; attempt < 8; ++attempt) {
    const double epsilon = std::max(1e-8, 1e-5 * std::pow(2.0, attempt));
    const gp_Pnt2d plus(midpoint.X() + radial.X() * epsilon,
                        midpoint.Y() + radial.Y() * epsilon);
    const gp_Pnt2d minus(midpoint.X() - radial.X() * epsilon,
                         midpoint.Y() - radial.Y() * epsilon);
    const auto plusState = BRepClass_FaceClassifier(face, plus, Precision::PConfusion()).State();
    const auto minusState = BRepClass_FaceClassifier(face, minus, Precision::PConfusion()).State();
    if (plusState == TopAbs_OUT && minusState == TopAbs_IN) {
      outwardPositive = true;
      directionFound = true;
      break;
    }
    if (minusState == TopAbs_OUT && plusState == TopAbs_IN) {
      outwardPositive = false;
      directionFound = true;
      break;
    }
  }
  if (!directionFound) return Fail(error, "cannot determine the material side of the closed pcurve");
  const auto chord = [&](double delta) {
    const double newRadius = radius + (outwardPositive ? delta : -delta);
    const double angle = std::atan2(midpoint.Y() - center.Y(), midpoint.X() - center.X());
    const gp_Pnt2d moved(center.X() + newRadius * std::cos(angle),
                         center.Y() + newRadius * std::sin(angle));
    return SurfacePoint(surface, location, midpoint).Distance(
        SurfacePoint(surface, location, moved));
  };
  double low = 0, high = 1e-3;
  bool bracketed = false;
  for (int i = 0; i < 32; ++i) {
    const double candidateRadius = radius + (outwardPositive ? high : -high);
    if (candidateRadius <= Precision::PConfusion() ||
        !CircleWithinSupport(surface, center, candidateRadius)) break;
    const double measured = chord(high);
    if (!std::isfinite(measured)) return Fail(error, "closed pcurve chord is non-finite");
    if (measured >= distanceMm) { bracketed = true; break; }
    low = high;
    high *= 2.0;
  }
  if (!bracketed)
    return Fail(error, "requested closed pcurve chord exceeds the existing exact support");
  for (int i = 0; i < 40; ++i) {
    const double middle = (low + high) * 0.5;
    const double candidateRadius = radius + (outwardPositive ? middle : -middle);
    if (!CircleWithinSupport(surface, center, candidateRadius)) { high = middle; continue; }
    const double measured = chord(middle);
    if (std::abs(measured - distanceMm) <= 1e-7) { low = high = middle; break; }
    if (measured < distanceMm) low = middle;
    else high = middle;
  }
  const double delta = (low + high) * 0.5;
  if (std::abs(chord(delta) - distanceMm) > std::max(1e-5, toleranceMm * 10.0))
    return Fail(error, "closed pcurve midpoint chord calibration did not converge");
  try {
    *annex = MakeClosedCircleAnnex(face, boundary, circle,
                                   radius + (outwardPositive ? delta : -delta),
                                   surface, toleranceMm);
    return true;
  } catch (const Standard_Failure& failure) {
    return Fail(error, std::string("closed pcurve annex kernel failure: ") +
        (failure.GetMessageString() ? failure.GetMessageString() : "OCCT error"));
  } catch (const std::exception& failure) {
    return Fail(error, std::string("closed pcurve annex failure: ") + failure.what());
  }
}

inline bool BuildSurfaceExtendShape(const ShapeRecord& target,
                                    const SurfaceTrimExtendJson& edgeReference,
                                    const std::string& consumerId,
                                    bool allowUnboundSelection,
                                    double distanceMm, double toleranceMm,
                                    TopoDS_Shape* output, std::string* error) {
  if (!output || !std::isfinite(distanceMm) || distanceMm < 1e-6 ||
      distanceMm > 100000.0 || !surface_sew_offset_detail::ValidTolerance(toleranceMm))
    return Fail(error, "SurfaceExtend distance/tolerance is outside supported ranges");
  if (!IsSurfaceGeometry(target)) return Fail(error, "SurfaceExtend target must be a surface body");
  if (!ValidateSurfaceBody(target, "SurfaceExtend target", error)) return false;
  TopoDS_Shape selectedShape;
  if (!ResolveSelectedTopology(target, consumerId, edgeReference, true,
                               allowUnboundSelection, &selectedShape, error)) return false;
  const TopoDS_Edge selected = TopoDS::Edge(selectedShape);
  if (BRep_Tool::Degenerated(selected))
    return Fail(error, "SurfaceExtend rejects degenerate edges");
  TopTools_IndexedDataMapOfShapeListOfShape edgeFaces;
  TopExp::MapShapesAndAncestors(target.shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
  if (!edgeFaces.Contains(selected)) return Fail(error, "selected edge is not part of target");
  const auto& ancestors = edgeFaces.FindFromKey(selected);
  std::vector<TopoDS_Face> owners;
  for (TopTools_ListOfShape::Iterator it(ancestors); it.More(); it.Next()) {
    const auto face = TopoDS::Face(it.Value());
    if (std::none_of(owners.begin(), owners.end(), [&](const TopoDS_Face& item) {
          return item.IsSame(face);
        })) owners.push_back(face);
  }
  if (owners.size() != 1)
    return Fail(error, "SurfaceExtend rejects shared or nonmanifold edges");
  if (BRep_Tool::IsClosed(selected, owners.front()))
    return Fail(error, "SurfaceExtend rejects periodic seam edges");
  GProp_GProps edgeProperties;
  BRepGProp::LinearProperties(selected, edgeProperties);
  if (!std::isfinite(edgeProperties.Mass()) || edgeProperties.Mass() <= Precision::Confusion())
    return Fail(error, "SurfaceExtend rejects degenerate edge length");
  TopoDS_Edge outerBoundary;
  if (!FindOuterBoundary(owners.front(), selected, &outerBoundary, error)) return false;
  TopLoc_Location sourceLocation;
  const auto surface = BRep_Tool::Surface(owners.front(), sourceLocation);
  if (surface.IsNull()) return Fail(error, "selected face has no exact support");
  TopoDS_Vertex loopStart, loopEnd;
  TopExp::Vertices(outerBoundary, loopStart, loopEnd, true);
  const bool closedLoop = !loopStart.IsNull() && loopStart.IsSame(loopEnd);
  Standard_Real pcurveFirst = 0, pcurveLast = 0;
  const auto pcurve = BRep_Tool::CurveOnSurface(outerBoundary, owners.front(),
                                                 pcurveFirst, pcurveLast);
  if (pcurve.IsNull()) return Fail(error, "selected boundary has no exact pcurve");
  const bool closedCircularLoop = closedLoop &&
      !Handle(Geom2d_Circle)::DownCast(pcurve).IsNull();
  bool wrapsSupportPeriod = false;
  if (closedLoop && !closedCircularLoop) {
    const gp_Pnt2d firstUv = pcurve->Value(pcurveFirst);
    const gp_Pnt2d lastUv = pcurve->Value(pcurveLast);
    const auto spansOnePeriod = [](double delta, double period) {
      return std::isfinite(period) && period > Precision::PConfusion() &&
          std::abs(std::abs(delta) - period) <= std::max(1e-7, period * 1e-7);
    };
    wrapsSupportPeriod =
        (surface->IsUPeriodic() &&
         spansOnePeriod(lastUv.X() - firstUv.X(), surface->UPeriod())) ||
        (surface->IsVPeriodic() &&
         spansOnePeriod(lastUv.Y() - firstUv.Y(), surface->VPeriod()));
    if (!wrapsSupportPeriod)
      return Fail(error, "SurfaceExtend supports closed boundaries only for circular pcurves or one-period loops");
  }
  gp_Vec2d shift;
  Handle(Geom_Surface) annexSupport;
  if (!closedCircularLoop) {
    gp_Vec2d direction;
    if (!OutwardPcurveDirection(owners.front(), outerBoundary, &direction, error) ||
        !CalibrateExtendedPcurve(owners.front(), outerBoundary, direction,
                                 distanceMm, toleranceMm, &annexSupport,
                                 &shift, error)) return false;
  }

  try {
    BRepBuilderAPI_Copy targetCopy(target.shape, Standard_True, Standard_False);
    if (!targetCopy.IsDone() || targetCopy.Shape().IsNull())
      return Fail(error, "SurfaceExtend could not copy target B-Rep");
    const TopoDS_Shape mappedEdge = targetCopy.ModifiedShape(selected);
    const TopoDS_Shape mappedFace = targetCopy.ModifiedShape(owners.front());
    if (mappedEdge.IsNull() || mappedEdge.ShapeType() != TopAbs_EDGE ||
        mappedFace.IsNull() || mappedFace.ShapeType() != TopAbs_FACE)
      return Fail(error, "SurfaceExtend could not map selected topology through deep copy");
    TopoDS_Edge copiedBoundary;
    if (!FindOuterBoundary(TopoDS::Face(mappedFace), TopoDS::Edge(mappedEdge),
                           &copiedBoundary, error)) return false;
    TopoDS_Face annex;
    if (closedCircularLoop) {
      if (!BuildClosedCircleAnnex(TopoDS::Face(mappedFace), copiedBoundary,
                                  distanceMm, toleranceMm, &annex, error)) return false;
    } else {
      annex = MakePcurveAnnex(TopoDS::Face(mappedFace), copiedBoundary,
                              shift, annexSupport, toleranceMm);
    }
    if (!BRepCheck_Analyzer(annex, true).IsValid())
      return Fail(error, "SurfaceExtend annex B-Rep is invalid");
    const double sourceArea = SurfaceArea(target.shape);
    const double annexArea = SurfaceArea(annex);
    if (!std::isfinite(sourceArea) || sourceArea <= Precision::Confusion() ||
        !std::isfinite(annexArea) || annexArea <= Precision::Confusion())
      return Fail(error, "SurfaceExtend source or annex area is invalid");

    BRepBuilderAPI_Sewing sewing(toleranceMm);
    sewing.Add(targetCopy.Shape());
    sewing.Add(annex);
    sewing.Perform();
    const TopoDS_Shape sewn = sewing.SewedShape();
    if (sewn.IsNull() || sewing.NbContigousEdges() < 1)
      return Fail(error, "SurfaceExtend could not sew annex to source boundary");
    if (TopExp_Explorer(sewn, TopAbs_SOLID).More())
      return Fail(error, "SurfaceExtend unexpectedly produced solid topology");
    if (!BRepCheck_Analyzer(sewn, true).IsValid())
      return Fail(error, "SurfaceExtend sewn B-Rep is invalid");
    if (!surface_sew_offset_detail::NoSelfInterference(sewn, "SurfaceExtend", error))
      return false;
    std::vector<TopoDS_Face> resultFaces;
    for (TopExp_Explorer it(sewn, TopAbs_FACE); it.More(); it.Next())
      resultFaces.push_back(TopoDS::Face(it.Current()));
    int components = 0;
    if (!ConnectedFaces(resultFaces, &components, error) || components != 1)
      return Fail(error, "SurfaceExtend result is not one connected surface body");

    const double sewnArea = SurfaceArea(sewn);
    if (!std::isfinite(sewnArea) ||
        std::abs(sewnArea - sourceArea - annexArea) > std::max(1e-5, toleranceMm * 100.0))
      return Fail(error, "SurfaceExtend result area does not equal pristine source plus annex");
    const auto commonShape = [&](const TopoDS_Shape& first, const TopoDS_Shape& second,
                                 TopoDS_Shape* commonShapeOut) {
      BRepBuilderAPI_Copy firstCopy(first, Standard_True, Standard_False);
      BRepBuilderAPI_Copy secondCopy(second, Standard_True, Standard_False);
      if (!firstCopy.IsDone() || !secondCopy.IsDone()) return false;
      TopTools_ListOfShape arguments, tools;
      arguments.Append(firstCopy.Shape());
      tools.Append(secondCopy.Shape());
      BRepAlgoAPI_Common common;
      common.SetArguments(arguments);
      common.SetTools(tools);
      common.SetNonDestructive(Standard_True);
      common.Build();
      if (!common.IsDone()) return false;
      *commonShapeOut = common.Shape();
      return true;
    };
    TopoDS_Shape retainedShape;
    if (!commonShape(target.shape, sewn, &retainedShape))
      return Fail(error, "SurfaceExtend could not validate retained source");
    const double retainedArea = retainedShape.IsNull() ? 0 : SurfaceArea(retainedShape);
    if (!std::isfinite(sourceArea) || !std::isfinite(retainedArea) ||
        std::abs(sourceArea - retainedArea) > std::max(1e-5, toleranceMm * 100.0))
      return Fail(error, "SurfaceExtend did not preserve the original surface region");
    TopoDS_Shape overlapShape;
    if (!commonShape(target.shape, annex, &overlapShape))
      return Fail(error, "SurfaceExtend could not validate annex overlap");
    const double overlapArea = overlapShape.IsNull() ? 0 : SurfaceArea(overlapShape);
    if (!std::isfinite(overlapArea) || overlapArea > std::max(1e-7, toleranceMm * 10.0))
      return Fail(error, "SurfaceExtend annex overlaps source surface");
    if (!OutputSurface(sewn, "SurfaceExtend", error)) return false;
    *output = sewn;
    return true;
  } catch (const Standard_Failure& failure) {
    return Fail(error, std::string("SurfaceExtend kernel failure: ") +
                        (failure.GetMessageString() ? failure.GetMessageString() : "OCCT error"));
  } catch (const std::exception& failure) {
    return Fail(error, std::string("SurfaceExtend failure: ") + failure.what());
  }
}

inline bool BuildSurfaceExtendFromRecords(
    const std::string& targetId, const SurfaceTrimExtendJson& refExtra,
    const std::vector<double>& params, const std::string& consumerId,
    bool allowUnboundSelection, TopoDS_Shape* output, std::string* error,
    const std::map<std::string, ShapeRecord>* records = nullptr) {
  if (!refExtra.is_object() || refExtra.value("version", 0) != 1 ||
      !refExtra.contains("boundaryEdge") || !refExtra["boundaryEdge"].is_object())
    return Fail(error, "SurfaceExtend reference metadata is invalid");
  const auto& reference = refExtra["boundaryEdge"];
  if (reference.value("type", std::string{}) != "edge" ||
      reference.value("featureId", std::string{}) != targetId ||
      reference.value("persistentEdgeId", std::string{}).empty())
    return Fail(error, "SurfaceExtend boundaryEdge must reference target edge");
  if (params.size() != 2) return Fail(error, "SurfaceExtend expects distanceMm and toleranceMm");
  ShapeRecord target;
  if (!FindRecord(targetId, records, &target, error)) return false;
  return BuildSurfaceExtendShape(target, reference, consumerId, allowUnboundSelection,
                                 params[0], params[1], output, error);
}

}  // namespace surface_trim_extend_detail

inline bool CreateSurfaceTrimFeature(const std::string& featureId,
                                     const std::string& targetId,
                                     const std::string& toolId,
                                     const SurfaceTrimExtendJson& keepFace,
                                     double keepU, double keepV,
                                     double toleranceMm, std::string* error) {
  using namespace surface_trim_extend_detail;
  if (!CheckNewId(featureId, error)) return false;
  if (targetId == toolId || !ShapeStore::ValidFeatureId(targetId) ||
      !ShapeStore::ValidFeatureId(toolId))
    return Fail(error, "SurfaceTrim target and tool IDs must be valid and different");
  if (!std::isfinite(keepU) || !std::isfinite(keepV) ||
      !surface_sew_offset_detail::ValidTolerance(toleranceMm))
    return Fail(error, "SurfaceTrim parameters are outside supported ranges");
  SurfaceTrimExtendJson refExtra = {{"version", 1}, {"keepFace", keepFace}};
  ModelSnapshot before;
  if (!OcafLive::instance().BeginCommand(error)) return false;
  const auto rollback = [&]() {
    OcafLive::instance().AbortCommand();
    OcafLive::instance().ForgetFeatures({featureId});
    before.restore();
  };
  std::string storedRef = refExtra.dump();
  if (!BindSurfaceSources(featureId, targetId, "keepFace", &storedRef, false, error)) {
    rollback();
    return false;
  }
  try { refExtra = SurfaceTrimExtendJson::parse(storedRef); }
  catch (...) {
    if (error) *error = "bound SurfaceTrim references are invalid";
    rollback();
    return false;
  }
  TopoDS_Shape shape;
  if (!BuildSurfaceTrimFromRecords(targetId, toolId, refExtra,
          {keepU, keepV, toleranceMm}, featureId, false, &shape, error)) {
    rollback();
    return false;
  }
  if (!CommitShape(featureId, "SurfaceTrim", {keepU, keepV, toleranceMm},
                   {targetId, toolId}, refExtra.dump(), shape, nullptr, true, error)) {
    rollback();
    return false;
  }
  bool hadDelta = false;
  if (!OcafLive::instance().CommitCommand(&hadDelta, error)) {
    rollback();
    return false;
  }
  return true;
}

inline bool RebuildSurfaceTrimFromStore(const std::string& featureId,
                                        std::string* error) {
  using namespace surface_trim_extend_detail;
  ShapeRecord previous;
  if (!ShapeStore::instance().get(featureId, &previous) ||
      previous.type != "SurfaceTrim" || previous.dependsOn.size() != 2 ||
      previous.paramsMm.size() != 3)
    return Fail(error, "invalid stored SurfaceTrim feature");
  SurfaceTrimExtendJson refExtra;
  try { refExtra = SurfaceTrimExtendJson::parse(previous.refExtra); }
  catch (...) { return Fail(error, "stored SurfaceTrim references are invalid"); }
  if (!refExtra.is_object() || !refExtra.contains("keepFace") ||
      !RequireStoredSelectionEntry(refExtra.at("keepFace"), false, error)) return false;
  std::string storedRef = refExtra.dump();
  if (!BindSurfaceSources(featureId, previous.dependsOn[0], "keepFace", &storedRef, true, error)) return false;
  try { refExtra = SurfaceTrimExtendJson::parse(storedRef); }
  catch (...) { return Fail(error, "refreshed SurfaceTrim references are invalid"); }
  TopoDS_Shape shape;
  if (!BuildSurfaceTrimFromRecords(previous.dependsOn[0], previous.dependsOn[1],
          refExtra, previous.paramsMm, featureId, false, &shape, error)) return false;
  return CommitShape(featureId, previous.type, previous.paramsMm, previous.dependsOn,
                     refExtra.dump(), shape, &previous, false, error);
}

inline bool CreateSurfaceExtendFeature(const std::string& featureId,
                                       const std::string& targetId,
                                       const SurfaceTrimExtendJson& boundaryEdge,
                                       double distanceMm, double toleranceMm,
                                       std::string* error) {
  using namespace surface_trim_extend_detail;
  if (!CheckNewId(featureId, error)) return false;
  if (!ShapeStore::ValidFeatureId(targetId) || !std::isfinite(distanceMm) ||
      distanceMm < 1e-6 || distanceMm > 100000.0 ||
      !surface_sew_offset_detail::ValidTolerance(toleranceMm))
    return Fail(error, "SurfaceExtend parameters are outside supported ranges");
  SurfaceTrimExtendJson refExtra = {{"version", 1}, {"boundaryEdge", boundaryEdge}};
  ModelSnapshot before;
  if (!OcafLive::instance().BeginCommand(error)) return false;
  const auto rollback = [&]() {
    OcafLive::instance().AbortCommand();
    OcafLive::instance().ForgetFeatures({featureId});
    before.restore();
  };
  std::string storedRef = refExtra.dump();
  if (!BindSurfaceSources(featureId, targetId, "boundaryEdge", &storedRef, false, error)) {
    rollback();
    return false;
  }
  try { refExtra = SurfaceTrimExtendJson::parse(storedRef); }
  catch (...) {
    if (error) *error = "bound SurfaceExtend references are invalid";
    rollback();
    return false;
  }
  TopoDS_Shape shape;
  if (!BuildSurfaceExtendFromRecords(targetId, refExtra, {distanceMm, toleranceMm},
          featureId, false, &shape, error)) {
    rollback();
    return false;
  }
  if (!CommitShape(featureId, "SurfaceExtend", {distanceMm, toleranceMm},
                   {targetId}, refExtra.dump(), shape, nullptr, true, error)) {
    rollback();
    return false;
  }
  bool hadDelta = false;
  if (!OcafLive::instance().CommitCommand(&hadDelta, error)) {
    rollback();
    return false;
  }
  return true;
}

inline bool RebuildSurfaceExtendFromStore(const std::string& featureId,
                                          std::string* error) {
  using namespace surface_trim_extend_detail;
  ShapeRecord previous;
  if (!ShapeStore::instance().get(featureId, &previous) ||
      previous.type != "SurfaceExtend" || previous.dependsOn.size() != 1 ||
      previous.paramsMm.size() != 2)
    return Fail(error, "invalid stored SurfaceExtend feature");
  SurfaceTrimExtendJson refExtra;
  try { refExtra = SurfaceTrimExtendJson::parse(previous.refExtra); }
  catch (...) { return Fail(error, "stored SurfaceExtend references are invalid"); }
  if (!refExtra.is_object() || !refExtra.contains("boundaryEdge") ||
      !RequireStoredSelectionEntry(refExtra.at("boundaryEdge"), true, error)) return false;
  std::string storedRef = refExtra.dump();
  if (!BindSurfaceSources(featureId, previous.dependsOn[0], "boundaryEdge", &storedRef, true, error)) return false;
  try { refExtra = SurfaceTrimExtendJson::parse(storedRef); }
  catch (...) { return Fail(error, "refreshed SurfaceExtend references are invalid"); }
  TopoDS_Shape shape;
  if (!BuildSurfaceExtendFromRecords(previous.dependsOn[0], refExtra,
          previous.paramsMm, featureId, false, &shape, error)) return false;
  return CommitShape(featureId, previous.type, previous.paramsMm, previous.dependsOn,
                     refExtra.dump(), shape, &previous, false, error);
}

#else

inline bool CreateSurfaceTrimFeature(const std::string&, const std::string&,
                                     const std::string&, const SurfaceTrimExtendJson&,
                                     double, double, double, std::string* error) {
  if (error) *error = "SurfaceTrim requires OCCT";
  return false;
}
inline bool RebuildSurfaceTrimFromStore(const std::string&, std::string* error) {
  if (error) *error = "SurfaceTrim requires OCCT";
  return false;
}
inline bool CreateSurfaceExtendFeature(const std::string&, const std::string&,
                                       const SurfaceTrimExtendJson&, double, double,
                                       std::string* error) {
  if (error) *error = "SurfaceExtend requires OCCT";
  return false;
}
inline bool RebuildSurfaceExtendFromStore(const std::string&, std::string* error) {
  if (error) *error = "SurfaceExtend requires OCCT";
  return false;
}

#endif
}  // namespace kreoda
