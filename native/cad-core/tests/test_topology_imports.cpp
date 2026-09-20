// Topology on imported solids (Phase 8 §61/§63.11): holes resolve face
// roles on StepImport (exact B-Rep) and MeshImport (sewn + unified) bodies
// exactly like native solids — persistent references, no indices.

#include <gtest/gtest.h>

#include <cmath>
#include <filesystem>
#include <string>
#include <vector>

#include "../src/document/document_store.h"
#include "../src/exchange/step_exchange.h"
#include "../src/exchange/threemf_exchange.h"
#include "../src/features/hole/hole.h"
#include "../src/features/primitives/primitives.h"
#include "../src/model/shapes.h"
#include "../src/topology/face_roles.h"

#if KREODA_WITH_OCCT
#include <BRepAdaptor_Surface.hxx>
#include <BRepBndLib.hxx>
#include <Bnd_Box.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#endif

namespace fs = std::filesystem;

namespace {

// Plate with a centered ⌀8 through-hole: 60000 − π·16·10.
constexpr double kPlateVol = 60000.0;
constexpr double kHoleVol = 16.0 * 3.141592653589793 * 10.0;

bool makePlate(std::string* err) {
  kreoda::DocumentStore::instance().create("topo-import-doc");
  return kreoda::CreateBoxFeature("topo-plate", 100, 60, 10, err);
}

bool holeCenter(const std::string& holeId, const std::string& targetId,
                std::string* err) {
  return kreoda::CreateHoleFeature(holeId, targetId, "box.+Z", 50, 30, 8,
                                      "throughAll", 0, err);
}

#if KREODA_WITH_OCCT
// Face-local center through the ACTUAL face frame (what the UI's centroid
// mapping does): role picks the face, the frame picks the point. Canonical
// (50, 30) only holds for native MakeBox frames.
bool holeAtFaceCenter(const std::string& holeId, const std::string& targetId,
                      const std::string& type, std::string* err) {
  kreoda::ShapeRecord rec;
  if (!kreoda::ShapeStore::instance().get(targetId, &rec)) {
    if (err) *err = "unknown target";
    return false;
  }
  TopoDS_Face face;
  if (!kreoda::FindFaceByRole(rec.shape, targetId, type, "box.+Z",
                                 &face)) {
    if (err) *err = "role not found";
    return false;
  }
  BRepAdaptor_Surface adapt(face);
  const gp_Pln pln = adapt.Plane();
  Bnd_Box fb;
  BRepBndLib::Add(face, fb);
  double x0, y0, z0, x1, y1, z1;
  fb.Get(x0, y0, z0, x1, y1, z1);
  const gp_Pnt c((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const gp_Pnt loc = pln.Location();
  const gp_Dir nx = pln.XAxis().Direction();
  const gp_Dir ny = pln.YAxis().Direction();
  const double x = (c.X() - loc.X()) * nx.X() + (c.Y() - loc.Y()) * nx.Y() +
                   (c.Z() - loc.Z()) * nx.Z();
  const double y = (c.X() - loc.X()) * ny.X() + (c.Y() - loc.Y()) * ny.Y() +
                   (c.Z() - loc.Z()) * ny.Z();
  return kreoda::CreateHoleFeature(holeId, targetId, "box.+Z", x, y, 8,
                                      "throughAll", 0, err);
}

// Role uniqueness: unified imports expose one face per plane (native-like).
int countRole(const std::string& targetId, const std::string& type,
              const std::string& role) {
  kreoda::ShapeRecord rec;
  if (!kreoda::ShapeStore::instance().get(targetId, &rec)) return -1;
  int n = 0;
  for (const std::string& full :
       kreoda::ClassifyFaceRoles(rec.shape, type, targetId)) {
    if (full == targetId + ":" + role) ++n;
  }
  return n;
}
#endif

double volumeOf(const std::string& id) {
  kreoda::ShapeRecord rec;
  if (!kreoda::ShapeStore::instance().get(id, &rec)) return -1.0;
  return rec.volumeMm3;
}

}  // namespace

TEST(TopologyImports, HoleOnStepImportFace) {
  std::string err;
  ASSERT_TRUE(makePlate(&err)) << err;
  const fs::path file =
      fs::temp_directory_path() / "kreoda-topo-hole.step";
  std::error_code ec;
  ASSERT_TRUE(kreoda::ExportStep(file.string(), &err)) << err;
  kreoda::DocumentStore::instance().create("topo-import-doc");
  std::vector<std::string> ids;
  ASSERT_TRUE(kreoda::ImportStep(file.string(), &ids, &err)) << err;
  ASSERT_EQ(ids.size(), 1u);
  ASSERT_TRUE(holeCenter("topo-hole-step", ids[0], &err)) << err;
  EXPECT_NEAR(volumeOf("topo-hole-step"), kPlateVol - kHoleVol, 1.0);
  fs::remove(file, ec);
}

TEST(TopologyImports, HoleOnMeshImportFace) {
  std::string err;
  ASSERT_TRUE(makePlate(&err)) << err;
  const fs::path file =
      fs::temp_directory_path() / "kreoda-topo-hole.3mf";
  std::error_code ec;
  ASSERT_TRUE(kreoda::ExportThreeMF(file.string(), &err)) << err;
  kreoda::DocumentStore::instance().create("topo-import-doc");
  std::vector<std::string> ids;
  ASSERT_TRUE(kreoda::ImportThreeMF(file.string(), &ids, &err)) << err;
  ASSERT_EQ(ids.size(), 1u);
#if KREODA_WITH_OCCT
  // UnifySameDomain merged the sewn triangles: one top face, one role.
  EXPECT_EQ(countRole(ids[0], "MeshImport", "box.+Z"), 1);
  ASSERT_TRUE(holeAtFaceCenter("topo-hole-mesh", ids[0], "MeshImport", &err))
      << err;
#endif
  EXPECT_NEAR(volumeOf("topo-hole-mesh"), kPlateVol - kHoleVol, 2.0);
  fs::remove(file, ec);
}
