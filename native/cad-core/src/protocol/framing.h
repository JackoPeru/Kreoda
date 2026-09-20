#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace intentcad::protocol {

// Framed transport (§8): uint32 LE length + payload bytes.
constexpr uint32_t kProtocolVersion = 1;
constexpr size_t kMaxFrameBytes = 256u * 1024u * 1024u;

std::vector<uint8_t> frame(const std::vector<uint8_t>& payload);
std::vector<uint8_t> frame(const std::string& payload);

// Incremental decoder for stdin byte streams.
class FrameDecoder {
 public:
  void push(const uint8_t* data, size_t n);
  // Returns complete payloads (without length prefix).
  std::vector<std::vector<uint8_t>> pop();
 private:
  std::vector<uint8_t> buf_;
};

}  // namespace intentcad::protocol
