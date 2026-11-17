#pragma once

#include <string>
#include "shapes.h"

#if KREODA_WITH_OCCT
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <NCollection_IndexedMap.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS_Shape.hxx>
#endif

namespace kreoda {

enum class GeometryKind { Solid, Surface };

inline bool IsSurfaceFeatureType(const std::string& type) {
  return type == "SurfaceExtrude" || type == "SurfaceRevolve" ||
         type == "SurfaceLoft" || type == "SurfaceSew" ||
         type == "SurfaceOffset" || type == "SurfaceSweep" ||
         type == "SurfaceTrim" || type == "SurfaceExtend";
}

inline bool IsKnownSolidFeatureType(const std::string& type) {
  return type == "Box" || type == "Cylinder" || type == "Sphere" ||
         type == "Extrude" || type == "Revolve" || type == "Union" ||
         type == "Subtract" || type == "Intersect" || type == "Hole" ||
         type == "HolePattern" || type == "Fillet" || type == "Chamfer" ||
         type == "Shell" ||
         type == "SurfaceLoftSewnSolid" || type == "SurfaceSewnSolid" ||
         type == "SurfaceThicken" ||
         type == "SurfaceFaceThicken" ||
         type == "OutwardFacePush" || type == "InwardFacePocket" ||
         type == "MoveFace" || type == "OffsetFace" ||
         type == "DeleteFace" || type == "ReplaceFace" ||
         type == "StepImport" || type == "MeshImport" || type == "Instance" ||
         type == "Mirror" || type == "BodyPattern" ||
         type == "CircularBodyPattern";
}

#if KREODA_WITH_OCCT
inline bool HasSolidTopology(const TopoDS_Shape& shape) {
  return !shape.IsNull() && TopExp_Explorer(shape, TopAbs_SOLID).More();
}

inline bool HasSurfaceTopology(const TopoDS_Shape& shape) {
  return !shape.IsNull() && !HasSolidTopology(shape) &&
         TopExp_Explorer(shape, TopAbs_FACE).More();
}

inline bool HasFreeSurfaceTopology(const TopoDS_Shape& shape) {
  if (shape.IsNull()) return false;
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> solidFaces, allFaces;
  for (TopExp_Explorer solid(shape, TopAbs_SOLID); solid.More(); solid.Next())
    TopExp::MapShapes(solid.Current(), TopAbs_FACE, solidFaces);
  TopExp::MapShapes(shape, TopAbs_FACE, allFaces);
  for (int i = 1; i <= allFaces.Extent(); ++i)
    if (!solidFaces.Contains(allFaces(i))) return true;
  return false;
}

inline bool HasMixedSolidSurfaceTopology(const TopoDS_Shape& shape) {
  return HasSolidTopology(shape) && HasFreeSurfaceTopology(shape);
}
#endif

inline bool IsSurfaceGeometry(const ShapeRecord& record) {
  if (IsSurfaceFeatureType(record.type)) return true;
#if KREODA_WITH_OCCT
  // Instance keeps generic type; use its current B-Rep rather than traverse an
  // unbounded prototype chain or add a transport-only kind field.
  if (record.type == "Instance") return HasSurfaceTopology(record.shape);
#endif
  return false;
}

inline GeometryKind FeatureGeometryKind(const std::string& type) {
  return IsSurfaceFeatureType(type) ? GeometryKind::Surface
                                    : GeometryKind::Solid;
}

inline GeometryKind FeatureGeometryKind(const ShapeRecord& record) {
  return IsSurfaceGeometry(record) ? GeometryKind::Surface
                                   : GeometryKind::Solid;
}

}  // namespace kreoda
