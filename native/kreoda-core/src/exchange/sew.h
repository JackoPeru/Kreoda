#pragma once

#include <cstdint>
#include <string>
#include <vector>

#if KREODA_WITH_OCCT
// NOTE: OCCT includes must stay OUTSIDE namespace kreoda.
#include <TopoDS_Shape.hxx>
#endif

namespace kreoda {

// Shared helpers for faceted imports (3MF, STL, OBJ, glTF — Phase 8 §61).
// Mesh formats carry triangles, not topology: one triangle soup in, closed
// solids out. Open or degenerate-only meshes fail honestly (never a silent
// partial solid).
#if KREODA_WITH_OCCT
// Sew flat vertex/index soup (mm) into closed solids.
bool SewTrianglesToSolids(const std::vector<float>& verts,
                          const std::vector<uint32_t>& indices,
                          std::vector<TopoDS_Shape>* solids,
                          std::string* error);

// Collect every triangulated face of a shape into flat soup (mm), applying
// face locations. Faces without triangulation are skipped; all-skipped fails.
bool ExtractTriangles(const TopoDS_Shape& shape, std::vector<float>* verts,
                      std::vector<uint32_t>* indices, std::string* error);

// Commit imported solids as non-parametric features (type "MeshImport" or
// "StepImport") inside ONE OCAF command: one user action == one Undo step.
// Mints collision-checked "<prefix>-<12hex>" ids (§10 charset).
bool CommitImportedSolids(const std::vector<TopoDS_Shape>& solids,
                          const std::string& type, const std::string& idPrefix,
                          std::vector<std::string>* createdIds,
                          std::string* error);

// OCCT components log through the default messenger, which prints to stdout
// — lethal for the stdio-framed sidecar (STEP proved it). RAII printer
// clear/restore around any transfer call (per Message_Messenger docs).
class ScopedMute {
 public:
  ScopedMute();
  ~ScopedMute();

 private:
  struct Impl;
  Impl* impl_;
};
#endif

}  // namespace kreoda
