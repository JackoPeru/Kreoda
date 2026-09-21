// STL exchange via OCCT DataExchange (binary write, sewn import).

#include "exchange/stl_exchange.h"

#include "exchange/sew.h"
#include "model/shapes.h"

#if KREODA_WITH_OCCT
// NOTE: OCCT includes must stay OUTSIDE namespace kreoda.
#include <DESTL_ConfigurationNode.hxx>
#include <DESTL_Provider.hxx>
#include <Standard_Failure.hxx>
#include <TCollection_AsciiString.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Solid.hxx>
#endif

namespace kreoda {

bool ExportStl(const std::string& path, std::string* error) {
#if KREODA_WITH_OCCT
  if (path.empty()) {
    if (error) *error = "path is required";
    return false;
  }
  try {
    TopoDS_Compound compound;
    if (!CollectSolidsCompound(&compound, error)) return false;
    // STL needs triangles, not B-Rep: pre-mesh at export deflection (same
    // 0.01 mm / 0.05 rad as the LOD-2 tessellation the 3MF slice uses).
    if (!PreMeshExport(&compound, "STL", error)) return false;
    ScopedMute mute;
    occ::handle<DESTL_ConfigurationNode> node = new DESTL_ConfigurationNode();
    node->InternalParameters.WriteAscii = false;  // binary STL: smaller
    DESTL_Provider provider(node);
    if (!provider.Write(TCollection_AsciiString(path.c_str()), compound)) {
      if (error) *error = "STL write failed: " + path;
      return false;
    }
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("STL export failed: ") + f.what();
    return false;
  }
#else
  (void)path;
  if (error) *error = "STL export requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool ImportStl(const std::string& path, std::vector<std::string>* createdIds,
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
    occ::handle<DESTL_ConfigurationNode> node = new DESTL_ConfigurationNode();
    DESTL_Provider provider(node);
    TopoDS_Shape shape;
    if (!provider.Read(TCollection_AsciiString(path.c_str()), shape) ||
        shape.IsNull()) {
      if (error) *error = "STL read failed (not an STL file?): " + path;
      return false;
    }
    // STL carries triangulation, not B-Rep: extract triangles, sew closed
    // shells — the shared faceted-import path (same honesty as 3MF).
    std::vector<float> verts;
    std::vector<uint32_t> indices;
    if (!ExtractTriangles(shape, &verts, &indices, error)) return false;
    std::vector<TopoDS_Shape> solids;
    if (!SewTrianglesToSolids(verts, indices, &solids, error)) return false;
    // One OCAF command for the whole import (shared helper).
    if (!CommitImportedSolids(solids, "MeshImport", "stl-", createdIds,
                              error)) {
      return false;
    }
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("STL import failed: ") + f.what();
    return false;
  }
#else
  (void)path;
  (void)createdIds;
  if (error) *error = "STL import requires OCCT (link via vcpkg)";
  return false;
#endif
}

}  // namespace kreoda
