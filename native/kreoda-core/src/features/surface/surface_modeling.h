#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <map>
#include <set>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

#include "features/sketch/sketch_face.h"
#include "features/sketch/sketch_store.h"
#include "model/commit.h"
#include "model/geometry_availability.h"
#include "model/geometry_kind.h"
#include "model/shapes.h"

#if KREODA_WITH_OCCT
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <Precision.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <gp_Ax1.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#endif

namespace kreoda {

inline constexpr size_t kMaxSurfaceSketchEdges = 4096;
inline constexpr double kSurfaceParameterLimitMm = 100000.0;

namespace surface_detail {

inline bool Fail(std::string* error, const std::string& message) {
  if (error) *error = message;
  return false;
}

inline std::vector<std::string> EntityIds(const SketchFeature& sketch) {
  const auto& model = sketch.model;
  const auto isConstruction = [&](const std::string& id) {
    return std::find(model.constructionIds.begin(), model.constructionIds.end(),
                     id) != model.constructionIds.end();
  };
  std::vector<std::string> ids;
  ids.reserve(model.lines.size() + model.circles.size() + model.arcs.size() +
              model.ellipses.size() + model.splines.size());
  for (const auto& item : model.lines)
    if (!isConstruction(item.id)) ids.push_back(item.id);
  for (const auto& item : model.circles)
    if (!isConstruction(item.id)) ids.push_back(item.id);
  for (const auto& item : model.arcs)
    if (!isConstruction(item.id)) ids.push_back(item.id);
  for (const auto& item : model.ellipses)
    if (!isConstruction(item.id)) ids.push_back(item.id);
  for (const auto& item : model.splines)
    if (!isConstruction(item.id)) ids.push_back(item.id);
  return ids;
}

#if KREODA_WITH_OCCT
struct SurfaceEdge {
  std::string key;
  TopoDS_Edge edge;
  gp_Pnt first;
  gp_Pnt last;
  size_t firstNode = 0;
  size_t lastNode = 0;
};

struct SurfaceNode {
  gp_Pnt point;
  std::vector<size_t> edges;
};

struct SurfaceWire {
  TopoDS_Wire wire;
  bool closed = false;
  gp_Pnt sortPoint;
};

inline bool PointLess(const gp_Pnt& a, const gp_Pnt& b) {
  if (a.X() != b.X()) return a.X() < b.X();
  if (a.Y() != b.Y()) return a.Y() < b.Y();
  return a.Z() < b.Z();
}

using Cell = std::tuple<int64_t, int64_t, int64_t>;

inline bool CellFor(const gp_Pnt& point, double size, Cell* cell) {
  const long double x = std::floor(static_cast<long double>(point.X()) / size);
  const long double y = std::floor(static_cast<long double>(point.Y()) / size);
  const long double z = std::floor(static_cast<long double>(point.Z()) / size);
  const auto low = static_cast<long double>(std::numeric_limits<int64_t>::min()) + 2;
  const auto high = static_cast<long double>(std::numeric_limits<int64_t>::max()) - 2;
  if (x < low || x > high || y < low || y > high || z < low || z > high)
    return false;
  *cell = {static_cast<int64_t>(x), static_cast<int64_t>(y),
           static_cast<int64_t>(z)};
  return true;
}

inline bool FindNode(const gp_Pnt& point, double tolerance,
                     std::map<Cell, std::vector<size_t>>* buckets,
                     std::vector<SurfaceNode>* nodes, size_t* result) {
  Cell base;
  if (!CellFor(point, tolerance, &base)) return false;
  const auto [bx, by, bz] = base;
  size_t match = nodes->size();
  for (int dx = -1; dx <= 1; ++dx) {
    for (int dy = -1; dy <= 1; ++dy) {
      for (int dz = -1; dz <= 1; ++dz) {
        const auto found = buckets->find({bx + dx, by + dy, bz + dz});
        if (found == buckets->end()) continue;
        for (const size_t candidate : found->second) {
          if (point.Distance((*nodes)[candidate].point) <= tolerance &&
              (match == nodes->size() || candidate < match))
            match = candidate;
        }
      }
    }
  }
  if (match != nodes->size()) {
    *result = match;
    return true;
  }
  const size_t index = nodes->size();
  nodes->push_back({point, {}});
  (*buckets)[base].push_back(index);
  *result = index;
  return true;
}

inline bool AddEdge(const std::string& key, const TopoDS_Edge& edge,
                    std::vector<SurfaceEdge>* output, std::string* error) {
  if (edge.IsNull()) return Fail(error, "sketch contains a missing edge");
  TopoDS_Vertex first, last;
  TopExp::Vertices(edge, first, last, Standard_True);
  if (first.IsNull() || last.IsNull())
    return Fail(error, "sketch edge has no resolvable endpoints");
  GProp_GProps length;
  BRepGProp::LinearProperties(edge, length);
  if (!std::isfinite(length.Mass()) || length.Mass() <= Precision::Confusion())
    return Fail(error, "sketch contains a degenerate edge");
  output->push_back({key, edge, BRep_Tool::Pnt(first), BRep_Tool::Pnt(last)});
  return true;
}

inline bool BuildWire(const std::vector<size_t>& component,
                      const std::vector<SurfaceEdge>& edges,
                      const std::vector<SurfaceNode>& nodes,
                      const std::vector<std::vector<size_t>>& adjacency,
                      SurfaceWire* output, std::string* error) {
  std::set<size_t> componentSet(component.begin(), component.end());
  std::map<size_t, size_t> degree;
  for (const size_t index : component) {
    ++degree[edges[index].firstNode];
    ++degree[edges[index].lastNode];
  }
  std::vector<size_t> openEnds;
  for (const auto& [node, count] : degree) {
    if (count > 2) return Fail(error, "sketch boundary branches at a vertex");
    if (count == 1) openEnds.push_back(node);
  }
  const bool closed = openEnds.empty();
  if ((!closed && openEnds.size() != 2) ||
      (closed && std::any_of(degree.begin(), degree.end(),
                             [](const auto& entry) { return entry.second != 2; })))
    return Fail(error, "sketch boundary is not a connected wire");
  const auto nodeLess = [&](size_t a, size_t b) {
    if (PointLess(nodes[a].point, nodes[b].point)) return true;
    if (PointLess(nodes[b].point, nodes[a].point)) return false;
    return a < b;
  };
  size_t start = closed ? degree.begin()->first : openEnds.front();
  if (closed) {
    for (const auto& [node, unused] : degree)
      if (nodeLess(node, start)) start = node;
  } else if (nodeLess(openEnds[1], start)) {
    start = openEnds[1];
  }

  BRepBuilderAPI_MakeWire maker;
  std::set<size_t> used;
  size_t current = start;
  while (used.size() != component.size()) {
    std::vector<size_t> candidates;
    for (const size_t edge : adjacency[current])
      if (componentSet.count(edge) && !used.count(edge))
        candidates.push_back(edge);
    std::sort(candidates.begin(), candidates.end(), [&](size_t a, size_t b) {
      return edges[a].key < edges[b].key;
    });
    candidates.erase(std::unique(candidates.begin(), candidates.end()),
                     candidates.end());
    if (candidates.empty()) return Fail(error, "sketch boundary lost an edge");
    const size_t edgeIndex = candidates.front();
    TopoDS_Edge oriented = edges[edgeIndex].edge;
    const bool forward = edges[edgeIndex].firstNode == current;
    if (!forward && edges[edgeIndex].lastNode != current)
      return Fail(error, "sketch boundary ordering failed");
    if (!forward && edges[edgeIndex].firstNode != edges[edgeIndex].lastNode)
      oriented.Reverse();
    maker.Add(oriented);
    if (!maker.IsDone()) return Fail(error, "cannot assemble sketch boundary wire");
    used.insert(edgeIndex);
    current = forward ? edges[edgeIndex].lastNode : edges[edgeIndex].firstNode;
  }
  if (closed != (current == start))
    return Fail(error, "sketch boundary did not close consistently");
  TopoDS_Wire wire = maker.Wire();
  if (wire.IsNull() || wire.Closed() != closed)
    return Fail(error, "sketch boundary closure is inconsistent");
  size_t wireEdgeCount = 0;
  for (TopExp_Explorer it(wire, TopAbs_EDGE); it.More(); it.Next()) ++wireEdgeCount;
  if (wireEdgeCount != component.size())
    return Fail(error, "sketch boundary construction dropped an edge");
  output->wire = wire;
  output->closed = closed;
  output->sortPoint = nodes[start].point;
  return true;
}

inline bool CollectSketchWires(const SketchFeature& sketch,
                               std::vector<SurfaceWire>* output,
                               std::string* error) {
  if (!output) return Fail(error, "surface wire output is null");
  const auto ids = EntityIds(sketch);
  size_t inputCount = ids.size();
  for (const auto& group : sketch.projectionGroups) {
    if (group.status != "ok")
      return Fail(error, "broken projection group " + group.groupId +
                             ": " + group.error);
    inputCount += group.evaluatedEdges.size();
  }
  if (inputCount == 0) return Fail(error, "sketch has no boundary edges");
  if (inputCount > kMaxSurfaceSketchEdges)
    return Fail(error, "sketch boundary exceeds 4096 edges");

  std::vector<TopoDS_Edge> authored;
  if (!ids.empty() && !BuildSketchEntityEdges(sketch, ids, &authored, error))
    return false;
  if (authored.size() != ids.size())
    return Fail(error, "sketch boundary contains a missing or dropped entity");

  std::vector<SurfaceEdge> edges;
  edges.reserve(inputCount);
  for (size_t i = 0; i < ids.size(); ++i)
    if (!AddEdge("entity:" + ids[i], authored[i], &edges, error)) return false;
  for (size_t groupIndex = 0; groupIndex < sketch.projectionGroups.size(); ++groupIndex) {
    const auto& group = sketch.projectionGroups[groupIndex];
    for (size_t edgeIndex = 0; edgeIndex < group.evaluatedEdges.size(); ++edgeIndex) {
      const auto key = "projection:" + std::to_string(groupIndex) + ":" +
                       group.groupId + ":" + std::to_string(edgeIndex);
      if (!AddEdge(key, group.evaluatedEdges[edgeIndex], &edges, error)) return false;
    }
  }
  std::sort(edges.begin(), edges.end(), [](const SurfaceEdge& a, const SurfaceEdge& b) {
    return a.key < b.key;
  });

  const double tolerance = std::max(Precision::Confusion(), 1e-7);
  std::map<Cell, std::vector<size_t>> buckets;
  std::vector<SurfaceNode> nodes;
  for (size_t i = 0; i < edges.size(); ++i) {
    if (!FindNode(edges[i].first, tolerance, &buckets, &nodes,
                  &edges[i].firstNode) ||
        !FindNode(edges[i].last, tolerance, &buckets, &nodes,
                  &edges[i].lastNode))
      return Fail(error, "sketch boundary coordinate exceeds safe range");
  }
  std::vector<std::vector<size_t>> adjacency(nodes.size());
  for (size_t i = 0; i < edges.size(); ++i) {
    adjacency[edges[i].firstNode].push_back(i);
    adjacency[edges[i].lastNode].push_back(i);
  }
  std::vector<bool> visited(edges.size(), false);
  std::vector<SurfaceWire> wires;
  for (size_t seed = 0; seed < edges.size(); ++seed) {
    if (visited[seed]) continue;
    std::vector<size_t> component;
    std::vector<size_t> pending{seed};
    visited[seed] = true;
    while (!pending.empty()) {
      const size_t current = pending.back();
      pending.pop_back();
      component.push_back(current);
      for (const size_t node : {edges[current].firstNode, edges[current].lastNode})
        for (const size_t next : adjacency[node])
          if (!visited[next]) {
            visited[next] = true;
            pending.push_back(next);
          }
    }
    SurfaceWire wire;
    if (!BuildWire(component, edges, nodes, adjacency, &wire, error)) return false;
    wires.push_back(std::move(wire));
  }
  std::sort(wires.begin(), wires.end(), [](const SurfaceWire& a, const SurfaceWire& b) {
    return PointLess(a.sortPoint, b.sortPoint);
  });
  *output = std::move(wires);
  return true;
}

inline bool LoadSketch(const std::string& id, SketchFeature* sketch,
                       std::string* error) {
  if (!ShapeStore::ValidFeatureId(id))
    return Fail(error, "sketchId must match [A-Za-z0-9_-]");
  if (!SketchStore::instance().get(id, sketch))
    return Fail(error, "missing sketch " + id);
  return EnsureGeometryAvailable(id, error);
}

inline bool SetBoundsAndValidate(const TopoDS_Shape& shape, ShapeRecord* record,
                                 std::string* error) {
  if (shape.IsNull() || !HasSurfaceTopology(shape))
    return Fail(error, "surface feature must contain faces and no solids");
  if (!BRepCheck_Analyzer(shape, true).IsValid())
    return Fail(error, "surface B-Rep validation failed");
  GProp_GProps area;
  BRepGProp::SurfaceProperties(shape, area);
  if (!std::isfinite(area.Mass()) || area.Mass() <= Precision::Confusion())
    return Fail(error, "surface has zero or invalid area");
  Bnd_Box bounds;
  BRepBndLib::AddOptimal(shape, bounds, false, false);
  if (bounds.IsVoid() || bounds.IsOpen())
    return Fail(error, "surface has no finite bounds");
  bounds.Get(record->bboxMm[0], record->bboxMm[1], record->bboxMm[2],
             record->bboxMm[3], record->bboxMm[4], record->bboxMm[5]);
  record->volumeMm3 = 0;
  return true;
}

inline bool BuildSweptSurfaces(const std::vector<SurfaceWire>& wires,
                               const gp_Vec* translation, const gp_Ax1* axis,
                               double angleRadians, TopoDS_Shape* output,
                               std::string* error) {
  if (!output || wires.empty()) return Fail(error, "surface sweep has no wires");
  try {
    BRep_Builder builder;
    TopoDS_Compound compound;
    builder.MakeCompound(compound);
    for (const auto& source : wires) {
      TopoDS_Shape patch;
      if (translation) {
        BRepPrimAPI_MakePrism sweep(source.wire, *translation, Standard_True,
                                    Standard_True);
        sweep.Build();
        if (!sweep.IsDone()) return Fail(error, "surface extrusion failed");
        patch = sweep.Shape();
      } else {
        BRepPrimAPI_MakeRevol sweep(source.wire, *axis, angleRadians,
                                    Standard_True);
        sweep.Build();
        if (!sweep.IsDone()) return Fail(error, "surface revolution failed");
        patch = sweep.Shape();
      }
      if (patch.IsNull() || TopExp_Explorer(patch, TopAbs_FACE).More() == false ||
          TopExp_Explorer(patch, TopAbs_SOLID).More())
        return Fail(error, "surface sweep produced no uncapped face");
      builder.Add(compound, patch);
    }
    *output = compound;
    return true;
  } catch (const Standard_Failure& failure) {
    return Fail(error, std::string("surface sweep kernel failure: ") +
                           failure.GetMessageString());
  }
}

inline bool NormalizeRevolveParams(const std::vector<double>& input,
                                   std::vector<double>* output,
                                   std::string* error) {
  if (input.size() != 7) return Fail(error, "surface revolve requires seven parameters");
  if (!std::all_of(input.begin(), input.end(),
                   [](double value) { return std::isfinite(value); }))
    return Fail(error, "surface revolve parameters must be finite");
  if (input[0] <= 0 || input[0] > 360)
    return Fail(error, "angleDeg must be in (0, 360]");
  for (size_t i = 1; i <= 3; ++i)
    if (std::abs(input[i]) > kSurfaceParameterLimitMm)
      return Fail(error, "axis origin components must be within +/-100000 mm");
  for (size_t i = 4; i <= 6; ++i)
    if (std::abs(input[i]) > 1)
      return Fail(error, "axis direction components must be within [-1, 1]");
  const double length = std::sqrt(input[4] * input[4] + input[5] * input[5] +
                                  input[6] * input[6]);
  if (!std::isfinite(length) || length <= 1e-9)
    return Fail(error, "axis direction must be nonzero");
  *output = input;
  for (size_t i = 4; i <= 6; ++i) (*output)[i] /= length;
  return true;
}
#endif

}  // namespace surface_detail

#if KREODA_WITH_OCCT
inline bool BuildSurfaceExtrudeShape(const std::string& sketchId,
                                    double distanceMm, TopoDS_Shape* output,
                                    std::string* error) {
  if (!std::isfinite(distanceMm) || distanceMm == 0 ||
      std::abs(distanceMm) > kSurfaceParameterLimitMm)
    return surface_detail::Fail(error, "distanceMm must be finite, nonzero and within +/-100000 mm");
  SketchFeature sketch;
  if (!surface_detail::LoadSketch(sketchId, &sketch, error)) return false;
  std::vector<surface_detail::SurfaceWire> wires;
  if (!surface_detail::CollectSketchWires(sketch, &wires, error)) return false;
  const gp_Vec normal(sketch.plane.normal[0] * distanceMm,
                      sketch.plane.normal[1] * distanceMm,
                      sketch.plane.normal[2] * distanceMm);
  return surface_detail::BuildSweptSurfaces(wires, &normal, nullptr, 0, output, error);
}

inline bool BuildSurfaceRevolveShape(const std::string& sketchId,
                                    const std::vector<double>& params,
                                    TopoDS_Shape* output,
                                    std::vector<double>* canonicalParams,
                                    std::string* error) {
  std::vector<double> normalized;
  if (!surface_detail::NormalizeRevolveParams(params, &normalized, error)) return false;
  SketchFeature sketch;
  if (!surface_detail::LoadSketch(sketchId, &sketch, error)) return false;
  std::vector<surface_detail::SurfaceWire> wires;
  if (!surface_detail::CollectSketchWires(sketch, &wires, error)) return false;
  const gp_Ax1 axis(gp_Pnt(normalized[1], normalized[2], normalized[3]),
                    gp_Dir(normalized[4], normalized[5], normalized[6]));
  if (!surface_detail::BuildSweptSurfaces(wires, nullptr, &axis,
                                           normalized[0] * std::acos(-1.0) / 180.0,
                                           output, error)) return false;
  if (canonicalParams) *canonicalParams = std::move(normalized);
  return true;
}

inline bool BuildSurfaceLoftShape(const std::vector<std::string>& sketchIds,
                                  TopoDS_Shape* output,
                                  std::string* error) {
  if (!output || sketchIds.size() < 2 || sketchIds.size() > 128)
    return surface_detail::Fail(error, "surface loft requires 2 to 128 sketches");
  std::set<std::string> unique;
  std::vector<TopoDS_Wire> sections;
  sections.reserve(sketchIds.size());
  bool status = false;
  for (size_t i = 0; i < sketchIds.size(); ++i) {
    const auto& id = sketchIds[i];
    if (!ShapeStore::ValidFeatureId(id) || !unique.insert(id).second)
      return surface_detail::Fail(error, "surface loft sketchIds must be distinct stable IDs");
    SketchFeature sketch;
    if (!surface_detail::LoadSketch(id, &sketch, error)) return false;
    std::vector<surface_detail::SurfaceWire> wires;
    if (!surface_detail::CollectSketchWires(sketch, &wires, error)) return false;
    if (wires.size() != 1)
      return surface_detail::Fail(error, "each loft sketch must contain one connected wire");
    if (i == 0) status = wires.front().closed;
    else if (wires.front().closed != status)
      return surface_detail::Fail(error, "loft sections must have matching open or closed status");
    sections.push_back(wires.front().wire);
  }
  try {
    BRepOffsetAPI_ThruSections loft(Standard_False, Standard_False);
    loft.CheckCompatibility(Standard_True);
    for (const auto& section : sections) loft.AddWire(section);
    loft.Build();
    if (!loft.IsDone() || loft.Shape().IsNull())
      return surface_detail::Fail(error, "surface loft failed");
    *output = loft.Shape();
    return true;
  } catch (const Standard_Failure& failure) {
    return surface_detail::Fail(error, std::string("surface loft kernel failure: ") +
                                   failure.GetMessageString());
  }
}

inline bool CommitSurfaceFeature(const std::string& featureId,
                                 const std::string& type,
                                 std::vector<double> params,
                                 std::vector<std::string> dependencies,
                                 const TopoDS_Shape& shape,
                                 std::string* error) {
  ShapeRecord check;
  check.type = type;
  if (!IsSurfaceFeatureType(type) ||
      !surface_detail::SetBoundsAndValidate(shape, &check, error)) return false;
  return CommitSingleFeature(featureId, type, std::move(params),
                             std::move(dependencies), "", shape, error);
}

inline bool CreateSurfaceExtrudeFeature(const std::string& featureId,
                                       const std::string& sketchId,
                                       double distanceMm,
                                       std::string* error) {
  if (!CheckNewId(featureId, error)) return false;
  TopoDS_Shape shape;
  if (!BuildSurfaceExtrudeShape(sketchId, distanceMm, &shape, error)) return false;
  return CommitSurfaceFeature(featureId, "SurfaceExtrude", {distanceMm},
                              {sketchId}, shape, error);
}

inline bool CreateSurfaceRevolveFeature(const std::string& featureId,
                                       const std::string& sketchId,
                                       const std::vector<double>& params,
                                       std::string* error) {
  if (!CheckNewId(featureId, error)) return false;
  TopoDS_Shape shape;
  std::vector<double> canonical;
  if (!BuildSurfaceRevolveShape(sketchId, params, &shape, &canonical, error))
    return false;
  return CommitSurfaceFeature(featureId, "SurfaceRevolve", std::move(canonical),
                              {sketchId}, shape, error);
}

inline bool CreateSurfaceLoftFeature(const std::string& featureId,
                                    const std::vector<std::string>& sketchIds,
                                    std::string* error) {
  if (!CheckNewId(featureId, error)) return false;
  TopoDS_Shape shape;
  if (!BuildSurfaceLoftShape(sketchIds, &shape, error)) return false;
  return CommitSurfaceFeature(featureId, "SurfaceLoft", {}, sketchIds,
                              shape, error);
}

inline bool RebuildSurfaceFeatureFromStore(const std::string& featureId,
                                          std::string* error) {
  ShapeRecord previous;
  if (!ShapeStore::instance().get(featureId, &previous) ||
      !IsSurfaceFeatureType(previous.type) || previous.dependsOn.empty())
    return surface_detail::Fail(error, "invalid stored surface feature");
  TopoDS_Shape shape;
  std::vector<double> params = previous.paramsMm;
  bool built = false;
  if (previous.type == "SurfaceExtrude" && params.size() == 1 &&
      previous.dependsOn.size() == 1)
    built = BuildSurfaceExtrudeShape(previous.dependsOn.front(), params.front(),
                                     &shape, error);
  else if (previous.type == "SurfaceRevolve" && params.size() == 7 &&
           previous.dependsOn.size() == 1) {
    std::vector<double> canonical;
    built = BuildSurfaceRevolveShape(previous.dependsOn.front(), params, &shape,
                                     &canonical, error);
    params = std::move(canonical);
  } else if (previous.type == "SurfaceLoft" && params.empty())
    built = BuildSurfaceLoftShape(previous.dependsOn, &shape, error);
  if (!built) return false;
  ShapeRecord check;
  check.type = previous.type;
  if (!surface_detail::SetBoundsAndValidate(shape, &check, error)) return false;
  return CommitShape(featureId, previous.type, std::move(params),
                     previous.dependsOn, previous.refExtra, shape,
                     &previous, false, error);
}
#endif

}  // namespace kreoda
