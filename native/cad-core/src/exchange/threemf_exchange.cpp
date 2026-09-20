// 3MF exchange via lib3mf (mesh round-trip at export LOD, Phase 8 §61).

#include "exchange/threemf_exchange.h"

#include "model/shapes.h"
#include "tessellation/mesh.h"
#include "exchange/sew.h"

#if defined(INTENTCAD_WITH_LIB3MF) && INTENTCAD_WITH_OCCT
// NOTE: OCCT includes must stay OUTSIDE namespace intentcad.
#include <Bindings/Cpp/lib3mf_implicit.hpp>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Solid.hxx>
#endif

namespace intentcad {

namespace {

#if defined(INTENTCAD_WITH_LIB3MF) && INTENTCAD_WITH_OCCT
// 3MF model unit → mm scale factor (export always writes millimeters).
// Unknown future units fail LOUDLY (M17): silently assuming mm would
// import meter-scale parts 1000× off with an "ok" status.
double UnitToMm(Lib3MF::eModelUnit unit, bool* ok) {
  using Lib3MF::eModelUnit;
  if (ok) *ok = true;
  switch (unit) {
    case eModelUnit::MicroMeter: return 0.001;
    case eModelUnit::MilliMeter: return 1.0;
    case eModelUnit::CentiMeter: return 10.0;
    case eModelUnit::Inch: return 25.4;
    case eModelUnit::Foot: return 304.8;
    case eModelUnit::Meter: return 1000.0;
    default:
      break;
  }
  if (ok) *ok = false;
  return 1.0;
}

// 3MF/STL carry triangles, not topology: sewing lives in sew.{h,cpp} so all
// faceted imports share one watertight-shell path with identical honesty.
#endif

}  // namespace

bool ExportThreeMF(const std::string& path, std::string* error) {
#if defined(INTENTCAD_WITH_LIB3MF) && INTENTCAD_WITH_OCCT
  if (path.empty()) {
    if (error) *error = "path is required";
    return false;
  }
  try {
    Lib3MF::CWrapper wrapper;
    Lib3MF::PModel model = wrapper.CreateModel();
    model->SetUnit(Lib3MF::eModelUnit::MilliMeter);
    int objects = 0;
    std::vector<std::string> skipped;
    for (const ShapeRecord& rec : ShapeStore::instance().listInOrder()) {
      if (rec.shape.IsNull()) continue;
      std::string terr;
      const CoreMesh mesh = TessellateRecord(rec, 2, &terr);
      // Fail LOUD on partial export (M6): never a file missing a body.
      if (mesh.indices.empty() || mesh.positions.empty()) {
        skipped.push_back(rec.featureId);
        continue;
      }
      Lib3MF::PMeshObject obj = model->AddMeshObject();
      obj->SetName(rec.featureId + " " + rec.type);
      for (size_t v = 0; v < mesh.positions.size() / 3; ++v) {
        Lib3MF::sPosition p;
        p.m_Coordinates[0] = mesh.positions[v * 3];
        p.m_Coordinates[1] = mesh.positions[v * 3 + 1];
        p.m_Coordinates[2] = mesh.positions[v * 3 + 2];
        obj->AddVertex(p);
      }
      for (size_t t = 0; t < mesh.indices.size() / 3; ++t) {
        Lib3MF::sTriangle tri;
        tri.m_Indices[0] = mesh.indices[t * 3];
        tri.m_Indices[1] = mesh.indices[t * 3 + 1];
        tri.m_Indices[2] = mesh.indices[t * 3 + 2];
        obj->AddTriangle(tri);
      }
      model->AddBuildItem(obj.get(), wrapper.GetIdentityTransform());
      ++objects;
    }
    if (!skipped.empty()) {
      if (error) {
        *error = "cannot tessellate for export: " + skipped[0];
        for (size_t i = 1; i < skipped.size(); ++i)
          *error += ", " + skipped[i];
      }
      return false;
    }
    if (objects == 0) {
      if (error) *error = "nothing to export: the document has no solids";
      return false;
    }
    model->QueryWriter("3mf")->WriteToFile(path);
    return true;
  } catch (const Lib3MF::ELib3MFException& e) {
    if (error) *error = std::string("3MF export failed: ") + e.what();
    return false;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("3MF export failed: ") + f.what();
    return false;
  }
#else
  (void)path;
  if (error) *error = "3MF export requires OCCT + lib3mf (link via vcpkg)";
  return false;
#endif
}

bool ImportThreeMF(const std::string& path,
                   std::vector<std::string>* createdIds,
                   std::string* error) {
#if defined(INTENTCAD_WITH_LIB3MF) && INTENTCAD_WITH_OCCT
  if (path.empty()) {
    if (error) *error = "path is required";
    return false;
  }
  if (!createdIds) {
    if (error) *error = "internal error: null out-param";
    return false;
  }
  try {
    Lib3MF::CWrapper wrapper;
    Lib3MF::PModel model = wrapper.CreateModel();
    model->QueryReader("3mf")->ReadFromFile(path);
    bool unitOk = false;
    const double scale = UnitToMm(model->GetUnit(), &unitOk);
    if (!unitOk) {
      if (error) *error = "3MF has an unsupported model unit";
      return false;
    }
    Lib3MF::PMeshObjectIterator it = model->GetMeshObjects();
    int objects = 0;
    std::vector<TopoDS_Shape> solids;
    while (it->MoveNext()) {
      ++objects;
      Lib3MF::PMeshObject obj = it->GetCurrentMeshObject();
      const Lib3MF_uint32 nv = obj->GetVertexCount();
      const Lib3MF_uint32 nt = obj->GetTriangleCount();
      if (nv == 0 || nt == 0) continue;
      std::vector<float> verts(nv * 3);
      for (Lib3MF_uint32 i = 0; i < nv; ++i) {
        const Lib3MF::sPosition p = obj->GetVertex(i);
        verts[i * 3] = static_cast<float>(p.m_Coordinates[0] * scale);
        verts[i * 3 + 1] = static_cast<float>(p.m_Coordinates[1] * scale);
        verts[i * 3 + 2] = static_cast<float>(p.m_Coordinates[2] * scale);
      }
      std::vector<uint32_t> indices;
      indices.reserve(nt * 3);
      for (Lib3MF_uint32 i = 0; i < nt; ++i) {
        const Lib3MF::sTriangle t = obj->GetTriangle(i);
        indices.push_back(t.m_Indices[0]);
        indices.push_back(t.m_Indices[1]);
        indices.push_back(t.m_Indices[2]);
      }
      if (!SewTrianglesToSolids(verts, indices, &solids, error)) {
        return false;
      }
    }
    if (objects == 0) {
      if (error) *error = "3MF file contains no mesh objects: " + path;
      return false;
    }
    if (solids.empty()) {
      if (error) *error = "3MF file contains no closed solids: " + path;
      return false;
    }
    // One OCAF command for the whole import (shared helper).
    if (!CommitImportedSolids(solids, "MeshImport", "mesh-", createdIds,
                              error)) {
      return false;
    }
    return true;
  } catch (const Lib3MF::ELib3MFException& e) {
    if (error) *error = std::string("3MF import failed: ") + e.what();
    return false;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("3MF import failed: ") + f.what();
    return false;
  }
#else
  (void)path;
  (void)createdIds;
  if (error) *error = "3MF import requires OCCT + lib3mf (link via vcpkg)";
  return false;
#endif
}

}  // namespace intentcad
