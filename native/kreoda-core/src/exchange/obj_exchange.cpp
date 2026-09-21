// OBJ exchange via OCCT DataExchange (pre-meshed write, sewn import).

#include "exchange/obj_exchange.h"

#include "exchange/sew.h"
#include "model/shapes.h"

#if KREODA_WITH_OCCT
// NOTE: OCCT includes must stay OUTSIDE namespace kreoda.
#include <DEOBJ_ConfigurationNode.hxx>
#include <DEOBJ_Provider.hxx>
#include <Standard_Failure.hxx>
#include <TCollection_AsciiString.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Solid.hxx>
#endif

namespace kreoda {

bool ExportObj(const std::string& path, std::string* error) {
#if KREODA_WITH_OCCT
  if (path.empty()) {
    if (error) *error = "path is required";
    return false;
  }
  try {
    TopoDS_Compound compound;
    if (!CollectSolidsCompound(&compound, error)) return false;
    // OBJ needs triangles: same export deflection as STL/3MF (0.01/0.05).
    if (!PreMeshExport(&compound, "OBJ", error)) return false;
    ScopedMute mute;
    occ::handle<DEOBJ_ConfigurationNode> node = new DEOBJ_ConfigurationNode();
    // OBJ numbers are millimeters here: FileLengthUnit is the file unit
    // expressed in meters (default 1.0 = meters would scale us ×1000).
    // NOTE (M16): OBJ itself is unitless — third-party files authored in
    // meters/centimeters import scaled. We stay self-consistent (mm both
    // ways) and say so in the handoff instead of guessing.
    node->InternalParameters.FileLengthUnit = 0.001;
    DEOBJ_Provider provider(node);
    if (!provider.Write(TCollection_AsciiString(path.c_str()), compound)) {
      if (error) *error = "OBJ write failed: " + path;
      return false;
    }
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("OBJ export failed: ") + f.what();
    return false;
  }
#else
  (void)path;
  if (error) *error = "OBJ export requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool ImportObj(const std::string& path, std::vector<std::string>* createdIds,
               std::string* error) {
#if KREODA_WITH_OCCT
  if (path.empty()) {
    if (error) *error = "path is required";
    return false;
  }
  if (!createdIds) {
    if (error) *error = "internal error: null out-param";
    return false;
  }
  try {
    ScopedMute mute;
    occ::handle<DEOBJ_ConfigurationNode> node = new DEOBJ_ConfigurationNode();
    node->InternalParameters.FileLengthUnit = 0.001;  // mm, not meters
    DEOBJ_Provider provider(node);
    TopoDS_Shape shape;
    if (!provider.Read(TCollection_AsciiString(path.c_str()), shape) ||
        shape.IsNull()) {
      if (error) *error = "OBJ read failed (not an OBJ file?): " + path;
      return false;
    }
    // Same faceted-import path as STL (unitless file — millimeters).
    std::vector<float> verts;
    std::vector<uint32_t> indices;
    if (!ExtractTriangles(shape, &verts, &indices, error)) return false;
    std::vector<TopoDS_Shape> solids;
    if (!SewTrianglesToSolids(verts, indices, &solids, error)) return false;
    // One OCAF command for the whole import (shared helper).
    if (!CommitImportedSolids(solids, "MeshImport", "obj-", createdIds,
                              error)) {
      return false;
    }
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("OBJ import failed: ") + f.what();
    return false;
  }
#else
  (void)path;
  (void)createdIds;
  if (error) *error = "OBJ import requires OCCT (link via vcpkg)";
  return false;
#endif
}

}  // namespace kreoda
