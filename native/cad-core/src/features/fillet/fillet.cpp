#include "fillet.h"

#include <cmath>
#include <sstream>

#include "document/document_store.h"
#include "model/commit.h"
#include "model/feature_graph.h"
#include "model/shapes.h"
#include "topology/face_roles.h"
#include "features/sketch/sketch_store.h"

#if KREODA_WITH_OCCT
#include <BRepCheck_Analyzer.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <Standard_Failure.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Shape.hxx>

#include "persistence/ocaf_live.h"
#endif

namespace kreoda {

// Pure codec (no OCCT): available in all configs for previews.
std::vector<std::string> SplitEdgeIds(const std::string& s) {
  std::vector<std::string> out;
  size_t start = 0;
  while (start <= s.size()) {
    const size_t end = s.find(',', start);
    const std::string tok =
        s.substr(start, end == std::string::npos ? end : end - start);
    if (!tok.empty()) out.push_back(tok);
    if (end == std::string::npos) break;
    start = end + 1;
  }
  return out;
}

#if KREODA_WITH_OCCT
namespace {

std::string JoinIds(const std::vector<std::string>& ids) {
  std::ostringstream os;
  for (size_t i = 0; i < ids.size(); ++i) {
    if (i) os << ",";
    os << ids[i];
  }
  return os.str();
}

bool ResolveEdges(const TopoDS_Shape& target, const std::string& targetId,
                  const std::string& targetType,
                  const std::vector<std::string>& edgeIds,
                  std::vector<TopoDS_Edge>* edges, std::string* error) {
  for (const auto& id : edgeIds) {
    // Accept full ids ("uuid:edge…") or bare roles ("edge…").
    std::string role = id;
    const size_t cut = id.find(':');
    if (cut != std::string::npos) {
      const std::string owner = id.substr(0, cut);
      if (owner != targetId) {
        if (error) {
          *error = "edge belongs to another feature (needs repair): " + id;
        }
        return false;
      }
      role = id.substr(cut + 1);
    }
    TopoDS_Edge edge;
    if (!FindEdgeByRole(target, targetId, targetType, role, &edge)) {
      if (error) {
        *error = "edge vanished (needs repair): " + id +
                 " — edit to pick new edges";
      }
      return false;
    }
    edges->push_back(edge);
  }
  return true;
}

}  // namespace (ResolveEdges stays local)

bool BuildFilletShape(const TopoDS_Shape& target, const std::string& targetId,
                      const std::string& targetType,
                      const std::vector<std::string>& edgeIds, double radius,
                      TopoDS_Shape* out, std::string* error) {
  std::vector<TopoDS_Edge> edges;
  if (!ResolveEdges(target, targetId, targetType, edgeIds, &edges, error)) {
    return false;
  }
  try {
    BRepFilletAPI_MakeFillet mk(target);
    for (const auto& e : edges) mk.Add(radius, e);
    mk.Build();
    if (!mk.IsDone()) return false;  // caller maps to safe-range error
    TopoDS_Shape result = mk.Shape();
    if (result.IsNull() || !BRepCheck_Analyzer(result).IsValid(result)) {
      return false;
    }
    *out = result;
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("Fillet: kernel exception: ") + f.what();
    return false;
  }
}

// Binary-search the largest stable radius in (0, requested] (§41).
// Returns true + safeMax when the requested radius fails but a smaller one
// works; false when nothing works (error already set) or no search needed.
static bool FailsafeRadius(const TopoDS_Shape& target, const std::string& targetId,
                    const std::string& targetType,
                    const std::vector<std::string>& edgeIds, double requested,
                    double* safeMax, std::string* error) {
  double lo = 0.0;  // known-good (degenerate, always "works" trivially)
  double hi = requested;
  // First check the floor: a tiny radius must succeed for the range to exist.
  TopoDS_Shape probe;
  std::string dummy;
  if (!BuildFilletShape(target, targetId, targetType, edgeIds, 0.1, &probe,
                        &dummy)) {
    if (error) {
      *error = "Fillet could not be created even at 0.1 mm "
               "(edges may not support filleting)";
    }
    return false;
  }
  lo = 0.1;
  // Bounded probe budget: each probe is a full kernel fillet on the IPC
  // thread (§40 has no cancellation here yet) — 12 probes halve a 40 mm
  // range well below the 0.05 mm reporting granularity.
  for (int i = 0; i < 12; ++i) {  // ~2.4e-4 relative precision
    const double mid = (lo + hi) / 2.0;
    TopoDS_Shape tmp;
    if (BuildFilletShape(target, targetId, targetType, edgeIds, mid, &tmp,
                         &dummy)) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < 0.05) break;  // 0.05 mm reporting granularity
  }
  *safeMax = lo;
  return lo > 0.1;
}

bool BuildChamferShape(const TopoDS_Shape& target, const std::string& targetId,
                       const std::string& targetType,
                       const std::vector<std::string>& edgeIds, double dis,
                       TopoDS_Shape* out, std::string* error) {
  std::vector<TopoDS_Edge> edges;
  if (!ResolveEdges(target, targetId, targetType, edgeIds, &edges, error)) {
    return false;
  }
  try {
    BRepFilletAPI_MakeChamfer mk(target);
    for (const auto& e : edges) mk.Add(dis, e);
    mk.Build();
    if (!mk.IsDone()) {
      if (error) {
        *error = "Chamfer could not be created at " +
                 std::to_string(dis) + " mm (try a smaller distance)";
      }
      return false;
    }
    TopoDS_Shape result = mk.Shape();
    if (result.IsNull() || !BRepCheck_Analyzer(result).IsValid(result)) {
      if (error) *error = "Chamfer: result failed validation";
      return false;
    }
    *out = result;
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("Chamfer: kernel exception: ") + f.what();
    return false;
  }
}

static bool CreateDressUp(const std::string& kind, const std::string& featureId,
                   const std::string& targetId,
                   const std::vector<std::string>& edgeIds, double value,
                   std::string* error) {
  if (featureId.empty() || targetId.empty() || edgeIds.empty()) {
    if (error) *error = "featureId, targetId and edgeIds are required";
    return false;
  }
  if (!ShapeStore::ValidFeatureId(featureId)) {
    if (error) *error = "featureId must match [A-Za-z0-9_-]";
    return false;
  }
  // Edge ids travel inside the comma-joined refExtra codec: delimiters that
  // would corrupt it (| ,) are rejected here (face roles are checked in
  // EncodeHoleRef; generated roles never contain these).
  for (const auto& id : edgeIds) {
    if (id.find('|') != std::string::npos ||
        id.find(',') != std::string::npos) {
      if (error) *error = "invalid edge id characters: " + id;
      return false;
    }
  }
  if (!(value > 0 && value <= 100000)) {
    if (error) *error = "radius/distance must be in (0, 100000] mm";
    return false;
  }
  if (ShapeStore::instance().contains(featureId) ||
      SketchStore::instance().contains(featureId)) {
    if (error) *error = "id already exists: " + featureId;
    return false;
  }
  ShapeRecord target;
  if (!ShapeStore::instance().get(targetId, &target) ||
      target.shape.IsNull()) {
    if (error) *error = "unknown target " + targetId;
    return false;
  }
  TopoDS_Shape shape;
  if (kind == "Fillet") {
    if (!BuildFilletShape(target.shape, targetId, target.type, edgeIds, value,
                          &shape, nullptr)) {
      double safeMax = 0;
      if (FailsafeRadius(target.shape, targetId, target.type, edgeIds, value,
                         &safeMax, nullptr)) {
        if (error) {
          *error = "Fillet could not be created at " +
                   std::to_string(value) +
                   " mm. Maximum stable value appears to be approximately " +
                   std::to_string(safeMax) + " mm.";
        }
      } else {
        if (error) {
          *error = "Fillet could not be created at " +
                   std::to_string(value) + " mm.";
        }
      }
      return false;
    }
  } else {
    if (!BuildChamferShape(target.shape, targetId, target.type, edgeIds,
                           value, &shape, error)) {
      return false;
    }
  }
  if (!OcafLive::instance().BeginCommand(error)) return false;
  const bool ok =
      CommitShape(featureId, kind, {value}, {targetId}, JoinIds(edgeIds),
                  shape, nullptr, true, error);
  if (!ok) {
    OcafLive::instance().AbortCommand();
    return false;
  }
  bool hadDelta = false;
  OcafLive::instance().CommitCommand(&hadDelta, nullptr);
  return true;
}

bool CreateFilletFeature(const std::string& featureId,
                         const std::string& targetId,
                         const std::vector<std::string>& edgeIds,
                         double radiusMm, std::string* error) {
  return CreateDressUp("Fillet", featureId, targetId, edgeIds, radiusMm,
                       error);
}

bool CreateChamferFeature(const std::string& featureId,
                          const std::string& targetId,
                          const std::vector<std::string>& edgeIds,
                          double distanceMm, std::string* error) {
  return CreateDressUp("Chamfer", featureId, targetId, edgeIds, distanceMm,
                       error);
}

bool RebuildFilletFromStore(const std::string& featureId, std::string* error) {
  ShapeRecord rec;
  if (!ShapeStore::instance().get(featureId, &rec)) {
    if (error) *error = "unknown feature " + featureId;
    return false;
  }
  if ((rec.type != "Fillet" && rec.type != "Chamfer") ||
      rec.paramsMm.size() != 1 || rec.dependsOn.size() != 1) {
    if (error) *error = "cannot rebuild " + rec.type;
    return false;
  }
  ShapeRecord target;
  if (!ShapeStore::instance().get(rec.dependsOn[0], &target) ||
      target.shape.IsNull()) {
    if (error) {
      *error = "dress-up target vanished (needs repair): " + rec.dependsOn[0];
    }
    return false;
  }
  const std::vector<std::string> edgeIds = SplitEdgeIds(rec.refExtra);
  TopoDS_Shape shape;
  if (rec.type == "Fillet") {
    if (!BuildFilletShape(target.shape, target.featureId, target.type,
                          edgeIds, rec.paramsMm[0], &shape, error)) {
      return false;
    }
  } else {
    if (!BuildChamferShape(target.shape, target.featureId, target.type,
                           edgeIds, rec.paramsMm[0], &shape, error)) {
      return false;
    }
  }
  return CommitShape(featureId, rec.type, rec.paramsMm, rec.dependsOn,
                     rec.refExtra, shape, nullptr, false, error);
}

bool RebuildChamferFromStore(const std::string& featureId, std::string* error) {
  return RebuildFilletFromStore(featureId, error);  // shared path
}

#else

bool CreateFilletFeature(const std::string&, const std::string&,
                         const std::vector<std::string>&, double,
                         std::string* error) {
  if (error) *error = "fillets require OCCT (link via vcpkg)";
  return false;
}

bool CreateChamferFeature(const std::string&, const std::string&,
                          const std::vector<std::string>&, double,
                          std::string* error) {
  if (error) *error = "chamfers require OCCT (link via vcpkg)";
  return false;
}

bool RebuildFilletFromStore(const std::string&, std::string* error) {
  if (error) *error = "fillets require OCCT (link via vcpkg)";
  return false;
}

bool RebuildChamferFromStore(const std::string&, std::string* error) {
  if (error) *error = "chamfers require OCCT (link via vcpkg)";
  return false;
}

#endif

}  // namespace kreoda
