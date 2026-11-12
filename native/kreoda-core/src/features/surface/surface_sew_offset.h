#pragma once

#include <algorithm>
#include <cmath>
#include <iterator>
#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "model/commit.h"
#include "model/geometry_availability.h"
#include "model/geometry_kind.h"
#include "model/shapes.h"

#if KREODA_WITH_OCCT
#include <BRepAlgoAPI_Check.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepCheck_Shell.hxx>
#include <BRepGProp.hxx>
#include <BRepLib.hxx>
#include <BRep_Builder.hxx>
#include <BRepOffsetAPI_MakeOffsetShape.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <NCollection_IndexedDataMap.hxx>
#include <NCollection_IndexedMap.hxx>
#include <NCollection_List.hxx>
#include <Precision.hxx>
#include <Standard_Failure.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Shape.hxx>
#endif

namespace kreoda {

inline constexpr size_t kMaxSurfaceSewOffsetFaces = 4096;

#if KREODA_WITH_OCCT
namespace surface_sew_offset_detail {

inline bool Fail(std::string* error, const std::string& message) {
  if (error) *error = message;
  return false;
}

inline int FaceCount(const TopoDS_Shape& shape) {
  int count = 0;
  for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next()) ++count;
  return count;
}

inline bool HasFreeFaceBoundaryTopology(const TopoDS_Shape& shape) {
  TopTools_IndexedMapOfShape allEdges, faceEdges, allVertices, faceVertices;
  TopExp::MapShapes(shape, TopAbs_EDGE, allEdges);
  TopExp::MapShapes(shape, TopAbs_VERTEX, allVertices);
  for (TopExp_Explorer face(shape, TopAbs_FACE); face.More(); face.Next()) {
    TopExp::MapShapes(face.Current(), TopAbs_EDGE, faceEdges);
    TopExp::MapShapes(face.Current(), TopAbs_VERTEX, faceVertices);
  }
  for (int i = 1; i <= allEdges.Extent(); ++i)
    if (!faceEdges.Contains(allEdges(i))) return true;
  for (int i = 1; i <= allVertices.Extent(); ++i)
    if (!faceVertices.Contains(allVertices(i))) return true;
  return false;
}

inline bool ValidTolerance(double value) {
  return std::isfinite(value) && value >= 1e-7 && value <= 1.0;
}

inline bool ValidSurface(const ShapeRecord& record, const std::string& operation,
                         std::string* error) {
  if (record.shape.IsNull() || HasSolidTopology(record.shape) ||
      HasMixedSolidSurfaceTopology(record.shape) ||
      !HasSurfaceTopology(record.shape) ||
      HasFreeFaceBoundaryTopology(record.shape))
    return Fail(error, operation + ": input must contain only face/shell surfaces");
  if (!BRepCheck_Analyzer(record.shape, true).IsValid())
    return Fail(error, operation + ": input surface B-Rep is invalid");
  return true;
}

inline bool SetSurfaceBounds(const TopoDS_Shape& shape, ShapeRecord* record,
                             const std::string& operation,
                             std::string* error) {
  if (shape.IsNull() || HasSolidTopology(shape) || !HasSurfaceTopology(shape) ||
      HasFreeFaceBoundaryTopology(shape))
    return Fail(error, operation + ": result must be uncapped face/shell surfaces");
  if (!BRepCheck_Analyzer(shape, true).IsValid())
    return Fail(error, operation + ": BRepCheck validation failed");
  GProp_GProps area;
  BRepGProp::SurfaceProperties(shape, area);
  if (!std::isfinite(area.Mass()) || area.Mass() <= Precision::Confusion())
    return Fail(error, operation + ": result has zero or invalid area");
  Bnd_Box bounds;
  BRepBndLib::AddOptimal(shape, bounds, false, false);
  if (bounds.IsVoid() || bounds.IsOpen())
    return Fail(error, operation + ": result has no finite bounds");
  double values[6];
  bounds.Get(values[0], values[1], values[2], values[3], values[4], values[5]);
  if (!std::all_of(std::begin(values), std::end(values),
                   [](double value) { return std::isfinite(value); }))
    return Fail(error, operation + ": result has non-finite bounds");
  for (size_t i = 0; i < 6; ++i) record->bboxMm[i] = values[i];
  record->volumeMm3 = 0;
  return true;
}

inline bool NoSelfInterference(const TopoDS_Shape& shape,
                               const std::string& operation,
                               std::string* error) {
  BRepAlgoAPI_Check check(shape, false, true);
  if (!check.IsValid())
    return Fail(error, operation + ": self-interference check failed");
  return true;
}

inline bool OffsetFaceComponents(const TopoDS_Shape& source,
                                 double distanceMm, double toleranceMm,
                                 TopoDS_Shape* output, std::string* error) {
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
  TopExp::MapShapes(source, TopAbs_FACE, faces);
  if (faces.IsEmpty()) return Fail(error, "SurfaceOffset: source has no faces");

  std::vector<int> parent(static_cast<size_t>(faces.Extent()) + 1);
  for (int i = 1; i <= faces.Extent(); ++i) parent[i] = i;
  const auto root = [&parent](int item) {
    int current = item;
    while (parent[current] != current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  const auto join = [&parent, &root](int a, int b) {
    const int aRoot = root(a), bRoot = root(b);
    if (aRoot != bRoot) parent[bRoot] = aRoot;
  };

  NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>,
                             TopTools_ShapeMapHasher> edgeFaces;
  TopExp::MapShapesAndAncestors(source, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
  for (int edgeIndex = 1; edgeIndex <= edgeFaces.Extent(); ++edgeIndex) {
    const auto& ancestors = edgeFaces.FindFromIndex(edgeIndex);
    if (ancestors.Extent() < 2) continue;
    NCollection_List<TopoDS_Shape>::Iterator it(ancestors);
    const int firstFace = faces.FindIndex(it.Value());
    for (it.Next(); it.More(); it.Next()) {
      const int adjacentFace = faces.FindIndex(it.Value());
      if (firstFace > 0 && adjacentFace > 0) join(firstFace, adjacentFace);
    }
  }

  std::map<int, std::vector<int>> components;
  for (int i = 1; i <= faces.Extent(); ++i)
    components[root(i)].push_back(i);

  BRep_Builder builder;
  TopoDS_Compound combined;
  builder.MakeCompound(combined);
  for (const auto& [_, componentFaces] : components) {
    TopoDS_Shape component;
    if (componentFaces.size() == 1) {
      component = faces(componentFaces.front());
    } else {
      TopoDS_Shell shell;
      builder.MakeShell(shell);
      for (const int faceIndex : componentFaces)
        builder.Add(shell, TopoDS::Face(faces(faceIndex)));
      component = shell;
    }

    BRepOffsetAPI_MakeOffsetShape offset;
    offset.PerformByJoin(component, distanceMm, toleranceMm,
                         BRepOffset_Skin, false, false, GeomAbs_Arc, false);
    if (!offset.IsDone() || offset.Shape().IsNull())
      return Fail(error, "SurfaceOffset: OCCT could not construct a connected face component");
    builder.Add(combined, offset.Shape());
  }
  *output = combined;
  return true;
}

inline bool CountShellLeaves(const TopoDS_Shape& shape, int* count) {
  if (shape.ShapeType() == TopAbs_SHELL) {
    ++*count;
    return true;
  }
  if (shape.ShapeType() != TopAbs_COMPOUND) return false;
  for (TopoDS_Iterator it(shape); it.More(); it.Next())
    if (!CountShellLeaves(it.Value(), count)) return false;
  return true;
}

inline bool SingleConnectedSurface(const TopoDS_Shape& shape,
                                   int expectedFaces, TopoDS_Shell* shell,
                                   std::string* error) {
  TopTools_IndexedMapOfShape faces;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  if (faces.Extent() != expectedFaces)
    return Fail(error, "SurfaceSew: sewing dropped or merged source faces");
  if (shape.ShapeType() == TopAbs_FACE) {
    if (expectedFaces != 1)
      return Fail(error, "SurfaceSew: disconnected face leftovers");
    BRep_Builder builder;
    builder.MakeShell(*shell);
    builder.Add(*shell, TopoDS::Face(shape));
    return true;
  }
  int shellLeaves = 0;
  if (!CountShellLeaves(shape, &shellLeaves) || shellLeaves != 1)
    return Fail(error, "SurfaceSew: result has disconnected face or edge leftovers");
  TopTools_IndexedMapOfShape shells;
  TopExp::MapShapes(shape, TopAbs_SHELL, shells);
  if (shells.Extent() != 1)
    return Fail(error, "SurfaceSew: result must be one connected face/shell");
  TopTools_IndexedMapOfShape shellFaces;
  TopExp::MapShapes(shells(1), TopAbs_FACE, shellFaces);
  if (shellFaces.Extent() != expectedFaces)
    return Fail(error, "SurfaceSew: disconnected face leftovers");
  *shell = TopoDS::Shell(shells(1));
  return true;
}

inline bool FindRecord(const std::string& id,
                       const std::map<std::string, ShapeRecord>* records,
                       ShapeRecord* out, std::string* error) {
  if (!ShapeStore::ValidFeatureId(id))
    return Fail(error, "surface feature ID must match [A-Za-z0-9_-]");
  if (!EnsureGeometryAvailable(id, error)) return false;
  if (records) {
    const auto found = records->find(id);
    if (found == records->end())
      return Fail(error, "missing surface feature " + id);
    *out = found->second;
    return true;
  }
  if (!ShapeStore::instance().get(id, out))
    return Fail(error, "missing surface feature " + id);
  return true;
}

}  // namespace surface_sew_offset_detail

inline bool BuildSurfaceSewShape(
    const std::vector<std::string>& featureIds, double toleranceMm,
    bool makeSolid, TopoDS_Shape* output, std::string* error,
    const std::map<std::string, ShapeRecord>* records = nullptr) {
  using namespace surface_sew_offset_detail;
  if (!output || featureIds.empty() || featureIds.size() > 128)
    return Fail(error, "SurfaceSew requires 1 to 128 feature IDs");
  if (!ValidTolerance(toleranceMm))
    return Fail(error, "toleranceMm must be finite and in [1e-7, 1]");
  if (std::set<std::string>(featureIds.begin(), featureIds.end()).size() !=
      featureIds.size())
    return Fail(error, "SurfaceSew featureIds must be distinct");

  int totalFaces = 0;
  std::vector<ShapeRecord> sources;
  sources.reserve(featureIds.size());
  try {
    for (const auto& id : featureIds) {
      ShapeRecord source;
      if (!FindRecord(id, records, &source, error)) return false;
      const int faces = FaceCount(source.shape);
      if (faces == 0 || totalFaces > static_cast<int>(kMaxSurfaceSewOffsetFaces) - faces)
        return Fail(error, "SurfaceSew is limited to 4096 source faces");
      totalFaces += faces;
      sources.push_back(std::move(source));
    }

    BRepBuilderAPI_Sewing sewing(toleranceMm);
    sewing.SetFaceMode(true);
    sewing.SetFloatingEdgesMode(false);
    sewing.SetNonManifoldMode(false);
    std::vector<TopoDS_Shape> copies;
    copies.reserve(sources.size());
    for (const auto& source : sources) {
      if (!ValidSurface(source, "SurfaceSew", error)) return false;
      BRepBuilderAPI_Copy copy(source.shape, true, false);
      if (!copy.IsDone() || copy.Shape().IsNull())
        return Fail(error, "SurfaceSew: failed to copy source B-Rep");
      copies.push_back(copy.Shape());
      sewing.Add(copies.back());
    }
    sewing.Perform();
    const TopoDS_Shape sewed = sewing.SewedShape();
    if (sewed.IsNull() || sewing.NbDeletedFaces() != 0 ||
        sewing.NbMultipleEdges() != 0)
      return Fail(error, "SurfaceSew: sewing dropped faces or found non-manifold edges");
    if (HasSolidTopology(sewed) || !HasSurfaceTopology(sewed))
      return Fail(error, "SurfaceSew: kernel did not return uncapped surfaces");
    TopoDS_Shell shell;
    if (!SingleConnectedSurface(sewed, totalFaces, &shell, error)) return false;
    ShapeRecord surfaceValidation;
    if (!SetSurfaceBounds(sewed, &surfaceValidation, "SurfaceSew", error) ||
        !NoSelfInterference(sewed, "SurfaceSew", error)) return false;
    if (!makeSolid) {
      *output = sewed;
      return true;
    }
    BRepCheck_Shell shellCheck(shell);
    if (shellCheck.Closed() != BRepCheck_NoError)
      return Fail(error, "SurfaceSew: cannot make solid from an open shell; no caps are added");
    BRepBuilderAPI_MakeSolid make(shell);
    if (!make.IsDone())
      return Fail(error, "SurfaceSew: closed shell could not form a solid");
    TopoDS_Solid solid = make.Solid();
    if (!BRepLib::OrientClosedSolid(solid))
      return Fail(error, "SurfaceSew: closed shell has inconsistent orientation");
    BRepCheck_Analyzer analyzer(solid, true);
    if (!analyzer.IsValid() || !HasSolidTopology(solid) ||
        HasMixedSolidSurfaceTopology(solid))
      return Fail(error, "SurfaceSew: solid B-Rep validation failed");
    GProp_GProps volume;
    BRepGProp::VolumeProperties(solid, volume, true, false, false);
    if (!std::isfinite(volume.Mass()) || volume.Mass() <= 0)
      return Fail(error, "SurfaceSew: solid must have positive finite volume");
    *output = solid;
    return true;
  } catch (const Standard_Failure& failure) {
    return Fail(error, std::string("SurfaceSew kernel failure: ") +
                           failure.GetMessageString());
  }
}

inline bool BuildSurfaceOffsetShape(const ShapeRecord& source,
                                    double distanceMm, double toleranceMm,
                                    TopoDS_Shape* output,
                                    std::string* error) {
  using namespace surface_sew_offset_detail;
  if (!output)
    return Fail(error, "SurfaceOffset requires an output shape");
  if (!std::isfinite(distanceMm) || std::abs(distanceMm) < 1e-6 ||
      std::abs(distanceMm) > 100000.0)
    return Fail(error, "distanceMm must be finite with absolute value in [1e-6, 100000]");
  if (!ValidTolerance(toleranceMm))
    return Fail(error, "toleranceMm must be finite and in [1e-7, 1]");
  if (FaceCount(source.shape) > static_cast<int>(kMaxSurfaceSewOffsetFaces))
    return Fail(error, "SurfaceOffset is limited to 4096 source faces");
  if (!ValidSurface(source, "SurfaceOffset", error)) return false;
  try {
    BRepBuilderAPI_Copy copy(source.shape, true, false);
    if (!copy.IsDone() || copy.Shape().IsNull())
      return Fail(error, "SurfaceOffset: failed to copy source B-Rep");
    TopoDS_Shape candidate;
    if (!OffsetFaceComponents(copy.Shape(), distanceMm, toleranceMm,
                              &candidate, error)) return false;
    ShapeRecord validation;
    if (!SetSurfaceBounds(candidate, &validation, "SurfaceOffset", error)) return false;
    if (!NoSelfInterference(candidate, "SurfaceOffset", error)) return false;
    *output = candidate;
    return true;
  } catch (const Standard_Failure& failure) {
    return Fail(error, std::string("SurfaceOffset kernel failure: ") +
                           failure.GetMessageString());
  }
}

inline bool BuildSurfaceOffsetShape(const std::string& targetId,
                                    double distanceMm, double toleranceMm,
                                    TopoDS_Shape* output,
                                    std::string* error) {
  ShapeRecord source;
  if (!GetCurrentShapeRecord(targetId, &source, error)) return false;
  if (!IsSurfaceGeometry(source)) {
    if (error) *error = "SurfaceOffset: target must be a current surface feature or direct surface instance";
    return false;
  }
  return BuildSurfaceOffsetShape(source, distanceMm, toleranceMm, output, error);
}

inline bool CreateSurfaceSewFeature(const std::string& featureId,
                                    const std::vector<std::string>& featureIds,
                                    double toleranceMm, bool makeSolid,
                                    std::string* error) {
  if (!CheckNewId(featureId, error)) return false;
  TopoDS_Shape shape;
  if (!BuildSurfaceSewShape(featureIds, toleranceMm, makeSolid, &shape, error))
    return false;
  const std::string type = makeSolid ? "SurfaceSewnSolid" : "SurfaceSew";
  return CommitSingleFeature(featureId, type, {toleranceMm}, featureIds,
                             "", shape, error);
}

inline bool CreateSurfaceOffsetFeature(const std::string& featureId,
                                       const std::string& targetId,
                                       double distanceMm, double toleranceMm,
                                       std::string* error) {
  if (!CheckNewId(featureId, error)) return false;
  TopoDS_Shape shape;
  if (!BuildSurfaceOffsetShape(targetId, distanceMm, toleranceMm, &shape, error))
    return false;
  return CommitSingleFeature(featureId, "SurfaceOffset",
                             {distanceMm, toleranceMm}, {targetId}, "",
                             shape, error);
}

inline bool RebuildSurfaceSewOffsetFromStore(const std::string& featureId,
                                             std::string* error) {
  ShapeRecord previous;
  if (!ShapeStore::instance().get(featureId, &previous)) {
    if (error) *error = "unknown surface feature " + featureId;
    return false;
  }
  TopoDS_Shape shape;
  bool built = false;
  if ((previous.type == "SurfaceSew" || previous.type == "SurfaceSewnSolid") &&
      previous.paramsMm.size() == 1 && !previous.dependsOn.empty()) {
    built = BuildSurfaceSewShape(previous.dependsOn, previous.paramsMm[0],
                                 previous.type == "SurfaceSewnSolid", &shape,
                                 error);
  } else if (previous.type == "SurfaceOffset" &&
             previous.paramsMm.size() == 2 && previous.dependsOn.size() == 1) {
    ShapeRecord source;
    if (GetCurrentShapeRecord(previous.dependsOn[0], &source, error))
      built = BuildSurfaceOffsetShape(source, previous.paramsMm[0],
                                      previous.paramsMm[1], &shape, error);
  } else {
    if (error) *error = "invalid stored surface sew/offset feature";
    return false;
  }
  if (!built) return false;
  return CommitShape(featureId, previous.type, previous.paramsMm,
                     previous.dependsOn, previous.refExtra, shape,
                     &previous, false, error);
}

#endif  // KREODA_WITH_OCCT

}  // namespace kreoda
