#include "mesh.h"

#include <cmath>

#include "model/shapes.h"
#include "tessellation/box_tessellator.h"
#if KREODA_WITH_OCCT
#include "topology/face_roles.h"
#include <BRepAdaptor_Curve.hxx>
#include <BRepBndLib.hxx>
#include <BRepGProp.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <GCPnts_UniformDeflection.hxx>
#include <Poly_Triangulation.hxx>
#include <Standard.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#endif

namespace kreoda {

namespace {

#if KREODA_WITH_OCCT
void appendFaceTriangles(CoreMesh& mesh, const TopoDS_Face& face,
                         const std::string& role) {
  TopLoc_Location loc;
  const Handle(Poly_Triangulation)& tri =
      BRep_Tool::Triangulation(face, loc);
  if (tri.IsNull() || tri->NbTriangles() < 1) return;
  const gp_Trsf& trsf = loc.Transformation();
  const uint32_t triStart =
      static_cast<uint32_t>(mesh.indices.size() / 3);
  const int nNodes = tri->NbNodes();
  // Node map may be 1-based; copy via Node(i).
  const uint32_t base =
      static_cast<uint32_t>(mesh.positions.size() / 3);
  for (int i = 1; i <= nNodes; ++i) {
    gp_Pnt p = tri->Node(i);
    p.Transform(trsf);
    mesh.positions.push_back(static_cast<float>(p.X()));
    mesh.positions.push_back(static_cast<float>(p.Y()));
    mesh.positions.push_back(static_cast<float>(p.Z()));
    mesh.normals.insert(mesh.normals.end(), {0.f, 0.f, 0.f});
  }
  for (int i = 1; i <= tri->NbTriangles(); ++i) {
    int a, b, c;
    tri->Triangle(i).Get(a, b, c);
    const uint32_t ia = base + static_cast<uint32_t>(a - 1);
    const uint32_t ib = base + static_cast<uint32_t>(b - 1);
    const uint32_t ic = base + static_cast<uint32_t>(c - 1);
    mesh.indices.insert(mesh.indices.end(), {ia, ib, ic});
    // Flat facet normal (robust everywhere; smooth normals are Phase 2).
    const float ax = mesh.positions[3 * ia], ay = mesh.positions[3 * ia + 1],
                az = mesh.positions[3 * ia + 2];
    const float ux = mesh.positions[3 * ib] - ax,
                uy = mesh.positions[3 * ib + 1] - ay,
                uz = mesh.positions[3 * ib + 2] - az;
    const float vx = mesh.positions[3 * ic] - ax,
                vy = mesh.positions[3 * ic + 1] - ay,
                vz = mesh.positions[3 * ic + 2] - az;
    float nx = uy * vz - uz * vy, ny = uz * vx - ux * vz,
          nz = ux * vy - uy * vx;
    const float len = std::sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-12f) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    // Respect face orientation: reversed faces need flipped normals.
    const float s =
        (face.Orientation() == TopAbs_REVERSED) ? -1.f : 1.f;
    for (uint32_t vi : {ia, ib, ic}) {
      mesh.normals[3 * vi] = s * nx;
      mesh.normals[3 * vi + 1] = s * ny;
      mesh.normals[3 * vi + 2] = s * nz;
    }
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
  if (!ShapeStore::instance().get(featureId, &rec)) {
    if (error) *error = "unknown feature " + featureId;
    return {};
  }
  return TessellateRecord(rec, lod, error);
}

CoreMesh TessellateRecord(const ShapeRecord& rec, int lod,
                          std::string* error) {
  const std::string& featureId = rec.featureId;
#if KREODA_WITH_OCCT
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
  BRepMesh_IncrementalMesh mesher(rec.shape, linDefl, Standard_False,
                                  angDefl, Standard_True);
  if (!mesher.IsDone()) {
    if (error) *error = "tessellation failed";
    return {};
  }
  CoreMesh mesh;
  // Mass props from the tessellated shape itself — never trusted blindly,
  // so transient previews report their own volume/bbox (§13, §41).
  {
    GProp_GProps props;
    BRepGProp::VolumeProperties(rec.shape, props);
    mesh.volumeMm3 = props.Mass();
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

}  // namespace kreoda
