#include "features/datum/datum_store.h"
#include "features/datum/datum_json.h"
#include "features/datum/datum_commands.h"
#include "dispatcher.h"
#include "protocol/json_fields.h"
#include "protocol/save_publish_retry.h"
#include "protocol/session_geometry.h"
#include "diagnostics/crash_barrier.h"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <iomanip>
#include <map>
#include <set>
#include <sstream>
#include <thread>

#if KREODA_WITH_OCCT
#include <BRepAdaptor_Curve.hxx>
#include <Precision.hxx>
#include <Standard_Failure.hxx>
#include <TopoDS_Edge.hxx>
#include <gp_Pnt.hxx>
#endif

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <unistd.h>
#endif

#include "document/document_store.h"
#include "exchange/gltf_exchange.h"
#include "exchange/obj_exchange.h"
#include "exchange/step_exchange.h"
#include "exchange/stl_exchange.h"
#include "exchange/threemf_exchange.h"
#include "expressions/expressions.h"
#include "features/booleans/boolean.h"
#include "features/evaluate.h"
#include "features/extrusion/extrude.h"
#include "features/fillet/fillet.h"
#include "features/shell/shell.h"
#include "features/hole/hole.h"
#include "features/instance/instance.h"
#include "features/mirror/mirror.h"
#include "features/pattern/body_pattern.h"
#include "features/pattern/circular_body_pattern.h"
#include "features/assembly/assembly_constraints.h"
#include "features/primitives/primitives.h"
#include "features/revolve/revolve.h"
#include "features/surface/loft_sew.h"
#include "features/surface/surface_modeling.h"
#include "features/surface/surface_sew_offset.h"
#include "features/surface/surface_thicken.h"
#include "features/surface/surface_sweep.h"
#include "features/surface/surface_trim_extend.h"
#include "features/surface/face_thicken.h"
#include "features/configurations/configurations.h"
#include "features/direct/offset_face.h"
#include "features/direct/face_history.h"
#include "features/sketch/sketch_commands.h"
#include "features/sketch/sketch_face.h"
#include "features/sketch/sketch_json.h"
#include "features/sketch/sketch_projection.h"
#include "features/sketch/sketch_store.h"
#include "model/feature_graph.h"
#include "model/body.h"
#include "model/body_visibility.h"
#include "model/shapes.h"
#include "model/geometry_kind.h"
#include "model/geometry_availability.h"
#include "protocol/mesh_fb.h"
#include "topology/face_roles.h"
#include "persistence/icad_zip.h"
#include "persistence/ocaf_live.h"

#include "tessellation/mesh.h"

namespace kreoda {

namespace fs = std::filesystem;

namespace {

// Per-operation temp dirs (M10): autosave (15 s) and explicit save/open can
// overlap in flight — fixed shared names (`kreoda-save/document.xbf`)
// would clobber each other mid-stream.
std::string uniqueTempDir(const std::string& base, std::error_code& ec) {
  static std::atomic<unsigned long> counter{0};
  for (int attempt = 0; attempt < 64; ++attempt) {
    std::ostringstream name;
#ifdef _WIN32
    name << base << "-" << static_cast<unsigned long>(GetCurrentProcessId())
         << "-" << counter.fetch_add(1);
#else
    name << base << "-" << static_cast<unsigned long>(getpid()) << "-"
         << counter.fetch_add(1);
#endif
    fs::path dir = fs::temp_directory_path(ec) / name.str();
    if (ec) return "";
    if (fs::create_directories(dir, ec) && !ec) return dir.string();
  }
  return "";
}

std::string undo_counts_body();

std::string escape(const std::string& s) {
  // Full JSON string escaping (§63.10): error paths carry OCCT what(),
  // file paths and glTF diagnostics — raw controls would emit invalid
  // JSON and the renderer would see SyntaxError instead of errorCode.
  static const char* kHex = "0123456789abcdef";
  std::string out;
  for (unsigned char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          out += "\\u00";
          out += kHex[(c >> 4) & 0xF];
          out += kHex[c & 0xF];
        } else {
          out += static_cast<char>(c);
        }
    }
  }
  return out;
}

std::string error_body(const std::string& code, const std::string& msg) {
  return "\"errorCode\":\"" + escape(code) +
         "\",\"errorMessage\":\"" + escape(msg) + "\"";
}

bool projection_request_fields_valid(
    const Json& request, std::initializer_list<const char*> arguments,
    std::string* error) {
  std::set<std::string> allowed = {
      "protocolVersion", "requestId", "documentId", "type",
      "transactionId"};
  for (const auto* argument : arguments) allowed.insert(argument);
  for (const auto& field : request.items()) {
    if (!allowed.count(field.key())) {
      if (error) *error = "unsupported projection argument: " + field.key();
      return false;
    }
  }
  return true;
}

bool surface_command_fields_valid(const Json& request,
                                  std::initializer_list<const char*> arguments,
                                  std::string* error) {
  std::set<std::string> allowed = {"protocolVersion", "requestId", "documentId",
                                   "type", "transactionId"};
  for (const auto* argument : arguments) allowed.insert(argument);
  for (const auto& field : request.items()) {
    if (!allowed.count(field.key())) {
      if (error) *error = "unsupported surface command argument: " + field.key();
      return false;
    }
  }
  return true;
}

bool surface_topology_reference_valid(const Json& reference,
                                      const std::string& expectedType,
                                      const std::string& roleKey,
                                      const std::string& ownerId,
                                      std::string* error) {
  if (!reference.is_object()) {
    if (error) *error = "topology reference must be an object";
    return false;
  }
  const std::set<std::string> allowed = {"type", "featureId", roleKey};
  for (const auto& field : reference.items()) {
    if (!allowed.count(field.key())) {
      if (error) *error = "unsupported topology reference field: " + field.key();
      return false;
    }
  }
  if (!reference.contains("type") || !reference.at("type").is_string() ||
      reference.at("type").get<std::string>() != expectedType ||
      !reference.contains("featureId") || !reference.at("featureId").is_string() ||
      reference.at("featureId").get<std::string>() != ownerId ||
      !reference.contains(roleKey) || !reference.at(roleKey).is_string() ||
      reference.at(roleKey).get<std::string>().empty() ||
      reference.at(roleKey).get<std::string>().size() > 512) {
    if (error) *error = "topology reference has an invalid type, owner, or persistent ID";
    return false;
  }
  const auto& role = reference.at(roleKey).get_ref<const std::string&>();
  const auto colon = role.find(':');
  if (colon != std::string::npos && role.substr(0, colon) != ownerId) {
    if (error) *error = "persistent topology ID belongs to a different feature";
    return false;
  }
  return true;
}

bool finite_number(const Json& request, const char* key, double* output,
                   double fallback = 0.0) {
  if (!request.contains(key)) {
    *output = fallback;
    return true;
  }
  if (!request.at(key).is_number()) return false;
  *output = request.at(key).get<double>();
  return std::isfinite(*output);
}

std::string shape_body(const ShapeRecord& rec) {
  std::ostringstream os;
  os << std::setprecision(17);
  os << "\"featureId\":\"" << escape(rec.featureId) << "\",\"type\":\""
     << escape(rec.type) << "\",\"paramsMm\":[";
  for (size_t i = 0; i < rec.paramsMm.size(); ++i) {
    if (i) os << ",";
    os << rec.paramsMm[i];
  }
  os << "],\"dependsOn\":[";
  for (size_t i = 0; i < rec.dependsOn.size(); ++i) {
    if (i) os << ",";
    os << "\"" << escape(rec.dependsOn[i]) << "\"";
  }
  os << "],\"expressions\":{";
  {
    bool efirst = true;
    for (const auto& [param, expr] :
         ExpressionStore::instance().forFeature(rec.featureId)) {
      if (!efirst) os << ",";
      efirst = false;
      os << "\"" << escape(param) << "\":\"" << escape(expr) << "\"";
    }
  }
  os << "}";
  os << ",\"refExtra\":\"" << escape(rec.refExtra) << "\""
     << ",\"revision\":" << DocumentStore::instance().revision() << ","
     << undo_counts_body();
  if (!IsSurfaceGeometry(rec)) os << ",\"volumeMm3\":" << rec.volumeMm3;
  os << ",\"bboxMm\":[" << rec.bboxMm[0] << "," << rec.bboxMm[1] << ","
     << rec.bboxMm[2] << "," << rec.bboxMm[3] << "," << rec.bboxMm[4] << ","
     << rec.bboxMm[5] << "]";
  return os.str();
}

#if KREODA_WITH_OCCT
Json sketch_curve_display(const SketchFeature& sketch) {
  Json result={{"space","sketch-local"},{"curves",Json::array()},
               {"errors",Json::array()}};
  const auto displayOne=[&](const std::string& id,const char* kind) {
    const auto addError=[&](const std::string& message) {
      result["errors"].push_back({{"entityId",id},
                                  {"message",message.empty()?"native display failed":message}});
    };
    try {
      std::vector<TopoDS_Edge> edges;
      std::string error;
      if(!BuildSketchEntityEdges(sketch,{id},&edges,&error)) {
        addError(error);
        return;
      }
      if(edges.size()!=1 || edges.front().IsNull()) {
        addError("native curve builder returned no unique edge");
        return;
      }
      BRepAdaptor_Curve curve(edges.front());
      const double first=curve.FirstParameter();
      const double last=curve.LastParameter();
      const double span=last-first;
      if(!std::isfinite(first) || !std::isfinite(last) ||
         Precision::IsInfinite(first) || Precision::IsInfinite(last) ||
         !std::isfinite(span) || Precision::IsInfinite(span) || !(last>first)) {
        addError("native curve display interval is not finite and nonempty");
        return;
      }
      Json points=Json::array();
      points.get_ref<Json::array_t&>().reserve(129);
      for(size_t i=0;i<129;++i) {
        const double fraction=static_cast<double>(i)/128.0;
        const double parameter=first+span*fraction;
        if(!std::isfinite(parameter)) {
          addError("native curve display parameter is nonfinite");
          return;
        }
        const gp_Pnt point=curve.Value(parameter);
        const double dx=point.X()-sketch.plane.origin[0];
        const double dy=point.Y()-sketch.plane.origin[1];
        const double dz=point.Z()-sketch.plane.origin[2];
        const double x=dx*sketch.plane.xAxis[0]+dy*sketch.plane.xAxis[1]+
                       dz*sketch.plane.xAxis[2];
        const double y=dx*sketch.plane.yAxis[0]+dy*sketch.plane.yAxis[1]+
                       dz*sketch.plane.yAxis[2];
        if(!std::isfinite(point.X()) || !std::isfinite(point.Y()) ||
           !std::isfinite(point.Z()) || !std::isfinite(x) || !std::isfinite(y)) {
          addError("native curve display contains nonfinite points");
          return;
        }
        points.push_back(Json::array({x,y}));
      }
      result["curves"].push_back({{"entityId",id},{"kind",kind},
          {"closed",curve.IsClosed()},{"pointsMm",std::move(points)}});
    } catch(const Standard_Failure& failure) {
      addError(failure.what());
    } catch(const std::exception& failure) {
      addError(failure.what());
    } catch(...) {
      addError("native curve display failed");
    }
  };
  for(const auto& ellipse:sketch.model.ellipses)
    displayOne(ellipse.id,ellipse.arc?"ellipticalArc":"ellipse");
  for(const auto& spline:sketch.model.splines)
    displayOne(spline.id,"spline");
  return result;
}
#else
Json sketch_curve_display(const SketchFeature& sketch) {
  Json result{{"space","sketch-local"},{"curves",Json::array()},
              {"errors",Json::array()}};
  if (!sketch.model.ellipses.empty() || !sketch.model.splines.empty())
    result["errors"].push_back({{"message","native curve display unavailable"}});
  return result;
}
#endif

std::string sketch_body(const SketchFeature& sketch,
                        const SolveResult* solve = nullptr) {
  std::ostringstream os;
  os << std::setprecision(17);
  os << "\"featureId\":\"" << escape(sketch.id) << "\",\"type\":\"Sketch\""
     << ",\"planeKind\":\"" << escape(sketch.planeKind) << "\""
     << ",\"revision\":" << DocumentStore::instance().revision() << ","
     << undo_counts_body() << ",\"sketch\":"
      << SerializeSketchFeatureForInspection(sketch);
  std::string curve_display_json;
  try {
    curve_display_json = sketch_curve_display(sketch).dump();
  } catch(...) {
    // A display failure is metadata only: never undo or misreport a committed sketch.
    curve_display_json =
        R"({"space":"sketch-local","curves":[],"errors":[{"message":"native curve display failed"}]})";
  }
  os << ",\"curveDisplay\":" << curve_display_json;
  const auto availability = GetGeometryAvailability(sketch.id);
  os << ",\"geometryCurrent\":" << (availability.geometryCurrent ? "true" : "false")
     << ",\"geometryStatus\":\"" << escape(availability.status) << "\"";
  if (!availability.geometryCurrent) {
    os << ",\"error\":\"" << escape(availability.error)
       << "\",\"blockingSourceIds\":[";
    for (size_t i = 0; i < availability.blockingSourceIds.size(); ++i) {
      if (i) os << ",";
      os << "\"" << escape(availability.blockingSourceIds[i]) << "\"";
    }
    os << "]";
  }
  if (solve) {
    os << ",\"solved\":" << (solve->ok ? "true" : "false")
       << ",\"residual\":" << solve->residual << ",\"dofs\":" << solve->dofs;
    if (!solve->conflicting.empty()) {
      os << ",\"conflicting\":[";
      for (size_t i = 0; i < solve->conflicting.size(); ++i) {
        if (i) os << ",";
        os << "\"" << escape(solve->conflicting[i]) << "\"";
      }
      os << "]";
    }
  }
  return os.str();
}

std::string feature_list_body() {
  std::ostringstream os;
  os << std::setprecision(17);
  os << "\"features\":[";
  bool first = true;
  for (const auto& rec : ShapeStore::instance().listInOrder()) {
    if (!first) os << ",";
    first = false;
    os << "{";
    os << "\"featureId\":\"" << escape(rec.featureId) << "\",\"type\":\""
       << escape(rec.type) << "\",\"paramsMm\":[";
    for (size_t i = 0; i < rec.paramsMm.size(); ++i) {
      if (i) os << ",";
      os << rec.paramsMm[i];
    }
    os << "],\"dependsOn\":[";
    for (size_t i = 0; i < rec.dependsOn.size(); ++i) {
      if (i) os << ",";
      os << "\"" << escape(rec.dependsOn[i]) << "\"";
    }
    // Formulas ride the summaries so the tree/chips can show ƒ markers (§22).
    os << "],\"expressions\":{";
    {
      bool efirst = true;
      for (const auto& [param, expr] :
           ExpressionStore::instance().forFeature(rec.featureId)) {
        if (!efirst) os << ",";
        efirst = false;
        os << "\"" << escape(param) << "\":\"" << escape(expr) << "\"";
      }
    }
    os << "}";
    os << ",\"refExtra\":\"" << escape(rec.refExtra) << "\"";
    BodyRecord owningBody;
    if (BodyStore::instance().bodyForFeature(rec.featureId,&owningBody)) {
      os << ",\"bodyId\":\"" << escape(owningBody.bodyId) << "\""
         << ",\"bodyVisible\":" << (owningBody.visible?"true":"false")
         << ",\"bodyTip\":" << (owningBody.tipFeatureId==rec.featureId?"true":"false");
    }
    const auto availability = GetGeometryAvailability(rec.featureId);
    os << ",\"geometryCurrent\":" << (availability.geometryCurrent ? "true" : "false")
       << ",\"status\":\"" << escape(availability.status) << "\"";
    if (availability.geometryCurrent && !IsSurfaceGeometry(rec)) {
      os << ",\"volumeMm3\":" << rec.volumeMm3;
    } else {
      os << ",\"error\":\"" << escape(availability.error)
         << "\",\"blockingSourceIds\":[";
      for (size_t i = 0; i < availability.blockingSourceIds.size(); ++i) {
        if (i) os << ",";
        os << "\"" << escape(availability.blockingSourceIds[i]) << "\"";
      }
      os << "]";
    }
    os << "}";
  }
  os << "],\"sketches\":[";
  first = true;
  for (const auto& sk : SketchStore::instance().listInOrder()) {
    if (!first) os << ",";
    first = false;
    os << "{\"featureId\":\"" << escape(sk.id)
       << "\",\"type\":\"Sketch\",\"planeKind\":\"" << escape(sk.planeKind)
       << "\",\"points\":" << sk.model.points.size()
       << ",\"lines\":" << sk.model.lines.size()
       << ",\"circles\":" << sk.model.circles.size()
       << ",\"constraints\":" << sk.model.constraints.size()
       << ",\"supportRef\":\"" << escape(sk.supportRef) << "\",\"plane\":"
       << Json::parse(SerializeSketchFeature(sk))["plane"].dump();
    const auto availability = GetGeometryAvailability(sk.id);
    os << ",\"geometryCurrent\":" << (availability.geometryCurrent ? "true" : "false")
       << ",\"status\":\"" << escape(availability.status) << "\"";
    if (!availability.geometryCurrent) {
      os << ",\"error\":\"" << escape(availability.error)
         << "\",\"blockingSourceIds\":[";
      for (size_t i = 0; i < availability.blockingSourceIds.size(); ++i) {
        if (i) os << ",";
        os << "\"" << escape(availability.blockingSourceIds[i]) << "\"";
      }
      os << "]";
    }
    os << ",\"projectionGroups\":"
       << SerializeSketchProjectionGroupsForInspection(sk.projectionGroups) << "}";
  }
  os << "],\"datums\":[";
  first=true;
  for(const auto& record:DatumStore::instance().listInOrder()) {
    if(!first)os << ",";
    first=false;os << SerializeDatumRecord(record);
  }
  os << "],\"revision\":" << DocumentStore::instance().revision() << ","
     << undo_counts_body();
  return os.str();
}

std::string manifest_json(const std::string& documentId, const std::string& references) {
  std::ostringstream os;
  os << std::setprecision(17);
  os << "{\"format\":\"kreoda-project\",\"schemaVersion\":1,"
     << "\"appVersion\":\"0.1.0\",\"documentId\":\"" << escape(documentId)
     << "\",\"units\":\"mm\",\"bodies\":" << SerializeBodiesJson()
     << ",\"referencePlanesJson\":\"" << escape(references) << "\"}";
  return os.str();
}

// Rebuilds graph nodes from the stores with clean flags (open/undo/redo:
// geometry is current, nothing pending, §53). Sketches are nodes too;
// solids carry their sketch/feature deps.
void SyncGraphFromStore() {
  TheFeatureGraph().clear();
  for (const auto& datum : DatumStore::instance().listInOrder()) {
    TheFeatureGraph().addFeature(datum.featureId, datum.dependsOn);
    TheFeatureGraph().clearDirty(datum.featureId);
  }
  for (const auto& sk : SketchStore::instance().listInOrder()) {
    TheFeatureGraph().addFeature(sk.id, SketchDependencies(sk));
    TheFeatureGraph().clearDirty(sk.id);
  }
  for (const auto& rec : ShapeStore::instance().listInOrder()) {
    TheFeatureGraph().addFeature(rec.featureId, rec.dependsOn);
    TheFeatureGraph().clearDirty(rec.featureId);
  }
}

std::string undo_counts_body() {
#if KREODA_WITH_OCCT
  std::ostringstream os;
  os << std::setprecision(17);
  os << "\"undos\":" << OcafLive::instance().AvailableUndos()
     << ",\"redos\":" << OcafLive::instance().AvailableRedos();
  return os.str();
#else
  return "\"undos\":0,\"redos\":0";
#endif
}

// C5: a failed Open/Import must not destroy the current document.
// Snapshot everything create() would clear (stores + registry + OCAF backup)
// and restore it on any fallible step.
struct DocSnapshot {
  std::vector<ShapeRecord> shapes;
  std::vector<SketchFeature> sketches;
  std::vector<DatumRecord> datums;
  std::vector<ExpressionEntry> exprs;
  std::vector<BodyRecord> bodies;  // Slice 2: failed Open restores tips too
  std::map<std::string, std::string> registry;
  int64_t revision = 0;
  std::string docId;
  std::string references;
  std::string ocafBackupDir;
  std::string ocafBackupXbf;
  bool hasOcafBackup = false;
  bool hadContent = false;
};

DocSnapshot takeDocSnapshot(const std::string& docId) {
  DocSnapshot s;
  s.shapes = ShapeStore::instance().listInOrder();
  s.sketches = SketchStore::instance().listInOrder();
  s.datums = DatumStore::instance().listInOrder();
  s.exprs = ExpressionStore::instance().listInOrder();
  s.bodies = BodyStore::instance().bodies();
  s.registry = DocumentStore::instance().snapshotRegistry();
  s.revision = DocumentStore::instance().snapshotRevision();
  s.docId = DocumentStore::instance().snapshotDocumentId();
  s.references = DocumentStore::instance().referencePlanesJson();
  (void)docId;
  s.hadContent = !s.shapes.empty() || !s.sketches.empty() || !s.datums.empty();
#if KREODA_WITH_OCCT
  if (s.hadContent) {
    std::error_code ec;
    std::string tmp = uniqueTempDir("kreoda-backup", ec);
    if (!tmp.empty()) {
      std::string xbf = (fs::path(tmp) / "backup.xbf").string();
      std::string err;
      if (OcafLive::instance().Save(xbf, &err)) {
        s.ocafBackupDir = tmp;
        s.ocafBackupXbf = xbf;
        s.hasOcafBackup = true;
      } else {
        fs::remove_all(tmp, ec);
      }
    }
  }
#endif
  return s;
}

void restoreDocSnapshot(const DocSnapshot& s) {
  ShapeStore::instance().clear();
  for (const auto& r : s.shapes) ShapeStore::instance().put(r);
  BodyStore::instance().replaceAll(s.bodies);  // Slice 2: tips survive abort
  DatumStore::instance().clear();
  for (const auto& datum : s.datums) DatumStore::instance().put(datum);
  SketchStore::instance().clear();
  for (const auto& sk : s.sketches) SketchStore::instance().put(sk);
  ExpressionStore::instance().clear();
  for (const auto& e : s.exprs) ExpressionStore::instance().set(e.featureId, e.paramName, e.expression);
  DocumentStore::instance().restoreSnapshot(s.docId, s.revision, s.registry);
  DocumentStore::instance().setReferencePlanesJson(s.references);
#if KREODA_WITH_OCCT
  if (s.hasOcafBackup) {
    std::vector<ShapeRecord> recs;
    std::vector<std::string> sks;
    std::string err;
    // Reload the backup into the live doc, then rebuild maps.
    if (OcafLive::instance().Load(s.ocafBackupXbf, &recs, &sks, &err)) {
      std::string rsErr;
      OcafLive::instance().ResyncStore(&rsErr);
    } else {
      std::string rsErr;
      OcafLive::instance().ResyncStore(&rsErr);
    }
    std::error_code ec;
    fs::remove_all(s.ocafBackupDir, ec);
  } else {
    // Was empty before: Reset is already the right OCAF state; just rebuild
    // maps so aborted labels never dangle (C7).
    std::string rsErr;
    OcafLive::instance().ResyncStore(&rsErr);
  }
#endif
  SyncGraphFromStore();
}

void discardDocSnapshot(const DocSnapshot& s) {
  if (s.hasOcafBackup) {
    std::error_code ec;
    fs::remove_all(s.ocafBackupDir, ec);
  }
}

#ifdef _WIN32
protocol::save_publish_retry::TargetState probeRenameTarget(
    const fs::path& finalPath, const std::error_code& renameError) {
  if (renameError.category() != std::system_category() ||
      (renameError.value() != ERROR_ACCESS_DENIED &&
       renameError.value() != ERROR_SHARING_VIOLATION)) {
    return protocol::save_publish_retry::TargetState::NonRetryable;
  }

  const DWORD attributes = GetFileAttributesW(finalPath.c_str());
  if (attributes == INVALID_FILE_ATTRIBUTES ||
      (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0 ||
      (attributes & FILE_ATTRIBUTE_READONLY) != 0) {
    return protocol::save_publish_retry::TargetState::NonRetryable;
  }

  // MoveFileEx reports ERROR_ACCESS_DENIED (5) when an existing target's
  // handle omitted FILE_SHARE_DELETE. Probe DELETE access to distinguish that
  // transient sharing lock from ACL/read-only failures that must fail now.
  HANDLE probe = CreateFileW(finalPath.c_str(), DELETE,
                             FILE_SHARE_READ | FILE_SHARE_WRITE |
                                 FILE_SHARE_DELETE,
                             nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL,
                             nullptr);
  if (probe != INVALID_HANDLE_VALUE) {
    CloseHandle(probe);
    return protocol::save_publish_retry::TargetState::DeleteAvailable;
  }
  const DWORD probeError = GetLastError();
  if (probeError == ERROR_SHARING_VIOLATION ||
      probeError == ERROR_LOCK_VIOLATION) {
    return protocol::save_publish_retry::TargetState::DeleteShareLocked;
  }
  return protocol::save_publish_retry::TargetState::NonRetryable;
}
#endif

// Phase 10.5 (crash recovery): a killed save must never leave a partially
// written project behind. Writers produce a temp sibling in the SAME
// directory (same filesystem → atomic rename); the destination is replaced
// only by a complete file. On any failure the previous file is untouched.
template <typename Writer>
bool saveAtomically(const std::string& finalPath, Writer&& write,
                    std::string* error) {
  std::error_code ec;
  fs::create_directories(fs::path(finalPath).parent_path(), ec);
  // m8: pid-qualified temp names — a second sidecar process (or a restart
  // after a kill) restarts the counter at 0, so the counter alone would
  // clobber another process's in-flight temp. Same-dir sibling keeps the
  // rename on one filesystem (atomic publish). A kill between write and
  // rename can still leave a <name>.tmp-<pid>-<n> sibling behind (litter,
  // never corruption — the destination is only ever replaced whole).
  static std::atomic<unsigned long> saveCounter{0};
#ifdef _WIN32
  const unsigned long pid = static_cast<unsigned long>(GetCurrentProcessId());
#else
  const unsigned long pid = static_cast<unsigned long>(getpid());
#endif
  std::ostringstream tmpName;
  tmpName << fs::path(finalPath).filename().string() << ".tmp-" << pid << "-"
          << saveCounter.fetch_add(1);
  const std::string tmpPath =
      (fs::path(finalPath).parent_path() / tmpName.str()).string();
  if (!write(tmpPath, error)) {
    std::error_code rm;
    fs::remove(tmpPath, rm);
    return false;
  }
  CrashTestBarrier("save-before-publish");
  fs::rename(tmpPath, finalPath, ec);
#ifdef _WIN32
  if (ec) {
    const auto deadline = std::chrono::steady_clock::now() +
                          std::chrono::milliseconds(200);
    auto backoff = std::chrono::milliseconds(10);
    bool retriedWithDeleteAvailable = false;
    while (ec && std::chrono::steady_clock::now() < deadline) {
      const auto targetState = probeRenameTarget(finalPath, ec);
      const auto decision = protocol::save_publish_retry::Decide(
          targetState, retriedWithDeleteAvailable);
      if (decision == protocol::save_publish_retry::Decision::Stop) break;
      if (decision == protocol::save_publish_retry::Decision::Wait) {
        const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(
            deadline - std::chrono::steady_clock::now());
        if (remaining <= std::chrono::milliseconds::zero()) break;
        std::this_thread::sleep_for(std::min(backoff, remaining));
      }
      ec.clear();
      fs::rename(tmpPath, finalPath, ec);
      backoff = std::min(backoff * 2, std::chrono::milliseconds(20));
    }
  }
#endif
  if (ec) {
    // m9: no remove+rename fallback by design — if the destination is locked
    // (viewer/AV), a fallback could remove the good file and then fail the
    // rename, destroying data. The honest error below leaves the previous
    // file untouched and cleans the temp (proven by the atomic-overwrite
    // torture test).
    if (error) *error = "save: publish failed: " + ec.message();
    std::error_code rm;
    fs::remove(tmpPath, rm);
    return false;
  }
  return true;
}

}  // namespace

std::string json_string_field(const std::string& text, const char* key, const std::string& fallback) {
  try { return json_string_field(parse_json_object(text), key, fallback); }
  catch (const JsonFieldError&) { return fallback; }
}
std::string json_string_field_strict(const std::string& text, const char* key, const std::string& fallback) {
  return json_string_field(text, key, fallback);
}
bool json_has_key(const std::string& text, const char* key) {
  return json_has_key(parse_json_object(text), key);
}
bool json_double_strict(const std::string& text, const char* key, double* out) {
  return json_double_strict(parse_json_object(text), key, out);
}
int json_int_field(const std::string& text, const char* key, int fallback) {
  try { return json_int_field(parse_json_object(text), key, fallback); }
  catch (const JsonFieldError&) { return fallback; }
}
double json_double_field(const std::string& text, const char* key, double fallback) {
  try { return json_double_field(parse_json_object(text), key, fallback); }
  catch (const JsonFieldError&) { return fallback; }
}

std::vector<uint8_t> make_response(const std::string& requestId,
                                   const std::string& status,
                                   const std::string& bodyJson) {
  std::ostringstream os;
  os << std::setprecision(17);
  os << "{\"protocolVersion\":1,\"requestId\":\"" << escape(requestId)
     << "\",\"status\":\"" << status << "\"," << bodyJson << "}";
  const std::string s = os.str();
  return std::vector<uint8_t>(s.begin(), s.end());
}

std::vector<uint8_t> make_error_response(const std::string& requestId,
                                         const std::string& code,
                                         const std::string& message) {
  return make_response(requestId, "error", error_body(code, message));
}

namespace {
// Mesh success responses (§8: mesh data must not be JSON). Errors stay JSON.
// The encoded-mesh cache lives here (file scope) so fresh baselines can
// drop it: revision resets to 0 on Create/Open, and the document id in the
// key alone is not enough to bound growth across sessions (C6).
// It stores CoreMesh (not encoded bytes): the FlatBuffers table echoes the
// per-request requestId for sidecar correlation (C15), so encoding happens
// fresh on every hit while the dominant cost — tessellation — is skipped.
std::map<std::string, CoreMesh>& MeshCache() {
  static std::map<std::string, CoreMesh> cache;
  return cache;
}
std::vector<uint8_t> mesh_success(const std::string& requestId,
                                  const std::string& featureId, int lod,
                                  const CoreMesh& mesh, std::string* error) {
#if KREODA_WITH_FLATBUFFERS
  std::vector<uint8_t> fb = BuildMeshUpdateFb(
      featureId, lod, mesh, DocumentStore::instance().revision(), requestId,
      error);
  if (fb.empty() && error && error->empty())
    *error = "mesh encode failed";
  return fb;
#else
  (void)requestId;
  (void)featureId;
  (void)lod;
  (void)mesh;
  if (error) *error = "mesh binary requires FlatBuffers (link via vcpkg)";
  return {};
#endif
}
}  // namespace

static std::vector<uint8_t> handle_command_typed(const Json& requestJson) {
  const std::string requestId = json_string_field(requestJson, "requestId", "");
  const int type = json_int_field(requestJson, "type", 0);
  const std::string documentId =
      json_string_field(requestJson, "documentId", "doc-phase1");

  // Envelope gate (§63.10, bug-hunt C3): ids/paths must be inert strings —
  // no quotes/controls that could confuse field extraction or the fs layer.
  // Envelope scalar types were checked before dispatch; ids retain the
  // existing canonical character/range gate.
  auto cleanId = [](const std::string& s) {
    if (s.size() > 128) return false;
    for (unsigned char c : s) {
      if (!(c >= 'A' && c <= 'Z') && !(c >= 'a' && c <= 'z') &&
          !(c >= '0' && c <= '9') && c != '_' && c != '-') {
        return false;
      }
    }
    return true;
  };
  if (!cleanId(documentId)) {
    return make_response(requestId, "error",
                         error_body("BAD_ENVELOPE", "bad documentId"));
  }
  if ((type == kCreateDocument || type == kOpenDocument) &&
      documentId.empty()) {
    return make_response(requestId, "error",
                         error_body("BAD_ENVELOPE",
                                    "documentId is required for lifecycle"));
  }
  // A stale or confused client must not mutate whichever document happens
  // to be active: every command except document lifecycle must name it.
  if (type != kCreateDocument && type != kOpenDocument &&
      type != kGetCoreInfo &&
      documentId != DocumentStore::instance().snapshotDocumentId()) {
    return make_response(requestId, "error",
                         error_body("DOCUMENT_MISMATCH",
                                    "documentId is not the open document"));
  }
  // Paths reach both field extraction and the fs layer: quotes/controls
  // are never legitimate there (C3).
  auto cleanPath = [](const std::string& s) {
    if (s.empty() || s.size() > 1024) return false;
    for (unsigned char c : s) {
      if (c < 0x20 || c == '"') return false;
    }
    return true;
  };

  // An abandoned transaction must not fence the document forever: roll it
  // back once its owner has been idle past the timeout.
  OcafLive::instance().ExpireStaleTransaction();

  // §11.12 transaction fence: while a session transaction is open, only
  // joined mutating commands (carrying the owner's transactionId), the
  // transaction control commands, read-only queries and transient previews
  // may run. Document-lifecycle and history commands (create/undo/redo/
  // save/open) are always fenced — they would entangle the atomic unit.
  // Everything else is rejected honestly instead of silently joining
  // another client's transaction.
  if (OcafLive::instance().InTransaction() && type != kBeginTransaction &&
      type != kCommitTransaction && type != kRollbackTransaction) {
    const bool readOnly =
        type == kGetCoreInfo || type == kRequestMesh ||
        type == kRequestSketch || type == kPreviewSketch ||
        type == kRequestFaceInfo || type == kRequestSnapshot || type == kRequestSessionQuery || type == kRequestDatum || type == kQueryConfigurations ||
        type == kRequestSketchProjection;
    const bool preview =
        (type == kSetFeatureParameter || type == kUpdateSketch) &&
        (json_bool_field(requestJson, "isPreview"));
      const bool lifecycle =
          type == kCreateDocument || type == kUndo || type == kRedo ||
          type == kSaveDocument || type == kOpenDocument;
      // Read-only queries and transient previews always pass (they observe
      // the document without joining the atomic unit). Lifecycle/history
      // commands are always fenced; other mutating commands must carry the
      // owner's transactionId.
      if (!readOnly && !preview) {
        const std::string tid =
            json_string_field(requestJson, "transactionId", "");
        if (lifecycle || tid.empty() ||
            tid != OcafLive::instance().TransactionOwner()) {
          return make_response(requestId, "error",
                               error_body("TRANSACTION_OPEN",
                                          "a session transaction is in progress — "
                                          "join it with its transactionId or wait"));
        }
      }
  }

  switch (type) {
    case kCreateDatumPlane:
    case kCreateDatumAxis:
    case kCreateDatumPoint:
    case kUpdateDatum: {
      const auto id=json_string_field(requestJson,"featureId","");
      if(!requestJson.contains("definition")||!requestJson["definition"].is_object())
        return make_response(requestId,"error",error_body("BAD_PARAMS","definition must be an object"));
      std::string error;
      const auto definition=requestJson["definition"].dump();
      const auto kind=type==kCreateDatumPlane?DatumKind::Plane:type==kCreateDatumAxis?DatumKind::Axis:DatumKind::Point;
      const bool success=type==kUpdateDatum?UpdateDatumFeature(id,definition,&error):CreateDatumFeature(id,kind,definition,&error);
      if(!success)return make_response(requestId,"error",error_body("DATUM_FAILED",error));
      DatumRecord record;DatumStore::instance().get(id,&record);
      return make_response(requestId,"ok","\"datum\":"+SerializeDatumRecord(record)+","+feature_list_body());
    }
    case kRequestDatum: {
      const auto id=json_string_field(requestJson,"featureId","");DatumRecord record;
      if(!ShapeStore::ValidFeatureId(id))return make_response(requestId,"error",error_body("BAD_PARAMS","invalid featureId"));
      if(!DatumStore::instance().get(id,&record))return make_response(requestId,"error",error_body("NOT_FOUND",id));
      return make_response(requestId,"ok","\"datum\":"+SerializeDatumRecord(record)+",\"revision\":"+std::to_string(DocumentStore::instance().revision()));
    }
    case kSetSketchProjection: {
      std::string error;
      if (!projection_request_fields_valid(requestJson,
              {"featureId", "groupId", "definition"}, &error))
        return make_response(requestId, "error", error_body("BAD_PARAMS", error));
      const auto featureId = json_string_field(requestJson, "featureId", "");
      const auto groupId = json_string_field(requestJson, "groupId", "");
      if (!ShapeStore::ValidFeatureId(featureId) ||
          !ShapeStore::ValidFeatureId(groupId))
        return make_response(requestId, "error",
                             error_body("BAD_PARAMS", "invalid sketch or projection group id"));
      SketchFeature sketch;
      if (!SketchStore::instance().get(featureId, &sketch))
        return make_response(requestId, "error", error_body("NOT_FOUND", featureId));
      if (!requestJson.contains("definition") ||
          !requestJson.at("definition").is_object())
        return make_response(requestId, "error",
                             error_body("BAD_PARAMS", "definition must be an object"));
      std::string canonical;
      std::vector<std::string> sourceIds;
      if (!ValidateSketchProjectionDefinition(groupId,
              requestJson.at("definition").dump(), &canonical, &sourceIds, &error))
        return make_response(requestId, "error", error_body("BAD_PARAMS", error));
      if (!SetSketchProjectionGroup(featureId, groupId, canonical, &error))
        return make_response(requestId, "error", error_body("PROJECTION_FAILED", error));
      if (!SketchStore::instance().get(featureId, &sketch))
        return make_response(requestId, "error",
                             error_body("PROJECTION_FAILED", "updated sketch disappeared"));
      return make_response(requestId, "ok", sketch_body(sketch));
    }
    case kRemoveSketchProjection: {
      std::string error;
      if (!projection_request_fields_valid(requestJson,
              {"featureId", "groupId"}, &error))
        return make_response(requestId, "error", error_body("BAD_PARAMS", error));
      const auto featureId = json_string_field(requestJson, "featureId", "");
      const auto groupId = json_string_field(requestJson, "groupId", "");
      if (!ShapeStore::ValidFeatureId(featureId) ||
          !ShapeStore::ValidFeatureId(groupId))
        return make_response(requestId, "error",
                             error_body("BAD_PARAMS", "invalid sketch or projection group id"));
      SketchFeature sketch;
      if (!SketchStore::instance().get(featureId, &sketch))
        return make_response(requestId, "error", error_body("NOT_FOUND", featureId));
      if (std::none_of(sketch.projectionGroups.begin(), sketch.projectionGroups.end(),
              [&](const auto& group) { return group.groupId == groupId; }))
        return make_response(requestId, "error", error_body("NOT_FOUND", groupId));
      if (!RemoveSketchProjectionGroup(featureId, groupId, &error))
        return make_response(requestId, "error", error_body("PROJECTION_FAILED", error));
      if (!SketchStore::instance().get(featureId, &sketch))
        return make_response(requestId, "error",
                             error_body("PROJECTION_FAILED", "updated sketch disappeared"));
      return make_response(requestId, "ok", sketch_body(sketch));
    }
    case kRequestSketchProjection: {
      std::string error;
      if (!projection_request_fields_valid(requestJson,
              {"featureId", "groupId"}, &error))
        return make_response(requestId, "error", error_body("BAD_PARAMS", error));
      const auto featureId = json_string_field(requestJson, "featureId", "");
      if (!ShapeStore::ValidFeatureId(featureId))
        return make_response(requestId, "error",
                             error_body("BAD_PARAMS", "invalid sketch featureId"));
      const bool hasGroupId = requestJson.contains("groupId");
      const auto groupId = json_string_field(requestJson, "groupId", "");
      if (hasGroupId && !ShapeStore::ValidFeatureId(groupId))
        return make_response(requestId, "error",
                             error_body("BAD_PARAMS", "invalid projection groupId"));
      SketchFeature sketch;
      if (!SketchStore::instance().get(featureId, &sketch))
        return make_response(requestId, "error", error_body("NOT_FOUND", featureId));
      if (hasGroupId && std::none_of(sketch.projectionGroups.begin(),
              sketch.projectionGroups.end(), [&](const auto& group) {
                return group.groupId == groupId;
              }))
        return make_response(requestId, "error", error_body("NOT_FOUND", groupId));
      std::string projection;
      if (!SerializeSketchProjectionQuery(sketch, groupId, &projection, &error))
        return make_response(requestId, "error", error_body("QUERY_FAILED", error));
      const Json body = {{"projection", Json::parse(projection)},
                         {"documentId", DocumentStore::instance().snapshotDocumentId()},
                         {"revision", DocumentStore::instance().revision()}};
      const auto serialized = body.dump();
      return make_response(requestId, "ok",
                           serialized.substr(1, serialized.size() - 2));
    }
    case kRequestSessionQuery: {
      try {
        const auto method = json_string_field(requestJson,"method","");
        const auto params = requestJson.value("params", Json::object());
        const auto result = RunSessionGeometryQuery(method,params);
        const Json body={{"result",result},{"revision",DocumentStore::instance().revision()}};
        const auto text=body.dump();
        return make_response(requestId,"ok",text.substr(1,text.size()-2));
      } catch (const SessionQueryError& e) {
        return make_response(requestId,"error",error_body(e.code,e.what()));
      }
    }
    case kGetCoreInfo: {
      std::ostringstream body;
      body << "\"coreVersion\":\"0.1.0\",\"occtVersion\":\""
#if KREODA_WITH_OCCT
           << "8.0.1-native"
#else
           << "stub-unlinked"
#endif
           << "\",\"revision\":" << DocumentStore::instance().revision()
           << "," << undo_counts_body();
      return make_response(requestId, "ok", body.str());
    }
    case kCreateDocument: {
      DocumentStore::instance().create(documentId);
      MeshCache().clear();  // fresh baseline: drop all encoded meshes (C6)
      std::ostringstream body;
      body << "\"documentId\":\"" << escape(documentId) << "\",\"revision\":"
           << DocumentStore::instance().revision();
      return make_response(requestId, "ok", body.str());
    }
    case kCreateBox: {
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      const double w = json_double_field(requestJson, "widthMm",
                                         json_double_field(requestJson, "width", 0));
      const double h = json_double_field(requestJson, "heightMm",
                                         json_double_field(requestJson, "height", 0));
      const double d = json_double_field(requestJson, "depthMm",
                                         json_double_field(requestJson, "depth", 0));
      std::string error;
      if (!CreateBoxFeature(featureId, w, h, d, &error)) {
        return make_response(requestId, "error",
                             error_body("INVALID_BOX", error));
      }
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateCylinder: {
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      const double r = json_double_field(requestJson, "radiusMm",
                                         json_double_field(requestJson, "radius", 0));
      const double h = json_double_field(requestJson, "heightMm",
                                         json_double_field(requestJson, "height", 0));
      std::string error;
      if (!CreateCylinderFeature(featureId, r, h, &error)) {
        return make_response(requestId, "error",
                             error_body("INVALID_CYLINDER", error));
      }
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateSphere: {
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      const double r = json_double_field(requestJson, "radiusMm",
                                         json_double_field(requestJson, "radius", 0));
      std::string error;
      if (!CreateSphereFeature(featureId, r, &error)) {
        return make_response(requestId, "error",
                             error_body("INVALID_SPHERE", error));
      }
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kRequestMesh: {
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      if (!requestJson.contains("featureId") || !requestJson["featureId"].is_string() ||
          !ShapeStore::ValidFeatureId(featureId) ||
          (requestJson.contains("lod") &&
           (!requestJson["lod"].is_number_integer() ||
            requestJson["lod"].get<int>() < 0 || requestJson["lod"].get<int>() > 2)))
        return make_response(requestId,"error",error_body("BAD_PARAMS",
          "RequestMesh needs valid featureId and lod 0, 1 or 2"));
      const int lod = json_int_field(requestJson, "lod", 1);
      std::string availabilityError;
      if (!EnsureGeometryAvailable(featureId, &availabilityError))
        return make_response(requestId, "error",
                             error_body("MESH_FAILED", availabilityError));
      // Revision-keyed response cache (Phase 8 large-model slice): reopen /
      // undo / redo re-pull identical meshes constantly; tessellation +
      // encoding dominate the cost. The (document, revision) in the key
      // invalidates on every commit AND every fresh baseline (revision
      // resets to 0 on Open/Create — a bare revision key would serve
      // another document's bytes, C6); a full clear bounds memory.
      // Responses are FlatBuffers MeshUpdate tables (§8); errors stay JSON.
      auto& meshCache = MeshCache();
      const std::string cacheKey =
          documentId + "|" + featureId + "|" + std::to_string(lod) + "|" +
          std::to_string(DocumentStore::instance().revision());
      const auto cached = meshCache.find(cacheKey);
      if (cached != meshCache.end()) {
        std::string error;
        std::vector<uint8_t> body =
            mesh_success(requestId, featureId, lod, cached->second, &error);
        if (body.empty()) {
          return make_response(requestId, "error",
                               error_body("MESH_FAILED", error.empty()
                                                             ? "encode failed"
                                                             : error));
        }
        return body;
      }
      std::string error;
      const CoreMesh mesh = TessellateFeature(featureId, lod, &error);
      if (mesh.indices.empty()) {
        return make_response(requestId, "error",
                             error_body("MESH_FAILED", error.empty()
                                                           ? "empty mesh"
                                                           : error));
      }
      std::vector<uint8_t> body =
          mesh_success(requestId, featureId, lod, mesh, &error);
      if (body.empty()) {
        return make_response(requestId, "error",
                             error_body("MESH_FAILED", error.empty()
                                                           ? "encode failed"
                                                           : error));
      }
      if (meshCache.size() >= 64) meshCache.clear();
      meshCache[cacheKey] = mesh;
      return body;
    }
    case kSaveDocument: {
      const std::string path = json_string_field(requestJson, "path", "");
      if (!cleanPath(path)) {
        return make_response(requestId, "error",
                             error_body("BAD_PATH", "path is required"));
      }
      // Extension dispatch (Phase 8 §61): .icad stays native, .step/.stp goes
      // through AP214 exchange, anything else gets an honest pointer.
      std::string ext = fs::path(path).extension().string();
      for (char& c : ext) c = static_cast<char>(std::tolower(c));
      if (ext == ".step" || ext == ".stp") {
        std::string error;
        if (!saveAtomically(
                path,
                [](const std::string& tmp, std::string* e) {
                  return ExportStep(tmp, e);
                },
                &error)) {
          return make_response(requestId, "error",
                               error_body("EXPORT_FAILED", error));
        }
        std::ostringstream body;
        body << "\"path\":\"" << escape(path) << "\"," << feature_list_body();
        return make_response(requestId, "ok", body.str());
      }
      if (ext == ".3mf") {
        std::string error;
        if (!saveAtomically(
                path,
                [](const std::string& tmp, std::string* e) {
                  return ExportThreeMF(tmp, e);
                },
                &error)) {
          return make_response(requestId, "error",
                               error_body("EXPORT_FAILED", error));
        }
        std::ostringstream body;
        body << "\"path\":\"" << escape(path) << "\"," << feature_list_body();
        return make_response(requestId, "ok", body.str());
      }
      if (ext == ".stl") {
        std::string error;
        if (!saveAtomically(
                path,
                [](const std::string& tmp, std::string* e) {
                  return ExportStl(tmp, e);
                },
                &error)) {
          return make_response(requestId, "error",
                               error_body("EXPORT_FAILED", error));
        }
        std::ostringstream body;
        body << "\"path\":\"" << escape(path) << "\"," << feature_list_body();
        return make_response(requestId, "ok", body.str());
      }
      if (ext == ".obj") {
        std::string error;
        if (!saveAtomically(
                path,
                [](const std::string& tmp, std::string* e) {
                  return ExportObj(tmp, e);
                },
                &error)) {
          return make_response(requestId, "error",
                               error_body("EXPORT_FAILED", error));
        }
        std::ostringstream body;
        body << "\"path\":\"" << escape(path) << "\"," << feature_list_body();
        return make_response(requestId, "ok", body.str());
      }
      if (ext == ".gltf") {
        std::string error;
        if (!saveAtomically(
                path,
                [](const std::string& tmp, std::string* e) {
                  return ExportGltf(tmp, e);
                },
                &error)) {
          return make_response(requestId, "error",
                               error_body("EXPORT_FAILED", error));
        }
        std::ostringstream body;
        body << "\"path\":\"" << escape(path) << "\"," << feature_list_body();
        return make_response(requestId, "ok", body.str());
      }
      if (ext == ".glb") {
        std::string error;
        if (!saveAtomically(
                path,
                [](const std::string& tmp, std::string* e) {
                  return ExportGlb(tmp, e);
                },
                &error)) {
          return make_response(requestId, "error",
                               error_body("EXPORT_FAILED", error));
        }
        std::ostringstream body;
        body << "\"path\":\"" << escape(path) << "\"," << feature_list_body();
        return make_response(requestId, "ok", body.str());
      }
      // Opaque renderer metadata is escaped as one string, never injected
      // into the manifest. Older clients preserve it when omitting the field.
      const std::string references = json_string_field_strict(
          requestJson, "referencePlanesJson",
          DocumentStore::instance().referencePlanesJson());
      if (references.size() > 100 * 1024 * 1024) {
        return make_response(requestId, "error",
                             error_body("SAVE_FAILED", "reference metadata too large"));
      }
      std::error_code ec;
      const std::string tmp = uniqueTempDir("kreoda-save", ec);
      if (tmp.empty()) {
        return make_response(requestId, "error",
                             error_body("IO_ERROR", "no temp dir"));
      }
      const std::string xbf = (fs::path(tmp) / "document.xbf").string();
      std::string error;
      if (!OcafLive::instance().Save(xbf, &error)) {
        fs::remove_all(tmp, ec);
        return make_response(requestId, "error",
                             error_body("SAVE_FAILED", error));
      }
      fs::create_directories(fs::path(path).parent_path(), ec);
      const std::string manifest = manifest_json(documentId, references);
      if (!saveAtomically(
              path,
              [&](const std::string& tmp, std::string* e) {
                return WriteIcad(tmp, manifest, xbf, e);
              },
              &error)) {
        fs::remove_all(tmp, ec);
        return make_response(requestId, "error",
                             error_body("SAVE_FAILED", error));
      }
      fs::remove_all(tmp, ec);
      DocumentStore::instance().setReferencePlanesJson(references);
      std::ostringstream body;
      body << "\"path\":\"" << escape(path) << "\"," << feature_list_body();
      return make_response(requestId, "ok", body.str());
    }
    case kOpenDocument: {
      const std::string path = json_string_field(requestJson, "path", "");
      if (!cleanPath(path) || !fs::exists(fs::path(path))) {
        return make_response(requestId, "error",
                             error_body("BAD_PATH", "file not found: " + path));
      }
      std::string ext = fs::path(path).extension().string();
      for (char& c : ext) c = static_cast<char>(std::tolower(c));
      // C5: snapshot BEFORE any create() — every branch below replaces the
      // document, and a corrupt file must not destroy current work. If the
      // current document has content but OCAF could not be backed up, the
      // restore below could not bring it back: refuse instead of risking a
      // silent wipe.
      DocSnapshot backup = takeDocSnapshot(documentId);
      if (backup.hadContent && !backup.hasOcafBackup) {
        return make_response(requestId, "error",
                             error_body("OPEN_FAILED",
                                        "cannot open safely: OCAF backup "
                                        "unavailable; current document was "
                                        "left untouched"));
      }
      if (ext == ".step" || ext == ".stp") {
        // STEP import replaces the document (same as Open): fresh baseline,
        // one StepImport feature per solid in a single Undo step.
        std::string error;
        std::vector<std::string> created;
        DocumentStore::instance().create(documentId);
        if (!ImportStep(path, &created, &error)) {
          restoreDocSnapshot(backup);
          return make_response(requestId, "error",
                               error_body("OPEN_FAILED", error));
        }
        CrashTestBarrier("step-import-before-adoption");
        for (const auto& id : created) {
          ShapeRecord rec;
          DocumentStore::instance().noteFeature(
              id, ShapeStore::instance().get(id, &rec) ? rec.type
                                                      : "StepImport");
        }
        SyncGraphFromStore();
        DocumentStore::instance().commit();
        MeshCache().clear();
        discardDocSnapshot(backup);
        std::ostringstream body;
        body << "\"path\":\"" << escape(path) << "\"," << feature_list_body();
        return make_response(requestId, "ok", body.str());
      }
      if (ext == ".3mf") {
        // 3MF import replaces the document: one MeshImport feature per
        // closed mesh in a single Undo step.
        std::string error;
        std::vector<std::string> created;
        DocumentStore::instance().create(documentId);
        if (!ImportThreeMF(path, &created, &error)) {
          restoreDocSnapshot(backup);
          return make_response(requestId, "error",
                               error_body("OPEN_FAILED", error));
        }
        for (const auto& id : created) {
          ShapeRecord rec;
          DocumentStore::instance().noteFeature(
              id, ShapeStore::instance().get(id, &rec) ? rec.type
                                                      : "MeshImport");
        }
        SyncGraphFromStore();
        DocumentStore::instance().commit();
        MeshCache().clear();
        discardDocSnapshot(backup);
        std::ostringstream body;
        body << "\"path\":\"" << escape(path) << "\"," << feature_list_body();
        return make_response(requestId, "ok", body.str());
      }
      if (ext == ".stl") {
        // STL import replaces the document: triangulation sewn into
        // MeshImport solids in a single Undo step (unitless file — mm).
        std::string error;
        std::vector<std::string> created;
        DocumentStore::instance().create(documentId);
        if (!ImportStl(path, &created, &error)) {
          restoreDocSnapshot(backup);
          return make_response(requestId, "error",
                               error_body("OPEN_FAILED", error));
        }
        for (const auto& id : created) {
          ShapeRecord rec;
          DocumentStore::instance().noteFeature(
              id, ShapeStore::instance().get(id, &rec) ? rec.type
                                                      : "MeshImport");
        }
        SyncGraphFromStore();
        DocumentStore::instance().commit();
        MeshCache().clear();
        discardDocSnapshot(backup);
        std::ostringstream body;
        body << "\"path\":\"" << escape(path) << "\"," << feature_list_body();
        return make_response(requestId, "ok", body.str());
      }
      if (ext == ".obj" || ext == ".gltf" || ext == ".glb") {
        // OBJ/glTF import replaces the document: one MeshImport feature per
        // closed mesh in a single Undo step (glTF meters → mm on import).
        std::string error;
        std::vector<std::string> created;
        DocumentStore::instance().create(documentId);
        bool ok = (ext == ".obj")
                      ? ImportObj(path, &created, &error)
                      : ImportGltf(path, &created, &error);
        if (!ok) {
          restoreDocSnapshot(backup);
          return make_response(requestId, "error",
                               error_body("OPEN_FAILED", error));
        }
        for (const auto& id : created) {
          ShapeRecord rec;
          DocumentStore::instance().noteFeature(
              id, ShapeStore::instance().get(id, &rec) ? rec.type
                                                      : "MeshImport");
        }
        SyncGraphFromStore();
        DocumentStore::instance().commit();
        MeshCache().clear();
        discardDocSnapshot(backup);
        std::ostringstream body;
        body << "\"path\":\"" << escape(path) << "\"," << feature_list_body();
        return make_response(requestId, "ok", body.str());
      }
      std::error_code ec;
      const std::string tmp = uniqueTempDir("kreoda-open", ec);
      if (tmp.empty()) {
        return make_response(requestId, "error",
                             error_body("IO_ERROR", "no temp dir"));
      }
      std::string manifest, xbf;
      std::string error;
      if (!ReadIcad(path, tmp, &manifest, &xbf, &error)) {
        fs::remove_all(tmp, ec);
        return make_response(requestId, "error",
                             error_body("OPEN_FAILED", error));
      }
      const std::string references = json_string_field_strict(manifest, "referencePlanesJson", "[]");
      if (references.size() > 100 * 1024 * 1024) {
        fs::remove_all(tmp, ec);
        discardDocSnapshot(backup);
        return make_response(requestId, "error",
                             error_body("OPEN_FAILED", "reference metadata too large"));
      }
      std::vector<SketchFeature> sketches;
      std::vector<DatumRecord> datums;
      if (!OcafLive::instance().ValidateSketchesInFile(xbf, &sketches, &error, &datums)) {
        fs::remove_all(tmp, ec);
        discardDocSnapshot(backup);
        return make_response(requestId, "error",
                             error_body("OPEN_FAILED", error));
      }
      std::vector<ShapeRecord> records;
      std::vector<BodyRecord> declaredBodies;
      const bool allowEmpty =
          ParseBodiesJson(manifest, &declaredBodies) && declaredBodies.empty() &&
          manifest.find("\"bodies\":[]") != std::string::npos;
      // Fresh baseline BEFORE load (clears stores + OCAF); Load then opens
      // the file into the live doc with all labels (solids, sketches,
      // selections, evolution) intact — no re-mirroring needed.
      // Sketches were fully staged above so malformed labels cannot reach this
      // destructive boundary. C5 backup remains for later open failures.
      // C8: validate adopted Instances (nested/self/missing never open).
      DocumentStore::instance().create(documentId);
      if (!OcafLive::instance().Load(xbf, &records, nullptr, &error,
                                     allowEmpty)) {
        fs::remove_all(tmp, ec);
        restoreDocSnapshot(backup);
        return make_response(requestId, "error",
                             error_body("OPEN_FAILED", error));
      }
      // Adopt into in-memory stores + graph (OCAF already holds the truth).
      // C8 belt-and-braces: Load already drops bad Instances, but a future
      // path must never adopt Instance→Instance/self/ghost either.
      {
        std::map<std::string, std::string> t;
        for (auto& r : records) t[r.featureId] = r.type;
        std::vector<ShapeRecord> kept;
        for (auto& r : records) {
          if (r.type == "Instance") {
            bool bad = r.dependsOn.size() != 1 || r.dependsOn[0] == r.featureId ||
                       t.find(r.dependsOn[0]) == t.end() ||
                       t[r.dependsOn[0]] == "Instance";
            if (bad) continue;
          }
          kept.push_back(r);
        }
        records.swap(kept);
      }
      for (auto& rec : records) {
        ShapeStore::instance().put(rec);
        DocumentStore::instance().noteFeature(rec.featureId, rec.type);
      }
      // Slice 2: adopt persisted bodies when they match the loaded records;
      // legacy files (no bodies section) migrate by the creation-order rule.
      {
        std::vector<BodyRecord> persisted;
        const std::vector<ShapeRecord> ordered =
            ShapeStore::instance().listInOrder();
        if (ParseBodiesJson(manifest, &persisted) &&
            BodiesMatchRecords(persisted, ordered)) {
          BodyStore::instance().replaceAll(persisted);
        } else {
          BodyStore::instance().rebuildFromRecords(ordered);
        }
      }
      for (const auto& datum : datums) {
        DatumStore::instance().put(datum);
        DocumentStore::instance().noteFeature(datum.featureId, DatumTypeName(datum.kind));
      }
      for (const auto& sf : sketches) {
        SketchStore::instance().put(sf);
        DocumentStore::instance().noteFeature(sf.id, "Sketch");
      }
      SyncGraphFromStore();
      DocumentStore::instance().commit();
      MeshCache().clear();
      discardDocSnapshot(backup);
      fs::remove_all(tmp, ec);
      DocumentStore::instance().setReferencePlanesJson(references);
      std::ostringstream body;
      body << "\"path\":\"" << escape(path) << "\",\"referencePlanesJson\":\""
           << escape(references) << "\"," << feature_list_body();
      return make_response(requestId, "ok", body.str());
    }
    case kSetFeatureParameter: {
      // Typed dimension edit (§12, §22): exactly one committed transaction.
      // isPreview=true tessellates the would-be shape WITHOUT committing.
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      const std::string paramName =
          json_string_field(requestJson, "paramName", "");
      // M3: a present-but-garbage valueMm ("evil") must be BAD_PARAMS, not
      // silent 0. hasValue is key presence; strict parse validates numerics.
      const int hasValue = json_has_key(requestJson, "valueMm") ||
                           json_has_key(requestJson, "value");
      double value = 0;
      if (hasValue) {
        bool parsed = json_double_strict(requestJson, "valueMm", &value);
        if (!parsed) parsed = json_double_strict(requestJson, "value", &value);
        if (!parsed) {
          return make_response(requestId, "error",
                               error_body("BAD_PARAMS",
                                          "valueMm must be a JSON number"));
        }
      }
      const bool isPreview =
          json_bool_field(requestJson, "isPreview");
      // Phase 9a: an expression replaces the bare value (validated + stored
      // core-side; evaluated before the DAG recompute).
      const std::string expression =
          json_string_field(requestJson, "expression", "");
      if (featureId.empty() || paramName.empty() ||
          (!hasValue && expression.empty())) {
        return make_response(requestId, "error",
                             error_body("BAD_PARAMS",
                                        "featureId, paramName and valueMm "
                                        "(or expression) are required"));
      }
      if(DatumStore::instance().contains(featureId)) {
        if(isPreview||!expression.empty()||json_has_key(requestJson,"parameterValues"))
          return make_response(requestId,"error",error_body("BAD_PARAMS","datum edit requires one numeric parameter; preview and expressions are unsupported"));
        std::string error;
        if(!SetDatumParameter(featureId,paramName,value,&error))
          return make_response(requestId,"error",error_body("DATUM_FAILED",error));
        DatumRecord record;DatumStore::instance().get(featureId,&record);
        return make_response(requestId,"ok","\"datum\":"+SerializeDatumRecord(record)+","+feature_list_body());
      }
      if (isPreview) {
        // Transient preview (§13): resolved + built + tessellated WITHOUT
        // touching stores, revision, or OCAF. Never committed.
        double previewValue = value;
        std::string error;
        CoreMesh mesh;
        const std::string previewTipId = json_string_field(requestJson, "previewTipId", "");
        if (requestJson.contains("previewTipId") &&
            (!requestJson["previewTipId"].is_string() || previewTipId.empty())) {
          return make_response(requestId, "error", error_body("BAD_PARAMS", "previewTipId must be a non-empty feature id"));
        }
        std::map<std::string, double> otherValues;
        if (requestJson.contains("previewValues")) {
          const auto& values = requestJson["previewValues"];
          if (!values.is_object() || values.size() > 5 || values.contains(paramName)) {
            return make_response(requestId, "error", error_body("BAD_PARAMS", "previewValues must contain at most five distinct additional parameters"));
          }
          for (const auto& [name, value] : values.items()) {
            if (!value.is_number() || !std::isfinite(value.get<double>())) {
              return make_response(requestId, "error", error_body("BAD_PARAMS", "previewValues must be finite numbers"));
            }
            otherValues[name] = value.get<double>();
          }
        }
        const bool useBodyPreview = !previewTipId.empty() || requestJson.contains("previewValues");
        // Body/compound formulas evaluate only after all candidate values have
        // reached scratch. Legacy single-feature callers keep their evaluator.
        if (!useBodyPreview && !expression.empty() &&
            !EvaluateOneExpression(featureId, paramName, expression, &previewValue, &error)) {
          return make_response(requestId, "error", error_body("PREVIEW_FAILED", error));
        }
        const bool previewOk = useBodyPreview
            ? BuildPreviewBodyMesh(featureId, paramName, previewValue, previewTipId.empty() ? featureId : previewTipId,
                                   &mesh, &error, expression, otherValues)
            : BuildPreviewMesh(featureId, paramName, previewValue, &mesh, &error);
        if (!previewOk || mesh.indices.empty()) {
          return make_response(requestId, "error",
                               error_body("PREVIEW_FAILED",
                                          error.empty() ? paramName : error));
        }
        std::vector<uint8_t> preview =
            mesh_success(requestId, previewTipId.empty() ? featureId : previewTipId, 0, mesh, &error);
        if (preview.empty()) {
          return make_response(requestId, "error",
                               error_body("PREVIEW_FAILED", error.empty()
                                                                 ? paramName
                                                                 : error));
        }
        return preview;
      }
      std::map<std::string, double> parameterValues;
      if (requestJson.contains("parameterValues")) {
        const auto& values = requestJson["parameterValues"];
        if (!values.is_object() || values.size() > 5 || values.contains(paramName))
          return make_response(requestId, "error", error_body("BAD_PARAMS", "invalid additional parameterValues"));
        for (const auto& [name, value] : values.items()) {
          if (!value.is_number() || !std::isfinite(value.get<double>()))
            return make_response(requestId, "error", error_body("BAD_PARAMS", "parameterValues must be finite numbers"));
          parameterValues[name] = value.get<double>();
        }
      }
      std::string error;
      if (!RebuildFeature(featureId, paramName, value, expression, &error, parameterValues)) {
        return make_response(requestId, "error",
                             error_body("REBUILD_FAILED", error));
      }
      // C2: cross-feature expressions / instance reflow can move OTHER
      // features — the response must carry the full list so the renderer
      // never goes stale. shape_body keeps the edited record for the old
      // single-id path; feature_list_body carries every summary.
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok",
                           shape_body(rec) + "," + feature_list_body());
    }
    case kUndo:
    case kRedo: {
      // OCAF document transactions (§12): one committed user action == one
      // Undo delta; undo/redo resync the store and count as one step each.
      std::string error;
      const bool ok = (type == kUndo)
                          ? OcafLive::instance().Undo(&error)
                          : OcafLive::instance().Redo(&error);
      if (!ok) {
        return make_response(requestId, "error",
                             error_body(type == kUndo ? "NOTHING_TO_UNDO"
                                                      : "NOTHING_TO_REDO",
                                        error));
      }
      SyncGraphFromStore();
      DocumentStore::instance().commit();
      std::ostringstream body;
      body << feature_list_body();
      return make_response(requestId, "ok", body.str());
    }
    case kCreateSketch: {
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      const auto planeKind = json_string_field(requestJson, "planeKind", "XY");
      std::string modelRaw;
      SketchModel model;
      if (json_value_field(requestJson, "model", &modelRaw)) {
        std::string error;
        if (!ParseSketchModel(modelRaw, &model, &error)) {
          return make_response(requestId, "error",
                               error_body("BAD_SKETCH", error));
        }
      } else {
        // Inline flat form (points/lines/... at top level).
        std::string error;
        if (!ParseSketchModel(requestJson.dump(), &model, &error)) {
          return make_response(requestId, "error",
                               error_body("BAD_SKETCH", error));
        }
      }
      std::string error;
      const auto support=json_string_field(requestJson,"supportRef","");
      if (!(support.empty()?CreateSketchFeature(featureId,planeKind,model,&error):
                            CreateSketchOnDatumFeature(featureId,support,model,&error))) {
        return make_response(requestId, "error",
                             error_body("SKETCH_FAILED", error));
      }
      SketchFeature sketch;
      SketchStore::instance().get(featureId, &sketch);
      return make_response(requestId, "ok", sketch_body(sketch));
    }
    case kUpdateSketch: {
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      const bool isPreview =
          json_bool_field(requestJson, "isPreview");
      std::string modelRaw;
      SketchModel model;
      if (json_value_field(requestJson, "model", &modelRaw)) {
        std::string error;
        if (!ParseSketchModel(modelRaw, &model, &error)) {
          return make_response(requestId, "error",
                               error_body("BAD_SKETCH", error));
        }
      } else {
        std::string error;
        if (!ParseSketchModel(requestJson.dump(), &model, &error)) {
          return make_response(requestId, "error",
                               error_body("BAD_SKETCH", error));
        }
      }
      if (isPreview) {
        // Transient preview (§13/§21.5): optional drag target, no commit.
        SketchFeature stored;
        const bool hasStored =
            SketchStore::instance().get(featureId, &stored);
        SolveOptions opts;
        if (json_has_key(requestJson, "dragPointId")) {
          opts.hasDragTarget = true;
          opts.dragPointId = json_string_field(requestJson, "dragPointId");
          opts.dragX = json_double_field(requestJson, "dragX", 0);
          opts.dragY = json_double_field(requestJson, "dragY", 0);
        }
        // Solve the PROPOSED model (not stored) so drag shows live feedback.
        auto solver = CreateSketchSolver();
        SolveResult r = solver->solve(model, opts);
        if (!r.ok) {
          return make_response(requestId, "error",
                               error_body("PREVIEW_FAILED",
                                          r.error.empty() ? "no convergence"
                                                          : r.error));
        }
        SketchFeature tmp;
        tmp.id = featureId;
        // Plane is solve-independent: echo the stored plane when known.
        tmp.planeKind = hasStored ? stored.planeKind : "XY";
        tmp.plane = hasStored ? stored.plane : PrincipalPlane("XY");
        tmp.model = model;
        for (auto& p : tmp.model.points) {
          const auto it = r.points.find(p.id);
          if (it != r.points.end()) {
            p.x = it->second.first;
            p.y = it->second.second;
          }
        }
        for (auto& circle : tmp.model.circles) {
          const auto it = r.radii.find(circle.id);
          if (it != r.radii.end()) circle.r = it->second;
        }
        for (auto& arc : tmp.model.arcs) {
          const auto it = r.radii.find(arc.id);
          if (it != r.radii.end()) arc.r = it->second;
        }
        std::string ellipseError;
        if (!ApplySolvedEllipseAxes(r, &tmp.model, &ellipseError)) {
          return make_response(requestId, "error",
                               error_body("PREVIEW_FAILED", ellipseError));
        }
        std::ostringstream b;
        b << "\"preview\":true," << sketch_body(tmp, &r);
        return make_response(requestId, "ok", b.str());
      }
      std::string error;
      if (!UpdateSketchFeature(featureId, model, &error)) {
        return make_response(requestId, "error",
                             error_body("SKETCH_FAILED", error));
      }
      SketchFeature sketch;
      SketchStore::instance().get(featureId, &sketch);
      auto solver = CreateSketchSolver();
      SolveOptions opts;
      SolveResult r = solver->solve(sketch.model, opts);
      return make_response(requestId, "ok", sketch_body(sketch, &r));
    }
    case kSetBodyVisibility: {
      const std::string bodyId=json_string_field(requestJson,"bodyId","");
      if (bodyId.empty() || !requestJson.contains("visible") ||
          !requestJson.at("visible").is_boolean())
        return make_response(requestId,"error",error_body("BAD_PARAMS","bodyId and boolean visible required"));
      const bool visible=requestJson.at("visible").get<bool>();
      std::string error;
      if (!SetBodyVisibility(bodyId,visible,&error))
        return make_response(requestId,"error",error_body("BODY_VISIBILITY_FAILED",error));
      if (!OcafLive::instance().InTransaction()) DocumentStore::instance().commit();
      return make_response(requestId,"ok","\"bodyId\":\""+escape(bodyId)+"\",\"visible\":"+(visible?"true":"false"));
    }
    case kQueryConfigurations: {
      nlohmann::json doc;
      std::string error;
      if (!ReadConfigurationDocument(&doc,&error))
        return make_response(requestId,"error",error_body("CONFIGURATION_FAILED",error));
      doc["revision"]=DocumentStore::instance().revision();
      return make_response(requestId,"ok",doc.dump().substr(1,doc.dump().size()-2));
    }
    case kDefineConfiguration: {
      if (!requestJson.contains("name") || !requestJson["name"].is_string() ||
          !requestJson.contains("overrides") || !requestJson["overrides"].is_object())
        return make_response(requestId,"error",error_body("BAD_PARAMS","name and overrides required"));
      try {
        const auto overrides=requestJson["overrides"].get<ConfigurationOverrides>();
        std::string error;
        if (!DefineConfiguration(requestJson["name"].get<std::string>(),overrides,&error))
          return make_response(requestId,"error",error_body("CONFIGURATION_FAILED",error));
        nlohmann::json doc;
        ReadConfigurationDocument(&doc,&error);
        doc["revision"]=DocumentStore::instance().revision();
        const auto payload=doc.dump();
        return make_response(requestId,"ok",payload.substr(1,payload.size()-2));
      } catch (const std::exception& ex) {
        return make_response(requestId,"error",error_body("BAD_PARAMS",ex.what()));
      }
    }
    case kActivateConfiguration: {
      if (!requestJson.contains("name") || !requestJson["name"].is_string())
        return make_response(requestId,"error",error_body("BAD_PARAMS","name required"));
      std::string error;
      if (!ActivateConfiguration(requestJson["name"].get<std::string>(),&error))
        return make_response(requestId,"error",error_body("CONFIGURATION_FAILED",error));
      nlohmann::json doc;
      ReadConfigurationDocument(&doc,&error);
      doc["revision"]=DocumentStore::instance().revision();
      const auto payload=doc.dump();
      return make_response(requestId,"ok",payload.substr(1,payload.size()-2));
    }
    case kCreateInwardFacePocket:
    case kCreateOutwardFacePush: {
      if (!requestJson.contains("featureId") || !requestJson["featureId"].is_string() ||
          !requestJson.contains("sourceFeatureId") || !requestJson["sourceFeatureId"].is_string() ||
          !requestJson.contains("faceRole") || !requestJson["faceRole"].is_string() ||
          !requestJson.contains("distanceMm") || !requestJson["distanceMm"].is_number())
        return make_response(requestId,"error",error_body("BAD_PARAMS",
          "featureId, sourceFeatureId, faceRole, distanceMm required"));
      const auto featureId=requestJson["featureId"].get<std::string>();
      const auto sourceId=requestJson["sourceFeatureId"].get<std::string>();
      std::string role=requestJson["faceRole"].get<std::string>();
      const double distance=requestJson["distanceMm"].get<double>();
      // UI tessellation returns qualified persistent ids; accept the bare
      // semantic role too, but never silently accept another feature owner.
      const auto colon=role.find(':');
      if (colon!=std::string::npos) {
        if (role.substr(0,colon)!=sourceId)
          return make_response(requestId,"error",error_body("BAD_PARAMS","faceRole belongs to another feature"));
        role=role.substr(colon+1);
      }
      if (!std::isfinite(distance) || distance<=0 || distance>100000 ||
          !ShapeStore::ValidFeatureId(featureId) ||
          !ShapeStore::ValidFeatureId(sourceId) || role.empty() ||
          HasIndexedTopologyRole(role))
        return make_response(requestId,"error",error_body("BAD_PARAMS","invalid feature ID, semantic face role or positive distance"));
      std::string error;
      const bool inward=type==kCreateInwardFacePocket;
      if (!(inward?CreateInwardFacePocketFeature(featureId,sourceId,role,distance,&error):
                   CreateOutwardFacePushFeature(featureId,sourceId,role,distance,&error)))
        return make_response(requestId,"error",error_body(inward?"INWARD_FACE_POCKET_FAILED":"OUTWARD_FACE_PUSH_FAILED",error));
      ShapeRecord rec;
      ShapeStore::instance().get(featureId,&rec);
      return make_response(requestId,"ok",shape_body(rec));
    }
    case kCreateSurfaceFaceThicken: {
      if(!requestJson.contains("featureId")||!requestJson["featureId"].is_string()||
         !requestJson.contains("sourceFeatureId")||!requestJson["sourceFeatureId"].is_string()||
         !requestJson.contains("faceRole")||!requestJson["faceRole"].is_string()||
         !requestJson.contains("thicknessMm")||!requestJson["thicknessMm"].is_number())
        return make_response(requestId,"error",error_body("BAD_PARAMS",
          "featureId, sourceFeatureId, faceRole and thicknessMm required"));
      const auto featureId=requestJson["featureId"].get<std::string>();
      const auto sourceId=requestJson["sourceFeatureId"].get<std::string>();
      std::string role=requestJson["faceRole"].get<std::string>();
      const auto colon=role.find(':');
      if(colon!=std::string::npos) {
        if(role.substr(0,colon)!=sourceId)
          return make_response(requestId,"error",error_body("BAD_PARAMS","faceRole belongs to another feature"));
        role=role.substr(colon+1);
      }
      const double thickness=requestJson["thicknessMm"].get<double>();
      if(!ShapeStore::ValidFeatureId(featureId)||!ShapeStore::ValidFeatureId(sourceId)||
         role.empty()||HasIndexedTopologyRole(role)||!std::isfinite(thickness)||
         thickness<=0||thickness>100000)
        return make_response(requestId,"error",error_body("BAD_PARAMS","invalid thicken feature, role or thickness"));
      std::string error;
      if(!CreateSurfaceFaceThickenFeature(featureId,sourceId,role,thickness,&error))
        return make_response(requestId,"error",error_body("SURFACE_THICKEN_FAILED",error));
      ShapeRecord rec;
      ShapeStore::instance().get(featureId,&rec);
      return make_response(requestId,"ok",shape_body(rec));
    }
    case kCreateMoveFace:
    case kCreateOffsetFace:
    case kCreateDeleteFace:
    case kCreateReplaceFace: {
      std::string error;
      bool created = false;
      if (type == kCreateMoveFace)
        created = CreateMoveFaceFeature(requestJson, &error);
      else if (type == kCreateOffsetFace)
        created = CreateOffsetFaceFeature(requestJson, &error);
      else if (type == kCreateDeleteFace)
        created = CreateDeleteFaceFeature(requestJson, &error);
      else
        created = CreateReplaceFaceFeature(requestJson, &error);
      if (!created)
        return make_response(requestId, "error",
                             error_body("DIRECT_FACE_HISTORY_FAILED", error));
      ShapeRecord rec;
      if (!ShapeStore::instance().get(
              requestJson.value("featureId", std::string{}), &rec))
        return make_response(requestId, "error", error_body(
            "DIRECT_FACE_HISTORY_FAILED", "created face-history record is missing"));
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateSurfaceLoftSewnSolid: {
      if (!requestJson.contains("featureId") ||
          !requestJson.at("featureId").is_string() ||
          !requestJson.contains("sketchIds") ||
          !requestJson.at("sketchIds").is_array() ||
          requestJson.at("sketchIds").size() < 2)
        return make_response(requestId,"error",error_body("BAD_PARAMS",
          "featureId and sketchIds array (at least two) are required"));
      std::vector<std::string> sketchIds;
      for (const auto& id : requestJson.at("sketchIds")) {
        if (!id.is_string() || !ShapeStore::ValidFeatureId(id.get<std::string>()))
          return make_response(requestId,"error",error_body("BAD_PARAMS","invalid sketchIds entry"));
        sketchIds.push_back(id.get<std::string>());
      }
      if (std::set<std::string>(sketchIds.begin(),sketchIds.end()).size()!=sketchIds.size())
        return make_response(requestId,"error",error_body("BAD_PARAMS","duplicate sketchIds"));
      const auto featureId=requestJson.at("featureId").get<std::string>();
      std::string error;
      if (!CreateSurfaceLoftSewnSolidFeature(featureId,sketchIds,&error))
        return make_response(requestId,"error",error_body("SURFACE_LOFT_FAILED",error));
      ShapeRecord rec;
      ShapeStore::instance().get(featureId,&rec);
      return make_response(requestId,"ok",shape_body(rec));
    }
    case kCreateSurfaceExtrude: {
      std::string error;
      if (!surface_command_fields_valid(requestJson,
              {"featureId", "sketchId", "distanceMm"}, &error))
        return make_response(requestId, "error", error_body("BAD_PARAMS", error));
      double distance = 0;
      if (!requestJson.contains("featureId") || !requestJson["featureId"].is_string() ||
          !requestJson.contains("sketchId") || !requestJson["sketchId"].is_string() ||
          !requestJson.contains("distanceMm") ||
          !finite_number(requestJson, "distanceMm", &distance))
        return make_response(requestId, "error", error_body("BAD_PARAMS",
            "featureId, sketchId and finite distanceMm are required"));
      const auto featureId = requestJson["featureId"].get<std::string>();
      const auto sketchId = requestJson["sketchId"].get<std::string>();
      if (!CreateSurfaceExtrudeFeature(featureId, sketchId, distance, &error))
        return make_response(requestId, "error", error_body("SURFACE_EXTRUDE_FAILED", error));
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateSurfaceRevolve: {
      std::string error;
      if (!surface_command_fields_valid(requestJson,
              {"featureId", "sketchId", "angleDeg", "axisOriginXMm",
               "axisOriginYMm", "axisOriginZMm", "axisX", "axisY", "axisZ"},
              &error))
        return make_response(requestId, "error", error_body("BAD_PARAMS", error));
      if (!requestJson.contains("featureId") || !requestJson["featureId"].is_string() ||
          !requestJson.contains("sketchId") || !requestJson["sketchId"].is_string())
        return make_response(requestId, "error", error_body("BAD_PARAMS",
            "featureId and sketchId are required"));
      std::vector<double> params(7);
      const char* names[] = {"angleDeg", "axisOriginXMm", "axisOriginYMm",
                             "axisOriginZMm", "axisX", "axisY", "axisZ"};
      const double defaults[] = {0, 0, 0, 0, 1, 0, 0};
      for (size_t i = 0; i < params.size(); ++i) {
        if ((i == 0 && !requestJson.contains(names[i])) ||
            !finite_number(requestJson, names[i], &params[i], defaults[i]))
          return make_response(requestId, "error", error_body("BAD_PARAMS",
              std::string(names[i]) + " must be a finite JSON number"));
      }
      const auto featureId = requestJson["featureId"].get<std::string>();
      const auto sketchId = requestJson["sketchId"].get<std::string>();
      if (!CreateSurfaceRevolveFeature(featureId, sketchId, params, &error))
        return make_response(requestId, "error", error_body("SURFACE_REVOLVE_FAILED", error));
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateSurfaceLoft: {
      std::string error;
      if (!surface_command_fields_valid(requestJson,
              {"featureId", "sketchIds"}, &error))
        return make_response(requestId, "error", error_body("BAD_PARAMS", error));
      if (!requestJson.contains("featureId") || !requestJson["featureId"].is_string() ||
          !requestJson.contains("sketchIds") || !requestJson["sketchIds"].is_array() ||
          requestJson["sketchIds"].size() < 2 || requestJson["sketchIds"].size() > 128)
        return make_response(requestId, "error", error_body("BAD_PARAMS",
            "featureId and sketchIds array of 2 to 128 IDs are required"));
      std::vector<std::string> sketchIds;
      for (const auto& id : requestJson["sketchIds"]) {
        if (!id.is_string() || !ShapeStore::ValidFeatureId(id.get<std::string>()))
          return make_response(requestId, "error", error_body("BAD_PARAMS", "invalid sketchIds entry"));
        sketchIds.push_back(id.get<std::string>());
      }
      if (std::set<std::string>(sketchIds.begin(), sketchIds.end()).size() != sketchIds.size())
        return make_response(requestId, "error", error_body("BAD_PARAMS", "duplicate sketchIds"));
      const auto featureId = requestJson["featureId"].get<std::string>();
      if (!CreateSurfaceLoftFeature(featureId, sketchIds, &error))
        return make_response(requestId, "error", error_body("SURFACE_LOFT_FAILED", error));
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateSurfaceSew: {
      std::string error;
      if (!surface_command_fields_valid(requestJson,
              {"featureId", "featureIds", "toleranceMm", "makeSolid"},
              &error))
        return make_response(requestId, "error", error_body("BAD_PARAMS", error));
      if (!requestJson.contains("featureId") || !requestJson["featureId"].is_string() ||
          !requestJson.contains("featureIds") || !requestJson["featureIds"].is_array() ||
          requestJson["featureIds"].empty() || requestJson["featureIds"].size() > 128)
        return make_response(requestId, "error", error_body("BAD_PARAMS",
            "featureId and featureIds array of 1 to 128 IDs are required"));
      const auto featureId = requestJson["featureId"].get<std::string>();
      std::vector<std::string> featureIds;
      featureIds.reserve(requestJson["featureIds"].size());
      for (const auto& id : requestJson["featureIds"]) {
        if (!id.is_string() || !ShapeStore::ValidFeatureId(id.get<std::string>()))
          return make_response(requestId, "error", error_body("BAD_PARAMS", "invalid featureIds entry"));
        featureIds.push_back(id.get<std::string>());
      }
      if (std::set<std::string>(featureIds.begin(), featureIds.end()).size() != featureIds.size())
        return make_response(requestId, "error", error_body("BAD_PARAMS", "duplicate featureIds"));
      double tolerance = 0.01;
      if (!finite_number(requestJson, "toleranceMm", &tolerance, 0.01))
        return make_response(requestId, "error", error_body("BAD_PARAMS", "toleranceMm must be a finite JSON number"));
      bool makeSolid = false;
      if (requestJson.contains("makeSolid")) {
        if (!requestJson["makeSolid"].is_boolean())
          return make_response(requestId, "error", error_body("BAD_PARAMS", "makeSolid must be a boolean"));
        makeSolid = requestJson["makeSolid"].get<bool>();
      }
      if (!CreateSurfaceSewFeature(featureId, featureIds, tolerance, makeSolid, &error))
        return make_response(requestId, "error", error_body("SURFACE_SEW_FAILED", error));
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateSurfaceOffset: {
      std::string error;
      if (!surface_command_fields_valid(requestJson,
              {"featureId", "targetId", "distanceMm", "toleranceMm"},
              &error))
        return make_response(requestId, "error", error_body("BAD_PARAMS", error));
      if (!requestJson.contains("featureId") || !requestJson["featureId"].is_string() ||
          !requestJson.contains("targetId") || !requestJson["targetId"].is_string() ||
          !requestJson.contains("distanceMm"))
        return make_response(requestId, "error", error_body("BAD_PARAMS",
            "featureId, targetId and distanceMm are required"));
      double distance = 0;
      double tolerance = 1e-6;
      if (!finite_number(requestJson, "distanceMm", &distance) ||
          !finite_number(requestJson, "toleranceMm", &tolerance, 1e-6))
        return make_response(requestId, "error", error_body("BAD_PARAMS",
            "distanceMm and toleranceMm must be finite JSON numbers"));
      const auto featureId = requestJson["featureId"].get<std::string>();
      const auto targetId = requestJson["targetId"].get<std::string>();
      if (!ShapeStore::ValidFeatureId(featureId) || !ShapeStore::ValidFeatureId(targetId))
        return make_response(requestId, "error", error_body("BAD_PARAMS", "invalid featureId or targetId"));
      if (!CreateSurfaceOffsetFeature(featureId, targetId, distance, tolerance, &error))
        return make_response(requestId, "error", error_body("SURFACE_OFFSET_FAILED", error));
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateSurfaceSweep: {
      std::string error;
      if (!surface_command_fields_valid(
              requestJson,
              {"featureId", "profileSketchId", "pathSketchId", "toleranceMm"},
              &error))
        return make_response(requestId, "error", error_body("BAD_PARAMS", error));
      if (!requestJson.contains("featureId") || !requestJson["featureId"].is_string() ||
          !requestJson.contains("profileSketchId") || !requestJson["profileSketchId"].is_string() ||
          !requestJson.contains("pathSketchId") || !requestJson["pathSketchId"].is_string())
        return make_response(requestId, "error", error_body("BAD_PARAMS",
            "featureId, profileSketchId and pathSketchId are required"));
      const auto featureId = requestJson["featureId"].get<std::string>();
      const auto profileSketchId = requestJson["profileSketchId"].get<std::string>();
      const auto pathSketchId = requestJson["pathSketchId"].get<std::string>();
      if (!ShapeStore::ValidFeatureId(featureId) ||
          !ShapeStore::ValidFeatureId(profileSketchId) ||
          !ShapeStore::ValidFeatureId(pathSketchId) ||
          profileSketchId == pathSketchId)
        return make_response(requestId, "error", error_body("BAD_PARAMS",
            "feature and sketch IDs must be valid; profile and path IDs must differ"));
      double tolerance = 1e-6;
      if (!finite_number(requestJson, "toleranceMm", &tolerance, 1e-6))
        return make_response(requestId, "error", error_body("BAD_PARAMS",
            "toleranceMm must be a finite JSON number"));
      if (!CreateSurfaceSweepFeature(featureId, profileSketchId, pathSketchId,
                                     tolerance, &error))
        return make_response(requestId, "error", error_body("SURFACE_SWEEP_FAILED", error));
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateSurfaceThicken: {
      std::string error;
      if (!surface_command_fields_valid(requestJson,
              {"featureId", "targetId", "thicknessMm", "toleranceMm"},
              &error))
        return make_response(requestId, "error", error_body("BAD_PARAMS", error));
      if (!requestJson.contains("featureId") || !requestJson["featureId"].is_string() ||
          !requestJson.contains("targetId") || !requestJson["targetId"].is_string() ||
          !requestJson.contains("thicknessMm"))
        return make_response(requestId, "error", error_body("BAD_PARAMS",
            "featureId, targetId and thicknessMm are required"));
      double thickness = 0;
      double tolerance = 1e-6;
      if (!finite_number(requestJson, "thicknessMm", &thickness) ||
          !finite_number(requestJson, "toleranceMm", &tolerance, 1e-6))
        return make_response(requestId, "error", error_body("BAD_PARAMS",
            "thicknessMm and toleranceMm must be finite JSON numbers"));
      const auto featureId = requestJson["featureId"].get<std::string>();
      const auto targetId = requestJson["targetId"].get<std::string>();
      if (!ShapeStore::ValidFeatureId(featureId) || !ShapeStore::ValidFeatureId(targetId))
        return make_response(requestId, "error", error_body("BAD_PARAMS",
            "invalid featureId or targetId"));
      if (!CreateSurfaceThickenFeature(featureId, targetId, thickness,
                                       tolerance, &error))
        return make_response(requestId, "error",
            error_body("SURFACE_THICKEN_FAILED", error));
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateSurfaceTrim: {
      std::string error;
      if (!surface_command_fields_valid(requestJson,
              {"featureId", "targetId", "toolId", "keepFace", "keepUv", "toleranceMm"},
              &error))
        return make_response(requestId, "error", error_body("BAD_PARAMS", error));
      for (const auto* key : {"featureId", "targetId", "toolId"})
        if (!requestJson.contains(key) || !requestJson.at(key).is_string() ||
            !ShapeStore::ValidFeatureId(requestJson.at(key).get<std::string>()))
          return make_response(requestId, "error",
              error_body("BAD_PARAMS", std::string(key) + " must be a valid feature ID"));
      const auto featureId = requestJson.at("featureId").get<std::string>();
      const auto targetId = requestJson.at("targetId").get<std::string>();
      const auto toolId = requestJson.at("toolId").get<std::string>();
      if (targetId == toolId)
        return make_response(requestId, "error", error_body("BAD_PARAMS", "targetId and toolId must differ"));
      if (!requestJson.contains("keepFace"))
        return make_response(requestId, "error", error_body("BAD_PARAMS", "keepFace is required"));
      if (!surface_topology_reference_valid(requestJson.at("keepFace"), "face",
              "persistentFaceId", targetId, &error))
        return make_response(requestId, "error", error_body("BAD_PARAMS", error));
      if (!requestJson.contains("keepUv") || !requestJson.at("keepUv").is_array() ||
          requestJson.at("keepUv").size() != 2 ||
          !requestJson.at("keepUv").at(0).is_number() ||
          !requestJson.at("keepUv").at(1).is_number() ||
          !std::isfinite(requestJson.at("keepUv").at(0).get<double>()) ||
          !std::isfinite(requestJson.at("keepUv").at(1).get<double>()))
        return make_response(requestId, "error", error_body("BAD_PARAMS", "keepUv must contain two finite coordinates"));
      double tolerance = 1e-6;
      if (!finite_number(requestJson, "toleranceMm", &tolerance, 1e-6) ||
          tolerance < 1e-7 || tolerance > 1.0)
        return make_response(requestId, "error", error_body("BAD_PARAMS", "toleranceMm must be in [1e-7, 1]"));
      if (!CreateSurfaceTrimFeature(featureId, targetId, toolId,
              requestJson.at("keepFace"), requestJson.at("keepUv").at(0).get<double>(),
              requestJson.at("keepUv").at(1).get<double>(), tolerance, &error))
        return make_response(requestId, "error", error_body("SURFACE_TRIM_FAILED", error));
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateSurfaceExtend: {
      std::string error;
      if (!surface_command_fields_valid(requestJson,
              {"featureId", "targetId", "boundaryEdge", "distanceMm", "toleranceMm"},
              &error))
        return make_response(requestId, "error", error_body("BAD_PARAMS", error));
      if (!requestJson.contains("featureId") || !requestJson.at("featureId").is_string() ||
          !requestJson.contains("targetId") || !requestJson.at("targetId").is_string() ||
          !ShapeStore::ValidFeatureId(requestJson.at("featureId").get<std::string>()) ||
          !ShapeStore::ValidFeatureId(requestJson.at("targetId").get<std::string>()))
        return make_response(requestId, "error", error_body("BAD_PARAMS", "featureId and targetId must be valid feature IDs"));
      const auto featureId = requestJson.at("featureId").get<std::string>();
      const auto targetId = requestJson.at("targetId").get<std::string>();
      if (!requestJson.contains("boundaryEdge"))
        return make_response(requestId, "error", error_body("BAD_PARAMS", "boundaryEdge is required"));
      if (!surface_topology_reference_valid(requestJson.at("boundaryEdge"), "edge",
              "persistentEdgeId", targetId, &error))
        return make_response(requestId, "error", error_body("BAD_PARAMS", error));
      double distance = 0;
      double tolerance = 1e-6;
      if (!finite_number(requestJson, "distanceMm", &distance) ||
          distance < 1e-6 || distance > 100000.0 ||
          !finite_number(requestJson, "toleranceMm", &tolerance, 1e-6) ||
          tolerance < 1e-7 || tolerance > 1.0)
        return make_response(requestId, "error", error_body("BAD_PARAMS", "distanceMm must be in [1e-6, 100000] and toleranceMm in [1e-7, 1]"));
      if (!CreateSurfaceExtendFeature(featureId, targetId,
              requestJson.at("boundaryEdge"), distance, tolerance, &error))
        return make_response(requestId, "error", error_body("SURFACE_EXTEND_FAILED", error));
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateExtrude: {
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      const std::string sketchId =
          json_string_field(requestJson, "sketchId", "");
      const double dist = json_double_field(
          requestJson, "distanceMm",
          json_double_field(requestJson, "distance", 0));
      std::string error;
      if (!CreateExtrudeFeature(featureId, sketchId, dist, &error)) {
        return make_response(requestId, "error",
                             error_body("EXTRUDE_FAILED", error));
      }
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateRevolve: {
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      const std::string sketchId =
          json_string_field(requestJson, "sketchId", "");
      const double ang = json_double_field(
          requestJson, "angleDeg",
          json_double_field(requestJson, "angle", 0));
      std::string error;
      if (!CreateRevolveFeature(featureId, sketchId, ang, &error)) {
        return make_response(requestId, "error",
                             error_body("REVOLVE_FAILED", error));
      }
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateBoolean: {
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      const std::string op = json_string_field(requestJson, "op", "");
      const std::string targetId =
          json_string_field(requestJson, "targetId", "");
      const std::string toolId = json_string_field(requestJson, "toolId", "");
      std::string error;
      if (!CreateBooleanFeature(featureId, op, targetId, toolId, &error)) {
        return make_response(requestId, "error",
                             error_body("BOOLEAN_FAILED", error));
      }
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateHole: {
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      const std::string targetId =
          json_string_field(requestJson, "targetId", "");
      std::string faceRole = json_string_field(requestJson, "faceRole", "");
      if (faceRole.empty()) {
        // Accept full persistent ids ("uuid:role") as well as bare roles.
        const std::string faceId = json_string_field(requestJson, "faceId", "");
        const size_t cut = faceId.find(':');
        faceRole = (cut == std::string::npos) ? faceId : faceId.substr(cut + 1);
      }
      const double x = json_double_field(requestJson, "xMm",
                                         json_double_field(requestJson, "x", 0));
      const double y = json_double_field(requestJson, "yMm",
                                         json_double_field(requestJson, "y", 0));
      const double dia = json_double_field(
          requestJson, "diameterMm",
          json_double_field(requestJson, "diameter", 0));
      const std::string mode =
          json_string_field(requestJson, "depthMode", "throughAll");
      const double depth = json_double_field(
          requestJson, "depthMm",
          json_double_field(requestJson, "depth", 0));
      const auto insertBeforeId = json_string_field(requestJson, "insertBeforeId", "");
      if (json_has_key(requestJson, "insertBeforeId") && !ShapeStore::ValidFeatureId(insertBeforeId)) {
        return make_response(requestId, "error", error_body("BAD_PARAMS", "insertBeforeId must be a feature id"));
      }
      std::string error;
      if (!CreateHoleFeature(featureId, targetId, faceRole, x, y, dia, mode,
                             depth, &error, insertBeforeId)) {
        return make_response(requestId, "error",
                             error_body("HOLE_FAILED", error));
      }
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec) +
          (insertBeforeId.empty() ? "" : "," + feature_list_body()));
    }
    case kCreateHolePattern: {
      // M11: 1..4 holes in exactly one OCAF transaction (one Undo step).
      const std::string targetId =
          json_string_field(requestJson, "targetId", "");
      std::string faceRole = json_string_field(requestJson, "faceRole", "");
      if (faceRole.empty()) {
        const std::string faceId = json_string_field(requestJson, "faceId", "");
        const size_t cut = faceId.find(':');
        faceRole = (cut == std::string::npos) ? faceId : faceId.substr(cut + 1);
      }
      double dia = 0;
      if (!json_double_strict(requestJson, "diameterMm", &dia) &&
          !json_double_strict(requestJson, "diameter", &dia)) {
        return make_response(requestId, "error",
                             error_body("BAD_PARAMS",
                                        "diameterMm must be a JSON number"));
      }
      const std::string mode =
          json_string_field(requestJson, "depthMode", "throughAll");
      // m17: an unknown depthMode is a parameter error, reported here as
      // BAD_PARAMS like the other numeric gates (not HOLE_FAILED).
      if (mode != "throughAll" && mode != "blind") {
        return make_response(requestId, "error",
                             error_body("BAD_PARAMS",
                                        "depthMode must be throughAll|blind"));
      }
      double depth = 0;
      if (json_has_key(requestJson, "depthMm") || json_has_key(requestJson, "depth")) {
        if (!json_double_strict(requestJson, "depthMm", &depth) &&
            !json_double_strict(requestJson, "depth", &depth)) {
          return make_response(requestId, "error",
                               error_body("BAD_PARAMS",
                                          "depthMm must be a JSON number"));
        }
      }
      const auto featureIds = json_string_array(requestJson, "featureIds");
      const auto nums = json_number_array(requestJson, "points");
      if (featureIds.empty() || featureIds.size() > 4) {
        return make_response(requestId, "error",
                             error_body("BAD_PARAMS",
                                        "featureIds must have 1..4 entries"));
      }
      {
        std::set<std::string> seen;
        for (const auto& fid : featureIds) {
          if (fid.empty() || !ShapeStore::ValidFeatureId(fid)) {
            return make_response(requestId, "error",
                                 error_body("BAD_PARAMS",
                                            "featureIds must match [A-Za-z0-9_-]"));
          }
          if (!seen.insert(fid).second) {
            return make_response(requestId, "error",
                                 error_body("BAD_PARAMS",
                                            "duplicate featureId in pattern"));
          }
        }
      }
      if (nums.size() != featureIds.size() * 2) {
        return make_response(requestId, "error",
                             error_body("BAD_PARAMS",
                                        "points must be [x,y] per featureId"));
      }
      std::vector<std::pair<double, double>> pts;
      for (size_t i = 0; i < featureIds.size(); ++i) {
        pts.emplace_back(nums[2 * i], nums[2 * i + 1]);
      }
      std::string error;
      std::vector<std::string> created;
      if (!CreateHolePatternFeature(targetId, faceRole, pts, dia, mode, depth,
                                    featureIds, &created, &error)) {
        return make_response(requestId, "error",
                             error_body("HOLE_FAILED", error));
      }
      for (const auto& id : created) {
        ShapeRecord rec;
        DocumentStore::instance().noteFeature(
            id, ShapeStore::instance().get(id, &rec) ? rec.type : "Hole");
      }
      SyncGraphFromStore();
      std::ostringstream body;
      body << feature_list_body();
      return make_response(requestId, "ok", body.str());
    }
    case kRequestSnapshot: {
      // §11.7 session snapshot: the authoritative feature/sketch lists at
      // the current revision. Read-only: no transaction, no revision bump,
      // safe to call between mutations (callers use revision for deltas).
      std::ostringstream body;
      const bool includeReferences = json_bool_field(requestJson, "includeReferencePlanes");
      if (includeReferences) {
        body << "\"referencePlanesJson\":\""
             << escape(DocumentStore::instance().referencePlanesJson()) << "\",";
      }
      body << "\"documentId\":\"" << escape(DocumentStore::instance().snapshotDocumentId()) << "\","
           << feature_list_body();
      return make_response(requestId, "ok", body.str());
    }
    case kBeginTransaction: {
      // §11.12: open one Undo step for N subsequent joined commands.
      const std::string tid =
          json_string_field(requestJson, "transactionId", "");
      if (tid.empty() || !cleanId(tid)) {
        return make_response(requestId, "error",
                             error_body("BAD_PARAMS",
                                        "transactionId must match [A-Za-z0-9_-]"));
      }
      if (OcafLive::instance().InTransaction()) {
        return make_response(requestId, "error",
                             error_body("TRANSACTION_BUSY",
                                        "a transaction is already open — commit or roll it back first"));
      }
      std::string error;
      if (!OcafLive::instance().BeginTransaction(tid, &error)) {
        return make_response(requestId, "error",
                             error_body("TRANSACTION_FAILED", error));
      }
      std::ostringstream body;
      body << "\"transactionId\":\"" << escape(tid) << "\","
           << feature_list_body();
      return make_response(requestId, "ok", body.str());
    }
    case kCommitTransaction: {
      const std::string tid =
          json_string_field(requestJson, "transactionId", "");
      if (!OcafLive::instance().InTransaction()) {
        return make_response(requestId, "error",
                             error_body("NO_TRANSACTION", "no open transaction"));
      }
      if (tid != OcafLive::instance().TransactionOwner()) {
        return make_response(requestId, "error",
                             error_body("NOT_OWNER",
                                        "only the transaction owner can commit it"));
      }
      // A successful commit is exactly one Undo delta: bump the revision
      // once so deltas converge (§11.6).
      bool hadDelta = false;
      std::string error;
      if (!OcafLive::instance().CommitTransaction(tid, &hadDelta, &error)) {
        // Tainted (a step failed): everything already rolled back inside —
        // rebuild the graph (phantom nodes from joined ops) and report the
        // post-rollback list so clients converge instead of diverging.
        SyncGraphFromStore();
        std::ostringstream body;
        body << "\"transactionId\":\"" << escape(tid) << "\","
             << feature_list_body();
        return make_response(requestId, "error",
                             error_body("TRANSACTION_TAINTED", error) + "," +
                                 body.str());
      }
      SyncGraphFromStore();
      if(hadDelta)DocumentStore::instance().commit();
      std::ostringstream body;
      body << "\"transactionId\":\"" << escape(tid) << "\","
           << feature_list_body();
      return make_response(requestId, "ok", body.str());
    }
    case kRollbackTransaction: {
      const std::string tid =
          json_string_field(requestJson, "transactionId", "");
      if (!OcafLive::instance().InTransaction()) {
        return make_response(requestId, "error",
                             error_body("NO_TRANSACTION", "no open transaction"));
      }
      if (tid != OcafLive::instance().TransactionOwner()) {
        return make_response(requestId, "error",
                             error_body("NOT_OWNER",
                                        "only the transaction owner can roll it back"));
      }
      std::string error;
      if (!OcafLive::instance().RollbackTransaction(tid, &error)) {
        return make_response(requestId, "error",
                             error_body("TRANSACTION_FAILED", error));
      }
      // Store + label maps were rebuilt from the live doc; the graph keeps
      // phantom nodes from joined ops — rebuild it too. No revision bump:
      // nothing committed, but the list below lets clients converge.
      SyncGraphFromStore();
      std::ostringstream body;
      body << "\"transactionId\":\"" << escape(tid) << "\","
           << feature_list_body();
      return make_response(requestId, "ok", body.str());
    }
    case kCreateFillet:
    case kCreateChamfer: {
      const bool isFillet = (type == kCreateFillet);
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      const std::string targetId =
          json_string_field(requestJson, "targetId", "");
      std::vector<std::string> edgeIds;
      std::set<std::string> seen;
      for (const auto& id : json_string_array(requestJson, "edgeIds")) {
        if (seen.insert(id).second) edgeIds.push_back(id);
      }
      const std::string single = json_string_field(requestJson, "edgeId", "");
      if (!single.empty()) edgeIds.push_back(single);
      const double value = isFillet
                               ? json_double_field(
                                     requestJson, "radiusMm",
                                     json_double_field(requestJson, "radius",
                                                       0))
                               : json_double_field(
                                     requestJson, "distanceMm",
                                     json_double_field(requestJson, "distance",
                                                       0));
      std::string error;
      const bool ok = isFillet
                          ? CreateFilletFeature(featureId, targetId, edgeIds,
                                                value, &error)
                          : CreateChamferFeature(featureId, targetId, edgeIds,
                                                 value, &error);
      if (!ok) {
        return make_response(requestId, "error",
                             error_body(isFillet ? "FILLET_FAILED"
                                                : "CHAMFER_FAILED",
                                        error));
      }
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateShell: {
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      const std::string targetId =
          json_string_field(requestJson, "targetId", "");
      std::vector<std::string> faceIds;
      std::set<std::string> seen;
      for (const auto& id : json_string_array(requestJson, "faceIds")) {
        if (seen.insert(id).second) faceIds.push_back(id);
      }
      const std::string single = json_string_field(requestJson, "faceId", "");
      if (!single.empty() && seen.insert(single).second) faceIds.push_back(single);
      const std::string role = json_string_field(requestJson, "faceRole", "");
      if (!role.empty() && seen.insert(role).second) faceIds.push_back(role);
      const double thickness = json_double_field(
          requestJson, "thicknessMm",
          json_double_field(requestJson, "thickness", 0));
      std::string error;
      if (!CreateShellFeature(featureId, targetId, faceIds, thickness, &error)) {
        return make_response(requestId, "error",
                             error_body("SHELL_FAILED", error));
      }
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateInstance: {
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      const std::string targetId =
          json_string_field(requestJson, "targetId", "");
      // M3: placement garbage ("txMm":"evil") must be BAD_PARAMS, not 0.
      std::vector<double> placement(6, 0.0);
      const char* keys[6] = {"txMm", "tyMm", "tzMm", "rxDeg", "ryDeg", "rzDeg"};
      for (int i = 0; i < 6; ++i) {
        if (json_has_key(requestJson, keys[i])) {
          double v = 0;
          if (!json_double_strict(requestJson, keys[i], &v)) {
            return make_response(requestId, "error",
                                 error_body("BAD_PARAMS",
                                            std::string(keys[i]) +
                                            " must be a JSON number"));
          }
          placement[static_cast<size_t>(i)] = v;
        }
      }
      std::string error;
      if (!CreateInstanceFeature(featureId, targetId, placement, &error)) {
        return make_response(requestId, "error",
                             error_body("INSTANCE_FAILED", error));
      }
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateMirror: {
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      const std::string targetId =
          json_string_field(requestJson, "targetId", "");
      const std::string planeKind =
          json_string_field(requestJson, "planeKind", "");
      const std::string datumId =
          json_string_field(requestJson, "datumId", "");
      std::string error;
      if (!CreateMirrorFeature(featureId, targetId, planeKind, datumId,
                               &error)) {
        return make_response(requestId, "error",
                             error_body("MIRROR_FAILED", error));
      }
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateBodyPattern: {
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      const std::string targetId =
          json_string_field(requestJson, "targetId", "");
      const std::string axis = json_string_field(requestJson, "axis", "X");
      if (!json_has_key(requestJson, "count") ||
          !requestJson["count"].is_number_integer()) {
        return make_response(requestId, "error",
                             error_body("BAD_PARAMS", "count must be a JSON integer"));
      }
      const int count = json_int_field(requestJson, "count");
      double spacingMm = 0;
      if (!json_double_strict(requestJson, "spacingMm", &spacingMm)) {
        return make_response(requestId, "error",
                             error_body("BAD_PARAMS", "spacingMm must be a JSON number"));
      }
      std::string error;
      if (!CreateBodyPatternFeature(featureId, targetId, axis, count,
                                    spacingMm, &error)) {
        return make_response(requestId, "error",
                             error_body("PATTERN_FAILED", error));
      }
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateCircularBodyPattern: {
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      const std::string targetId =
          json_string_field(requestJson, "targetId", "");
      const std::string axis = json_string_field(requestJson, "axis", "Z");
      if (!json_has_key(requestJson, "count") ||
          !requestJson["count"].is_number_integer()) {
        return make_response(requestId, "error",
                             error_body("BAD_PARAMS", "count must be a JSON integer"));
      }
      const int count = json_int_field(requestJson, "count");
      double angleDeg = 0;
      if (!json_double_strict(requestJson, "angleDeg", &angleDeg)) {
        return make_response(requestId, "error",
                             error_body("BAD_PARAMS", "angleDeg must be a JSON number"));
      }
      std::string error;
      if (!CreateCircularBodyPatternFeature(featureId, targetId, axis, count,
                                            angleDeg, &error)) {
        return make_response(requestId, "error",
                             error_body("PATTERN_FAILED", error));
      }
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kDefineAssemblyConstraint: {
      const auto validId=[](const Json& value) {
        return value.is_string() && ShapeStore::ValidFeatureId(value.get<std::string>());
      };
      if(!requestJson.contains("constraintId")||!validId(requestJson["constraintId"])||
         !requestJson.contains("movingId")||!validId(requestJson["movingId"])||
         !requestJson.contains("kind")||!requestJson["kind"].is_string())
        return make_response(requestId,"error",error_body("BAD_PARAMS","constraintId, movingId and kind are required"));
      const auto kind=requestJson["kind"].get<std::string>();
      const auto moving=requestJson["movingId"].get<std::string>();
      const auto constraintId=requestJson["constraintId"].get<std::string>();
      const bool geometric=kind=="concentric"||kind=="parallel"||kind=="perpendicular"||kind=="angle";
      if(geometric) {
        std::uint64_t captureRevision=0;
        if(!requestJson.contains("captureRevision")||!requestJson["captureRevision"].is_number_integer())
          return make_response(requestId,"error",error_body("BAD_PARAMS","captureRevision must be a non-negative integer"));
        if(requestJson["captureRevision"].is_number_unsigned())captureRevision=requestJson["captureRevision"].get<std::uint64_t>();
        else {
          const auto signedRevision=requestJson["captureRevision"].get<std::int64_t>();
          if(signedRevision<0)return make_response(requestId,"error",error_body("BAD_PARAMS","captureRevision must be a non-negative integer"));
          captureRevision=static_cast<std::uint64_t>(signedRevision);
        }
        if(captureRevision!=static_cast<std::uint64_t>(DocumentStore::instance().revision()))
          return make_response(requestId,"error",error_body("STALE_CAPTURE","captureRevision does not match the current model revision"));
        auto validSourceBinding=[](const Json& value) {
          if(!value.is_object()||!value.contains("type")||!value["type"].is_string()||
             !value.contains("featureId")||!value["featureId"].is_string()||
             !ShapeStore::ValidFeatureId(value["featureId"].get<std::string>())||
             !value.contains("geometryKind")||!value["geometryKind"].is_string())return false;
          const auto type=value["type"].get<std::string>();
          const auto key=type=="face"?"persistentFaceId":type=="edge"?"persistentEdgeId":"";
          if(!*key||!value.contains(key)||!value[key].is_string())return false;
          const auto role=value[key].get<std::string>();
          if(role.empty()||role.size()>512||role.find(':')!=std::string::npos||value[key].is_null())return false;
          if(value["geometryKind"].get<std::string>().empty()||value["geometryKind"].get<std::string>().size()>24)return false;
          const std::set<std::string> allowed={"type","featureId","geometryKind",key};
          for(auto it=value.begin();it!=value.end();++it)if(!allowed.count(it.key()))return false;
          return value.size()==allowed.size();
        };
        const std::set<std::string> common={"protocolVersion","requestId","documentId","type","transactionId",
          "constraintId","kind","movingId","fixedId","captureRevision","movingPickId","fixedPickId",
          "movingSourceBinding","fixedSourceBinding"};
        auto allowed=common;
        if(kind=="angle")allowed.insert("angleDeg");
        for(auto it=requestJson.begin();it!=requestJson.end();++it)
          if(!allowed.count(it.key()))return make_response(requestId,"error",error_body("BAD_PARAMS","unexpected geometric mate field: "+it.key()));
        if(!requestJson.contains("fixedId")||!validId(requestJson["fixedId"])||
           !requestJson.contains("movingPickId")||!requestJson["movingPickId"].is_string()||requestJson["movingPickId"].get<std::string>().empty()||
           !requestJson.contains("fixedPickId")||!requestJson["fixedPickId"].is_string()||requestJson["fixedPickId"].get<std::string>().empty()||
           !requestJson.contains("movingSourceBinding")||!validSourceBinding(requestJson["movingSourceBinding"])||
           !requestJson.contains("fixedSourceBinding")||!validSourceBinding(requestJson["fixedSourceBinding"]))
          return make_response(requestId,"error",error_body("BAD_PARAMS","geometric mate needs fixed instance, world picks and strict source bindings"));
        if(kind=="angle"&&(!requestJson.contains("angleDeg")||!requestJson["angleDeg"].is_number()||
           !std::isfinite(requestJson["angleDeg"].get<double>())||requestJson["angleDeg"].get<double>()<0||requestJson["angleDeg"].get<double>()>180))
          return make_response(requestId,"error",error_body("BAD_PARAMS","angleDeg must be finite and between 0 and 180 degrees"));
        std::string error;
        if(!DefineGeometricAssemblyConstraint(requestJson,&error))
          return make_response(requestId,"error",error_body("ASSEMBLY_CONSTRAINT_FAILED",error));
        if(!OcafLive::instance().InTransaction())DocumentStore::instance().commit();
        const Json result={{"constraintId",constraintId},{"kind",kind},{"movingId",moving},
                           {"fixedId",requestJson["fixedId"]}};
        const auto serialized=result.dump();
        return make_response(requestId,"ok",serialized.substr(1,serialized.size()-2));
      }
      if(kind!="ground"&&kind!="coincident"&&kind!="distance")
        return make_response(requestId,"error",error_body("BAD_PARAMS","unknown assembly mate kind"));
      std::string fixed;
      int axis=0;
      double distance=0;
      if(kind!="ground") {
        if(!requestJson.contains("fixedId")||!validId(requestJson["fixedId"]))
          return make_response(requestId,"error",error_body("BAD_PARAMS","fixedId is required for a mate"));
        fixed=requestJson["fixedId"].get<std::string>();
      }
      if(kind=="distance") {
        if(!requestJson.contains("axis")||!requestJson["axis"].is_number_integer()||
           !requestJson.contains("distanceMm")||!requestJson["distanceMm"].is_number())
          return make_response(requestId,"error",error_body("BAD_PARAMS","distance mate needs integer axis and distanceMm"));
        axis=requestJson["axis"].get<int>();
        distance=requestJson["distanceMm"].get<double>();
        if(axis<0||axis>2||!std::isfinite(distance))
          return make_response(requestId,"error",error_body("BAD_PARAMS","invalid assembly distance or axis"));
      }
      const std::set<std::string> common={"protocolVersion","requestId","documentId","type","transactionId",
        "constraintId","kind","movingId"};
      auto allowed=common;
      if(kind!="ground")allowed.insert("fixedId");
      if(kind=="distance") {allowed.insert("axis");allowed.insert("distanceMm");}
      for(auto it=requestJson.begin();it!=requestJson.end();++it)
        if(!allowed.count(it.key()))
          return make_response(requestId,"error",error_body("BAD_PARAMS","unexpected assembly mate field: "+it.key()));
      std::string error;
      if(!DefineAssemblyConstraint(constraintId,kind,moving,fixed,axis,distance,&error))
        return make_response(requestId,"error",error_body("ASSEMBLY_CONSTRAINT_FAILED",error));
      if(!OcafLive::instance().InTransaction())DocumentStore::instance().commit();
      const Json result={{"constraintId",constraintId},{"kind",kind},
                         {"movingId",moving},{"fixedId",fixed}};
      const auto serialized=result.dump();
      return make_response(requestId,"ok",serialized.substr(1,serialized.size()-2));
    }
    case kRequestSketch: {
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      SketchFeature sketch;
      if (!SketchStore::instance().get(featureId, &sketch)) {
        return make_response(requestId, "error",
                             error_body("NOT_FOUND", featureId));
      }
      return make_response(requestId, "ok", sketch_body(sketch));
    }
    case kPreviewSketch: {
      // Alias of UpdateSketch preview with explicit drag fields.
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      SketchFeature stored;
      if (!SketchStore::instance().get(featureId, &stored)) {
        return make_response(requestId, "error",
                             error_body("NOT_FOUND", featureId));
      }
      SketchModel model = stored.model;
      std::string modelRaw;
      if (json_value_field(requestJson, "model", &modelRaw)) {
        std::string error;
        if (!ParseSketchModel(modelRaw, &model, &error)) {
          return make_response(requestId, "error",
                               error_body("BAD_SKETCH", error));
        }
      }
      SolveOptions opts;
      if (json_has_key(requestJson, "dragPointId")) {
        opts.hasDragTarget = true;
        opts.dragPointId = json_string_field(requestJson, "dragPointId");
        opts.dragX = json_double_field(requestJson, "dragX", 0);
        opts.dragY = json_double_field(requestJson, "dragY", 0);
      }
      auto solver = CreateSketchSolver();
      SolveResult r = solver->solve(model, opts);
      if (!r.ok) {
        return make_response(requestId, "error",
                             error_body("PREVIEW_FAILED",
                                        r.error.empty() ? "no convergence"
                                                        : r.error));
      }
      SketchFeature tmp = stored;
      tmp.model = model;
      for (auto& p : tmp.model.points) {
        const auto it = r.points.find(p.id);
        if (it != r.points.end()) {
          p.x = it->second.first;
          p.y = it->second.second;
        }
      }
      std::string ellipseError;
      if (!ApplySolvedEllipseAxes(r, &tmp.model, &ellipseError)) {
        return make_response(requestId, "error",
                             error_body("PREVIEW_FAILED", ellipseError));
      }
      std::ostringstream b;
      b << "\"preview\":true," << sketch_body(tmp, &r);
      return make_response(requestId, "ok", b.str());
    }
    case kRequestFaceInfo: {
#if KREODA_WITH_OCCT
      // Face plane frame for positioning (hole defaults, §10): world-space
      // origin/axes/normal of the resolved persistent face.
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      std::string role = json_string_field(requestJson, "faceRole", "");
      if (role.empty()) {
        const std::string faceId = json_string_field(requestJson, "faceId", "");
        const size_t cut = faceId.find(':');
        role = (cut == std::string::npos) ? faceId : faceId.substr(cut + 1);
      }
      ShapeRecord rec;
      std::string availabilityError;
      if (!GetCurrentShapeRecord(featureId, &rec, &availabilityError)) {
        if (ShapeStore::instance().contains(featureId))
          return make_response(requestId, "error",
                               error_body("GEOMETRY_UNAVAILABLE", availabilityError));
        return make_response(requestId, "error",
                             error_body("NOT_FOUND", featureId));
      }
      double origin[3], xa[3], ya[3], normal[3];
      if (!FaceFrameInfo(rec.shape, featureId, rec.type, role, origin, xa,
                         ya, normal)) {
        return make_response(requestId, "error",
                             error_body("NOT_PLANAR",
                                        "face has no plane frame: " + role));
      }
      std::ostringstream body;
      body << "\"featureId\":\"" << escape(featureId) << "\",\"role\":\""
           << escape(role) << "\",\"originMm\":[" << origin[0] << ","
           << origin[1] << "," << origin[2] << "],\"xAxis\":[" << xa[0] << ","
           << xa[1] << "," << xa[2] << "],\"yAxis\":[" << ya[0] << ","
           << ya[1] << "," << ya[2] << "],\"normal\":[" << normal[0] << ","
           << normal[1] << "," << normal[2] << "],\"revision\":"
           << DocumentStore::instance().revision() << "," << undo_counts_body();
      return make_response(requestId, "ok", body.str());
#else
      return make_response(requestId, "error",
                           error_body("NOT_IMPLEMENTED",
                                      "face frames require the OCCT kernel"));
#endif
    }
    case kDeleteFeature: {
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      if (!ShapeStore::ValidFeatureId(featureId)) {
        return make_response(requestId, "error",
                             error_body("BAD_PARAMS", "invalid featureId"));
      }
      const bool isShape = ShapeStore::instance().contains(featureId);
      const bool isSketch = SketchStore::instance().contains(featureId);
      const bool isDatum = DatumStore::instance().contains(featureId);
      if (!isShape && !isSketch && !isDatum) {
        return make_response(requestId, "error",
                             error_body("NOT_FOUND", featureId));
      }
      if (static_cast<int>(isShape)+static_cast<int>(isSketch)+static_cast<int>(isDatum)>1) {
        return make_response(requestId, "error",
                             error_body("DELETE_FAILED",
                                        "feature id is ambiguous across stores"));
      }

      // No cascade exists. Refuse direct geometry/sketch dependencies and
      // formula references before touching OCAF, including Instance targets.
      std::set<std::string> dependents;
      for(const auto& record:DatumStore::instance().listInOrder())
        if(record.featureId!=featureId&&std::find(record.dependsOn.begin(),record.dependsOn.end(),featureId)!=record.dependsOn.end())
          dependents.insert(record.featureId);
      for (const auto& rec : ShapeStore::instance().listInOrder()) {
        if (rec.featureId != featureId &&
            std::find(rec.dependsOn.begin(), rec.dependsOn.end(), featureId) !=
                rec.dependsOn.end()) {
          dependents.insert(rec.featureId);
        }
      }
      for (const auto& sketch : SketchStore::instance().listInOrder()) {
        const auto dependencies = SketchDependencies(sketch);
        if (sketch.id != featureId &&
            std::find(dependencies.begin(), dependencies.end(), featureId) !=
                dependencies.end()) {
          dependents.insert(sketch.id);
        }
      }
      for (const auto& entry : ExpressionStore::instance().listInOrder()) {
        if (entry.featureId == featureId) continue;
        std::vector<std::pair<std::string, std::string>> refs;
        std::string parseError;
        if (!ParseExpression(entry.expression, &refs, &parseError)) {
          return make_response(
              requestId, "error",
              error_body("DELETE_FAILED",
                         "cannot inspect expression on " + entry.featureId +
                             "." + entry.paramName + ": " + parseError));
        }
        for (const auto& [referencedId, param] : refs) {
          (void)param;
          if ((referencedId.empty() ? entry.featureId : referencedId) ==
              featureId) {
            dependents.insert(entry.featureId);
            break;
          }
        }
      }
      if (!dependents.empty()) {
        std::string dependentList;
        for (const auto& id : dependents) {
          if (!dependentList.empty()) dependentList += ", ";
          dependentList += id;
        }
        return make_response(
            requestId, "error",
            error_body("HAS_DEPENDENTS",
                       "delete dependent features first: " + dependentList));
      }

      std::string error;
      if (!OcafLive::instance().BeginCommand(&error)) {
        return make_response(requestId, "error",
                             error_body("DELETE_FAILED", error));
      }
      if (!OcafLive::instance().RemoveFeature(featureId, &error)) {
        OcafLive::instance().AbortCommand();
        return make_response(requestId, "error",
                             error_body("DELETE_FAILED", error));
      }
      bool hadDelta = false;
      if (!OcafLive::instance().CommitCommand(&hadDelta, &error)) {
        OcafLive::instance().AbortCommand();
        return make_response(requestId, "error",
                             error_body("DELETE_FAILED", error));
      }
      if (!OcafLive::instance().ResyncStore(&error)) {
        return make_response(requestId, "error",
                             error_body("DELETE_FAILED", error));
      }
      SyncGraphFromStore();
      if (hadDelta) DocumentStore::instance().commit();

      std::ostringstream body;
      body << "\"deletedFeatureId\":\"" << escape(featureId) << "\","
           << feature_list_body();
      return make_response(requestId, "ok", body.str());
    }
    default:
      return make_response(requestId, "error",
                           error_body("UNKNOWN_COMMAND",
                                      "unsupported command type"));
  }
}

std::vector<uint8_t> handle_command(const std::string& text) {
  const Json request = parse_json_object(text);
  const std::string requestId = json_string_field(text, "requestId", "");
  if (!request.is_object() || !request.contains("type") || !request.at("type").is_number_integer())
    return make_response(requestId, "error", error_body("BAD_ENVELOPE", "expected an object with integer command type"));
  for (const auto* key : {"requestId", "documentId", "transactionId"}) {
    if (request.contains(key) && !request.at(key).is_string())
      return make_response(requestId, "error", error_body("BAD_ENVELOPE", std::string(key) + " must be a JSON string"));
  }
  try {
    // Validate every present numeric alias too; a valid alternate field must
    // not conceal malformed canonical values. Nested metadata is ignored.
    for (const auto* key : {"widthMm", "heightMm", "depthMm", "radiusMm", "diameterMm", "distanceMm", "angleDeg", "valueMm", "xMm", "yMm",
        "width", "height", "depth", "radius", "diameter", "distance", "angle", "value", "x", "y",
        "txMm", "tyMm", "tzMm", "rxDeg", "ryDeg", "rzDeg", "dragX", "dragY"})
      if (request.contains(key)) json_double_field(request, key);
    if (request.contains("isPreview")) json_bool_field(request, "isPreview");
    return handle_command_typed(request);
  } catch (const JsonFieldError& error) {
    return make_response(requestId, "error", error_body("BAD_PARAMS", error.what()));
  } catch (const Json::exception& error) {
    return make_response(requestId, "error", error_body("BAD_PARAMS", error.what()));
  }
}

}  // namespace kreoda
