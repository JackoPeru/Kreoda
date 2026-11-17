// Mesh response cache (Phase 8 large-model slice): identical re-pulls hit
// the cache byte-for-byte; any commit (revision bump) invalidates via the
// revision in the key — never a stale mesh. Mesh successes are FlatBuffers
// MeshUpdate tables (§8), parsed with the generated bindings.

#include <gtest/gtest.h>

#include <string>
#include <vector>
#include <cmath>
#include <algorithm>
#include <cstring>
#include "tessellation/mesh.h"
#include "protocol/mesh_fb.h"
#if KREODA_WITH_OCCT
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepBuilderAPI_GTransform.hxx>
#include <gp_GTrsf.hxx>
#include <gp_Ax1.hxx>
#include <gp_Trsf.hxx>
#include <TopLoc_Location.hxx>
#endif

#include "rpc_text.h"

namespace {

std::string rpc(const std::string& body) {
  return kreoda_test::rpcText(body);
}

bool has(const std::string& r, const std::string& s) {
  return r.find(s) != std::string::npos;
}

}  // namespace

#if KREODA_WITH_OCCT
TEST(MeshCurvature, SphereUsesAnalyticInverseRadiusAfterScalePlacementAndReversal) {
  for(const bool reversed:{false,true}) {
    gp_Trsf scale;scale.SetScale(gp_Pnt(0,0,0),3);
    gp_Trsf placement;placement.SetTranslation(gp_Vec(17,-23,31));
    kreoda::ShapeRecord record;record.featureId="curvature-sphere";record.type="Sphere";
    record.shape=BRepBuilderAPI_Transform(BRepPrimAPI_MakeSphere(20).Shape(),scale,true).Shape()
      .Moved(TopLoc_Location(placement));
    if(reversed)record.shape.Reverse();
    const auto original=record.shape;
    std::string error;const auto mesh=kreoda::TessellateRecord(record,1,&error);
    ASSERT_TRUE(error.empty())<<error;
    ASSERT_GT(mesh.positions.size(),0u);
    ASSERT_EQ(mesh.curvatureMaxAbsPerMm.size(),mesh.positions.size()/3);
    size_t defined=0;
    for(const auto value:mesh.curvatureMaxAbsPerMm) {
      ASSERT_TRUE(std::isfinite(value));
      if(value==-1)continue;
      ++defined;EXPECT_NEAR(value,1.0/60,1e-7);
    }
    EXPECT_GT(defined,mesh.curvatureMaxAbsPerMm.size()*0.95);
    EXPECT_TRUE(record.shape.IsSame(original));
  }
}

TEST(MeshCurvature, CylinderSeparatesCurvedWallFromPlanarCapsAtSharedSharpEdges) {
  kreoda::ShapeRecord record;record.featureId="curvature-cylinder";record.type="Cylinder";
  record.shape=BRepPrimAPI_MakeCylinder(10,20).Shape();
  std::string error;const auto mesh=kreoda::TessellateRecord(record,1,&error);
  ASSERT_TRUE(error.empty())<<error;
  ASSERT_GT(mesh.positions.size(),0u);
  ASSERT_EQ(mesh.curvatureMaxAbsPerMm.size(),mesh.positions.size()/3);
  size_t planar=0,curved=0;
  for(size_t vertex=0;vertex<mesh.curvatureMaxAbsPerMm.size();++vertex) {
    const auto value=mesh.curvatureMaxAbsPerMm[vertex];
    ASSERT_TRUE(std::isfinite(value));
    if(std::abs(mesh.normals[vertex*3+2])>.5) {++planar;EXPECT_NEAR(value,0,1e-8);}
    else {++curved;EXPECT_NEAR(value,.1,1e-7);}
  }
  EXPECT_GT(planar,0u);EXPECT_GT(curved,0u);
}

TEST(MeshCurvature, NonuniformEllipsoidMatchesAnalyticPrincipalCurvatureAtNativeUvSamples) {
  gp_GTrsf stretch;stretch.SetValue(1,1,2);stretch.SetValue(2,2,1);stretch.SetValue(3,3,.5);
  kreoda::ShapeRecord record;record.featureId="curvature-ellipsoid";record.type="Imported";
  record.shape=BRepBuilderAPI_GTransform(BRepPrimAPI_MakeSphere(20).Shape(),stretch,true).Shape();
  std::string error;const auto mesh=kreoda::TessellateRecord(record,1,&error);
  ASSERT_TRUE(error.empty())<<error;
  ASSERT_GT(mesh.positions.size(),0u);
  ASSERT_EQ(mesh.curvatureMaxAbsPerMm.size(),mesh.positions.size()/3);
  size_t known=0;double minimum=1,maximum=0;
  for(size_t vertex=0;vertex<mesh.curvatureMaxAbsPerMm.size();++vertex) {
    const auto actual=mesh.curvatureMaxAbsPerMm[vertex];
    if(actual==-1)continue;
    ++known;minimum=std::min(minimum,double(actual));maximum=std::max(maximum,double(actual));
    const gp_Vec gradient(mesh.positions[vertex*3]/1600.,mesh.positions[vertex*3+1]/400.,mesh.positions[vertex*3+2]/100.);
    const auto normal=gradient.Normalized();
    auto t1=normal.Crossed(std::abs(normal.Z())<.9?gp_Vec(0,0,1):gp_Vec(1,0,0));t1.Normalize();
    const auto t2=normal.Crossed(t1);
    auto second=[&](const gp_Vec& a,const gp_Vec& b) {
      return (a.X()*b.X()/1600.+a.Y()*b.Y()/400.+a.Z()*b.Z()/100.)/gradient.Magnitude();
    };
    const double a=second(t1,t1),b=second(t1,t2),c=second(t2,t2);
    const double expected=(a+c+std::sqrt((a-c)*(a-c)+4*b*b))*.5;
    EXPECT_NEAR(actual,expected,2e-5)<<"native ellipsoid curvature at vertex "<<vertex;
  }
  EXPECT_GT(known,mesh.curvatureMaxAbsPerMm.size()*.95);
  EXPECT_LT(minimum,.04);EXPECT_GT(maximum,.35);
}

#if KREODA_WITH_FLATBUFFERS
TEST(MeshCurvature, NativeWireRetainsThePerVertexFieldAndRevision) {
  kreoda::ShapeRecord record;record.featureId="curvature-wire";record.type="Sphere";
  record.shape=BRepPrimAPI_MakeSphere(20).Shape();
  std::string error;const auto mesh=kreoda::TessellateRecord(record,1,&error);
  ASSERT_TRUE(error.empty())<<error;
  const auto raw=kreoda::BuildMeshUpdateFb(record.featureId,1,mesh,42,"curvature-request",&error);
  ASSERT_FALSE(raw.empty())<<error;
  const auto* update=kreoda_test::meshRoot(raw);
  ASSERT_NE(update,nullptr);
  ASSERT_NE(update->curvature_max_abs_per_mm(),nullptr);
  ASSERT_EQ(update->curvature_max_abs_per_mm()->size(),mesh.positions.size()/3*sizeof(float));
  for(size_t vertex=0;vertex<mesh.positions.size()/3;++vertex) {
    float sample;std::memcpy(&sample,update->curvature_max_abs_per_mm()->Data()+vertex*sizeof(float),sizeof(float));
    EXPECT_NEAR(sample,.05,1e-7);
  }
  EXPECT_EQ(update->revision(),42);
}
#endif

TEST(MeshNormals, SphereNormalsFollowSurfaceAtSeamsPolesAndAfterPlacement) {
  for (const bool reversed : {false, true}) {
    gp_Trsf placement;
    placement.SetRotation(gp_Ax1(gp_Pnt(0,0,0),gp_Dir(1,1,0)),0.7);
    placement.SetTranslationPart(gp_Vec(17,-23,31));
    kreoda::ShapeRecord record;
    record.featureId="normals-sphere";
    record.type="Sphere";
    record.shape=BRepPrimAPI_MakeSphere(20).Shape().Moved(TopLoc_Location(placement));
    if(reversed)record.shape.Reverse();
    std::string error;
    const auto mesh=kreoda::TessellateRecord(record,0,&error);
    ASSERT_TRUE(error.empty())<<error;
    ASSERT_GT(mesh.indices.size(),0u);
    ASSERT_EQ(mesh.normals.size(),mesh.positions.size());
    double worst=1;
    for(size_t i=0;i<mesh.positions.size();i+=3) {
      gp_Vec radial(mesh.positions[i]-17,mesh.positions[i+1]+23,mesh.positions[i+2]-31);
      radial.Normalize();
      const gp_Vec normal(mesh.normals[i],mesh.normals[i+1],mesh.normals[i+2]);
      EXPECT_NEAR(normal.Magnitude(),1,1e-6);
      worst=std::min(worst,radial.Dot(normal)*(reversed?-1:1));
    }
    EXPECT_GT(worst,0.999999)<<"Last-triangle normals must not replace surface normals";
  }
}

TEST(MeshNormals, CylinderKeepsSideNormalsAndSharpPlanarCapsSeparate) {
  kreoda::ShapeRecord record;
  record.featureId="normals-cylinder";
  record.type="Cylinder";
  record.shape=BRepPrimAPI_MakeCylinder(10,20).Shape();
  std::string error;
  const auto mesh=kreoda::TessellateRecord(record,1,&error);
  ASSERT_TRUE(error.empty())<<error;
  ASSERT_GT(mesh.indices.size(),0u);
  double worst=1;
  for(size_t i=0;i<mesh.positions.size();i+=3) {
    const double x=mesh.positions[i],y=mesh.positions[i+1],r=std::hypot(x,y);
    const double nx=mesh.normals[i],ny=mesh.normals[i+1],nz=mesh.normals[i+2];
    EXPECT_NEAR(std::sqrt(nx*nx+ny*ny+nz*nz),1,1e-6);
    if(std::abs(nz)>0.5)worst=std::min(worst,std::abs(nz));
    else {ASSERT_GT(r,0);worst=std::min(worst,(nx*x+ny*y)/r);EXPECT_NEAR(nz,0,1e-6);}
  }
  EXPECT_GT(worst,0.999999);
}
#endif

TEST(MeshCache, HitIsIdenticalAndCommitInvalidates) {
#ifdef KREODA_WITH_FLATBUFFERS
  ASSERT_TRUE(has(rpc("{\"protocolVersion\":1,\"requestId\":\"m1\","
                      "\"documentId\":\"mcache-doc\",\"type\":2}"),
                  "\"status\":\"ok\""));
  ASSERT_TRUE(has(rpc("{\"protocolVersion\":1,\"requestId\":\"m2\","
                      "\"documentId\":\"mcache-doc\",\"type\":3,"
                      "\"featureId\":\"mcache-box\",\"widthMm\":100,"
                      "\"heightMm\":50,\"depthMm\":20}"),
                  "\"status\":\"ok\""));
  const std::vector<uint8_t> mesh1 = kreoda::handle_command(
      "{\"protocolVersion\":1,\"requestId\":\"m3\","
      "\"documentId\":\"mcache-doc\",\"type\":12,"
      "\"featureId\":\"mcache-box\",\"lod\":1}");
  const auto* u1 = kreoda_test::meshRoot(mesh1);
  ASSERT_NE(u1, nullptr);
  EXPECT_NEAR(u1->volume_mm3(), 100000.0, 0.5);
  EXPECT_EQ(u1->indices_count() / 3, 12u);
  ASSERT_NE(u1->request_id(), nullptr);
  EXPECT_EQ(u1->request_id()->str(), "m3");
  // Second identical pull: cache hit (tessellation skipped), fresh encoding
  // with THIS request's id for sidecar correlation (C15) — so field-wise
  // equality, not byte equality.
  const std::vector<uint8_t> mesh2 = kreoda::handle_command(
      "{\"protocolVersion\":1,\"requestId\":\"m4\","
      "\"documentId\":\"mcache-doc\",\"type\":12,"
      "\"featureId\":\"mcache-box\",\"lod\":1}");
  const auto* u2 = kreoda_test::meshRoot(mesh2);
  ASSERT_NE(u2, nullptr);
  EXPECT_NEAR(u2->volume_mm3(), u1->volume_mm3(), 1e-9);
  EXPECT_EQ(u2->indices_count(), u1->indices_count());
  EXPECT_EQ(u2->positions_count(), u1->positions_count());
  ASSERT_NE(u2->request_id(), nullptr);
  EXPECT_EQ(u2->request_id()->str(), "m4");
  // Commit bumps the revision: the next pull must reflect new geometry.
  ASSERT_TRUE(has(rpc("{\"protocolVersion\":1,\"requestId\":\"m5\","
                      "\"documentId\":\"mcache-doc\",\"type\":6,"
                      "\"featureId\":\"mcache-box\",\"paramName\":\"widthMm\","
                      "\"valueMm\":200}"),
                  "\"status\":\"ok\""));
  const std::vector<uint8_t> mesh3 = kreoda::handle_command(
      "{\"protocolVersion\":1,\"requestId\":\"m6\","
      "\"documentId\":\"mcache-doc\",\"type\":12,"
      "\"featureId\":\"mcache-box\",\"lod\":1}");
  const auto* u3 = kreoda_test::meshRoot(mesh3);
  ASSERT_NE(u3, nullptr);
  EXPECT_NEAR(u3->volume_mm3(), 200000.0, 0.5);
#else
  GTEST_SKIP() << "mesh binary needs flatbuffers";
#endif
}

TEST(MeshCache, Phase12LodAndTriangleFaceRangesAreValid) {
#ifdef KREODA_WITH_FLATBUFFERS
  ASSERT_TRUE(has(rpc(R"({"protocolVersion":1,"requestId":"p12-new","documentId":"p12-mesh","type":2})"),"\"status\":\"ok\""));
  ASSERT_TRUE(has(rpc(R"({"protocolVersion":1,"requestId":"p12-box","documentId":"p12-mesh","type":3,"featureId":"p12-solid","widthMm":20,"heightMm":30,"depthMm":40})"),"\"status\":\"ok\""));
  for(const auto& invalid:{R"("1")",R"(1.5)",R"(-1)",R"(3)"}) {
    const auto req=std::string(R"({"protocolVersion":1,"requestId":"bad-lod","documentId":"p12-mesh","type":12,"featureId":"p12-solid","lod":)")+invalid+"}";
    EXPECT_TRUE(has(rpc(req),"BAD_PARAMS"))<<req;
  }
  for(int lod=0;lod<=2;++lod) {
    const auto req=std::string(R"({"protocolVersion":1,"requestId":"p12-lod","documentId":"p12-mesh","type":12,"featureId":"p12-solid","lod":)")+std::to_string(lod)+"}";
    const auto bytes=kreoda_test::rpcBytes(req);
    const auto* mesh=kreoda_test::meshRoot(bytes);
    ASSERT_NE(mesh,nullptr);
    EXPECT_EQ(mesh->lod(),lod);
    ASSERT_NE(mesh->faces(),nullptr);
    ASSERT_NE(mesh->edges(),nullptr);
    EXPECT_EQ(mesh->faces()->size(),6u);
    EXPECT_EQ(mesh->indices_count()%3,0u);
    uint32_t next=0;
    for(const auto* face:*mesh->faces()) {
      ASSERT_NE(face->persistent_face_id(),nullptr);
      EXPECT_EQ(face->triangle_start(),next);
      EXPECT_GT(face->triangle_count(),0u);
      EXPECT_NE(face->persistent_face_id()->str().find("p12-solid:"),std::string::npos);
      next+=face->triangle_count();
    }
    EXPECT_EQ(next,mesh->indices_count()/3);
    for(const auto* edge:*mesh->edges()) {
      ASSERT_NE(edge->persistent_edge_id(),nullptr);
      EXPECT_GT(edge->vertex_count(),1u);
    }
  }
#else
  GTEST_SKIP()<<"FlatBuffers unavailable";
#endif
}
