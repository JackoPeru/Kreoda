#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace kreoda {

// Minimal base64 (transfer encoding for binary mesh buffers inside the
// JSON interim envelope — bytes stay float32/uint32 LE, never per-vertex
// JSON numbers, §8). Replaced by FlatBuffers byte vectors in Phase 2.
inline std::string Base64Encode(const uint8_t* data, size_t n) {
  static const char kAlphabet[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((n + 2) / 3) * 4);
  for (size_t i = 0; i < n; i += 3) {
    const uint32_t b0 = data[i];
    const uint32_t b1 = (i + 1 < n) ? data[i + 1] : 0;
    const uint32_t b2 = (i + 2 < n) ? data[i + 2] : 0;
    const uint32_t triple = (b0 << 16) | (b1 << 8) | b2;
    out.push_back(kAlphabet[(triple >> 18) & 0x3F]);
    out.push_back(kAlphabet[(triple >> 12) & 0x3F]);
    out.push_back((i + 1 < n) ? kAlphabet[(triple >> 6) & 0x3F] : '=');
    out.push_back((i + 2 < n) ? kAlphabet[triple & 0x3F] : '=');
  }
  return out;
}

inline std::string Base64Encode(const std::vector<float>& v) {
  return Base64Encode(reinterpret_cast<const uint8_t*>(v.data()),
                      v.size() * sizeof(float));
}

inline std::string Base64EncodeU32(const std::vector<uint32_t>& v) {
  return Base64Encode(reinterpret_cast<const uint8_t*>(v.data()),
                      v.size() * sizeof(uint32_t));
}

}  // namespace kreoda
