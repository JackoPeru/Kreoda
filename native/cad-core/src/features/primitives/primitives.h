#pragma once

#include <string>
#include <vector>

#include "tessellation/mesh.h"

#if KREODA_WITH_OCCT
// NOTE: OCCT includes must stay OUTSIDE namespace kreoda (an include
// inside the namespace injects all of OCCT into it and breaks std headers).
#include <TopoDS_Shape.hxx>
#endif

namespace kreoda {

// Primitive evaluators — Phase 1: real OCCT B-Rep (BRepPrimAPI_*).
// Validation gate (§41): null-shape + BRepCheck_Analyzer, never a fake mesh.
//(featureId must be a stable UUID, §10.)
bool CreateBoxFeature(const std::string& featureId, double widthMm,
                      double heightMm, double depthMm, std::string* error);
bool CreateCylinderFeature(const std::string& featureId, double radiusMm,
                           double heightMm, std::string* error);
bool CreateSphereFeature(const std::string& featureId, double radiusMm,
                         std::string* error);

#if KREODA_WITH_OCCT
// Split build/commit (§13 preview): build the B-Rep without touching any
// store; commitShape validates + registers + mirrors to live OCAF.
bool BuildBoxShape(double widthMm, double heightMm, double depthMm,
                   TopoDS_Shape* out, std::string* error);
bool BuildCylinderShape(double radiusMm, double heightMm, TopoDS_Shape* out,
                        std::string* error);
bool BuildSphereShape(double radiusMm, TopoDS_Shape* out, std::string* error);
#endif

// Rebuild an existing feature with changed params, same UUID (Phase 2).
// paramName must be a canonical mm parameter for the feature type.
bool RebuildFeature(const std::string& featureId, const std::string& paramName,
                    double valueMm, std::string* error);

// Pure param validation shared by commit + preview paths (no state touched).
bool ResolveParamsForEdit(const ShapeRecord& rec, const std::string& paramName,
                          double valueMm, std::vector<double>* out,
                          std::string* error);

// Single DAG recompute step (§53): rebuild from current store params without
// a revision bump; the outer command registers exactly once.
bool RebuildNodeFromStore(const std::string& featureId, std::string* error);

// Transient preview (§13): resolves + builds + tessellates WITHOUT touching
// any store, revision, or OCAF state. Works in stub mode for boxes.
bool BuildPreviewMesh(const std::string& featureId,
                      const std::string& paramName, double valueMm,
                      CoreMesh* out, std::string* error);

}  // namespace kreoda
