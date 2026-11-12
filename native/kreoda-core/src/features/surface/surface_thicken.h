#pragma once

#include <algorithm>
#include <cmath>
#include <functional>
#include <string>
#include <vector>

#include "features/surface/surface_sew_offset.h"

#if KREODA_WITH_OCCT
#include <BRepAlgoAPI_Check.hxx>
#include <BRepAlgo_Image.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepCheck_Shell.hxx>
#include <BRepGProp.hxx>
#include <BRepLib.hxx>
#include <BRepOffset_MakeOffset.hxx>
#include <Bnd_Box.hxx>
#include <GeomAbs_JoinType.hxx>
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
#include <TopoDS_Iterator.hxx>
#include <TopoDS_Solid.hxx>
#endif

namespace kreoda {

#if KREODA_WITH_OCCT
namespace surface_thicken_detail {

inline bool Fail(std::string* error, const std::string& message) {
  if (error) *error = message;
  return false;
}

inline bool SurfaceContainersOnly(const TopoDS_Shape& shape) {
  if (shape.ShapeType() == TopAbs_FACE || shape.ShapeType() == TopAbs_SHELL)
    return true;
  if (shape.ShapeType() != TopAbs_COMPOUND) return false;
  bool any = false;
  for (TopoDS_Iterator it(shape); it.More(); it.Next()) {
    any = true;
    if (!SurfaceContainersOnly(it.Value())) return false;
  }
  return any;
}

inline bool OneManifoldFaceComponent(const TopoDS_Shape& shape,
                                     std::string* error) {
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  if (faces.IsEmpty()) return Fail(error, "source has no faces");

  std::vector<int> parent(static_cast<size_t>(faces.Extent()) + 1);
  for (int i = 1; i <= faces.Extent(); ++i) parent[i] = i;
  const auto root = [&parent](int value) {
    int current = value;
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
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
  for (int edgeIndex = 1; edgeIndex <= edgeFaces.Extent(); ++edgeIndex) {
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> owners;
    const auto& ancestors = edgeFaces.FindFromIndex(edgeIndex);
    for (NCollection_List<TopoDS_Shape>::Iterator it(ancestors); it.More(); it.Next())
      owners.Add(it.Value());
    if (owners.Extent() > 2)
      return Fail(error, "source contains a non-manifold edge shared by more than two faces");
    if (owners.Extent() == 2)
      join(faces.FindIndex(owners(1)), faces.FindIndex(owners(2)));
  }

  int componentCount = 0;
  for (int i = 1; i <= faces.Extent(); ++i)
    if (root(i) == i) ++componentCount;
  if (componentCount != 1)
    return Fail(error, "source must contain one connected face component");
  return true;
}

inline bool FiniteBoundsAndArea(const TopoDS_Shape& shape,
                                const std::string& operation,
                                std::string* error) {
  GProp_GProps area;
  BRepGProp::SurfaceProperties(shape, area);
  if (!std::isfinite(area.Mass()) || area.Mass() <= Precision::Confusion())
    return Fail(error, operation + ": surface area must be finite and positive");
  Bnd_Box bounds;
  BRepBndLib::AddOptimal(shape, bounds, false, false);
  if (bounds.IsVoid() || bounds.IsOpen())
    return Fail(error, operation + ": bounds are not finite");
  double values[6];
  bounds.Get(values[0], values[1], values[2], values[3], values[4], values[5]);
  if (!std::all_of(std::begin(values), std::end(values),
                   [](double value) { return std::isfinite(value); }))
    return Fail(error, operation + ": bounds are not finite");
  return true;
}

inline bool ValidateInput(const ShapeRecord& source, std::string* error) {
  const TopoDS_Shape& shape = source.shape;
  if (!IsSurfaceGeometry(source) || shape.IsNull() ||
      HasSolidTopology(shape) || HasMixedSolidSurfaceTopology(shape) ||
      !HasSurfaceTopology(shape) || !SurfaceContainersOnly(shape))
    return Fail(error, "SurfaceThicken: input must contain only face/shell surfaces");
  if (surface_sew_offset_detail::FaceCount(shape) >
      static_cast<int>(kMaxSurfaceSewOffsetFaces))
    return Fail(error, "SurfaceThicken is limited to 4096 source faces");
  if (surface_sew_offset_detail::HasFreeFaceBoundaryTopology(shape))
    return Fail(error, "SurfaceThicken: source contains loose edges or vertices");
  if (!BRepCheck_Analyzer(shape, true).IsValid())
    return Fail(error, "SurfaceThicken: source B-Rep is invalid");
  if (!surface_sew_offset_detail::NoSelfInterference(
          shape, "SurfaceThicken", error)) return false;
  if (!OneManifoldFaceComponent(shape, error)) return false;
  return FiniteBoundsAndArea(shape, "SurfaceThicken", error);
}

inline bool HasClosedInputSkin(const TopoDS_Shape& shape) {
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> shells;
  TopExp::MapShapes(shape, TopAbs_SHELL, shells);
  if (shells.IsEmpty()) return false;
  for (int i = 1; i <= shells.Extent(); ++i)
    if (BRepCheck_Shell(TopoDS::Shell(shells(i))).Closed() != BRepCheck_NoError)
      return false;
  return true;
}

inline bool EveryShellClosed(const TopoDS_Shape& shape, int* closedCount,
                             std::string* error) {
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> shells;
  TopExp::MapShapes(shape, TopAbs_SHELL, shells);
  if (shells.IsEmpty())
    return Fail(error, "SurfaceThicken: result has no boundary shells");
  int closed = 0;
  for (int i = 1; i <= shells.Extent(); ++i) {
    if (BRepCheck_Shell(TopoDS::Shell(shells(i))).Closed() != BRepCheck_NoError)
      return Fail(error, "SurfaceThicken: result contains an open boundary shell");
    ++closed;
  }
  if (closedCount) *closedCount = closed;
  return true;
}

inline bool OffsetHistoryCoversInput(const TopoDS_Shape& copiedSource,
                                     const TopoDS_Shape& rawOutput,
                                     const BRepAlgo_Image& images,
                                     std::string* error) {
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> originals, outputFaces;
  TopExp::MapShapes(copiedSource, TopAbs_FACE, originals);
  TopExp::MapShapes(rawOutput, TopAbs_FACE, outputFaces);
  if (originals.IsEmpty())
    return Fail(error, "SurfaceThicken: copied source has no faces");

  for (int i = 1; i <= originals.Extent(); ++i) {
    const TopoDS_Shape& face = originals(i);
    if (!outputFaces.Contains(face))
      return Fail(error, "SurfaceThicken: output did not retain an original source face");
    if (!images.HasImage(face))
      return Fail(error, "SurfaceThicken: source face has no offset image");
    NCollection_List<TopoDS_Shape> lastImages;
    images.LastImage(face, lastImages);
    bool covered = false;
    for (NCollection_List<TopoDS_Shape>::Iterator it(lastImages); it.More(); it.Next()) {
      const TopoDS_Shape& image = it.Value();
      if (image.ShapeType() == TopAbs_FACE && !originals.Contains(image) &&
          outputFaces.Contains(image)) {
        covered = true;
        break;
      }
    }
    if (!covered)
      return Fail(error, "SurfaceThicken: source face has no final offset face in output");
  }
  return true;
}

inline bool SolidContainersOnly(const TopoDS_Shape& shape) {
  if (shape.ShapeType() == TopAbs_SOLID) return true;
  if (shape.ShapeType() != TopAbs_COMPOUND) return false;
  bool any = false;
  for (TopoDS_Iterator it(shape); it.More(); it.Next()) {
    any = true;
    if (!SolidContainersOnly(it.Value())) return false;
  }
  return any;
}

inline bool ExtractOnlySolid(const TopoDS_Shape& raw, TopoDS_Solid* solid,
                             std::string* error) {
  if (!solid || raw.IsNull() || !SolidContainersOnly(raw))
    return Fail(error, "SurfaceThicken: output contains non-solid or loose geometry");
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> solids;
  TopExp::MapShapes(raw, TopAbs_SOLID, solids);
  if (solids.Extent() != 1)
    return Fail(error, "SurfaceThicken: output must contain exactly one material solid");

  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> allFaces, allShells,
      allEdges, allVertices, solidFaces, solidShells, solidEdges, solidVertices;
  TopExp::MapShapes(raw, TopAbs_FACE, allFaces);
  TopExp::MapShapes(raw, TopAbs_SHELL, allShells);
  TopExp::MapShapes(raw, TopAbs_EDGE, allEdges);
  TopExp::MapShapes(raw, TopAbs_VERTEX, allVertices);
  TopExp::MapShapes(solids(1), TopAbs_FACE, solidFaces);
  TopExp::MapShapes(solids(1), TopAbs_SHELL, solidShells);
  TopExp::MapShapes(solids(1), TopAbs_EDGE, solidEdges);
  TopExp::MapShapes(solids(1), TopAbs_VERTEX, solidVertices);
  if (allFaces.Extent() != solidFaces.Extent() ||
      allShells.Extent() != solidShells.Extent() ||
      allEdges.Extent() != solidEdges.Extent() ||
      allVertices.Extent() != solidVertices.Extent())
    return Fail(error, "SurfaceThicken: output has geometry outside its material solid");
  *solid = TopoDS::Solid(solids(1));
  return true;
}

inline double SignedVolume(const TopoDS_Shape& shape) {
  GProp_GProps props;
  BRepGProp::VolumeProperties(shape, props, true, false, false);
  return props.Mass();
}

inline bool ValidateSolid(const TopoDS_Shape& shape, bool closedSkin,
                          bool requirePositiveVolume, std::string* error) {
  if (shape.IsNull() || !HasSolidTopology(shape) ||
      HasMixedSolidSurfaceTopology(shape))
    return Fail(error, "SurfaceThicken: candidate is not a pure material solid");
  if (!BRepCheck_Analyzer(shape, true).IsValid())
    return Fail(error, "SurfaceThicken: solid B-Rep validation failed");
  BRepAlgoAPI_Check selfCheck(shape, false, true);
  if (!selfCheck.IsValid())
    return Fail(error, "SurfaceThicken: solid self-interference check failed");
  int closedShells = 0;
  if (!EveryShellClosed(shape, &closedShells, error)) return false;
  if (closedSkin && closedShells < 2)
    return Fail(error, "SurfaceThicken: closed source skin needs a separate closed offset boundary");
  if (!FiniteBoundsAndArea(shape, "SurfaceThicken", error)) return false;
  if (requirePositiveVolume) {
    const double volume = SignedVolume(shape);
    if (!std::isfinite(volume) || volume <= 0)
      return Fail(error, "SurfaceThicken: solid volume must be finite and positive");
  }
  return true;
}

}  // namespace surface_thicken_detail

inline bool BuildSurfaceThickenShape(const ShapeRecord& source,
                                     double thicknessMm, double toleranceMm,
                                     TopoDS_Shape* output,
                                     std::string* error) {
  using namespace surface_thicken_detail;
  if (!output) return Fail(error, "SurfaceThicken requires an output shape");
  if (!std::isfinite(thicknessMm) || std::abs(thicknessMm) < 1e-6 ||
      std::abs(thicknessMm) > 100000.0)
    return Fail(error, "thicknessMm must be finite with absolute value in [1e-6, 100000]");
  if (!surface_sew_offset_detail::ValidTolerance(toleranceMm))
    return Fail(error, "toleranceMm must be finite and in [1e-7, 1]");
  try {
    if (!ValidateInput(source, error)) return false;
    BRepBuilderAPI_Copy copy(source.shape, true, false);
    if (!copy.IsDone() || copy.Shape().IsNull())
      return Fail(error, "SurfaceThicken: failed to copy source B-Rep");

    BRepOffset_MakeOffset offset;
    offset.Initialize(copy.Shape(), thicknessMm, toleranceMm,
                      BRepOffset_Skin, false, false, GeomAbs_Arc, true, false);
    offset.MakeOffsetShape();
    if (!offset.IsDone() || offset.Error() != BRepOffset_NoError ||
        offset.Shape().IsNull())
      return Fail(error, "SurfaceThicken: OCCT could not construct the offset skin");

    const TopoDS_Shape raw = offset.Shape();
    if (!OffsetHistoryCoversInput(copy.Shape(), raw,
                                  offset.OffsetFacesFromShapes(), error)) return false;
    const bool closedSkin = HasClosedInputSkin(copy.Shape());
    TopoDS_Solid extracted;
    if (!ExtractOnlySolid(raw, &extracted, error) ||
        !ValidateSolid(extracted, closedSkin, false, error)) return false;

    BRepBuilderAPI_Copy candidateCopy(extracted, true, false);
    if (!candidateCopy.IsDone() || candidateCopy.Shape().IsNull())
      return Fail(error, "SurfaceThicken: failed to copy solid before orientation normalization");
    TopoDS_Solid candidate = TopoDS::Solid(candidateCopy.Shape());
    BRepLib::OrientClosedSolid(candidate);
    if (SignedVolume(candidate) < 0) candidate.Reverse();
    if (!ValidateSolid(candidate, closedSkin, true, error)) return false;
    *output = candidate;
    return true;
  } catch (const Standard_Failure& failure) {
    return Fail(error, std::string("SurfaceThicken kernel failure: ") +
                           (failure.GetMessageString() ? failure.GetMessageString() : "OCCT error"));
  } catch (const std::exception& failure) {
    return Fail(error, std::string("SurfaceThicken failure: ") + failure.what());
  }
}

inline bool BuildSurfaceThickenShape(
    const std::string& targetId, double thicknessMm, double toleranceMm,
    TopoDS_Shape* output, std::string* error,
    const std::map<std::string, ShapeRecord>* records = nullptr) {
  ShapeRecord source;
  if (!surface_sew_offset_detail::FindRecord(targetId, records, &source, error))
    return false;
  return BuildSurfaceThickenShape(source, thicknessMm, toleranceMm, output, error);
}

inline bool CreateSurfaceThickenFeature(const std::string& featureId,
                                        const std::string& targetId,
                                        double thicknessMm,
                                        double toleranceMm,
                                        std::string* error) {
  if (!CheckNewId(featureId, error)) return false;
  TopoDS_Shape shape;
  if (!BuildSurfaceThickenShape(targetId, thicknessMm, toleranceMm,
                                &shape, error)) return false;
  return CommitSingleFeature(featureId, "SurfaceThicken",
                             {thicknessMm, toleranceMm}, {targetId}, "",
                             shape, error);
}

inline bool RebuildSurfaceThickenFromStore(const std::string& featureId,
                                           std::string* error) {
  ShapeRecord previous;
  if (!ShapeStore::instance().get(featureId, &previous) ||
      previous.type != "SurfaceThicken" || previous.paramsMm.size() != 2 ||
      previous.dependsOn.size() != 1)
    return surface_thicken_detail::Fail(error, "invalid stored SurfaceThicken feature");
  TopoDS_Shape shape;
  if (!BuildSurfaceThickenShape(previous.dependsOn.front(),
                                previous.paramsMm[0], previous.paramsMm[1],
                                &shape, error)) return false;
  return CommitShape(featureId, previous.type, previous.paramsMm,
                     previous.dependsOn, previous.refExtra, shape,
                     &previous, false, error);
}

#endif  // KREODA_WITH_OCCT

}  // namespace kreoda
