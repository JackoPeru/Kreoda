// Shared test helpers: dispatcher answers are byte vectors (JSON stays
// byte-identical UTF-8; mesh successes are FlatBuffers MeshUpdate tables).

#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "../src/protocol/dispatcher.h"

#ifdef INTENTCAD_WITH_FLATBUFFERS
#include <flatbuffers/flatbuffers.h>

#include "../src/protocol/generated/cad_protocol_generated.h"
#endif

namespace intentcad_test {

// JSON responses (everything except mesh successes) as text.
inline std::string rpcText(const std::string& body) {
  const std::vector<uint8_t> v = intentcad::handle_command(body);
  return std::string(v.begin(), v.end());
}

// Raw bytes (mesh responses).
inline std::vector<uint8_t> rpcBytes(const std::string& body) {
  return intentcad::handle_command(body);
}

inline bool rpcOk(const std::string& body) {
  return rpcText(body).find("\"status\":\"ok\"") != std::string::npos;
}

#ifdef INTENTCAD_WITH_FLATBUFFERS
// Verified-decode of a mesh response (nullptr when the bytes are not one).
inline const IntentCad::Protocol::MeshUpdate* meshRoot(
    const std::vector<uint8_t>& bytes) {
  if (bytes.size() < 16) return nullptr;
  const auto* update =
      flatbuffers::GetRoot<IntentCad::Protocol::MeshUpdate>(bytes.data());
  if (!update) return nullptr;
  flatbuffers::Verifier verifier(bytes.data(), bytes.size());
  if (!update->Verify(verifier)) return nullptr;
  return update;
}
#endif

}  // namespace intentcad_test
