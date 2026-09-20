#include <gtest/gtest.h>

#include "../src/protocol/framing.h"

TEST(Framing, RoundTrip) {
  const std::string payload = R"({"protocolVersion":1})";
  const auto framed = intentcad::protocol::frame(payload);
  // 4-byte LE length prefix (§8)
  EXPECT_EQ(framed.size(), 4 + payload.size());
  EXPECT_EQ(framed[0], payload.size() & 0xFF);
  intentcad::protocol::FrameDecoder dec;
  dec.push(framed.data(), framed.size());
  auto out = dec.pop();
  ASSERT_EQ(out.size(), 1u);
  EXPECT_EQ(std::string(out[0].begin(), out[0].end()), payload);
}
