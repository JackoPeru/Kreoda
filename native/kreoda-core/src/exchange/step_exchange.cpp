// STEP AP214 exchange via OCCT DataExchange (DESTEP_Provider, Phase 8 §61).

#include "exchange/step_exchange.h"

#include "exchange/sew.h"
#include "model/shapes.h"

#if KREODA_WITH_OCCT
// NOTE: OCCT includes must stay OUTSIDE namespace kreoda.
#include <BRep_Builder.hxx>
#include <DESTEP_ConfigurationNode.hxx>
#include <DESTEP_Provider.hxx>
#include <Standard_Failure.hxx>
#include <TCollection_AsciiString.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Solid.hxx>
#include <TopAbs_ShapeEnum.hxx>
#endif

namespace kreoda {

bool ExportStep(const std::string& path, std::string* error) {
#if KREODA_WITH_OCCT
  if (path.empty()) {
    if (error) *error = "path is required";
    return false;
  }
  try {
    BRep_Builder builder;
    TopoDS_Compound compound;
    builder.MakeCompound(compound);
    int solids = 0;
    for (const ShapeRecord& rec : ShapeStore::instance().listInOrder()) {
      if (rec.shape.IsNull()) continue;
      builder.Add(compound, rec.shape);
      ++solids;
    }
    if (solids == 0) {
      if (error) *error = "nothing to export: the document has no solids";
      return false;
    }
    // The default provider has no configuration — hand it a default node
    // (AP214, manifold solids) explicitly.
    ScopedMute mute;
    occ::handle<DESTEP_ConfigurationNode> node = new DESTEP_ConfigurationNode();
    DESTEP_Provider provider(node);
    if (!provider.Write(TCollection_AsciiString(path.c_str()), compound)) {
      if (error) *error = "STEP write failed: " + path;
      return false;
    }
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("STEP export failed: ") + f.what();
    return false;
  }
#else
  (void)path;
  if (error) *error = "STEP export requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool ImportStep(const std::string& path, std::vector<std::string>* createdIds,
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
    occ::handle<DESTEP_ConfigurationNode> node = new DESTEP_ConfigurationNode();
    DESTEP_Provider provider(node);
    TopoDS_Shape shape;
    if (!provider.Read(TCollection_AsciiString(path.c_str()), shape) ||
        shape.IsNull()) {
      if (error) *error = "STEP read failed (not a STEP file?): " + path;
      return false;
    }
    std::vector<TopoDS_Shape> solids;
    for (TopExp_Explorer ex(shape, TopAbs_SOLID); ex.More(); ex.Next()) {
      if (!ex.Current().IsNull()) solids.push_back(ex.Current());
    }
    if (solids.empty()) {
      if (error) *error = "STEP file contains no solids: " + path;
      return false;
    }
    // One OCAF command for the whole import (shared helper).
    if (!CommitImportedSolids(solids, "StepImport", "step-", createdIds,
                              error)) {
      return false;
    }
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("STEP import failed: ") + f.what();
    return false;
  }
#else
  (void)path;
  (void)createdIds;
  if (error) *error = "STEP import requires OCCT (link via vcpkg)";
  return false;
#endif
}

}  // namespace kreoda
