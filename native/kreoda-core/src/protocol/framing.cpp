#include "framing.h"

#include <stdexcept>

namespace kreoda::protocol {

std::vector<uint8_t> frame(const std::vector<uint8_t>& payload) {
  std::vector<uint8_t> out;
  out.reserve(4 + payload.size());
  const auto n = static_cast<uint32_t>(payload.size());
  out.push_back(static_cast<uint8_t>(n & 0xFF));
  out.push_back(static_cast<uint8_t>((n >> 8) & 0xFF));
  out.push_back(static_cast<uint8_t>((n >> 16) & 0xFF));
  out.push_back(static_cast<uint8_t>((n >> 24) & 0xFF));
  out.insert(out.end(), payload.begin(), payload.end());
  return out;
}

std::vector<uint8_t> frame(const std::string& payload) {
  return frame(std::vector<uint8_t>(payload.begin(), payload.end()));
}

void FrameDecoder::push(const uint8_t* data, size_t n) {
  buf_.insert(buf_.end(), data, data + n);
}

std::vector<std::vector<uint8_t>> FrameDecoder::pop() {
  std::vector<std::vector<uint8_t>> out;
  while (buf_.size() >= 4) {
    const uint32_t len = static_cast<uint32_t>(buf_[0]) |
                         (static_cast<uint32_t>(buf_[1]) << 8) |
                         (static_cast<uint32_t>(buf_[2]) << 16) |
                         (static_cast<uint32_t>(buf_[3]) << 24);
    if (len > kMaxFrameBytes) throw std::runtime_error("frame too large");
    if (buf_.size() < 4 + len) break;
    out.emplace_back(buf_.begin() + 4, buf_.begin() + 4 + len);
    buf_.erase(buf_.begin(), buf_.begin() + 4 + len);
  }
  return out;
}

}  // namespace kreoda::protocol
