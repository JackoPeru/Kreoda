#include "dispatcher.h"

#include <atomic>
#include <cctype>
#include <filesystem>
#include <iomanip>
#include <map>
#include <set>
#include <sstream>

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
#include "features/booleans/boolean.h"
#include "features/evaluate.h"
#include "features/extrusion/extrude.h"
#include "features/fillet/fillet.h"
#include "features/hole/hole.h"
#include "features/primitives/primitives.h"
#include "features/revolve/revolve.h"
#include "features/sketch/sketch_commands.h"
#include "features/sketch/sketch_json.h"
#include "features/sketch/sketch_store.h"
#include "model/feature_graph.h"
#include "model/shapes.h"
#include "protocol/mesh_fb.h"
#include "topology/face_roles.h"
#include "persistence/icad_zip.h"
#include "persistence/ocaf_live.h"
#include "persistence/ocaf_store.h"
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

std::string find_raw(const std::string& json, const char* key) {
  const std::string pat = std::string("\"") + key + "\"";
  const auto pos = json.find(pat);
  if (pos == std::string::npos) return "";
  const auto colon = json.find(':', pos + pat.size());
  if (colon == std::string::npos) return "";
  const auto start = json.find_first_not_of(" \t", colon + 1);
  if (start == std::string::npos) return "";
  if (json[start] == '"') {
    const auto end = json.find('"', start + 1);
    if (end == std::string::npos) return "";
    return json.substr(start + 1, end - start - 1);
  }
  const auto end = json.find_first_of(",}", start);
  return json.substr(start, end == std::string::npos ? end : end - start);
}

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
  os << "],\"refExtra\":\"" << escape(rec.refExtra) << "\""
     << ",\"revision\":" << DocumentStore::instance().revision() << ","
     << undo_counts_body() << ",\"volumeMm3\":" << rec.volumeMm3
     << ",\"bboxMm\":[" << rec.bboxMm[0] << "," << rec.bboxMm[1] << ","
     << rec.bboxMm[2] << "," << rec.bboxMm[3] << "," << rec.bboxMm[4] << ","
     << rec.bboxMm[5] << "]";
  return os.str();
}

std::string sketch_body(const SketchFeature& sketch,
                        const SolveResult* solve = nullptr) {
  std::ostringstream os;
  os << std::setprecision(17);
  os << "\"featureId\":\"" << escape(sketch.id) << "\",\"type\":\"Sketch\""
     << ",\"planeKind\":\"" << escape(sketch.planeKind) << "\""
     << ",\"revision\":" << DocumentStore::instance().revision() << ","
     << undo_counts_body() << ",\"sketch\":"
     << SerializeSketchFeature(sketch);
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
    os << "],\"refExtra\":\"" << escape(rec.refExtra)
       << "\",\"volumeMm3\":" << rec.volumeMm3 << "}";
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
       << ",\"constraints\":" << sk.model.constraints.size() << "}";
  }
  os << "],\"revision\":" << DocumentStore::instance().revision() << ","
     << undo_counts_body();
  return os.str();
}

std::string manifest_json(const std::string& documentId) {
  std::ostringstream os;
  os << std::setprecision(17);
  os << "{\"format\":\"kreoda-project\",\"schemaVersion\":1,"
     << "\"appVersion\":\"0.1.0\",\"documentId\":\"" << escape(documentId)
     << "\",\"units\":\"mm\"}";
  return os.str();
}

// Rebuilds graph nodes from the stores with clean flags (open/undo/redo:
// geometry is current, nothing pending, §53). Sketches are nodes too;
// solids carry their sketch/feature deps.
void SyncGraphFromStore() {
  TheFeatureGraph().clear();
  for (const auto& sk : SketchStore::instance().listInOrder()) {
    TheFeatureGraph().addFeature(sk.id);
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

}  // namespace

std::string json_string_field(const std::string& json, const char* key,
                              const std::string& fallback) {
  const auto v = find_raw(json, key);
  return v.empty() ? fallback : v;
}

int json_int_field(const std::string& json, const char* key, int fallback) {
  const auto v = find_raw(json, key);
  if (v.empty()) return fallback;
  try {
    return std::stoi(v);
  } catch (...) {
    return fallback;
  }
}

double json_double_field(const std::string& json, const char* key,
                         double fallback) {
  const auto v = find_raw(json, key);
  if (v.empty()) return fallback;
  try {
    return std::stod(v);
  } catch (...) {
    return fallback;
  }
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
  (void)featureId;
  (void)lod;
  if (error) *error = "mesh binary requires FlatBuffers (link via vcpkg)";
  return {};
#endif
}
}  // namespace

std::vector<uint8_t> handle_command(const std::string& requestJson) {
  const std::string requestId = json_string_field(requestJson, "requestId", "");
  const int type = json_int_field(requestJson, "type", 0);
  const std::string documentId =
      json_string_field(requestJson, "documentId", "doc-bootstrap");

  // Envelope gate (§63.10, bug-hunt C3): ids/paths must be inert strings —
  // no quotes/controls that could confuse field extraction or the fs layer.
  // (Full strict-DOM envelope parsing is the follow-up; this kills the
  // cheapest injection shapes at the boundary.)
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
  // Paths reach both field extraction and the fs layer: quotes/controls
  // are never legitimate there (C3).
  auto cleanPath = [](const std::string& s) {
    if (s.empty() || s.size() > 1024) return false;
    for (unsigned char c : s) {
      if (c < 0x20 || c == '"') return false;
    }
    return true;
  };

  switch (type) {
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
      const int lod = json_int_field(requestJson, "lod", 1);
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
        std::error_code ec;
        fs::create_directories(fs::path(path).parent_path(), ec);
        std::string error;
        if (!ExportStep(path, &error)) {
          return make_response(requestId, "error",
                               error_body("EXPORT_FAILED", error));
        }
        std::ostringstream body;
        body << "\"path\":\"" << escape(path) << "\"," << feature_list_body();
        return make_response(requestId, "ok", body.str());
      }
      if (ext == ".3mf") {
        std::error_code ec;
        fs::create_directories(fs::path(path).parent_path(), ec);
        std::string error;
        if (!ExportThreeMF(path, &error)) {
          return make_response(requestId, "error",
                               error_body("EXPORT_FAILED", error));
        }
        std::ostringstream body;
        body << "\"path\":\"" << escape(path) << "\"," << feature_list_body();
        return make_response(requestId, "ok", body.str());
      }
      if (ext == ".stl") {
        std::error_code ec;
        fs::create_directories(fs::path(path).parent_path(), ec);
        std::string error;
        if (!ExportStl(path, &error)) {
          return make_response(requestId, "error",
                               error_body("EXPORT_FAILED", error));
        }
        std::ostringstream body;
        body << "\"path\":\"" << escape(path) << "\"," << feature_list_body();
        return make_response(requestId, "ok", body.str());
      }
      if (ext == ".obj") {
        std::error_code ec;
        fs::create_directories(fs::path(path).parent_path(), ec);
        std::string error;
        if (!ExportObj(path, &error)) {
          return make_response(requestId, "error",
                               error_body("EXPORT_FAILED", error));
        }
        std::ostringstream body;
        body << "\"path\":\"" << escape(path) << "\"," << feature_list_body();
        return make_response(requestId, "ok", body.str());
      }
      if (ext == ".gltf") {
        std::error_code ec;
        fs::create_directories(fs::path(path).parent_path(), ec);
        std::string error;
        if (!ExportGltf(path, &error)) {
          return make_response(requestId, "error",
                               error_body("EXPORT_FAILED", error));
        }
        std::ostringstream body;
        body << "\"path\":\"" << escape(path) << "\"," << feature_list_body();
        return make_response(requestId, "ok", body.str());
      }
      if (ext == ".glb") {
        std::error_code ec;
        fs::create_directories(fs::path(path).parent_path(), ec);
        std::string error;
        if (!ExportGlb(path, &error)) {
          return make_response(requestId, "error",
                               error_body("EXPORT_FAILED", error));
        }
        std::ostringstream body;
        body << "\"path\":\"" << escape(path) << "\"," << feature_list_body();
        return make_response(requestId, "ok", body.str());
      }
      std::error_code ec;
      const std::string tmp = uniqueTempDir("kreoda-save", ec);
      if (tmp.empty()) {
        return make_response(requestId, "error",
                             error_body("IO_ERROR", "no temp dir"));
      }
      const std::string xbf = (fs::path(tmp) / "document.xbf").string();
      std::string error;
      if (!SaveXbf(xbf, &error)) {
        fs::remove_all(tmp, ec);
        return make_response(requestId, "error",
                             error_body("SAVE_FAILED", error));
      }
      fs::create_directories(fs::path(path).parent_path(), ec);
      if (!WriteIcad(path, manifest_json(documentId), xbf, &error)) {
        fs::remove_all(tmp, ec);
        return make_response(requestId, "error",
                             error_body("SAVE_FAILED", error));
      }
      fs::remove_all(tmp, ec);
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
      MeshCache().clear();  // open replaces the doc in every branch below
      if (ext == ".step" || ext == ".stp") {
        // STEP import replaces the document (same as Open): fresh baseline,
        // one StepImport feature per solid in a single Undo step.
        std::string error;
        std::vector<std::string> created;
        DocumentStore::instance().create(documentId);
        if (!ImportStep(path, &created, &error)) {
          return make_response(requestId, "error",
                               error_body("OPEN_FAILED", error));
        }
        for (const auto& id : created) {
          ShapeRecord rec;
          DocumentStore::instance().noteFeature(
              id, ShapeStore::instance().get(id, &rec) ? rec.type
                                                      : "StepImport");
        }
        SyncGraphFromStore();
        DocumentStore::instance().commit();
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
      std::vector<ShapeRecord> records;
      std::vector<std::string> sketchJsons;
      // Fresh baseline BEFORE load (clears stores + OCAF); Load then opens
      // the file into the live doc with all labels (solids, sketches,
      // selections, evolution) intact — no re-mirroring needed.
      DocumentStore::instance().create(documentId);
      if (!OcafLive::instance().Load(xbf, &records, &sketchJsons, &error)) {
        fs::remove_all(tmp, ec);
        return make_response(requestId, "error",
                             error_body("OPEN_FAILED", error));
      }
      // Adopt into in-memory stores + graph (OCAF already holds the truth).
      for (auto& rec : records) {
        ShapeStore::instance().put(rec);
        DocumentStore::instance().noteFeature(rec.featureId, rec.type);
      }
      for (const auto& js : sketchJsons) {
        SketchFeature sf;
        std::string perr;
        if (ParseSketchFeature(js, &sf, &perr) && !sf.id.empty()) {
          SketchStore::instance().put(sf);
          DocumentStore::instance().noteFeature(sf.id, "Sketch");
        }
      }
      SyncGraphFromStore();
      DocumentStore::instance().commit();
      fs::remove_all(tmp, ec);
      std::ostringstream body;
      body << "\"path\":\"" << escape(path) << "\"," << feature_list_body();
      return make_response(requestId, "ok", body.str());
    }
    case kSetFeatureParameter: {
      // Typed dimension edit (§12, §22): exactly one committed transaction.
      // isPreview=true tessellates the would-be shape WITHOUT committing.
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      const std::string paramName =
          json_string_field(requestJson, "paramName", "");
      const int hasValue =
          requestJson.find("\"valueMm\"") != std::string::npos ||
          requestJson.find("\"value\"") != std::string::npos;
      const double value = json_double_field(requestJson, "valueMm",
                                             json_double_field(requestJson,
                                                               "value", 0));
      const bool isPreview =
          json_string_field(requestJson, "isPreview", "") == "true" ||
          json_int_field(requestJson, "isPreview", 0) == 1;
      if (featureId.empty() || paramName.empty() || !hasValue) {
        return make_response(requestId, "error",
                             error_body("BAD_PARAMS",
                                        "featureId, paramName and valueMm "
                                        "are required"));
      }
      if (isPreview) {
        // Transient preview (§13): resolved + built + tessellated WITHOUT
        // touching stores, revision, or OCAF. Never committed.
        std::string error;
        CoreMesh mesh;
        if (!BuildPreviewMesh(featureId, paramName, value, &mesh, &error) ||
            mesh.indices.empty()) {
          return make_response(requestId, "error",
                               error_body("PREVIEW_FAILED",
                                          error.empty() ? paramName : error));
        }
        std::vector<uint8_t> preview =
            mesh_success(requestId, featureId, 1, mesh, &error);
        if (preview.empty()) {
          return make_response(requestId, "error",
                               error_body("PREVIEW_FAILED", error.empty()
                                                                 ? paramName
                                                                 : error));
        }
        return preview;
      }
      std::string error;
      if (!RebuildFeature(featureId, paramName, value, &error)) {
        return make_response(requestId, "error",
                             error_body("REBUILD_FAILED", error));
      }
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
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
      std::string planeRaw;
      std::string planeKind = "XY";
      if (ExtractJsonValue(requestJson, "planeKind", &planeRaw)) {
        planeKind = planeRaw.size() >= 2 && planeRaw.front() == '"'
                        ? planeRaw.substr(1, planeRaw.size() - 2)
                        : planeRaw;
      }
      std::string modelRaw;
      SketchModel model;
      if (ExtractJsonValue(requestJson, "model", &modelRaw)) {
        std::string error;
        if (!ParseSketchModel(modelRaw, &model, &error)) {
          return make_response(requestId, "error",
                               error_body("BAD_SKETCH", error));
        }
      } else {
        // Inline flat form (points/lines/... at top level).
        std::string error;
        if (!ParseSketchModel(requestJson, &model, &error)) {
          return make_response(requestId, "error",
                               error_body("BAD_SKETCH", error));
        }
      }
      std::string error;
      if (!CreateSketchFeature(featureId, planeKind, model, &error)) {
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
          json_string_field(requestJson, "isPreview", "") == "true" ||
          json_int_field(requestJson, "isPreview", 0) == 1;
      std::string modelRaw;
      SketchModel model;
      if (ExtractJsonValue(requestJson, "model", &modelRaw)) {
        std::string error;
        if (!ParseSketchModel(modelRaw, &model, &error)) {
          return make_response(requestId, "error",
                               error_body("BAD_SKETCH", error));
        }
      } else {
        std::string error;
        if (!ParseSketchModel(requestJson, &model, &error)) {
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
        std::string dragRaw;
        if (ExtractJsonValue(requestJson, "dragPointId", &dragRaw) &&
            dragRaw.size() >= 2) {
          opts.hasDragTarget = true;
          opts.dragPointId = dragRaw.substr(1, dragRaw.size() - 2);
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
      std::string error;
      if (!CreateHoleFeature(featureId, targetId, faceRole, x, y, dia, mode,
                             depth, &error)) {
        return make_response(requestId, "error",
                             error_body("HOLE_FAILED", error));
      }
      ShapeRecord rec;
      ShapeStore::instance().get(featureId, &rec);
      return make_response(requestId, "ok", shape_body(rec));
    }
    case kCreateFillet:
    case kCreateChamfer: {
      const bool isFillet = (type == kCreateFillet);
      const std::string featureId =
          json_string_field(requestJson, "featureId", "");
      const std::string targetId =
          json_string_field(requestJson, "targetId", "");
      // edgeIds may arrive as a JSON array string or repeated fields;
      // accept both 'edgeIds' (JSON array) and 'edgeId' (single).
      std::vector<std::string> edgeIds;
      std::string raw;
      if (ExtractJsonValue(requestJson, "edgeIds", &raw)) {
        size_t a = 0;
        while (a < raw.size() && std::isspace((unsigned char)raw[a])) ++a;
        size_t b = raw.size();
        while (b > a && std::isspace((unsigned char)raw[b - 1])) --b;
        const std::string t = (b > a) ? raw.substr(a, b - a) : "";
        // Guard: malformed/empty envelopes must not index front()/back().
        if (t.size() >= 2 && t.front() == '[') {
          size_t start = 1;
          const size_t end =
              (t.back() == ']') ? t.size() - 1 : t.size();
          std::set<std::string> seen;  // dedupe: double Add() fails loudly
          size_t pos = start;
          while (pos < end) {
            while (pos < end &&
                   (t[pos] == ' ' || t[pos] == '\t' || t[pos] == '\n' ||
                    t[pos] == '\r' || t[pos] == ',' || t[pos] == '"')) {
              ++pos;
            }
            size_t stop = pos;
            while (stop < end && t[stop] != '"' && t[stop] != ',') ++stop;
            if (stop > pos) {
              const std::string id = t.substr(pos, stop - pos);
              // Trim trailing whitespace run-ups (e.g. "id" \t]).
              const size_t last = id.find_last_not_of(" \t\n\r");
              const std::string clean =
                  (last == std::string::npos) ? "" : id.substr(0, last + 1);
              if (!clean.empty() && !seen.count(clean)) {
                seen.insert(clean);
                edgeIds.push_back(clean);
              }
            }
            pos = stop;
          }
        }
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
      if (ExtractJsonValue(requestJson, "model", &modelRaw)) {
        std::string error;
        if (!ParseSketchModel(modelRaw, &model, &error)) {
          return make_response(requestId, "error",
                               error_body("BAD_SKETCH", error));
        }
      }
      SolveOptions opts;
      std::string dragRaw;
      if (ExtractJsonValue(requestJson, "dragPointId", &dragRaw) &&
          dragRaw.size() >= 2) {
        opts.hasDragTarget = true;
        opts.dragPointId = dragRaw.substr(1, dragRaw.size() - 2);
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
      std::ostringstream b;
      b << "\"preview\":true," << sketch_body(tmp, &r);
      return make_response(requestId, "ok", b.str());
    }
    case kRequestFaceInfo: {
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
      if (!ShapeStore::instance().get(featureId, &rec) ||
          rec.shape.IsNull()) {
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
    }
    default:
      return make_response(requestId, "error",
                           error_body("UNKNOWN_COMMAND",
                                      "unsupported type (core 0.1.0 "
                                      "implements 1-23)"));
  }
}

}  // namespace kreoda
