#include "features/direct/face_history.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <map>
#include <set>
#include <sstream>
#include <vector>

#include "document/document_store.h"
#include "features/datum/datum_store.h"
#include "model/body.h"
#include "model/commit.h"
#include "model/geometry_availability.h"
#include "model/model_snapshot.h"
#include "model/shapes.h"
#include "persistence/ocaf_live.h"
#include "topology/face_roles.h"

#if KREODA_WITH_OCCT
#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Defeaturing.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepOffset_MakeOffset.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeHalfSpace.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <Precision.hxx>
#include <Standard_Failure.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <NCollection_IndexedMap.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax1.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#endif

namespace kreoda {
namespace {
using Json = nlohmann::json;

enum class Operation { Move, Offset, Delete, Replace };

struct FaceRef {
  std::string owner;
  std::string role;
};

struct ParsedRequest {
  std::string featureId;
  FaceRef source;
  FaceRef replacement;
  std::uint64_t captureRevision = 0;
  std::array<double, 3> translation{};
  std::array<double, 3> rotationDeg{};
  std::array<double, 3> pivot{};
  double distanceMm = 0;
};

bool Fail(std::string* error, const std::string& message) {
  if (error) *error = message;
  return false;
}

bool HasOnlyKeys(const Json& value, const std::set<std::string>& allowed,
                 const std::string& label, std::string* error) {
  if (!value.is_object()) return Fail(error, label + " must be an object");
  for (const auto& field : value.items()) {
    if (!allowed.count(field.key()))
      return Fail(error, label + " contains unsupported field " + field.key());
  }
  return true;
}

bool ReadString(const Json& object, const char* key, std::string* out,
                std::string* error) {
  if (!object.contains(key) || !object.at(key).is_string())
    return Fail(error, std::string(key) + " must be a string");
  *out = object.at(key).get<std::string>();
  return true;
}

bool NormalizePublicRole(const std::string& owner, std::string* role,
                         std::string* error) {
  if (owner.empty() || role->empty() || role->size() > 512 ||
      role->find('|') != std::string::npos)
    return Fail(error, "persistentFaceId must be a non-empty face role");
  const std::string prefix = owner + ":";
  if (role->rfind(prefix, 0) == 0) {
    role->erase(0, prefix.size());
    if (role->empty() || role->find(':') != std::string::npos)
      return Fail(error, "persistentFaceId has an invalid owner-qualified role");
    return true;
  }
  if (role->find(':') != std::string::npos)
    return Fail(error, "persistentFaceId belongs to another feature");
  return true;
}

bool ParseFaceRef(const Json& value, const std::string& expectedOwner,
                  FaceRef* out, std::string* error) {
  static const std::set<std::string> keys = {
      "type", "featureId", "persistentFaceId"};
  if (!HasOnlyKeys(value, keys, "face reference", error) || value.size() != keys.size())
    return error && !error->empty() ? false
                                    : Fail(error, "face reference is incomplete");
  if (!value.contains("type") || !value.at("type").is_string() ||
      value.at("type").get<std::string>() != "face")
    return Fail(error, "face reference type must be face");
  if (!ReadString(value, "featureId", &out->owner, error) ||
      !ReadString(value, "persistentFaceId", &out->role, error))
    return false;
  if (!ShapeStore::ValidFeatureId(out->owner))
    return Fail(error, "face reference featureId is invalid");
  if (!expectedOwner.empty() && out->owner != expectedOwner)
    return Fail(error, "face reference owner must match its source feature");
  return NormalizePublicRole(out->owner, &out->role, error);
}

bool ParseRevision(const Json& request, std::uint64_t* out,
                   std::string* error) {
  if (!request.contains("captureRevision") ||
      (!request.at("captureRevision").is_number_integer() &&
       !request.at("captureRevision").is_number_unsigned()))
    return Fail(error, "captureRevision must be a non-negative safe integer");
  std::uint64_t revision = 0;
  if (request.at("captureRevision").is_number_unsigned()) {
    revision = request.at("captureRevision").get<std::uint64_t>();
  } else {
    const auto signedRevision = request.at("captureRevision").get<std::int64_t>();
    if (signedRevision < 0)
      return Fail(error, "captureRevision must be a non-negative safe integer");
    revision = static_cast<std::uint64_t>(signedRevision);
  }
  constexpr std::uint64_t kMaxSafeInteger = 9007199254740991ULL;
  if (revision > kMaxSafeInteger)
    return Fail(error, "captureRevision exceeds the safe integer range");
  *out = revision;
  return true;
}

bool ParseVector(const Json& request, const char* key,
                 std::array<double, 3>* out, std::string* error) {
  if (!request.contains(key) || !request.at(key).is_object())
    return Fail(error, std::string(key) + " must be an {x,y,z} object");
  const auto& value = request.at(key);
  static const std::set<std::string> keys = {"x", "y", "z"};
  if (!HasOnlyKeys(value, keys, key, error) || value.size() != keys.size())
    return error && !error->empty() ? false
                                    : Fail(error, std::string(key) + " needs x, y and z");
  const char* names[] = {"x", "y", "z"};
  for (std::size_t i = 0; i < 3; ++i) {
    if (!value.at(names[i]).is_number())
      return Fail(error, std::string(key) + " coordinates must be finite numbers");
    (*out)[i] = value.at(names[i]).get<double>();
    if (!std::isfinite((*out)[i]))
      return Fail(error, std::string(key) + " coordinates must be finite numbers");
  }
  return true;
}

bool ParseRequest(const Json& request, Operation operation,
                  ParsedRequest* out, std::string* error) {
  std::set<std::string> allowed = {
      "protocolVersion", "requestId", "documentId", "type", "transactionId",
      "featureId", "sourceFeatureId", "sourceFace", "captureRevision"};
  if (operation == Operation::Move) {
    allowed.insert("translationMm");
    allowed.insert("rotationDeg");
    allowed.insert("pivotMm");
  } else if (operation == Operation::Offset) {
    allowed.insert("distanceMm");
  } else if (operation == Operation::Replace) {
    allowed.insert("replacementFace");
  }
  if (!HasOnlyKeys(request, allowed, "face-history command", error)) return false;
  std::string sourceOwner;
  if (!ReadString(request, "featureId", &out->featureId, error) ||
      !ReadString(request, "sourceFeatureId", &sourceOwner, error))
    return false;
  if (!ShapeStore::ValidFeatureId(out->featureId) ||
      !ShapeStore::ValidFeatureId(sourceOwner))
    return Fail(error, "featureId and sourceFeatureId must be valid feature ids");
  if (!request.contains("sourceFace") ||
      !ParseFaceRef(request.at("sourceFace"), sourceOwner,
                    &out->source, error))
    return false;
  if (!ParseRevision(request, &out->captureRevision, error)) return false;
  if (out->captureRevision != static_cast<std::uint64_t>(
                                 DocumentStore::instance().snapshotRevision()))
    return Fail(error, "captureRevision does not match the current document revision");

  if (operation == Operation::Move) {
    if (!ParseVector(request, "translationMm", &out->translation, error) ||
        !ParseVector(request, "rotationDeg", &out->rotationDeg, error) ||
        !ParseVector(request, "pivotMm", &out->pivot, error))
      return false;
  } else if (operation == Operation::Offset) {
    if (!request.contains("distanceMm") || !request.at("distanceMm").is_number())
      return Fail(error, "distanceMm must be a finite nonzero number");
    out->distanceMm = request.at("distanceMm").get<double>();
    if (!std::isfinite(out->distanceMm) || out->distanceMm == 0)
      return Fail(error, "distanceMm must be finite and nonzero");
  } else if (operation == Operation::Replace) {
    if (!request.contains("replacementFace") ||
        !ParseFaceRef(request.at("replacementFace"), "",
                      &out->replacement, error))
      return false;
  }
  return true;
}

bool RejectJoinedFailure(std::string* error, const std::string& reason) {
  if (OcafLive::instance().InTransaction()) OcafLive::instance().AbortCommand();
  return Fail(error, reason);
}

#if KREODA_WITH_OCCT
constexpr double kPi = 3.1415926535897932384626433832795;
constexpr double kPlaneTolerance = 1e-5;

struct SupportPlane {
  TopoDS_Face face;
  gp_Pln plane;
  gp_Dir outward;
};

std::string SurfaceKind(const TopoDS_Face& face) {
  switch (BRepAdaptor_Surface(face).GetType()) {
    case GeomAbs_Plane: return "plane";
    case GeomAbs_Cylinder: return "cylinder";
    case GeomAbs_Sphere: return "sphere";
    case GeomAbs_Cone: return "cone";
    case GeomAbs_Torus: return "torus";
    case GeomAbs_BSplineSurface: return "bspline";
    case GeomAbs_BezierSurface: return "bezier";
    default: return "other";
  }
}

gp_Pln PlaneOf(const TopoDS_Face& face) {
  return BRepAdaptor_Surface(face).Plane();
}

gp_Dir OutwardOf(const TopoDS_Face& face) {
  gp_Dir normal = PlaneOf(face).Axis().Direction();
  if (face.Orientation() == TopAbs_REVERSED) normal.Reverse();
  return normal;
}

bool SamePlane(const gp_Pln& a, const gp_Pln& b, bool oriented) {
  const gp_Vec na(a.Axis().Direction());
  const gp_Vec nb(b.Axis().Direction());
  const double alignment = na.Dot(nb);
  if (oriented ? alignment < 1.0 - 1e-9 : std::abs(alignment) < 1.0 - 1e-9)
    return false;
  return std::abs(gp_Vec(a.Location(), b.Location()).Dot(na)) < kPlaneTolerance;
}

bool IntersectThree(const SupportPlane& a, const SupportPlane& b,
                    const SupportPlane& c, gp_Pnt* point) {
  const std::array<gp_Vec, 3> normals = {
      gp_Vec(a.outward), gp_Vec(b.outward), gp_Vec(c.outward)};
  const std::array<double, 3> rhs = {
      normals[0].Dot(gp_Vec(gp_Pnt(0, 0, 0), a.plane.Location())),
      normals[1].Dot(gp_Vec(gp_Pnt(0, 0, 0), b.plane.Location())),
      normals[2].Dot(gp_Vec(gp_Pnt(0, 0, 0), c.plane.Location()))};
  double matrix[3][4] = {
      {normals[0].X(), normals[0].Y(), normals[0].Z(), rhs[0]},
      {normals[1].X(), normals[1].Y(), normals[1].Z(), rhs[1]},
      {normals[2].X(), normals[2].Y(), normals[2].Z(), rhs[2]}};
  for (int column = 0; column < 3; ++column) {
    int pivot = column;
    for (int row = column + 1; row < 3; ++row)
      if (std::abs(matrix[row][column]) > std::abs(matrix[pivot][column]))
        pivot = row;
    if (std::abs(matrix[pivot][column]) < 1e-10) return false;
    if (pivot != column)
      for (int j = column; j < 4; ++j)
        std::swap(matrix[pivot][j], matrix[column][j]);
    const double divisor = matrix[column][column];
    for (int j = column; j < 4; ++j) matrix[column][j] /= divisor;
    for (int row = 0; row < 3; ++row) {
      if (row == column) continue;
      const double factor = matrix[row][column];
      for (int j = column; j < 4; ++j)
        matrix[row][j] -= factor * matrix[column][j];
    }
  }
  *point = gp_Pnt(matrix[0][3], matrix[1][3], matrix[2][3]);
  return std::isfinite(point->X()) && std::isfinite(point->Y()) &&
         std::isfinite(point->Z());
}

int MatchingPlaneFaces(const TopoDS_Shape& shape, const gp_Pln& plane) {
  int matches = 0;
  for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next()) {
    const auto face = TopoDS::Face(it.Current());
    if (BRepAdaptor_Surface(face).GetType() == GeomAbs_Plane &&
        SamePlane(PlaneOf(face), plane, false))
      ++matches;
  }
  return matches;
}

bool ValidClosedOneSolid(const TopoDS_Shape& shape, double* volume,
                         std::string* error) {
  if (shape.IsNull() || !BRepCheck_Analyzer(shape).IsValid())
    return Fail(error, "result B-Rep is null or invalid");
  int solids = 0;
  for (TopExp_Explorer it(shape, TopAbs_SOLID); it.More(); it.Next()) ++solids;
  if (solids != 1) return Fail(error, "result must contain exactly one solid");
  bool closedShell = false;
  for (TopExp_Explorer solidIt(shape, TopAbs_SOLID); solidIt.More(); solidIt.Next()) {
    for (TopExp_Explorer shellIt(solidIt.Current(), TopAbs_SHELL);
         shellIt.More(); shellIt.Next()) {
      if (BRep_Tool::IsClosed(shellIt.Current())) closedShell = true;
    }
  }
  if (!closedShell) return Fail(error, "result solid has no closed shell");
  GProp_GProps props;
  BRepGProp::VolumeProperties(shape, props);
  const double measured = props.Mass();
  if (!std::isfinite(measured) || measured <= 0)
    return Fail(error, "result must have finite positive physical volume");
  if (volume) *volume = measured;
  return true;
}

std::string Serialized(const TopoDS_Shape& shape) {
  std::ostringstream stream;
  BRepTools::Write(shape, stream);
  return stream.str();
}

bool ResolveFreshFace(const ShapeRecord& owner, const FaceRef& reference,
                      TopoDS_Face* out, std::string* error) {
  const std::string fullRole = reference.owner + ":" + reference.role;
  std::size_t roleCount = 0;
  for (const auto& role : ClassifyFaceRoles(owner.shape, owner.type, owner.featureId))
    if (role == fullRole) ++roleCount;
  if (roleCount != 1)
    return Fail(error, "face reference is missing or ambiguous in its owner");
  if (!FindFaceByRole(owner.shape, owner.featureId, owner.type, fullRole, out))
    return Fail(error, "face reference could not be resolved in its owner");
  return true;
}

bool IntersectSourceFace(const ShapeRecord& owner, const std::string& consumer,
                         const Json& reference, TopoDS_Face* out,
                         std::string* error) {
  if (!reference.is_object() || !reference.contains("selectionEntry") ||
      !reference.at("selectionEntry").is_string())
    return Fail(error, "stored face binding is missing its native selectionEntry");
  const auto ownerId = reference.value("featureId", std::string{});
  const auto roleId = reference.value("persistentFaceId", std::string{});
  const auto entry = reference.at("selectionEntry").get<std::string>();
  const std::string fullRole = ownerId + ":" + roleId.substr(ownerId.size() + 1);
  const auto resolver = OcafLive::instance().DatumSourceResolver();
  if (!resolver) return Fail(error, "face binding requires its live OCAF naming context");
  TopoDS_Shape selected;
  if (!resolver(entry, consumer, ownerId, fullRole, false, &selected, error))
    return Fail(error, error && !error->empty() ? *error
                                                : "stored face binding needs repair");
  if (selected.IsNull() || selected.ShapeType() != TopAbs_FACE)
    return Fail(error, "stored binding does not resolve to a face");
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
  TopExp::MapShapes(owner.shape, TopAbs_FACE, faces);
  std::size_t matches = 0;
  for (int index = 1; index <= faces.Extent(); ++index)
    if (faces.FindKey(index).IsSame(selected)) ++matches;
  if (matches != 1)
    return Fail(error, HasIndexedTopologyRole(fullRole)
                          ? "stored indexed face binding needs repair; ordinal fallback is disabled"
                          : "stored face binding is absent or ambiguous in its owner");
  *out = TopoDS::Face(selected);
  if (SurfaceKind(*out) != reference.value("geometryKind", std::string{}))
    return Fail(error, "stored face geometry kind changed; repair is required");
  return true;
}

bool ValidateStoredReference(const Json& reference, std::string* owner,
                             std::string* role, std::string* entry,
                             std::string* geometryKind,
                             std::string* error) {
  static const std::set<std::string> keys = {
      "type", "featureId", "persistentFaceId", "geometryKind", "selectionEntry"};
  if (!HasOnlyKeys(reference, keys, "stored face reference", error) ||
      reference.size() != keys.size())
    return error && !error->empty() ? false
                                    : Fail(error, "stored face reference is incomplete");
  if (!reference.contains("type") || !reference.at("type").is_string() ||
      reference.at("type").get<std::string>() != "face" ||
      !ReadString(reference, "featureId", owner, error) ||
      !ReadString(reference, "persistentFaceId", role, error) ||
      !ReadString(reference, "selectionEntry", entry, error) ||
      !ReadString(reference, "geometryKind", geometryKind, error))
    return error && !error->empty() ? false
                                    : Fail(error, "stored face reference is invalid");
  if (!ShapeStore::ValidFeatureId(*owner) || role->rfind(*owner + ":", 0) != 0 ||
      role->size() <= owner->size() + 1 || entry->empty() || geometryKind->empty())
    return Fail(error, "stored face reference owner, role or binding is invalid");
  const auto localRole = role->substr(owner->size() + 1);
  if (localRole.find(':') != std::string::npos || localRole.find('|') != std::string::npos)
    return Fail(error, "stored face reference role is malformed");
  return true;
}

bool ParseStoredMetadata(const ShapeRecord& record, Json* metadata,
                         std::string* error) {
  try {
    *metadata = Json::parse(record.refExtra);
  } catch (const std::exception&) {
    return Fail(error, "face-history metadata is invalid");
  }
  std::set<std::string> allowed = {"version", "captureRevision", "sourceFace"};
  if (record.type == "ReplaceFace") allowed.insert("replacementFace");
  if (!HasOnlyKeys(*metadata, allowed, "face-history metadata", error) ||
      metadata->size() != allowed.size())
    return error && !error->empty() ? false
                                    : Fail(error, "face-history metadata is incomplete");
  if (!metadata->contains("version") || !metadata->at("version").is_number_integer() ||
      metadata->at("version").get<int>() != 1)
    return Fail(error, "unsupported face-history metadata version");
  std::uint64_t captureRevision = 0;
  if (!ParseRevision(*metadata, &captureRevision, error)) return false;
  std::string owner, role, entry, geometryKind;
  if (!metadata->contains("sourceFace") ||
      !ValidateStoredReference(metadata->at("sourceFace"), &owner, &role,
                               &entry, &geometryKind, error))
    return false;
  if (record.dependsOn.empty() || owner != record.dependsOn.front())
    return Fail(error, "stored source face does not match the target dependency");
  if (record.type == "ReplaceFace") {
    if (!metadata->contains("replacementFace") ||
        !ValidateStoredReference(metadata->at("replacementFace"), &owner, &role,
                                 &entry, &geometryKind, error))
      return false;
    std::vector<std::string> expectedDeps = {record.dependsOn.front()};
    if (owner != expectedDeps.front()) expectedDeps.push_back(owner);
    if (expectedDeps != record.dependsOn)
      return Fail(error, "stored replacement owner does not match its dependency");
  } else if (record.dependsOn.size() != 1) {
    return Fail(error, "face-history feature has unexpected dependencies");
  }
  return true;
}

bool RefreshStoredBindings(const std::string& featureId, Json* metadata,
                           std::string* error) {
  std::map<std::string, std::string> expectedKinds;
  for (const auto key : {"sourceFace", "replacementFace"}) {
    if (!metadata->contains(key)) continue;
    const auto& reference = metadata->at(key);
    std::string owner, role, entry, kind;
    if (!ValidateStoredReference(reference, &owner, &role, &entry, &kind, error))
      return false;
    expectedKinds.emplace(entry, kind);
  }
  auto refresh = [&expectedKinds](const std::string& entry,
                                 const std::string&,
                                 const std::string& ownerId,
                                 const std::string& fullRole, bool edge,
                                 TopoDS_Shape* picked,
                                 std::string* refreshError) {
    if (edge || HasIndexedTopologyRole(fullRole))
      return Fail(refreshError,
                  "indexed face binding needs repair; ordinal fallback is disabled");
    const auto expected = expectedKinds.find(entry);
    if (expected == expectedKinds.end())
      return Fail(refreshError, "stored face binding identity is unknown");
    ShapeRecord owner;
    if (!ShapeStore::instance().get(ownerId, &owner) || owner.shape.IsNull())
      return Fail(refreshError, "stored face owner is unavailable for refresh");
    TopoDS_Face face;
    if (!FindFaceByRole(owner.shape, owner.featureId, owner.type, fullRole, &face))
      return Fail(refreshError, "stored semantic face is absent or ambiguous; repair is required");
    std::size_t count = 0;
    const auto roles = ClassifyFaceRoles(owner.shape, owner.type, owner.featureId);
    for (const auto& role : roles) if (role == fullRole) ++count;
    if (count != 1 || SurfaceKind(face) != expected->second)
      return Fail(refreshError, "stored semantic face changed incompatibly; repair is required");
    *picked = face;
    return true;
  };
  std::string serialized = metadata->dump();
  if (!OcafLive::instance().BindDatumSources(featureId, &serialized, error,
                                              true, refresh))
    return false;
  try {
    *metadata = Json::parse(serialized);
  } catch (const std::exception&) {
    return Fail(error, "refreshed face-history metadata is invalid");
  }
  return true;
}

bool ResolveStoredReferences(const std::string& featureId, Json* metadata,
                             const std::vector<ShapeRecord>& owners,
                             TopoDS_Face* sourceFace,
                             TopoDS_Face* replacementFace,
                             std::string* error) {
  std::map<std::string, ShapeRecord> ownerById;
  for (const auto& owner : owners) ownerById[owner.featureId] = owner;
  std::string ownerId, role, entry, geometryKind;
  const auto& sourceRef = metadata->at("sourceFace");
  if (!ValidateStoredReference(sourceRef, &ownerId, &role, &entry,
                               &geometryKind, error) ||
      !ownerById.count(ownerId) ||
      !IntersectSourceFace(ownerById.at(ownerId), featureId, sourceRef,
                           sourceFace, error))
    return false;
  if (metadata->contains("replacementFace")) {
    const auto& replacementRef = metadata->at("replacementFace");
    if (!ValidateStoredReference(replacementRef, &ownerId, &role, &entry,
                                 &geometryKind, error) ||
        !ownerById.count(ownerId) ||
        !IntersectSourceFace(ownerById.at(ownerId), featureId, replacementRef,
                             replacementFace, error))
      return false;
  }
  return true;
}

Json StoredReference(const FaceRef& reference, const TopoDS_Face& face) {
  return {{"type", "face"}, {"featureId", reference.owner},
          {"persistentFaceId", reference.role},
          {"geometryKind", SurfaceKind(face)}};
}

bool BuildMoveTransform(const TopoDS_Face& selected,
                        const ParsedRequest& request,
                        TopoDS_Face* transformed,
                        std::string* error) {
  gp_Trsf toOrigin, rotateX, rotateY, rotateZ, fromOrigin, translate;
  toOrigin.SetTranslation(gp_Vec(-request.pivot[0], -request.pivot[1],
                                 -request.pivot[2]));
  fromOrigin.SetTranslation(gp_Vec(request.pivot[0], request.pivot[1],
                                   request.pivot[2]));
  translate.SetTranslation(gp_Vec(request.translation[0], request.translation[1],
                                  request.translation[2]));
  rotateX.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0)),
                      request.rotationDeg[0] * kPi / 180.0);
  rotateY.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0)),
                      request.rotationDeg[1] * kPi / 180.0);
  rotateZ.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)),
                      request.rotationDeg[2] * kPi / 180.0);
  gp_Trsf transform = translate;
  transform.Multiply(fromOrigin);
  transform.Multiply(rotateZ);
  transform.Multiply(rotateY);
  transform.Multiply(rotateX);
  transform.Multiply(toOrigin);
  BRepBuilderAPI_Transform builder(selected, transform, true);
  if (!builder.IsDone() || builder.Shape().IsNull() ||
      builder.Shape().ShapeType() != TopAbs_FACE)
    return Fail(error, "requested rigid face transform failed");
  *transformed = TopoDS::Face(builder.Shape());
  gp_Vec expected(OutwardOf(selected));
  expected.Transform(transform);
  if (expected.Magnitude() <= Precision::Confusion() ||
      expected.Dot(gp_Vec(OutwardOf(*transformed))) <= 0)
    return Fail(error, "transformed face normal lost its requested orientation");
  return true;
}

bool PlanarSupportReclosure(const TopoDS_Shape& source,
                            const TopoDS_Face& selected,
                            const TopoDS_Face& selectedSupport,
                            bool requireTransformedNormal,
                            TopoDS_Shape* result, std::string* error) {
  if (source.IsNull() || selected.IsNull() || !result)
    return Fail(error, "missing planar reconstruction operand or selection");
  if (BRepAdaptor_Surface(selectedSupport).GetType() != GeomAbs_Plane)
    return Fail(error, "MoveFace and ReplaceFace require planar support geometry");
  BRepBuilderAPI_Copy copy(source, true, false);
  const TopoDS_Shape input = copy.Shape();
  const TopoDS_Shape mappedSelection = copy.ModifiedShape(selected);
  if (input.IsNull() || mappedSelection.IsNull() ||
      mappedSelection.ShapeType() != TopAbs_FACE)
    return Fail(error, "selected face identity was lost while copying source B-Rep");
  const TopoDS_Face copiedSelection = TopoDS::Face(mappedSelection);
  if (requireTransformedNormal &&
      OutwardOf(selectedSupport).Dot(OutwardOf(copiedSelection)) <= 0)
    return Fail(error, "MoveFace cannot reverse the requested oriented normal");

  std::vector<TopoDS_Face> sourceFaces;
  for (TopExp_Explorer it(input, TopAbs_FACE); it.More(); it.Next()) {
    const auto face = TopoDS::Face(it.Current());
    if (BRepAdaptor_Surface(face).GetType() != GeomAbs_Plane)
      return Fail(error, "planar support reconstruction rejects curved source solids");
    sourceFaces.push_back(face);
  }
  if (sourceFaces.size() < 4)
    return Fail(error, "planar support reconstruction requires a bounded polyhedron");
  for (const auto& face : sourceFaces) {
    const gp_Pln plane = PlaneOf(face);
    const gp_Vec outward(OutwardOf(face));
    for (TopExp_Explorer vertexIt(input, TopAbs_VERTEX); vertexIt.More(); vertexIt.Next()) {
      const gp_Pnt point = BRep_Tool::Pnt(TopoDS::Vertex(vertexIt.Current()));
      if (gp_Vec(plane.Location(), point).Dot(outward) > kPlaneTolerance)
        return Fail(error, "planar support reconstruction rejects concave solids");
    }
  }

  std::vector<SupportPlane> supports;
  for (const auto& face : sourceFaces) {
    TopoDS_Face supportFace = face;
    if (face.IsSame(copiedSelection)) supportFace = selectedSupport;
    supports.push_back({supportFace, PlaneOf(supportFace), OutwardOf(supportFace)});
  }
  std::vector<gp_Pnt> vertices;
  for (std::size_t i = 0; i < supports.size(); ++i) {
    for (std::size_t j = i + 1; j < supports.size(); ++j) {
      for (std::size_t k = j + 1; k < supports.size(); ++k) {
        gp_Pnt candidate;
        if (!IntersectThree(supports[i], supports[j], supports[k], &candidate)) continue;
        bool inside = true;
        for (const auto& support : supports) {
          if (gp_Vec(support.plane.Location(), candidate).Dot(
                  gp_Vec(support.outward)) > kPlaneTolerance) {
            inside = false;
            break;
          }
        }
        if (inside) vertices.push_back(candidate);
      }
    }
  }
  if (vertices.size() < 4)
    return Fail(error, "support planes do not bound a non-degenerate solid");

  double minX = vertices.front().X(), maxX = minX;
  double minY = vertices.front().Y(), maxY = minY;
  double minZ = vertices.front().Z(), maxZ = minZ;
  for (const auto& vertex : vertices) {
    minX = std::min(minX, vertex.X()); maxX = std::max(maxX, vertex.X());
    minY = std::min(minY, vertex.Y()); maxY = std::max(maxY, vertex.Y());
    minZ = std::min(minZ, vertex.Z()); maxZ = std::max(maxZ, vertex.Z());
  }
  const double scale = std::max({maxX - minX, maxY - minY, maxZ - minZ});
  if (!std::isfinite(scale) || scale <= Precision::Confusion())
    return Fail(error, "support planes produce a degenerate envelope");
  const double coordinateScale = std::max({
      scale, std::abs(minX), std::abs(maxX), std::abs(minY), std::abs(maxY),
      std::abs(minZ), std::abs(maxZ)});
  const double roundingPad = 32.0 * std::numeric_limits<double>::epsilon() *
                             coordinateScale;
  const double pad = std::max(2.0 * kPlaneTolerance, scale * 1e-6) +
                     roundingPad;
  gp_Vec vertexSum(0, 0, 0);
  for (const auto& vertex : vertices)
    vertexSum += gp_Vec(gp_Pnt(0, 0, 0), vertex);
  vertexSum /= static_cast<double>(vertices.size());
  const gp_Pnt interior(vertexSum.X(), vertexSum.Y(), vertexSum.Z());
  TopoDS_Shape current = BRepPrimAPI_MakeBox(
      gp_Pnt(minX - pad, minY - pad, minZ - pad),
      gp_Pnt(maxX + pad, maxY + pad, maxZ + pad)).Shape();
  const std::array<gp_Pnt, 8> envelopeCorners = {
      gp_Pnt(minX - pad, minY - pad, minZ - pad),
      gp_Pnt(minX - pad, minY - pad, maxZ + pad),
      gp_Pnt(minX - pad, maxY + pad, minZ - pad),
      gp_Pnt(minX - pad, maxY + pad, maxZ + pad),
      gp_Pnt(maxX + pad, minY - pad, minZ - pad),
      gp_Pnt(maxX + pad, minY - pad, maxZ + pad),
      gp_Pnt(maxX + pad, maxY + pad, minZ - pad),
      gp_Pnt(maxX + pad, maxY + pad, maxZ + pad)};
  const std::array<gp_Pln, 6> envelopePlanes = {
      gp_Pln(gp_Pnt(minX - pad, 0, 0), gp_Dir(-1, 0, 0)),
      gp_Pln(gp_Pnt(maxX + pad, 0, 0), gp_Dir(1, 0, 0)),
      gp_Pln(gp_Pnt(0, minY - pad, 0), gp_Dir(0, -1, 0)),
      gp_Pln(gp_Pnt(0, maxY + pad, 0), gp_Dir(0, 1, 0)),
      gp_Pln(gp_Pnt(0, 0, minZ - pad), gp_Dir(0, 0, -1)),
      gp_Pln(gp_Pnt(0, 0, maxZ + pad), gp_Dir(0, 0, 1))};
  for (const auto& support : supports) {
    double minU = std::numeric_limits<double>::infinity();
    double maxU = -minU, minV = minU, maxV = -minU;
    const gp_Vec uAxis(support.plane.Position().XDirection());
    const gp_Vec vAxis(support.plane.Position().YDirection());
    for (const auto& corner : envelopeCorners) {
      const gp_Vec relative(support.plane.Location(), corner);
      minU = std::min(minU, relative.Dot(uAxis));
      maxU = std::max(maxU, relative.Dot(uAxis));
      minV = std::min(minV, relative.Dot(vAxis));
      maxV = std::max(maxV, relative.Dot(vAxis));
    }
    BRepBuilderAPI_MakeFace patch(support.plane, minU - pad, maxU + pad,
                                  minV - pad, maxV + pad);
    if (!patch.IsDone())
      return Fail(error, "failed to create a geometry-derived planar support patch");
    BRepPrimAPI_MakeHalfSpace halfSpace(patch.Face(), interior);
    BRepAlgoAPI_Common common(current, halfSpace.Solid());
    common.Build();
    if (!common.IsDone() || common.Shape().IsNull())
      return Fail(error, "support-plane intersection is empty or failed");
    current = common.Shape();
  }
  double volume = 0;
  if (!ValidClosedOneSolid(current, &volume, error)) return false;
  for (const auto& envelopePlane : envelopePlanes)
    if (MatchingPlaneFaces(current, envelopePlane) != 0)
      return Fail(error, "derived envelope boundary survived; result is capped");
  for (const auto& support : supports)
    if (MatchingPlaneFaces(current, support.plane) != 1)
      return Fail(error, "selected or unselected planar support was lost or ambiguous");
  if (Serialized(source) == Serialized(current))
    return Fail(error, "face operation produced no geometry change");
  *result = current;
  return true;
}

bool BuildMoveFace(const ShapeRecord& source, const TopoDS_Face& selected,
                   const ParsedRequest& request, TopoDS_Shape* result,
                   std::string* error) {
  if (BRepAdaptor_Surface(selected).GetType() != GeomAbs_Plane)
    return Fail(error, "MoveFace currently supports planar faces on convex planar solids");
  bool noOp = true;
  for (double value : request.translation) noOp = noOp && value == 0;
  for (double value : request.rotationDeg) {
    const double reduced = std::remainder(value, 360.0);
    noOp = noOp && reduced == 0;
  }
  if (noOp) return Fail(error, "MoveFace transform is a true no-op");
  TopoDS_Face transformed;
  if (!BuildMoveTransform(selected, request, &transformed, error)) return false;
  if (SamePlane(PlaneOf(selected), PlaneOf(transformed), true))
    return Fail(error, "MoveFace does not change face support; in-plane trim motion is unsupported");
  return PlanarSupportReclosure(source.shape, selected, transformed, true,
                                result, error);
}

bool BuildOffsetFace(const ShapeRecord& source, const TopoDS_Face& selected,
                     double distanceMm, TopoDS_Shape* result,
                     std::string* error) {
  const auto kind = BRepAdaptor_Surface(selected).GetType();
  if (kind != GeomAbs_Plane && kind != GeomAbs_Cylinder && kind != GeomAbs_Sphere)
    return Fail(error, "OffsetFace supports planar, cylindrical and spherical faces");
  const auto original = Serialized(source.shape);
  BRepBuilderAPI_Copy copy(source.shape, true, false);
  const TopoDS_Shape input = copy.Shape();
  const TopoDS_Shape mapped = copy.ModifiedShape(selected);
  if (input.IsNull() || mapped.IsNull() || mapped.ShapeType() != TopAbs_FACE)
    return Fail(error, "OffsetFace could not preserve selected face identity while copying");
  BRepOffset_MakeOffset builder;
  builder.Initialize(input, 0.0, 1e-7, BRepOffset_Skin, false, false,
                     GeomAbs_Intersection, false, false);
  builder.SetOffsetOnFace(TopoDS::Face(mapped), distanceMm);
  builder.MakeOffsetShape();
  if (!builder.IsDone() || builder.Shape().IsNull())
    return Fail(error, "OCCT per-face offset failed");
  double beforeVolume = 0, afterVolume = 0;
  if (!ValidClosedOneSolid(source.shape, &beforeVolume, error) ||
      !ValidClosedOneSolid(builder.Shape(), &afterVolume, error))
    return false;
  if (original != Serialized(source.shape))
    return Fail(error, "OffsetFace modified its source B-Rep");
  const double relativeVolumeChange =
      std::abs(afterVolume - beforeVolume) / beforeVolume;
  if (original == Serialized(builder.Shape()) ||
      !std::isfinite(relativeVolumeChange) || relativeVolumeChange <= 1e-12)
    return Fail(error, "OffsetFace did not change the selected solid geometry");
  *result = builder.Shape();
  return true;
}

bool BuildDeleteFace(const ShapeRecord& source, const TopoDS_Face& selected,
                     TopoDS_Shape* result, std::string* error) {
  const auto original = Serialized(source.shape);
  BRepBuilderAPI_Copy copy(source.shape, true, false);
  const TopoDS_Shape input = copy.Shape();
  const TopoDS_Shape mapped = copy.ModifiedShape(selected);
  if (input.IsNull() || mapped.IsNull() || mapped.ShapeType() != TopAbs_FACE)
    return Fail(error, "DeleteFace could not preserve selected face identity while copying");
  BRepAlgoAPI_Defeaturing builder;
  builder.SetShape(input);
  builder.AddFaceToRemove(mapped);
  builder.SetToFillHistory(true);
  builder.Build();
  if (!builder.IsDone() || builder.Shape().IsNull())
    return Fail(error, "OCCT defeaturing failed to heal the selected face");
  if (!builder.IsDeleted(mapped))
    return Fail(error, "OCCT defeaturing ignored the selected face removal");
  double volume = 0;
  if (!ValidClosedOneSolid(builder.Shape(), &volume, error)) return false;
  if (original != Serialized(source.shape))
    return Fail(error, "DeleteFace modified its source B-Rep");
  if (original == Serialized(builder.Shape()))
    return Fail(error, "DeleteFace produced an unchanged copied solid");
  *result = builder.Shape();
  return true;
}

bool BuildReplaceFace(const ShapeRecord& source, const TopoDS_Face& selected,
                      const TopoDS_Face& replacement,
                      TopoDS_Shape* result, std::string* error) {
  if (BRepAdaptor_Surface(selected).GetType() != GeomAbs_Plane ||
      BRepAdaptor_Surface(replacement).GetType() != GeomAbs_Plane)
    return Fail(error, "ReplaceFace currently requires planar faces on convex planar solids");
  TopoDS_Face orientedReplacement = replacement;
  const double alignment = OutwardOf(selected).Dot(OutwardOf(replacement));
  if (std::abs(alignment) < 1e-8)
    return Fail(error, "replacement plane has ambiguous retained-solid orientation");
  if (alignment < 0) orientedReplacement.Reverse();
  if (SamePlane(PlaneOf(selected), PlaneOf(orientedReplacement), true))
    return Fail(error, "ReplaceFace support is identical to the selected face");
  return PlanarSupportReclosure(source.shape, selected, orientedReplacement,
                                false, result, error);
}

bool CreateFeature(const Json& request, Operation operation,
                   const std::string& type, std::string* error) {
  ParsedRequest parsed;
  if (!ParseRequest(request, operation, &parsed, error))
    return RejectJoinedFailure(error, error ? *error : "invalid face-history request");
  if (!CheckNewId(parsed.featureId, error))
    return RejectJoinedFailure(error, error ? *error : "invalid featureId");
  ShapeRecord source;
  if (!GetCurrentShapeRecord(parsed.source.owner, &source, error) ||
      source.shape.IsNull())
    return RejectJoinedFailure(error, error && !error->empty()
                                         ? *error : "source feature has no B-Rep");
  BodyRecord targetBody;
  if (!BodyStore::instance().bodyForFeature(parsed.source.owner, &targetBody) ||
      targetBody.tipFeatureId != parsed.source.owner)
    return RejectJoinedFailure(
        error, "source feature must be the current tip of an existing solid body");
  TopoDS_Face selected;
  if (!ResolveFreshFace(source, parsed.source, &selected, error))
    return RejectJoinedFailure(error, error ? *error : "source face is unavailable");

  ShapeRecord replacementOwner;
  TopoDS_Face replacement;
  if (operation == Operation::Replace) {
    if (!GetCurrentShapeRecord(parsed.replacement.owner, &replacementOwner, error) ||
        replacementOwner.shape.IsNull() ||
        !ResolveFreshFace(replacementOwner, parsed.replacement, &replacement, error))
      return RejectJoinedFailure(error, error && !error->empty()
                                           ? *error : "replacement face is unavailable");
    if (source.featureId == replacementOwner.featureId && selected.IsSame(replacement))
      return RejectJoinedFailure(error, "ReplaceFace cannot use the same face as its support");
  }

  TopoDS_Shape result;
  std::vector<double> params;
  Json metadata = {{"version", 1}, {"captureRevision", parsed.captureRevision},
                   {"sourceFace", StoredReference(parsed.source, selected)}};
  bool built = false;
  if (operation == Operation::Move) {
    params = {parsed.translation[0], parsed.translation[1], parsed.translation[2],
              parsed.rotationDeg[0], parsed.rotationDeg[1], parsed.rotationDeg[2],
              parsed.pivot[0], parsed.pivot[1], parsed.pivot[2]};
    built = BuildMoveFace(source, selected, parsed, &result, error);
  } else if (operation == Operation::Offset) {
    params = {parsed.distanceMm};
    built = BuildOffsetFace(source, selected, parsed.distanceMm, &result, error);
  } else if (operation == Operation::Delete) {
    built = BuildDeleteFace(source, selected, &result, error);
  } else {
    metadata["replacementFace"] = StoredReference(parsed.replacement, replacement);
    built = BuildReplaceFace(source, selected, replacement, &result, error);
  }
  if (!built) return RejectJoinedFailure(error, error && !error->empty()
                                                ? *error : "face-history kernel operation failed");
  if (parsed.captureRevision != static_cast<std::uint64_t>(
                                    DocumentStore::instance().snapshotRevision()))
    return RejectJoinedFailure(error, "captureRevision changed before face binding");

  std::vector<std::string> dependencies = {parsed.source.owner};
  if (operation == Operation::Replace &&
      parsed.replacement.owner != parsed.source.owner)
    dependencies.push_back(parsed.replacement.owner);

  const ModelSnapshot before;
  auto& ocaf = OcafLive::instance();
  if (!ocaf.BeginCommand(error)) return false;
  auto rollback = [&](const std::string& reason) {
    ocaf.AbortCommand();
    std::string resyncError;
    ocaf.ResyncStore(&resyncError);
    before.restore();
    if (error) *error = reason;
    return false;
  };
  std::string definition = metadata.dump();
  if (!ocaf.BindDatumSources(parsed.featureId, &definition, error))
    return rollback(error && !error->empty() ? *error : "could not bind face-history sources");
  try {
    metadata = Json::parse(definition);
  } catch (const std::exception&) {
    return rollback("native face-history binding returned invalid metadata");
  }
  if (!CommitShape(parsed.featureId, type, std::move(params),
                   std::move(dependencies), metadata.dump(), result, nullptr,
                   true, error))
    return rollback(error && !error->empty() ? *error : "could not commit face-history feature");
  bool hadDelta = false;
  if (!ocaf.CommitCommand(&hadDelta, error))
    return rollback(error && !error->empty() ? *error : "could not commit OCAF face-history command");
  return true;
}

bool RebuildFeatureFromStore(const std::string& featureId,
                             const std::string& expectedType,
                             Operation operation, std::string* error) {
  ShapeRecord record;
  if (!ShapeStore::instance().get(featureId, &record) || record.type != expectedType)
    return Fail(error, "unknown or mismatched face-history feature " + featureId);
  const std::size_t expectedParams = operation == Operation::Move ? 9
      : operation == Operation::Offset ? 1 : 0;
  if (record.paramsMm.size() != expectedParams)
    return Fail(error, "stored face-history parameter count is invalid");
  if (record.dependsOn.empty())
    return Fail(error, "face-history source dependency is missing");

  Json metadata;
  if (!ParseStoredMetadata(record, &metadata, error)) return false;
  const auto sourceId = record.dependsOn.front();
  ShapeRecord source;
  if (!GetCurrentShapeRecord(sourceId, &source, error) || source.shape.IsNull())
    return Fail(error, "face-history source B-Rep is unavailable");
  std::vector<ShapeRecord> owners = {source};
  if (operation == Operation::Replace) {
    const auto replacementId = metadata.at("replacementFace").at("featureId").get<std::string>();
    if (replacementId != sourceId) {
      ShapeRecord support;
      if (!GetCurrentShapeRecord(replacementId, &support, error) || support.shape.IsNull())
        return Fail(error, "replacement support B-Rep is unavailable");
      owners.push_back(support);
    }
  }
  if (!RefreshStoredBindings(featureId, &metadata, error)) return false;
  TopoDS_Face selected, replacement;
  if (!ResolveStoredReferences(featureId, &metadata, owners, &selected,
                               &replacement, error))
    return false;

  TopoDS_Shape result;
  bool built = false;
  if (operation == Operation::Move) {
    ParsedRequest params;
    std::copy_n(record.paramsMm.begin(), 3, params.translation.begin());
    std::copy_n(record.paramsMm.begin() + 3, 3, params.rotationDeg.begin());
    std::copy_n(record.paramsMm.begin() + 6, 3, params.pivot.begin());
    built = BuildMoveFace(source, selected, params, &result, error);
  } else if (operation == Operation::Offset) {
    built = BuildOffsetFace(source, selected, record.paramsMm[0], &result, error);
  } else if (operation == Operation::Delete) {
    built = BuildDeleteFace(source, selected, &result, error);
  } else {
    built = BuildReplaceFace(source, selected, replacement, &result, error);
  }
  if (!built) return false;
  return CommitShape(record.featureId, record.type, record.paramsMm,
                     record.dependsOn, metadata.dump(), result, &record,
                     false, error);
}
#endif  // KREODA_WITH_OCCT

bool Create(const Json& request, Operation operation, const std::string& type,
            std::string* error) {
#if KREODA_WITH_OCCT
  return CreateFeature(request, operation, type, error);
#else
  ParsedRequest parsed;
  if (!ParseRequest(request, operation, &parsed, error))
    return RejectJoinedFailure(error, error ? *error : "invalid face-history request");
  if (!CheckNewId(parsed.featureId, error))
    return RejectJoinedFailure(error, error ? *error : "invalid featureId");
  return RejectJoinedFailure(error, "direct face history requires OCCT");
#endif
}

bool Rebuild(const std::string& featureId, const std::string& type,
             Operation operation, std::string* error) {
#if KREODA_WITH_OCCT
  return RebuildFeatureFromStore(featureId, type, operation, error);
#else
  (void)featureId;
  (void)type;
  (void)operation;
  return Fail(error, "direct face history requires OCCT");
#endif
}

}  // namespace

bool CreateMoveFaceFeature(const nlohmann::json& request, std::string* error) {
  return Create(request, Operation::Move, "MoveFace", error);
}

bool CreateOffsetFaceFeature(const nlohmann::json& request, std::string* error) {
  return Create(request, Operation::Offset, "OffsetFace", error);
}

bool CreateDeleteFaceFeature(const nlohmann::json& request, std::string* error) {
  return Create(request, Operation::Delete, "DeleteFace", error);
}

bool CreateReplaceFaceFeature(const nlohmann::json& request, std::string* error) {
  return Create(request, Operation::Replace, "ReplaceFace", error);
}

bool RebuildMoveFaceFromStore(const std::string& featureId, std::string* error) {
  return Rebuild(featureId, "MoveFace", Operation::Move, error);
}

bool RebuildOffsetFaceFromStore(const std::string& featureId, std::string* error) {
  return Rebuild(featureId, "OffsetFace", Operation::Offset, error);
}

bool RebuildDeleteFaceFromStore(const std::string& featureId, std::string* error) {
  return Rebuild(featureId, "DeleteFace", Operation::Delete, error);
}

bool RebuildReplaceFaceFromStore(const std::string& featureId, std::string* error) {
  return Rebuild(featureId, "ReplaceFace", Operation::Replace, error);
}

}  // namespace kreoda
