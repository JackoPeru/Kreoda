#include "mesh.h"
#include "mesh_parameters.h"
#include "diagnostics/crash_barrier.h"
#include "model/geometry_availability.h"

#include <cmath>
#include <limits>
#include <optional>

#include "model/shapes.h"
#include "tessellation/box_tessellator.h"
#if KREODA_WITH_OCCT
#include "topology/face_roles.h"
#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepLProp_SLProps.hxx>
#include <BRepBndLib.hxx>
#include <BRepGProp.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepLib_ToolTriangulatedShape.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <GCPnts_UniformDeflection.hxx>
#include <Poly_Triangulation.hxx>
#include <Precision.hxx>
#include <Standard.hxx>
#include <Standard_Failure.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <gp_Pnt.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Sphere.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#if KREODA_CRASH_TEST_BARRIERS
#include <Message_ProgressIndicator.hxx>
#endif
#endif

namespace kreoda {

namespace {

#if KREODA_WITH_OCCT
#if KREODA_CRASH_TEST_BARRIERS
// OCCT calls Show inside Perform. Ignore the initial/final notifications so
// the barrier proves a live mesher call with partial progress.
class CrashMeshProgress final : public Message_ProgressIndicator {
  void Show(const Message_ProgressScope&, const bool) override {
    if (GetPosition() > 0.0 && GetPosition() < 1.0) {
      CrashTestBarrier("tessellation-inside-mesher");
    }
  }
};
#endif

void appendFaceTriangles(CoreMesh& mesh, const TopoDS_Face& face,
                         const std::string& role) {
  TopLoc_Location loc;
  const Handle(Poly_Triangulation)& tri =
      BRep_Tool::Triangulation(face, loc);
  if (tri.IsNull() || tri->NbTriangles() < 1) return;
  // Use surface/UV normals, including OCCT's singular-node fallback. Assigning
  // each incident triangle's normal to shared nodes made smooth faces jagged.
  BRepLib_ToolTriangulatedShape::ComputeNormals(face, tri);
  const gp_Trsf& trsf = loc.Transformation();
  const uint32_t triStart =
      static_cast<uint32_t>(mesh.indices.size() / 3);
  const int nNodes = tri->NbNodes();
  // Sample the authoritative B-Rep at the SAME UV nodes as this face mesh.
  // Constant analytic surfaces avoid derivatives at singular sphere poles.
  float constantCurvature = -1;
  std::optional<BRepLProp_SLProps> curvature;
  try {
    BRepAdaptor_Surface surface(face);
    double value = -1;
    if (surface.GetType() == GeomAbs_Plane) value = 0;
    else if (surface.GetType() == GeomAbs_Cylinder) value = 1 / surface.Cylinder().Radius();
    else if (surface.GetType() == GeomAbs_Sphere) value = 1 / surface.Sphere().Radius();
    else if (tri->HasUVNodes()) curvature.emplace(surface, 2, Precision::Confusion());
    if (std::isfinite(value) && value >= 0 && value <= std::numeric_limits<float>::max())
      constantCurvature = static_cast<float>(value);
  } catch (const Standard_Failure&) { /* Undefined analysis must not invalidate valid geometry. */ }
  // Node map may be 1-based; copy via Node(i).
  const uint32_t base =
      static_cast<uint32_t>(mesh.positions.size() / 3);
  for (int i = 1; i <= nNodes; ++i) {
    gp_Pnt p = tri->Node(i);
    p.Transform(trsf);
    mesh.positions.push_back(static_cast<float>(p.X()));
    mesh.positions.push_back(static_cast<float>(p.Y()));
    mesh.positions.push_back(static_cast<float>(p.Z()));
    gp_Dir normal = tri->Normal(i);
    normal.Transform(trsf);
    if (face.Orientation() == TopAbs_REVERSED) normal.Reverse();
    mesh.normals.insert(mesh.normals.end(), {static_cast<float>(normal.X()),
      static_cast<float>(normal.Y()), static_cast<float>(normal.Z())});
    float value = constantCurvature;
    if (curvature) {
      try {
        const auto uv = tri->UVNode(i);
        curvature->SetParameters(uv.X(), uv.Y());
        if (curvature->IsCurvatureDefined()) {
          const double magnitude = std::max(std::abs(curvature->MinCurvature()),
                                           std::abs(curvature->MaxCurvature()));
          if (std::isfinite(magnitude) && magnitude <= std::numeric_limits<float>::max())
            value = static_cast<float>(magnitude);
        }
      } catch (const Standard_Failure&) { value = -1; }
    }
    mesh.curvatureMaxAbsPerMm.push_back(value);
  }
  for (int i = 1; i <= tri->NbTriangles(); ++i) {
    int a, b, c;
    tri->Triangle(i).Get(a, b, c);
    const uint32_t ia = base + static_cast<uint32_t>(a - 1);
    const uint32_t ib = base + static_cast<uint32_t>(b - 1);
    const uint32_t ic = base + static_cast<uint32_t>(c - 1);
    mesh.indices.insert(mesh.indices.end(), {ia, ib, ic});
  }
  FaceRangeDto range;
  range.persistentFaceId = role;
  range.triangleStart = triStart;
  range.triangleCount =
      static_cast<uint32_t>(mesh.indices.size() / 3 - triStart);
  if (range.triangleCount > 0) mesh.faces.push_back(std::move(range));
}
#endif

}  // namespace

CoreMesh TessellateFeature(const std::string& featureId, int lod,
                           std::string* error) {
  ShapeRecord rec;
  if (!GetCurrentShapeRecord(featureId, &rec, error)) {
    return {};
  }
  return TessellateRecord(rec, lod, error);
}

static CoreMesh TessellateRecordImpl(const ShapeRecord& rec, int lod,
                                     std::string* error,
                                     bool validateCurrent) {
  const std::string& featureId = rec.featureId;
#if KREODA_WITH_OCCT
  if (validateCurrent && ShapeStore::instance().contains(rec.featureId)) {
    ShapeRecord current;
    if (!GetCurrentShapeRecord(rec.featureId, &current, error)) return {};
    if (!current.shape.IsSame(rec.shape)) {
      if (error) *error = "stale native record geometry for " + rec.featureId;
      return {};
    }
  } else if (validateCurrent) {
    for (const auto& dependency : rec.dependsOn) {
      if (!EnsureGeometryAvailable(dependency, error)) return {};
    }
  }
  if (rec.shape.IsNull()) {
    if (error) *error = "feature has no B-Rep shape";
    return {};
  }
  // LOD policy (§14): coarse / interactive / export deflection.
  double linDefl = 0.05, angDefl = 0.2;
  if (lod <= 0) {
    linDefl = 0.5;
    angDefl = 0.5;
  } else if (lod >= 2) {
    linDefl = 0.01;
    angDefl = 0.05;
  }
#if KREODA_CRASH_TEST_BARRIERS
  Handle(Message_ProgressIndicator) progress = new CrashMeshProgress();
  BRepMesh_IncrementalMesh mesher(rec.shape, OcctMeshingParameters(linDefl, angDefl), progress->Start());
#else
  BRepMesh_IncrementalMesh mesher(rec.shape, OcctMeshingParameters(linDefl, angDefl));
#endif
  if (!mesher.IsDone()) {
    if (error) *error = "tessellation failed";
    return {};
  }
  CrashTestBarrier("tessellation-before-extraction");
  CoreMesh mesh;
  // Mass props from the tessellated shape itself — never trusted blindly,
  // so transient previews report their own volume/bbox (§13, §41).
  {
    // Only physical solids contribute volume. A closed B-Rep face (for
    // example a full-revolution cylinder side) can have a nonzero signed
    // volume integral even though it encloses no solid in the model.
    const auto addSolidVolume = [&](const TopoDS_Shape& solid) {
      GProp_GProps props;
      BRepGProp::VolumeProperties(solid, props);
      mesh.volumeMm3 += props.Mass();
    };
    if (rec.shape.ShapeType() == TopAbs_SOLID) {
      addSolidVolume(rec.shape);
    } else {
      for (TopExp_Explorer solid(rec.shape, TopAbs_SOLID); solid.More();
           solid.Next()) {
        addSolidVolume(solid.Current());
      }
    }
    Bnd_Box box;
    BRepBndLib::Add(rec.shape, box);
    box.Get(mesh.bboxMm[0], mesh.bboxMm[1], mesh.bboxMm[2], mesh.bboxMm[3],
            mesh.bboxMm[4], mesh.bboxMm[5]);
  }
  const std::vector<std::string> roles =
      ClassifyFaceRoles(rec.shape, rec.type, featureId);
  size_t fi = 0;
  for (TopExp_Explorer ex(rec.shape, TopAbs_FACE); ex.More();
       ex.Next(), ++fi) {
    const std::string role =
        (fi < roles.size()) ? roles[fi] : (featureId + ":face.extra");
    appendFaceTriangles(mesh, TopoDS::Face(ex.Current()), role);
  }
  if (mesh.indices.empty() && error) *error = "empty tessellation";
  // Edge overlay polylines (§16): discretized with the LOD deflection so the
  // viewport draws CAD edges without any three.js-side geometry synthesis.
  for (const auto& er : ClassifyEdgeRoles(rec.shape, rec.type, featureId)) {
    BRepAdaptor_Curve adapt(er.edge);
    const double first = adapt.FirstParameter();
    const double last = adapt.LastParameter();
    if (!(last > first)) continue;
    GCPnts_UniformDeflection disc(adapt, linDefl, first, last);
    if (!disc.IsDone() || disc.NbPoints() < 2) continue;
    const TopLoc_Location loc = er.edge.Location();
    const gp_Trsf& trsf = loc.Transformation();
    EdgeRangeDto range;
    range.persistentEdgeId = er.persistentEdgeId;
    range.vertexStart = static_cast<uint32_t>(mesh.edgeVertices.size() / 3);
    for (int i = 1; i <= disc.NbPoints(); ++i) {
      gp_Pnt p = disc.Value(i);
      p.Transform(trsf);
      mesh.edgeVertices.push_back(static_cast<float>(p.X()));
      mesh.edgeVertices.push_back(static_cast<float>(p.Y()));
      mesh.edgeVertices.push_back(static_cast<float>(p.Z()));
    }
    range.vertexCount = static_cast<uint32_t>(mesh.edgeVertices.size() / 3 -
                                              range.vertexStart);
    mesh.edges.push_back(std::move(range));
  }
  return mesh;
#else
  // Stub: exact box only (cylinder/sphere need OCCT).
  (void)lod;
  (void)validateCurrent;
  if (rec.type != "Box" || rec.paramsMm.size() != 3) {
    if (error) *error = "stub core tessellates Box only (link OCCT)";
    return {};
  }
  const BoxMesh box =
      TessellateBoxExact(rec.paramsMm[0], rec.paramsMm[1], rec.paramsMm[2]);
  CoreMesh mesh;
  mesh.positions = box.positions;
  mesh.normals = box.normals;
  mesh.indices = box.indices;
  mesh.volumeMm3 = box.volumeMm3;
  for (int i = 0; i < 6; ++i) mesh.bboxMm[i] = rec.bboxMm[i];
  for (const auto& f : box.faces) {
    FaceRangeDto r;
    r.persistentFaceId = featureId + ":" + f.persistentFaceId;
    r.triangleStart = f.triangleStart;
    r.triangleCount = f.triangleCount;
    mesh.faces.push_back(std::move(r));
  }
  return mesh;
#endif
}

CoreMesh TessellateRecord(const ShapeRecord& rec, int lod,
                          std::string* error) {
  return TessellateRecordImpl(rec, lod, error, true);
}

// Internal preview geometry is intentionally a candidate shape with the
// owner's existing featureId. The live direct-record API keeps its stale
// geometry guard; previews validate their dependency chain before calling here.
CoreMesh TessellatePreviewRecord(const ShapeRecord& rec, int lod,
                                std::string* error) {
  return TessellateRecordImpl(rec, lod, error, false);
}

}  // namespace kreoda
