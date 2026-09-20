#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace kreoda {

// Minimal JSON field extraction for Phase-1 envelopes (no JSON dep in core).
// Full validation moves to FlatBuffers codegen (schemas/cad_protocol.fbs).
std::string json_string_field(const std::string& json, const char* key,
                              const std::string& fallback = "");
// Strict variant honoring backslash escapes inside quoted strings.
std::string json_string_field_strict(const std::string& json, const char* key,
                              const std::string& fallback = "");
bool json_has_key(const std::string& json, const char* key);
bool json_double_strict(const std::string& json, const char* key, double* out);
int json_int_field(const std::string& json, const char* key, int fallback = 0);
double json_double_field(const std::string& json, const char* key,
                         double fallback = 0.0);

// Builds a ResponseEnvelope-equivalent JSON string (protocolVersion = 1),
// returned as UTF-8 bytes (framing is byte-oriented; JSON responses stay
// byte-identical so every existing consumer keeps working).
std::vector<uint8_t> make_response(const std::string& requestId,
                                   const std::string& status,
                                   const std::string& bodyJson);

std::vector<uint8_t> handle_command(const std::string& requestJson);

// Command ids (§65 + Phase-1 extension + Phase-4 sketches + Phase-5 solids;
// mirrored in cad_protocol.fbs and @kreoda/protocol — keep in sync).
enum CommandId {
  kGetCoreInfo = 1,
  kCreateDocument = 2,
  kCreateBox = 3,
  kCreateCylinder = 4,
  kCreateSphere = 5,
  kSetFeatureParameter = 6,
  kDeleteFeature = 7,
  kUndo = 8,
  kRedo = 9,
  kSaveDocument = 10,
  kOpenDocument = 11,
  kRequestMesh = 12,
  kCreateSketch = 13,
  kUpdateSketch = 14,
  kCreateExtrude = 15,
  kCreateRevolve = 16,
  kRequestSketch = 17,
  kPreviewSketch = 18,
  kCreateBoolean = 19,
  kCreateHole = 20,
  kCreateFillet = 21,
  kCreateChamfer = 22,
  kRequestFaceInfo = 23,
  kCreateInstance = 24,
  kCreateHolePattern = 25,
  kRequestSnapshot = 26,
  kBeginTransaction = 27,
  kCommitTransaction = 28,
  kRollbackTransaction = 29,
};

}  // namespace kreoda
