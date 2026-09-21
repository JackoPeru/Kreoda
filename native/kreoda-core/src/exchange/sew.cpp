// Shared mesh→solid sewing for faceted imports (Phase 8 §61).

#include "exchange/sew.h"

#include <algorithm>
#include <cmath>
#include <iomanip>
#include <map>
#include <random>
#include <sstream>

#include "model/commit.h"
#include "model/shapes.h"
#include "model/feature_graph.h"
#include "document/document_store.h"
#include "features/sketch/sketch_store.h"
#include "persistence/ocaf_live.h"

#if KREODA_WITH_OCCT
// NOTE: OCCT includes must stay OUTSIDE namespace kreoda.
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Message.hxx>
#include <Message_Messenger.hxx>
#include <Message_Printer.hxx>
#include <NCollection_Sequence.hxx>
#include <Poly_Triangulation.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <Standard_Failure.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#endif

namespace kreoda {

#if KREODA_WITH_OCCT
namespace {

std::string MintImportId(const std::string& prefix) {
  static thread_local std::mt19937_64 rng{std::random_device{}()};
  for (int attempt = 0; attempt < 64; ++attempt) {
    // Fresh stream per id (no sticky hex/fill flags); 48 random bits.
    std::ostringstream os;
    os << prefix << std::hex << std::setw(12) << std::setfill('0')
       << (rng() & 0xFFFFFFFFFFFFull);
    const std::string id = os.str();
    // The UUID namespace is shared by solids AND sketches (§10): check both
    // before claiming an id, or a later rebuild takes the wrong path.
    if (!ShapeStore::instance().contains(id) &&
        !SketchStore::instance().contains(id)) {
      return id;
    }
  }
  return "";
}

}  // namespace

struct ScopedMute::Impl {
  occ::handle<Message_Messenger> messenger;
  NCollection_Sequence<occ::handle<Message_Printer>> saved;
};

ScopedMute::ScopedMute() : impl_(new Impl()) {
  impl_->messenger = Message::DefaultMessenger();
  if (!impl_->messenger.IsNull()) {
    impl_->saved = impl_->messenger->Printers();
    impl_->messenger->ChangePrinters().Clear();
  }
}

ScopedMute::~ScopedMute() {
  // Restore exactly what was there: drop anything added while muted first
  // (else nested mutes duplicate printers, M8), then re-add the saved set.
  if (!impl_->messenger.IsNull()) {
    impl_->messenger->ChangePrinters().Clear();
    for (const occ::handle<Message_Printer>& p : impl_->saved) {
      impl_->messenger->AddPrinter(p);
    }
  }
  delete impl_;
}

// RAII OCAF transaction (C11): any throw between Begin and Commit aborts
// instead of wedging the session with a half-open command.
class OcafTxn {
 public:
  explicit OcafTxn(std::string* error) {
    open_ = OcafLive::instance().BeginCommand(error);
  }
  ~OcafTxn() {
    if (open_) OcafLive::instance().AbortCommand();
  }
  bool isOpen() const { return open_; }
  void commit() {
    if (open_) {
      bool hadDelta = false;
      OcafLive::instance().CommitCommand(&hadDelta, nullptr);
      open_ = false;
    }
  }

 private:
  bool open_ = false;
};

bool CommitImportedSolids(const std::vector<TopoDS_Shape>& solids,
                          const std::string& type, const std::string& idPrefix,
                          std::vector<std::string>* createdIds,
                          std::string* error) {
  if (!createdIds) {
    if (error) *error = "internal error: null out-param";
    return false;
  }
  if (solids.empty()) {
    if (error) *error = "nothing to import: no solids";
    return false;
  }
  OcafTxn txn(error);
  if (!txn.isOpen()) return false;
  std::vector<std::string> added;
  for (const TopoDS_Shape& solid : solids) {
    const std::string id = MintImportId(idPrefix);
    if (id.empty()) {
      if (error) *error = "could not mint a feature id";
      break;
    }
    try {
      if (!CommitShape(id, type, {}, {}, std::string(), solid, nullptr,
                       false, error)) {
        break;
      }
    } catch (const Standard_Failure& f) {
      if (error) *error = std::string("import commit failed: ") + f.what();
      break;
    }
    added.push_back(id);
  }
  if (added.size() != solids.size()) {
    // Roll every registry back with the OCAF abort (C10): CommitShape puts
    // to ShapeStore BEFORE the OCAF mirror and notes the DocumentStore
    // registry, so an aborted multi-import would otherwise leave phantoms
    // in the store, the registry and the DAG (the UI tree reads the store,
    // but hasFeature/graph queries would lie).
    for (const std::string& id : added) {
      ShapeStore::instance().remove(id);
      TheFeatureGraph().removeFeature(id);
    }
    std::map<std::string, std::string> entries;
    for (const auto& sk : SketchStore::instance().listInOrder()) {
      entries[sk.id] = "Sketch";
    }
    for (const auto& rec : ShapeStore::instance().listInOrder()) {
      entries[rec.featureId] = rec.type;
    }
    DocumentStore::instance().replaceAll(entries);
    createdIds->clear();
    return false;
  }
  txn.commit();
  *createdIds = added;
  return true;
}
bool SewTrianglesToSolids(const std::vector<float>& verts,
                          const std::vector<uint32_t>& indices,
                          std::vector<TopoDS_Shape>* solids,
                          std::string* error) {
  if (verts.size() % 3 != 0 || indices.size() % 3 != 0 || indices.empty()) {
    if (error) *error = "mesh has no triangles";
    return false;
  }
  // DoS bound (C9): per-triangle MakeFace + UnifySameDomain scale badly;
  // refuse honestly instead of hanging past the IPC timeout / OOMing.
  constexpr size_t kMaxTris = 5000000;
  if (indices.size() / 3 > kMaxTris) {
    if (error) {
      *error = "mesh too large (over 5M triangles) — decimate and retry";
    }
    return false;
  }
  // Sewing tolerance from the part size (C8): fixed 1e-6 never stitches at
  // meter scale, and exact-zero degenerate tests misfire on float32 noise.
  double xmin = 1e300, ymin = 1e300, zmin = 1e300;
  double xmax = -1e300, ymax = -1e300, zmax = -1e300;
  for (size_t v = 0; v < verts.size() / 3; ++v) {
    const double x = verts[v * 3], y = verts[v * 3 + 1], z = verts[v * 3 + 2];
    xmin = std::min(xmin, x);
    ymin = std::min(ymin, y);
    zmin = std::min(zmin, z);
    xmax = std::max(xmax, x);
    ymax = std::max(ymax, y);
    zmax = std::max(zmax, z);
  }
  const double dx = xmax - xmin, dy = ymax - ymin, dz = zmax - zmin;
  const double diag = std::sqrt(dx * dx + dy * dy + dz * dz);
  const double tol = std::max(1e-7, diag * 1e-9);
  BRepBuilderAPI_Sewing sewing(tol);
  size_t skipped = 0;
  const size_t n = verts.size() / 3;
  for (size_t t = 0; t < indices.size() / 3; ++t) {
    const uint32_t a = indices[t * 3];
    const uint32_t b = indices[t * 3 + 1];
    const uint32_t c = indices[t * 3 + 2];
    if (a >= n || b >= n || c >= n) {
      if (error) *error = "triangle index out of range";
      return false;
    }
    const gp_Pnt p1(verts[a * 3], verts[a * 3 + 1], verts[a * 3 + 2]);
    const gp_Pnt p2(verts[b * 3], verts[b * 3 + 1], verts[b * 3 + 2]);
    const gp_Pnt p3(verts[c * 3], verts[c * 3 + 1], verts[c * 3 + 2]);
    if (p1.IsEqual(p2, tol) || p2.IsEqual(p3, tol) || p3.IsEqual(p1, tol)) {
      ++skipped;
      continue;
    }
    BRepBuilderAPI_MakePolygon poly(p1, p2, p3, Standard_True);
    if (!poly.IsDone()) {
      ++skipped;
      continue;
    }
    BRepBuilderAPI_MakeFace mk(poly.Wire(), Standard_True);
    if (!mk.IsDone()) {
      ++skipped;
      continue;
    }
    sewing.Add(mk.Face());
  }
  if (skipped == indices.size() / 3) {
    if (error) *error = "all triangles degenerate";
    return false;
  }
  sewing.Perform();
  const TopoDS_Shape sewed = sewing.SewedShape();
  if (sewed.IsNull()) {
    if (error) *error = "sewing produced no shape (open mesh?)";
    return false;
  }
  BRep_Builder builder;
  for (TopExp_Explorer ex(sewed, TopAbs_SHELL); ex.More(); ex.Next()) {
    const TopoDS_Shell shell = TopoDS::Shell(ex.Current());
    if (!BRep_Tool::IsClosed(shell)) continue;
    TopoDS_Solid solid;
    builder.MakeSolid(solid);
    builder.Add(solid, shell);
    if (solid.IsNull()) continue;
    // Sewing keeps per-triangle faces (duplicate roles, seam-split holes).
    // Unify coplanar domains so imports behave like native solids: one face
    // per plane, unique roles, center-hit holes. Unify failure keeps the
    // sewn solid (degraded roles, never a dropped import).
    try {
      ShapeUpgrade_UnifySameDomain unify(solid, true, true, false);
      unify.Build();
      if (!unify.Shape().IsNull())
        solids->push_back(unify.Shape());
      else
        solids->push_back(solid);
    } catch (const Standard_Failure&) {
      solids->push_back(solid);
    }
  }
  if (solids->empty()) {
    if (error) *error = "mesh has no closed solids (open mesh?)";
    return false;
  }
  return true;
}

bool ExtractTriangles(const TopoDS_Shape& shape, std::vector<float>* verts,
                      std::vector<uint32_t>* indices, std::string* error) {
  if (!verts || !indices) {
    if (error) *error = "internal error: null out-param";
    return false;
  }
  uint32_t base = 0;
  for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
    const TopoDS_Face face = TopoDS::Face(ex.Current());
    TopLoc_Location loc;
    const Handle(Poly_Triangulation) tri =
        BRep_Tool::Triangulation(face, loc);
    if (tri.IsNull() || tri->NbTriangles() <= 0) continue;
    const gp_Trsf tr = loc.Transformation();
    for (int i = 1; i <= tri->NbNodes(); ++i) {
      gp_Pnt p = tri->Node(i);
      p.Transform(tr);
      verts->push_back(static_cast<float>(p.X()));
      verts->push_back(static_cast<float>(p.Y()));
      verts->push_back(static_cast<float>(p.Z()));
    }
    for (int i = 1; i <= tri->NbTriangles(); ++i) {
      int a = 0, b = 0, c = 0;
      tri->Triangle(i).Get(a, b, c);
      indices->push_back(base + static_cast<uint32_t>(a - 1));
      indices->push_back(base + static_cast<uint32_t>(b - 1));
      indices->push_back(base + static_cast<uint32_t>(c - 1));
    }
    base += static_cast<uint32_t>(tri->NbNodes());
  }
  if (indices->empty()) {
    if (error) *error = "shape has no triangulation (not a mesh?)";
    return false;
  }
  return true;
}

bool CollectSolidsCompound(TopoDS_Compound* compound, std::string* error) {
  if (!compound) {
    if (error) *error = "internal error: null out-param";
    return false;
  }
  BRep_Builder builder;
  builder.MakeCompound(*compound);
  int solids = 0;
  for (const ShapeRecord& rec : ShapeStore::instance().listInOrder()) {
    if (rec.shape.IsNull()) continue;
    builder.Add(*compound, rec.shape);
    ++solids;
  }
  if (solids == 0) {
    if (error) *error = "nothing to export: the document has no solids";
    return false;
  }
  return true;
}

bool PreMeshExport(TopoDS_Compound* compound, const char* what,
                   std::string* error) {
  if (!compound) {
    if (error) *error = "internal error: null out-param";
    return false;
  }
  BRepMesh_IncrementalMesh mesher(*compound, 0.01, Standard_False, 0.05,
                                  Standard_True);
  if (!mesher.IsDone()) {
    if (error) *error = std::string(what ? what : "mesh") + " meshing failed";
    return false;
  }
  return true;
}
#endif

}  // namespace kreoda
